#!/usr/bin/env node
/**
 * @description Browser2Video CLI — yargs-based command parser.
 * Commands: run <file>, doctor.
 * Schemas for run options come from the operation registry (single source of truth).
 */
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { RunInputSchema } from "./ops/tools.ts";
import { runScenarioAsNodeTs } from "./runner.ts";

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------

const cwd = process.cwd();

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

// Scenario running is handled by runner.ts (no monorepo assumptions).

// ---------------------------------------------------------------------------
//  Shared CLI options (derived from RunInputSchema)
// ---------------------------------------------------------------------------

/**
 * Add run-related options to a yargs command.
 * Options and descriptions are derived from the RunInputSchema.
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
  .demandCommand(1, "Please specify a command: run or doctor")
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

    if (argv.narrate === true) env.B2V_NARRATE = "true";
    if (argv.voice) env.B2V_VOICE = argv.voice as string;
    if (argv.narrateSpeed) env.B2V_NARRATION_SPEED = String(argv.narrateSpeed);
    if (argv.realtimeAudio) env.B2V_REALTIME_AUDIO = "true";
    if (argv.language) env.B2V_NARRATION_LANGUAGE = argv.language as string;

    const res = await runScenarioAsNodeTs({
      scenarioFile: filePath,
      cwd,
      env,
      streamOutput: true,
    });

    process.exit(res.code);
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
