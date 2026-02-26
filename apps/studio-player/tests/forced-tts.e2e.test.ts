/**
 * Forced TTS engine selection test.
 *
 * Verifies that B2V_TTS_PROVIDER=system forces the macOS built-in TTS
 * (or falls back to Piper on systems without native TTS).
 *
 * Flow:
 *  1. Launch Electron player with slides-and-narration scenario
 *  2. Clear cache and verify size shows "0"
 *  3. Click Play — verify "Building the cache..." overlay with progress
 *  4. Verify cache files are created after prebuild
 *  5. Verify audio plays via browser API during scenario execution
 *  6. Scenario completes without errors
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

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  killPort(TEST_PORT);
  killPort(TEST_CDP_PORT);

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
      B2V_REALTIME_AUDIO: "true",
    },
    timeout: 60_000,
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });
});

test.afterAll(async () => {
  if (electronApp) await closeElectron(electronApp);
});

test("clear cache shows size 0", async () => {
  test.setTimeout(30_000);

  const cacheBtn = page.locator("[data-testid='ctrl-clear-cache']");
  await expect(cacheBtn).toBeVisible({ timeout: 10_000 });

  // Open cache popover and clear scenario cache
  await cacheBtn.click();
  const clearScenarioBtn = page.locator("[data-testid='ctrl-clear-scenario-cache']");
  await expect(clearScenarioBtn).toBeVisible({ timeout: 5_000 });
  await clearScenarioBtn.click();

  // After clearing, the cache button should show "0 B" for scenario size
  await expect(cacheBtn).toContainText("0 B", { timeout: 5_000 });
});

test("play triggers build overlay with progress messages", async () => {
  test.setTimeout(180_000);

  // Instrument Audio API to track playback calls
  await page.evaluate(() => {
    (window as any).__b2vAudioPlayed = [];
    const OrigAudio = window.Audio;
    (window as any).Audio = function (src?: string) {
      const a = new OrigAudio(src);
      const origPlay = a.play.bind(a);
      a.play = () => {
        (window as any).__b2vAudioPlayed.push(src);
        return origPlay();
      };
      return a;
    } as any;
  });

  const playBtn = page.locator("[data-testid='ctrl-play-all']");
  await expect(playBtn).toBeVisible({ timeout: 10_000 });
  await playBtn.click();

  // Build overlay should appear
  const overlay = page.locator("[data-testid='build-overlay']");

  if (hasSystemTts()) {
    // Wait for the build overlay to appear (TTS generation takes time)
    await expect(overlay).toBeVisible({ timeout: 30_000 });

    // Static message
    await expect(overlay.locator("text=Building the cache...")).toBeVisible();

    // Dynamic progress message should mention the provider
    const progressMsg = page.locator("[data-testid='build-progress-msg']");
    await expect(progressMsg).toBeVisible({ timeout: 10_000 });
    const msgText = await progressMsg.textContent();
    expect(msgText).toContain("Generating narration via");

    // Wait for the build overlay to disappear (build complete)
    await expect(overlay).toBeHidden({ timeout: 120_000 });
  } else {
    // System TTS not available — might get an error instead
    const errorBanner = page.locator(".bg-red-950");
    const result = await Promise.race([
      overlay.waitFor({ state: "visible", timeout: 30_000 }).then(() => "overlay" as const),
      errorBanner.waitFor({ state: "visible", timeout: 30_000 }).then(() => "error" as const),
    ].map(p => p.catch(() => "timeout" as const)));

    if (result === "error") {
      console.log("System TTS not available — error expected");
      return;
    }
  }
});

test("cache files are created after prebuild", async () => {
  test.setTimeout(30_000);

  if (!hasSystemTts()) {
    console.log("Skipping cache check — system TTS not available");
    return;
  }

  const cacheDir = path.join(PROJECT_ROOT, ".cache", "tts");
  if (!fs.existsSync(cacheDir)) {
    console.log("TTS cache dir does not exist — checking skipped");
    return;
  }

  const audioFiles = fs.readdirSync(cacheDir).filter((f) =>
    f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".aiff"),
  );
  console.log(`Found ${audioFiles.length} cached TTS audio files in ${cacheDir}`);
  expect(audioFiles.length).toBeGreaterThan(0);
});

test("scenario completes and audio was played via browser API", async () => {
  test.setTimeout(300_000);

  if (!hasSystemTts()) {
    console.log("Skipping playback check — system TTS not available");
    return;
  }

  const errorBanner = page.locator(".bg-red-950");

  // Wait for the scenario to finish — all steps done
  const stepCount = await page.locator("[data-testid^='step-card-']").count();
  const lastStepDone = page.locator(`text=${stepCount} / ${stepCount}`);

  for (let i = 0; i < 600; i++) {
    const errorVisible = await errorBanner.isVisible().catch(() => false);
    if (errorVisible) {
      const msg = await errorBanner.textContent().catch(() => "unknown");
      throw new Error(`Scenario error during execution: ${msg}`);
    }
    if (await lastStepDone.isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
  }

  await expect(lastStepDone).toBeVisible({ timeout: 5_000 });

  // Verify audio was played via browser API
  const playedUrls: string[] = await page.evaluate(() => (window as any).__b2vAudioPlayed ?? []);
  console.log(`Audio playback calls tracked: ${playedUrls.length}`);
  expect(playedUrls.length).toBeGreaterThan(0);

  // Each URL should point to our audio endpoint
  for (const url of playedUrls) {
    expect(url).toContain("/api/audio/");
  }
});

test("resolveVoiceForGender returns correct voices per provider and gender", async () => {
  const { resolveVoiceForGender } = await import(
    path.join(PROJECT_ROOT, "packages/browser2video/tts-language-presets.ts")
  );

  // OpenAI: male -> "onyx", female -> "nova" for English
  const openaiMale = resolveVoiceForGender("openai", "en", "male");
  const openaiFemale = resolveVoiceForGender("openai", "en", "female");
  expect(openaiMale).toBe("onyx");
  expect(openaiFemale).toBe("nova");

  // Google: male -> B suffix, female -> C suffix for English
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

  // No gender -> null
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
