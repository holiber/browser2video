/**
 * @description CLI adapter — derives commands from the procedure router.
 *
 * Usage: `b2v <resource> <action> [--flags]`
 * e.g.  `b2v scenario run my-test.ts --mode fast`
 *        `b2v system doctor`
 */
import { type Router, type CallContext, type ProcedureDescriptor } from "../unapi.ts";
import { type B2vState, createB2vState } from "../procedures.ts";
import { type ZodType, type ZodObject, type ZodOptional, type ZodDefault, ZodEnum } from "zod";

/**
 * Extract flat key-value flag definitions from a Zod object schema
 * for use with a CLI parser.
 */
function zodObjectToFlags(schema: ZodType): Array<{
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  choices?: string[];
}> {
  const flags: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description?: string;
    defaultValue?: unknown;
    choices?: string[];
  }> = [];

  const shape = getZodShape(schema);
  if (!shape) return flags;

  for (const [key, rawField] of Object.entries(shape)) {
    const { inner, hasDefault, defaultValue, isOptional } = unwrapZodField(rawField as ZodType);
    const desc = getZodDescription(rawField as ZodType) ?? getZodDescription(inner);
    const choices = inner instanceof ZodEnum ? (inner as any)._def.values as string[] : undefined;

    let type: "string" | "number" | "boolean" = "string";
    const typeName = inner._def?.typeName;
    if (typeName === "ZodNumber") type = "number";
    else if (typeName === "ZodBoolean") type = "boolean";

    flags.push({
      name: key,
      type,
      required: !isOptional && !hasDefault,
      description: desc,
      defaultValue: hasDefault ? defaultValue : undefined,
      choices,
    });
  }
  return flags;
}

function getZodShape(schema: ZodType): Record<string, ZodType> | null {
  const def = (schema as any)?._def;
  if (!def) return null;
  if (def.typeName === "ZodObject") return def.shape?.() ?? null;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
    return getZodShape(def.innerType);
  }
  return null;
}

function unwrapZodField(field: ZodType): {
  inner: ZodType;
  hasDefault: boolean;
  defaultValue: unknown;
  isOptional: boolean;
} {
  let inner = field;
  let hasDefault = false;
  let defaultValue: unknown;
  let isOptional = false;

  while (true) {
    const def = (inner as any)?._def;
    if (!def) break;
    if (def.typeName === "ZodDefault") {
      hasDefault = true;
      defaultValue = def.defaultValue();
      inner = def.innerType;
    } else if (def.typeName === "ZodOptional") {
      isOptional = true;
      inner = def.innerType;
    } else {
      break;
    }
  }
  return { inner, hasDefault, defaultValue, isOptional };
}

function getZodDescription(schema: ZodType): string | undefined {
  return (schema as any)?._def?.description;
}

/** kebab-case helper: "scenarioFile" → "scenario-file" */
function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Parse a flat argv array (after resource+action are consumed) into key-value pairs. */
function parseFlags(argv: string[], flagDefs: ReturnType<typeof zodObjectToFlags>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const byName = new Map(flagDefs.map((f) => [f.name, f]));
  const byKebab = new Map(flagDefs.map((f) => [toKebab(f.name), f]));

  let positionalIdx = 0;
  const positionals = flagDefs.filter((f) => f.required && f.type === "string");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const key = eqIdx > 0 ? arg.slice(2, eqIdx) : arg.slice(2);
      const rawVal = eqIdx > 0 ? arg.slice(eqIdx + 1) : argv[++i];

      const def = byKebab.get(key) ?? byName.get(key);
      if (!def) continue;

      if (def.type === "boolean") {
        result[def.name] = rawVal === undefined || rawVal === "true";
        if (rawVal !== undefined && rawVal !== "true" && rawVal !== "false") i--;
      } else if (def.type === "number") {
        result[def.name] = Number(rawVal);
      } else {
        result[def.name] = rawVal;
      }
    } else if (positionalIdx < positionals.length) {
      result[positionals[positionalIdx].name] = arg;
      positionalIdx++;
    }
  }

  for (const def of flagDefs) {
    if (result[def.name] === undefined && def.defaultValue !== undefined) {
      result[def.name] = def.defaultValue;
    }
  }

  return result;
}

export interface CliAdapterOptions {
  router: Router;
  state?: B2vState;
  /** Override process.argv (for testing). */
  argv?: string[];
  /** Print function (defaults to console.log). */
  print?: (msg: string) => void;
  /** Error print function (defaults to console.error). */
  printError?: (msg: string) => void;
}

/**
 * Run the CLI adapter: parse argv, dispatch to router, print result.
 * Returns the exit code.
 */
export async function runCli(opts: CliAdapterOptions): Promise<number> {
  const { router, print = console.log, printError = console.error } = opts;
  const argv = opts.argv ?? process.argv.slice(2);
  const state = opts.state ?? createB2vState();

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage(router, print);
    return 0;
  }

  const descriptors = router.describe();
  const first = argv[0];
  const second = argv[1];

  // Try `b2v resource.action` (dotted form)
  let proc = descriptors.find((d) => d.id === first);
  let flagArgv = argv.slice(1);

  // Try `b2v resource action` (space-separated form)
  if (!proc && second && !second.startsWith("-")) {
    proc = descriptors.find((d) => d.id === `${first}.${second}`);
    if (proc) flagArgv = argv.slice(2);
  }

  if (!proc) {
    printError(`Unknown command: ${argv.slice(0, 2).join(" ")}`);
    printError(`Run "b2v --help" for available commands.`);
    return 1;
  }

  if (flagArgv.includes("--help") || flagArgv.includes("-h")) {
    printProcedureHelp(proc, print);
    return 0;
  }

  const flagDefs = zodObjectToFlags(proc.inputSchema);
  const input = parseFlags(flagArgv, flagDefs);

  const ctx: Partial<CallContext> = {
    state: state as unknown as Record<string, unknown>,
    sendProgress: (_cur, _total, msg) => printError(`  ${msg}`),
  };

  try {
    const result = await router.call(proc.id, input, ctx);
    if (result !== undefined && result !== null) {
      print(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (err) {
    printError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function printUsage(router: Router, print: (msg: string) => void) {
  print("b2v — Browser2Video CLI\n");
  print("Usage: b2v <resource> <action> [--flags]\n");
  print("Commands:");
  for (const [resource, procs] of router.byResource()) {
    print(`\n  ${resource}:`);
    for (const p of procs) {
      const desc = p.meta.description.split(".")[0];
      print(`    ${p.id.padEnd(28)} ${desc}`);
    }
  }
  print("\nRun \"b2v <command> --help\" for details.");
}

function printProcedureHelp(proc: ProcedureDescriptor, print: (msg: string) => void) {
  print(`b2v ${proc.id}\n`);
  print(proc.meta.description + "\n");

  const flags = zodObjectToFlags(proc.inputSchema);
  if (flags.length > 0) {
    print("Options:");
    for (const f of flags) {
      const req = f.required ? " (required)" : "";
      const def = f.defaultValue !== undefined ? ` [default: ${JSON.stringify(f.defaultValue)}]` : "";
      const choices = f.choices ? ` [choices: ${f.choices.join(", ")}]` : "";
      print(`  --${toKebab(f.name).padEnd(22)} ${f.description ?? ""}${req}${def}${choices}`);
    }
  }

  if (proc.meta.examples?.length) {
    print("\nExamples:");
    for (const ex of proc.meta.examples) {
      print(`  ${ex.title}: ${ex.code}`);
    }
  }
}
