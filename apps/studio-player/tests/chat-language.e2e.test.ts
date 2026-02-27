import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getOpenAITtsDefaultsForLanguage } from "../../../packages/browser2video/tts-language-presets.ts";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const SCENARIO_FILE = "tests/scenarios/chat.scenario.ts";

const TTS_CACHE_DIR = path.resolve(PROJECT_ROOT, ".cache/tts");
const TTS_SPEED = 1;

const INTRO =
  "Welcome to Browser 2 Video. In this demo, Veronica is on her iPhone " +
  "while Bob is on his screen. They each have their own cursor, moving independently.";
const VERONICA_MSG =
  "Hey Bob! Are you free this Friday evening? There's a new sci-fi movie I wanna see!";
const BOB_REPLY =
  "Friday works! What time and where should we meet?";

function killPort(port: number) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
    }
  } catch { }
}

function detectSystemLanguageBase(): string {
  const langEnv = process.env.LANG ?? "";
  const fromEnv = langEnv.split(".")[0]?.split("_")[0]?.toLowerCase();
  if (fromEnv) return fromEnv;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return String(locale).split("-")[0]?.toLowerCase() || "en";
}

function toLanguageName(base: string): string {
  // We pass a human-readable language label into B2V_NARRATION_LANGUAGE.
  // The narration engine uses it verbatim in the translation prompt.
  if (base.startsWith("zh")) return "Chinese";
  if (base.startsWith("en")) return "English";
  if (base.startsWith("ru")) return "Russian";
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    return dn.of(base) ?? base;
  } catch {
    return base;
  }
}

function translationCachePath(language: string, text: string): string {
  const hash = crypto.createHash("sha256").update(`${language}:${text}`).digest("hex").slice(0, 16);
  return path.join(TTS_CACHE_DIR, `tr_${hash}.txt`);
}

function ttsAudioCachePath(language: string, text: string, voice: string): string {
  const defaults = getOpenAITtsDefaultsForLanguage(language);
  const model = defaults?.model ?? "tts-1-hd";
  const speed = defaults?.speed ?? TTS_SPEED;
  const langPart = language ? `:${language}` : "";
  const key = crypto
    .createHash("sha256")
    .update(`${model}:${voice}:${speed}${langPart}:${text}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(TTS_CACHE_DIR, `${key}.mp3`);
}

async function waitForAllStepsDone(page: Page, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const errorBanner = page.locator(".bg-red-950");
    if (await errorBanner.isVisible().catch(() => false)) {
      const msg = (await errorBanner.innerText().catch(() => "")).trim();
      throw new Error(`Player error banner: ${msg || "(empty)"}`);
    }

    const cards = page.locator("[data-testid^='step-card-']");
    const total = await cards.count();
    if (total > 0) {
      let done = 0;
      for (let i = 0; i < total; i++) {
        const cls = (await cards.nth(i).getAttribute("class")) ?? "";
        if (cls.includes("emerald")) done++;
      }
      if (done === total) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for all steps to complete in ${timeoutMs}ms`);
}

async function runChatOnce(opts: { language: string; port: number; cdpPort: number }) {
  killPort(opts.port);
  killPort(opts.cdpPort);

  const electronApp: ElectronApplication = await _electron.launch({
    // Provide scenario as positional CLI arg: auto-load + auto-play.
    args: [PLAYER_DIR, SCENARIO_FILE],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-strip-types --no-warnings",
      PORT: String(opts.port),
      B2V_CDP_PORT: String(opts.cdpPort),
      B2V_MODE: "human",
      B2V_NARRATION_LANGUAGE: opts.language,
    },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Scenario should auto-load
    await page.waitForSelector("[data-testid='step-card-0']", { timeout: 120_000 });

    // Run to completion (scenario auto-plays, but the UI might still be catching up)
    await waitForAllStepsDone(page, 12 * 60_000);
  } finally {
    try {
      const proc = electronApp.process();
      const pid = proc.pid;
      if (pid && proc.exitCode === null && proc.signalCode === null) {
        process.kill(pid, "SIGTERM");
      }
    } catch { /* ignore */ }
  }
}

function assertAudioCached(language: string) {
  // Translation cache
  expect(fs.existsSync(translationCachePath(language, INTRO))).toBe(true);

  // TTS cache for each voice used by the scenario
  expect(fs.existsSync(ttsAudioCachePath(language, INTRO, "alloy"))).toBe(true);
  expect(fs.existsSync(ttsAudioCachePath(language, VERONICA_MSG, "shimmer"))).toBe(true);
  expect(fs.existsSync(ttsAudioCachePath(language, BOB_REPLY, "echo"))).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("chat scenario: run twice with system language + fallback language (cache per language/voice)", async () => {
  test.setTimeout(30 * 60_000);

  const sysBase = detectSystemLanguageBase();
  const sysLang = toLanguageName(sysBase);
  const secondLang = sysBase.startsWith("en") ? "Russian" : "English";

  // Run #1: system language
  await runChatOnce({ language: sysLang, port: 9691, cdpPort: 9491 });
  assertAudioCached(sysLang);

  // Run #2: fallback language
  await runChatOnce({ language: secondLang, port: 9695, cdpPort: 9495 });
  assertAudioCached(secondLang);
});

