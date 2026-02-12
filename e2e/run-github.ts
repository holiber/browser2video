/**
 * @description CLI entry point for the GitHub scenario.
 * Does NOT start a Vite server — launches the system Chrome with a
 * copy of the user's profile so the browser is already logged into GitHub.
 *
 * Usage:
 *   tsx e2e/run-github.ts --mode human --headed
 *
 * IMPORTANT: Close Google Chrome before running this script.
 * Puppeteer cannot share a Chrome profile with a running Chrome instance.
 */
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { run, type Mode } from "./runner.js";
import { githubScenario } from "./github-scenario.js";

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
    if (args[i] === "--headless") headless = true;
    if (args[i] === "--headed") headless = false;
  }

  return { mode, headless };
}

// ---------------------------------------------------------------------------
//  Chrome profile helpers (macOS)
// ---------------------------------------------------------------------------

function getChromeExecutablePath(): string {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

/**
 * Copy the Chrome "Default" profile + Local State to a temporary directory.
 * Chrome refuses remote-debugging when launched with its default data dir,
 * so we use a copy. The system Chrome binary can still decrypt cookies
 * because the Keychain key is tied to the binary, not the data dir.
 */
function prepareTempProfile(): string {
  const sourceDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "b2v-chrome-"));
  const destDefault = path.join(tempDir, "Default");
  fs.mkdirSync(destDefault, { recursive: true });

  // Copy Local State (contains cookie encryption metadata)
  const localState = path.join(sourceDir, "Local State");
  if (fs.existsSync(localState)) {
    fs.cpSync(localState, path.join(tempDir, "Local State"));
  }

  // Copy only the essential auth/cookie files (not the whole profile)
  const essentialFiles = [
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data-journal",
    "Web Data",
    "Web Data-journal",
    "Preferences",
    "Secure Preferences",
  ];
  console.log("  Copying Chrome cookies to temp profile...");
  for (const file of essentialFiles) {
    const src = path.join(sourceDir, "Default", file);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(destDefault, file));
    }
  }

  return tempDir;
}

// ---------------------------------------------------------------------------
//  Resolve ffmpeg path
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
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const artifactDir = path.join(rootDir, "artifacts", `github-${timestamp}`);
  const executablePath = getChromeExecutablePath();

  console.log("\n======================================");
  console.log("  Browser2Video — GitHub Scenario");
  console.log("======================================");
  console.log(
    "\n  WARNING: Close Google Chrome before running this script.",
  );
  console.log(
    "  Puppeteer cannot share a profile with a running Chrome instance.\n",
  );
  console.log(`  Chrome binary: ${executablePath}`);

  const userDataDir = prepareTempProfile();
  console.log(`  Temp profile:  ${userDataDir}`);

  const ffmpegPath = await getFfmpegPath();
  if (ffmpegPath) {
    console.log(`  ffmpeg: ${ffmpegPath}`);
  } else {
    console.log("  ffmpeg: using system PATH");
  }

  try {
    const result = await run({
      mode,
      artifactDir,
      scenario: githubScenario,
      ffmpegPath,
      headless,
      userDataDir,
      executablePath,
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
    // Clean up temp profile
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
