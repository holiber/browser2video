/**
 * Forced TTS engine selection test.
 *
 * Verifies that B2V_TTS_PROVIDER=system forces the macOS built-in TTS
 * (or falls back to Piper on systems without native TTS).
 * Runs the slides-and-narration scenario which has narration steps.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const SCENARIO = "tests/scenarios/slides-and-narration.scenario.ts";
const TEST_PORT = 9681;
const TEST_CDP_PORT = 9481;

function killPort(port: number) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
    }
  } catch { }
}

async function closeElectron(app: ElectronApplication) {
  try {
    const proc = app.process();
    const pid = proc.pid;
    if (pid && proc.exitCode === null && proc.signalCode === null) {
      process.kill(pid, "SIGTERM");
      await new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        setTimeout(() => {
          try { process.kill(pid, "SIGKILL"); } catch { }
          resolve();
        }, 5_000);
      });
    }
  } catch { /* already exited */ }
}

function hasSystemTts(): boolean {
  if (process.platform === "darwin") {
    try { execSync("which say", { stdio: "pipe" }); return true; } catch { return false; }
  }
  if (process.platform === "win32") return true;
  try { execSync("which espeak-ng", { stdio: "pipe" }); return true; } catch {
    try { execSync("which espeak", { stdio: "pipe" }); return true; } catch { return false; }
  }
}

test.describe.configure({ mode: "serial" });

test("forced system TTS provider runs scenario without errors", async () => {
  test.setTimeout(180_000);
  killPort(TEST_PORT);
  killPort(TEST_CDP_PORT);

  let electronApp: ElectronApplication | null = null;
  try {
    electronApp = await _electron.launch({
      args: [PLAYER_DIR, SCENARIO],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-strip-types --no-warnings",
        PORT: String(TEST_PORT),
        B2V_CDP_PORT: String(TEST_CDP_PORT),
        B2V_MODE: "human",
        B2V_TTS_PROVIDER: "system",
        B2V_REALTIME_AUDIO: "false",
      },
      timeout: 60_000,
    });

    const page: Page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });

    // Autoplay should start — wait for the stop button or error banner
    const result = await Promise.race([
      page.waitForSelector("[data-testid='ctrl-stop']", { timeout: 120_000 }).then(() => "running" as const),
      page.waitForSelector(".bg-red-950", { timeout: 120_000 }).then(() => "error" as const),
    ]);

    if (result === "error") {
      const msg = await page.locator(".bg-red-950").textContent().catch(() => "unknown");
      if (hasSystemTts()) {
        throw new Error(`Scenario errored with system TTS: ${msg}`);
      }
      // If system TTS is not available, an error is acceptable
      console.log(`System TTS not available — error expected: ${msg}`);
    } else {
      console.log("Scenario running with forced system TTS");
    }
  } finally {
    if (electronApp) await closeElectron(electronApp);
  }
});

test("TTS cache directory contains audio files after run", async () => {
  const cacheDir = path.join(PROJECT_ROOT, ".cache", "tts");
  if (!fs.existsSync(cacheDir)) {
    console.log("TTS cache dir does not exist — skipping (no TTS keys may be set)");
    return;
  }

  const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".mp3"));
  console.log(`Found ${files.length} cached TTS audio files in ${cacheDir}`);
  expect(files.length).toBeGreaterThan(0);
});

test("resolveVoiceForGender returns correct voices per provider and gender", async () => {
  const { resolveVoiceForGender } = await import(
    path.join(PROJECT_ROOT, "packages/browser2video/tts-language-presets.ts")
  );

  // OpenAI: male → "onyx", female → "nova" for English
  const openaiMale = resolveVoiceForGender("openai", "en", "male");
  const openaiFemale = resolveVoiceForGender("openai", "en", "female");
  expect(openaiMale).toBe("onyx");
  expect(openaiFemale).toBe("nova");

  // Google: male → B suffix, female → C suffix for English
  const googleMale = resolveVoiceForGender("google", "en", "male");
  const googleFemale = resolveVoiceForGender("google", "en", "female");
  expect(googleMale).toContain("Neural2");
  expect(googleFemale).toContain("Neural2");
  expect(googleMale).not.toBe(googleFemale);

  // System (macOS)
  if (process.platform === "darwin") {
    expect(resolveVoiceForGender("system", null, "male")).toBe("Alex");
    expect(resolveVoiceForGender("system", null, "female")).toBe("Samantha");
  }

  // No gender → null
  expect(resolveVoiceForGender("openai", "en", null)).toBeNull();
  expect(resolveVoiceForGender("openai", "en", undefined)).toBeNull();

  // Russian voices differ from English
  const ruMale = resolveVoiceForGender("openai", "ru", "male");
  const ruFemale = resolveVoiceForGender("openai", "ru", "female");
  expect(ruMale).toBeTruthy();
  expect(ruFemale).toBeTruthy();
  expect(ruMale).not.toBe(ruFemale);

  console.log("Gender voice resolution: all assertions passed");
});
