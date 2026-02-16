#!/usr/bin/env node
/**
 * @description Browser2Video CLI — yargs-based command parser.
 * Commands: run <file>, list [dir], doctor.
 * Schemas for run options come from @browser2video/lib (single source of truth).
 */
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { RunInputSchema } from "@browser2video/lib";

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const defaultScenariosDir = path.join(repoRoot, "tests", "scenarios");

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Run a test file as a subprocess via `node` (native TS support).
 * CLI options are passed as B2V_* environment variables.
 */
function runTestFile(
  filePath: string,
  env: Record<string, string>,
): Promise<{ code: number }> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }

  return new Promise((resolve) => {
    const proc = execFile(
      process.execPath,
      [abs],
      {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024,
      },
      (err) => {
        resolve({ code: err?.code ? Number(err.code) : 0 });
      },
    );

    // Stream stdout/stderr to the terminal in real time
    proc.stdout?.pipe(process.stdout);
    proc.stderr?.pipe(process.stderr);
  });
}

// ---------------------------------------------------------------------------
//  Shared CLI options (derived from RunInputSchema)
// ---------------------------------------------------------------------------

/**
 * Add run-related options to a yargs command.
 * Options and descriptions are derived from the RunInputSchema in @browser2video/lib.
 */
function addRunOptions<T>(yarg: Argv<T>) {
  // Extract descriptions from the Zod schema at the field level
  const shape = RunInputSchema.shape;

  return yarg
    .option("mode", {
      alias: "m",
      type: "string",
      choices: ["human", "fast"] as const,
      default: "human" as const,
      describe: shape.mode._def.description ?? "Execution speed mode",
    })
    .option("headed", {
      type: "boolean",
      describe: "Force headed browser",
    })
    .option("headless", {
      type: "boolean",
      describe: "Force headless browser",
    })
    .option("narrate", {
      type: "boolean",
      describe: "Enable TTS narration (requires OPENAI_API_KEY)",
    })
    .option("voice", {
      type: "string",
      default: "ash",
      describe: shape.voice._def.description ?? "OpenAI TTS voice",
    })
    .option("narrate-speed", {
      type: "number",
      default: 1.0,
      describe: shape.narrationSpeed._def.innerType._def.description ?? "Narration speed 0.25-4.0",
    })
    .option("realtime-audio", {
      type: "boolean",
      default: false,
      describe: shape.realtimeAudio._def.innerType._def.description ?? "Play narration in realtime",
    })
    .option("language", {
      type: "string",
      describe: shape.language._def.innerType._def.description ?? "Auto-translate narration language",
    });
}

// ---------------------------------------------------------------------------
//  CLI definition
// ---------------------------------------------------------------------------

const cli = yargs(hideBin(process.argv))
  .scriptName("b2v")
  .usage("$0 <command> [options]")
  .strict()
  .demandCommand(1, "Please specify a command: run, list, or doctor")
  .help();

// ---- run <file> -----------------------------------------------------------

cli.command(
  "run <file>",
  "Run a test/scenario file and record video",
  (y) => {
    const withFile = y.positional("file", {
      type: "string",
      describe: "Path to a *.test.ts file",
      demandOption: true,
    });
    return addRunOptions(withFile);
  },
  async (argv) => {
    const filePath = argv.file as string;

    // Build env vars from CLI flags
    const env: Record<string, string> = {};

    env.B2V_MODE = argv.mode as string;

    if (argv.headed === true) env.B2V_HEADED = "true";
    if (argv.headless === true) env.B2V_HEADED = "false";

    if (argv.voice) env.B2V_VOICE = argv.voice as string;
    if (argv.narrateSpeed) env.B2V_NARRATION_SPEED = String(argv.narrateSpeed);
    if (argv.realtimeAudio) env.B2V_REALTIME_AUDIO = "true";
    if (argv.language) env.B2V_NARRATION_LANGUAGE = argv.language as string;

    const { code } = await runTestFile(filePath, env);

    process.exit(code);
  },
);

// ---- list [dir] -----------------------------------------------------------

cli.command(
  "list [dir]",
  "List *.test.ts scenario files in a directory",
  (y) =>
    y.positional("dir", {
      type: "string",
      default: defaultScenariosDir,
      describe: "Directory to scan (default: tests/scenarios)",
    }),
  (argv) => {
    const dir = path.isAbsolute(argv.dir as string)
      ? (argv.dir as string)
      : path.resolve(process.cwd(), argv.dir as string);

    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts"))
      .sort();

    if (files.length === 0) {
      console.log("(no test files found)");
    } else {
      for (const f of files) {
        console.log(f);
      }
    }
  },
);

// ---- doctor ---------------------------------------------------------------

cli.command(
  "doctor",
  "Print environment diagnostics and common fixes",
  () => {},
  async () => {
    console.log(`platform: ${process.platform} ${process.arch}`);
    console.log(`node: ${process.version}`);

    // Check ffmpeg availability
    try {
      const { execFileSync } = await import("child_process");
      const ver = execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }).toString().split("\n")[0];
      console.log(`ffmpeg: ${ver}`);
    } catch {
      console.log("ffmpeg: not found in PATH");
    }

    if (process.platform === "darwin") {
      console.log(
        "macOS note: screen recording requires Privacy & Security → Screen Recording permission.",
      );
    }
    if (process.platform !== "darwin") {
      console.log(
        "Linux/CI note: screen recording requires DISPLAY (use Xvfb/xvfb-run).",
      );
    }
  },
);

// ---- parse & run ----------------------------------------------------------

cli.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
