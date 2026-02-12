/**
 * @description CLI entry point for the scenario runner.
 * Starts the Vite dev server, runs the scenario, and outputs artifacts.
 *
 * Usage:
 *   tsx e2e/run.ts --mode human
 *   tsx e2e/run.ts --mode fast
 */
import { createServer, type ViteDevServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { run, type Mode } from "./runner.js";
import { demoScenario } from "./scenario.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
//  Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { mode: Mode; headless?: boolean } {
  const args = process.argv.slice(2);
  let mode: Mode = "human";
  let headless: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      const m = args[i + 1];
      if (m !== "human" && m !== "fast") {
        console.error(`Invalid mode: ${m}. Use "human" or "fast".`);
        process.exit(1);
      }
      mode = m;
      i++;
    }
    if (args[i] === "--headless") {
      headless = true;
    }
    if (args[i] === "--headed") {
      headless = false;
    }
  }

  return { mode, headless };
}

// ---------------------------------------------------------------------------
//  Resolve ffmpeg path from @ffmpeg-installer/ffmpeg
// ---------------------------------------------------------------------------

async function getFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = await import("@ffmpeg-installer/ffmpeg");
    const ffmpegPath = (mod as any).default?.path ?? (mod as any).path;
    if (ffmpegPath) return ffmpegPath;
  } catch {
    // fallback to system ffmpeg
  }
  return undefined;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  const { mode, headless } = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const artifactDir = path.join(rootDir, "artifacts", timestamp);

  console.log("\n======================================");
  console.log("  Browser2Video Scenario Runner");
  console.log("======================================");

  // Start Vite dev server
  console.log("\n  Starting Vite dev server...");
  let server: ViteDevServer | undefined;
  let baseURL: string;

  try {
    server = await createServer({
      root: rootDir,
      server: { port: 0, strictPort: false },
      logLevel: "error",
    });
    await server.listen();

    const info = server.resolvedUrls!;
    baseURL = info.local[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
    console.log(`  Vite running at: ${baseURL}`);
  } catch (err) {
    console.error("Failed to start Vite dev server:", err);
    process.exit(1);
  }

  const ffmpegPath = await getFfmpegPath();
  if (ffmpegPath) {
    console.log(`  ffmpeg: ${ffmpegPath}`);
  } else {
    console.log("  ffmpeg: using system PATH");
  }

  try {
    const result = await run({
      mode,
      baseURL,
      artifactDir,
      scenario: demoScenario,
      ffmpegPath,
      headless,
    });

    console.log("======================================");
    console.log("  Run complete!");
    console.log(`  Video:     ${result.videoPath}`);
    console.log(`  Subtitles: ${result.subtitlesPath}`);
    console.log(`  Metadata:  ${result.metadataPath}`);
    console.log(`  Steps:     ${result.steps.length}`);
    console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log("======================================\n");
  } finally {
    await server?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
