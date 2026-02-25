/**
 * Ensures every scenario available in the scenario selector can be run to
 * completion without showing an error banner.
 *
 * Note: This runs in `B2V_MODE=fast` for speed and determinism.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9671;
const TEST_CDP_PORT = 9471;

function killPort(port: number) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
    }
  } catch { }
}

let electronApp: ElectronApplication;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  killPort(TEST_PORT);
  killPort(TEST_CDP_PORT);

  electronApp = await _electron.launch({
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

  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='picker-select']", { timeout: 90_000 });
});

test.afterAll(async () => {
  if (!electronApp) return;
  try {
    const proc = electronApp.process();
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
});

async function getScenarioOptions(): Promise<string[]> {
  const select = page.locator("[data-testid='picker-select']");
  await expect(select).toBeVisible();
  const options = select.locator("option");
  const count = await options.count();
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const value = (await options.nth(i).getAttribute("value")) ?? "";
    if (value && value.endsWith(".scenario.ts")) files.push(value);
  }
  return files;
}

async function selectScenario(file: string) {
  const pickerSelect = page.locator("[data-testid='picker-select']");
  if (await pickerSelect.isVisible().catch(() => false)) {
    await pickerSelect.selectOption(file);
    return;
  }
  await page.selectOption("[data-testid='picker-switch']", { label: file });
}

async function waitForAllStepsDone(timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Fail fast if the player shows an error banner.
    if (await page.locator(".bg-red-950").isVisible()) {
      const msg = (await page.locator(".bg-red-950").innerText().catch(() => "")).trim();
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

test("all scenarios in selector run without errors", async () => {
  test.setTimeout(45 * 60_000); // 45 minutes

  const files = await getScenarioOptions();
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    console.log(`[all-scenarios] Running: ${file}`);
    try {
      // Load scenario
      await selectScenario(file);
      await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });

      // Run all steps
      await page.click("[data-testid='ctrl-play-all']");
      await waitForAllStepsDone(15 * 60_000);
      console.log(`[all-scenarios] ✅ Done: ${file}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[${file}] ${msg}`);
    }
  }
});

