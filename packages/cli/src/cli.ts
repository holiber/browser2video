#!/usr/bin/env node
/**
 * @description Browser2Video CLI.
 */
import { Command } from "commander";
import path from "path";
import { fileURLToPath } from "url";
import { createServer, type ViteDevServer } from "vite";
import { run, runCollab, type Mode } from "@browser2video/runner";
import { basicUiScenario, collabScenario, githubScenario } from "@browser2video/scenarios";

type ScenarioName = "basic-ui" | "collab" | "github";
type RecordMode = "none" | "screencast" | "screen";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const demoRoot = path.join(repoRoot, "apps", "demo");

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

async function withViteIfNeeded(
  scenario: ScenarioName,
  baseUrlFromArgs: string | undefined,
  fn: (baseURL: string | undefined) => Promise<void>,
) {
  const needsDemoServer = scenario === "basic-ui" || scenario === "collab";
  if (!needsDemoServer) {
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
      root: demoRoot,
      server: { port: 0, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const info = server.resolvedUrls!;
    const baseURL = info.local[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
    await fn(baseURL);
  } finally {
    await server?.close();
  }
}

const program = new Command();

program
  .name("b2v")
  .description("Run E2E scenarios and record video proofs.")
  .addHelpText(
    "after",
    `
Examples:
  b2v list-scenarios
  b2v run --scenario basic-ui --mode human --record screencast --headed
  b2v run --scenario collab --mode human --record screen --headed --display-size 2560x720
  b2v run --scenario basic-ui --mode fast --record none
`,
  );

program
  .command("list-scenarios")
  .description("List built-in scenarios.")
  .action(() => {
    console.log(["basic-ui", "collab", "github"].join("\n"));
  });

program
  .command("doctor")
  .description("Print environment diagnostics and common fixes.")
  .action(async () => {
    const ffmpeg = await getFfmpegPath();
    console.log(`platform: ${process.platform} ${process.arch}`);
    console.log(`node: ${process.version}`);
    console.log(`ffmpeg: ${ffmpeg ?? "(not found via @ffmpeg-installer/ffmpeg; will use PATH)"}`);
    if (process.platform === "darwin") {
      console.log(
        "macOS note: screen recording requires Privacy & Security → Screen Recording permission for the app launching ffmpeg.",
      );
    }
    if (process.platform !== "darwin") {
      console.log("Linux/CI note: screen recording requires DISPLAY (use Xvfb/xvfb-run).");
    }
  });

program
  .command("run")
  .description("Run a scenario in human or fast mode, optionally recording a video.")
  .requiredOption("--scenario <name>", "Scenario name: basic-ui | collab | github")
  .option("--mode <mode>", "Mode: human | fast", "human")
  .option("--record <mode>", "Record mode: none | screencast | screen", "screencast")
  .option("--artifacts <dir>", "Artifacts output directory (default: artifacts/<scenario>-<timestamp>)")
  .option("--base-url <url>", "Use an existing server instead of starting Vite")
  .option("--headed", "Force headed browser")
  .option("--headless", "Force headless browser")
  .option("--display-size <WxH>", "Linux screen capture display size, e.g. 2560x720")
  .option("--display <DISPLAY>", "Linux DISPLAY, e.g. :99")
  .option("--screen-index <n>", "macOS screen index for avfoundation capture")
  .action(async (opts) => {
    const scenario = opts.scenario as ScenarioName;
    const mode = opts.mode as Mode;
    const record = opts.record as RecordMode;
    const artifactsDir =
      opts.artifacts ?? path.join(repoRoot, "artifacts", `${scenario}-${isoStamp()}`);

    const ffmpegPath = await getFfmpegPath();

    const headless =
      typeof opts.headless === "boolean"
        ? opts.headless
        : (typeof opts.headed === "boolean" ? !opts.headed : undefined);

    await withViteIfNeeded(scenario, opts.baseUrl, async (baseURL) => {
      if (scenario === "collab") {
        await runCollab({
          mode,
          baseURL,
          artifactDir: artifactsDir,
          scenario: collabScenario,
          ffmpegPath,
          headless,
          recordMode: record,
          display: opts.display,
          displaySize: opts.displaySize,
          screenIndex: opts.screenIndex ? parseInt(String(opts.screenIndex), 10) : undefined,
          bossPath: "/notes?role=boss",
          workerPath: "/notes?role=worker",
          captureSelector: '[data-testid="notes-page"]',
          capturePadding: 24,
        });
        return;
      }

      const scenarioFn = scenario === "github" ? githubScenario : basicUiScenario;
      await run({
        mode,
        baseURL,
        artifactDir: artifactsDir,
        scenario: scenarioFn,
        ffmpegPath,
        headless,
        recordMode: record,
      });
    });

    console.log(`Artifacts: ${artifactsDir}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

