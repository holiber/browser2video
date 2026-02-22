import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const BASIC_UI = "tests/scenarios/basic-ui.scenario.ts";
const ALL_IN_ONE = "tests/scenarios/mcp-generated/all-in-one.scenario.ts";
const COLLAB = "tests/scenarios/collab.scenario.ts";
const TUI_TERMINALS = "tests/scenarios/tui-terminals.scenario.ts";
const TEST_PORT = 9531;
const TEST_CDP_PORT = 9335;

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await _electron.launch({
    args: [PLAYER_DIR],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-strip-types --no-warnings",
      PORT: String(TEST_PORT),
      B2V_CDP_PORT: String(TEST_CDP_PORT),
    },
    timeout: 60_000,
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
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
          try { process.kill(pid, "SIGKILL"); } catch {}
          resolve();
        }, 5_000);
      });
    }
  } catch { /* already exited or disposed */ }
});

async function waitForPlayerReady() {
  await page.waitForSelector("[title='Connected']", { timeout: 90_000 });
}

async function loadAndPlayScenario(scenarioFile: string) {
  // Reload the page to break any in-flight msgQueue from a previous runAll.
  // Without this, a still-running scenario blocks "load" messages due to
  // the server's sequential message queue.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForPlayerReady();

  const dropdown = page.locator("select").first();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  await dropdown.locator(`option[value="${scenarioFile}"]`).waitFor({ state: "attached", timeout: 15_000 });
  await dropdown.selectOption(scenarioFile);

  const playAll = page.getByRole("button", { name: "Play all" });
  await expect(playAll).toBeVisible({ timeout: 15_000 });
  return playAll;
}

test("electron app starts and shows player UI", async () => {
  test.setTimeout(120_000);
  await waitForPlayerReady();

  const dropdown = page.locator("select").first();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });

  const options = await dropdown.locator("option").count();
  expect(options).toBeGreaterThan(1);
});

test("electron: detects Electron mode in React app", async () => {
  test.setTimeout(60_000);

  const hasElectronAPI = await page.evaluate(() => !!(window as any).electronAPI?.isElectron);
  expect(hasElectronAPI).toBe(true);
});

test("electron: play button requires WS connection", async () => {
  test.setTimeout(60_000);
  await waitForPlayerReady();

  const playAll = await loadAndPlayScenario(BASIC_UI);
  await expect(playAll).toBeVisible();

  // Connected: green dot visible, Play button enabled
  const connectedDot = page.locator("[title='Connected']");
  await expect(connectedDot).toBeVisible({ timeout: 5_000 });
  await expect(playAll).toBeEnabled();

  // Force-close all WebSocket connections from the page
  await page.evaluate(() => {
    const instances: WebSocket[] = (window as any).__b2vWsInstances ?? [];
    instances.forEach((ws) => ws.close());
  });

  // Verify disconnected state: red dot, Play disabled
  const disconnectedDot = page.locator("div[title='Disconnected']");
  await expect(disconnectedDot).toBeVisible({ timeout: 5_000 });
  await expect(playAll).toBeDisabled();

  // Auto-reconnect should restore connection
  await expect(connectedDot).toBeVisible({ timeout: 10_000 });
  await expect(playAll).toBeEnabled();
});

test("electron: basic-ui scenario runs without errors", async () => {
  test.setTimeout(300_000);
  await waitForPlayerReady();

  const playAll = await loadAndPlayScenario(BASIC_UI);

  // Collect server error messages pushed to the UI
  const errors: string[] = [];
  const errorBanner = page.locator(".bg-red-950");

  await playAll.click();

  // Poll for either progress or an error banner
  let sawProgress = false;
  for (let i = 0; i < 240; i++) {
    const errorVisible = await errorBanner.isVisible().catch(() => false);
    if (errorVisible) {
      const errorText = await errorBanner.textContent().catch(() => "unknown error");
      throw new Error(`Scenario error during execution: ${errorText}`);
    }
    const progress = await page.locator("text=/\\d+ \\/ 16/").isVisible().catch(() => false);
    if (progress) {
      sawProgress = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(sawProgress).toBe(true);

  // Wait for scenario to complete — keep checking for errors
  await expect(page.locator("text=16 / 16")).toBeVisible({ timeout: 240_000 });
  await expect(errorBanner).toBeHidden();
});

test("electron: all-in-one scenario uses scenario-grid preview without extra windows", async () => {
  test.setTimeout(300_000);

  const windowCountBefore = (await electronApp.windows()).length;

  const playAll = await loadAndPlayScenario(ALL_IN_ONE);
  await playAll.click();

  const scenarioGrid = page.locator("[data-preview-mode='scenario-grid']");
  const errorBanner = page.locator(".bg-red-950");

  // Wait for scenario-grid OR error banner, whichever appears first.
  // Both promises get .catch() to suppress rejections from the loser.
  let winner: "grid" | "error" | "timeout" = "timeout";
  try {
    const gridPromise = scenarioGrid
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "grid" as const);
    const errorPromise = errorBanner
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "error" as const);
    gridPromise.catch(() => {});
    errorPromise.catch(() => {});
    winner = await Promise.race([gridPromise, errorPromise]);
  } catch {
    // Both waitFors failed — page may have navigated or closed
    winner = "timeout";
  }

  if (winner === "error") {
    const gridVisible = await scenarioGrid.isVisible().catch(() => false);
    if (!gridVisible) {
      const msg = await errorBanner.textContent().catch(() => "unknown");
      throw new Error(`Scenario grid never appeared — error: ${msg}`);
    }
  }

  if (winner === "timeout") {
    const gridVisible = await scenarioGrid.isVisible().catch(() => false);
    if (!gridVisible) {
      throw new Error("Neither scenario grid nor error banner appeared within 60s");
    }
  }

  const mode = await page.locator("[data-preview-mode]").first().getAttribute("data-preview-mode").catch(() => null);
  expect(mode).toBe("scenario-grid");

  // No extra Electron windows should have been spawned — all content
  // must render inside the main window (iframes for browser panes,
  // JabTerm for terminal panes). The count may drop if a previous
  // test's scenarioView was destroyed during load.
  const windowCountAfter = (await electronApp.windows()).length;
  expect(windowCountAfter).toBeLessThanOrEqual(windowCountBefore);

  // The electron-scenario-view mode (WebContentsView overlay) must NOT
  // be used when we have a jabterm grid with browser pane iframes.
  const electronView = page.locator("[data-preview-mode='electron-scenario-view']");
  await expect(electronView).toBeHidden();
});

test("electron: collab scenario starts without errors", async () => {
  test.setTimeout(300_000);

  const playAll = await loadAndPlayScenario(COLLAB);

  // Wait for Play button to become enabled (previous scenario cleanup may take time)
  await expect(playAll).toBeEnabled({ timeout: 60_000 });

  const windowCountBefore = (await electronApp.windows()).length;
  await playAll.click();

  const scenarioGrid = page.locator("[data-preview-mode='scenario-grid']");
  const errorBanner = page.locator(".bg-red-950");

  // Wait for scenario-grid to appear (setupFn pushes grid config).
  // Also detect errors fast — if the scenario crashes during setup,
  // the error banner appears and we fail immediately.
  let sawGrid = false;
  for (let i = 0; i < 240; i++) {
    const errorVisible = await errorBanner.isVisible().catch(() => false);
    if (errorVisible) {
      const msg = await errorBanner.textContent().catch(() => "unknown");
      throw new Error(`Collab scenario error during setup: ${msg}`);
    }
    if (await scenarioGrid.isVisible().catch(() => false)) {
      sawGrid = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(sawGrid).toBe(true);

  // No extra Electron windows should have been opened
  const windowCountAfter = (await electronApp.windows()).length;
  expect(windowCountAfter).toBeLessThanOrEqual(windowCountBefore);
});

test("electron: tui-terminals scenario renders terminal panes", async () => {
  test.setTimeout(300_000);

  const playAll = await loadAndPlayScenario(TUI_TERMINALS);
  await expect(playAll).toBeEnabled({ timeout: 60_000 });

  const windowCountBefore = (await electronApp.windows()).length;
  await playAll.click();

  const scenarioGrid = page.locator("[data-preview-mode='scenario-grid']");
  const errorBanner = page.locator(".bg-red-950");

  // Wait for scenario-grid to appear or detect an error
  let sawGrid = false;
  for (let i = 0; i < 120; i++) {
    const errorVisible = await errorBanner.isVisible().catch(() => false);
    if (errorVisible) {
      const msg = await errorBanner.textContent().catch(() => "unknown");
      throw new Error(`TUI scenario error during setup: ${msg}`);
    }
    if (await scenarioGrid.isVisible().catch(() => false)) {
      sawGrid = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(sawGrid).toBe(true);

  // Verify at least one terminal pane rendered with xterm content.
  // testIds are derived from the command name (e.g. xterm-term-mc, xterm-term-htop).
  const terminalPane = page.locator("[data-testid^='xterm-term-']").first();
  await expect(terminalPane).toBeVisible({ timeout: 30_000 });

  // Check that xterm rows have rendered with actual content
  await page.waitForFunction(
    () => {
      const panes = document.querySelectorAll("[data-testid^='xterm-term-']");
      if (panes.length === 0) return false;
      for (const pane of panes) {
        const rows = pane.querySelector(".xterm-rows");
        if (!rows || (rows.textContent ?? "").length === 0) return false;
      }
      return true;
    },
    undefined,
    { timeout: 30_000 },
  );

  // All 3 terminal panes should be present
  const paneCount = await page.locator("[data-testid^='xterm-term-']").count();
  expect(paneCount).toBe(3);

  // No extra Electron windows
  const windowCountAfter = (await electronApp.windows()).length;
  expect(windowCountAfter).toBeLessThanOrEqual(windowCountBefore);
});

function isPortFree(port: number): boolean {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    return pids.length === 0;
  } catch {
    return true;
  }
}

test("electron: clean shutdown — no orphaned processes", async () => {
  test.setTimeout(30_000);

  const pid = electronApp.process().pid;

  // electronApp.close() calls app.quit() via CDP which can hang if the
  // event loop is busy with scenario execution.  Send SIGTERM directly
  // instead — the server's gracefulShutdown handler will clean up and
  // call process.exit(0).
  if (pid) {
    process.kill(pid, "SIGTERM");
  }

  // Wait for the Electron process to exit
  await new Promise<void>((resolve) => {
    const proc = electronApp.process();
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.on("exit", () => resolve());
  });

  // Wait for child processes to finish exiting
  for (let i = 0; i < 20; i++) {
    if (isPortFree(TEST_PORT) && isPortFree(TEST_CDP_PORT)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  expect(isPortFree(TEST_PORT)).toBe(true);
  expect(isPortFree(TEST_CDP_PORT)).toBe(true);
});
