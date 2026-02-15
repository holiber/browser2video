#!/usr/bin/env node
/**
 * @description Browser2Video CLI — yargs-based command parser.
 * Commands: run <file>, list [dir], doctor.
 * Scenarios are loaded dynamically from files (no hardcoded names).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { createServer, type ViteDevServer } from "vite";
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "@browser2video/runner";
import type {
  ScenarioConfig,
  ScenarioContext,
  RunOptions,
  Mode,
  NarrationOptions,
} from "@browser2video/runner";

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const defaultScenariosDir = path.join(repoRoot, "tests", "scenarios");

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function getFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = await import("@ffmpeg-installer/ffmpeg");
    return (mod as any).default?.path ?? (mod as any).path;
  } catch {
    return undefined;
  }
}

/**
 * Start a Vite dev server when a scenario declares `server.type === "vite"`,
 * unless the caller already passed a --base-url.
 */
async function withViteIfNeeded(
  viteRoot: string | null,
  baseUrlFromArgs: string | undefined,
  fn: (baseURL: string | undefined) => Promise<void>,
) {
  if (!viteRoot) {
    await fn(baseUrlFromArgs);
    return;
  }
  if (baseUrlFromArgs) {
    await fn(baseUrlFromArgs);
    return;
  }

  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root: viteRoot,
      server: { port: 0, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const info = server.resolvedUrls!;
    const baseURL =
      info.local[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
    await fn(baseURL);
  } finally {
    await server?.close();
  }
}

/**
 * Dynamically import a scenario file and extract `config` + `default` exports.
 */
async function loadScenarioFile(filePath: string): Promise<{
  config: ScenarioConfig;
  scenarioFn: (ctx: ScenarioContext) => Promise<void>;
}> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(abs)) {
    throw new Error(`Scenario file not found: ${abs}`);
  }

  const mod: any = await import(pathToFileURL(abs).href);

  const scenarioFn: ((ctx: ScenarioContext) => Promise<void>) | undefined =
    typeof mod.default === "function"
      ? mod.default
      : typeof mod.scenario === "function"
        ? mod.scenario
        : undefined;

  if (!scenarioFn) {
    throw new Error(
      `Scenario file does not export a default or "scenario" function: ${abs}`,
    );
  }

  // If the file exports a config, use it.
  // Otherwise fall back to a sensible default (single browser pane + vite).
  const config: ScenarioConfig = mod.config ?? {
    server: { type: "vite" as const, root: path.join(repoRoot, "apps", "demo") },
    panes: [{ id: "main", type: "browser" as const, path: "/" }],
  };

  return { config, scenarioFn };
}

// ---------------------------------------------------------------------------
//  Shared CLI options (used by `run`)
// ---------------------------------------------------------------------------

function addRunOptions<T>(yarg: Argv<T>) {
  return yarg
    .option("mode", {
      alias: "m",
      type: "string",
      choices: ["human", "fast"] as const,
      default: "human" as const,
      describe: "Execution speed mode",
    })
    .option("record", {
      alias: "r",
      type: "string",
      choices: ["none", "screencast", "screen"] as const,
      default: "screencast" as const,
      describe: "Recording mode",
    })
    .option("artifacts", {
      type: "string",
      describe: "Artifacts output directory",
    })
    .option("base-url", {
      type: "string",
      describe: "Use an existing server instead of starting one",
    })
    .option("headed", {
      type: "boolean",
      describe: "Force headed browser",
    })
    .option("headless", {
      type: "boolean",
      describe: "Force headless browser",
    })
    .option("display-size", {
      type: "string",
      describe: "Linux screen capture display size, e.g. 2560x720",
    })
    .option("display", {
      type: "string",
      describe: "Linux DISPLAY, e.g. :99",
    })
    .option("screen-index", {
      type: "number",
      describe: "macOS screen index for avfoundation capture",
    })
    .option("debug-overlay", {
      type: "boolean",
      default: false,
      describe: "Show sync debug overlay",
    })
    .option("devtools", {
      type: "boolean",
      default: false,
      describe: "Open Chrome DevTools automatically",
    })
    .option("narrate", {
      type: "boolean",
      describe: "Enable TTS narration (requires OPENAI_API_KEY)",
    })
    .option("voice", {
      type: "string",
      default: "nova",
      describe: "OpenAI TTS voice: alloy | echo | fable | onyx | nova | shimmer",
    })
    .option("narrate-speed", {
      type: "number",
      default: 1.0,
      describe: "Narration speed 0.25-4.0",
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
  "Run a scenario file and optionally record video",
  (y) => {
    const withFile = y.positional("file", {
      type: "string",
      describe: "Path to a *.scenario.ts file",
      demandOption: true,
    });
    return addRunOptions(withFile);
  },
  async (argv) => {
    const filePath = argv.file as string;
    const { config, scenarioFn } = await loadScenarioFile(filePath);

    const scenarioLabel = path
      .basename(filePath)
      .replace(/\.scenario\.(ts|js|mts|mjs)$/, "");

    const artifactsDir =
      argv.artifacts ??
      path.join(repoRoot, "artifacts", `${scenarioLabel}-${isoStamp()}`);

    const ffmpegPath = await getFfmpegPath();

    const headless =
      typeof argv.headless === "boolean"
        ? argv.headless
        : typeof argv.headed === "boolean"
          ? !argv.headed
          : undefined;

    const narration: NarrationOptions | undefined = argv.narrate
      ? {
          enabled: true,
          voice: argv.voice as string,
          speed: argv.narrateSpeed as number,
        }
      : undefined;

    // Determine vite root from config when server.type === "vite"
    const viteRoot =
      config.server?.type === "vite" ? config.server.root : null;

    await withViteIfNeeded(
      viteRoot,
      argv.baseUrl as string | undefined,
      async (baseURL) => {
        const runOpts: RunOptions = {
          mode: argv.mode as Mode,
          baseURL,
          artifactDir: artifactsDir,
          recordMode: argv.record as RunOptions["recordMode"],
          ffmpegPath,
          headless,
          narration,
          devtools: Boolean(argv.devtools),
          display: argv.display as string | undefined,
          displaySize: argv.displaySize as string | undefined,
          screenIndex: argv.screenIndex as number | undefined,
          debugOverlay: Boolean(argv.debugOverlay),
        };

        await run(config, scenarioFn, runOpts);
      },
    );

    console.log(`Artifacts: ${artifactsDir}`);
  },
);

// ---- list [dir] -----------------------------------------------------------

cli.command(
  "list [dir]",
  "List *.scenario.ts files in a directory",
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
      .filter((f) => f.endsWith(".scenario.ts"))
      .sort();

    if (files.length === 0) {
      console.log("(no scenario files found)");
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
    const ffmpeg = await getFfmpegPath();
    console.log(`platform: ${process.platform} ${process.arch}`);
    console.log(`node: ${process.version}`);
    console.log(
      `ffmpeg: ${ffmpeg ?? "(not found via @ffmpeg-installer/ffmpeg; will use PATH)"}`,
    );
    if (process.platform === "darwin") {
      console.log(
        "macOS note: screen recording requires Privacy & Security → Screen Recording permission for the app launching ffmpeg.",
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
