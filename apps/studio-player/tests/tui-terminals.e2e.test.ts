import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
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

test.describe.configure({ mode: "serial" });

test("tui-terminals scenario plays without errors", async () => {
  test.setTimeout(12 * 60_000);

  killPort(TEST_PORT);
  killPort(TEST_CDP_PORT);

  const electronApp: ElectronApplication = await _electron.launch({
    args: [PLAYER_DIR],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-strip-types --no-warnings",
      PORT: String(TEST_PORT),
      B2V_CDP_PORT: String(TEST_CDP_PORT),
      B2V_MODE: "human",
    },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await page.waitForSelector("[data-testid='picker-select']", { timeout: 90_000 });
    await page.selectOption("[data-testid='picker-select']", {
      label: "tests/scenarios/tui-terminals.scenario.ts",
    });
    await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });

    await page.click("[data-testid='ctrl-play-all']");
    await waitForAllStepsDone(page, 10 * 60_000);

    expect(true).toBe(true);
  } finally {
    try {
      const proc = electronApp.process();
      const pid = proc.pid;
      if (pid && proc.exitCode === null && proc.signalCode === null) {
        process.kill(pid, "SIGTERM");
      }
    } catch { /* ignore */ }
  }
});

