/**
 * Player Self-Test E2E — InjectedActor smoke test
 *
 * Launches the player Electron app and uses an InjectedActor to drive the
 * player's own UI. The injected actor's cursor is visible inside the page,
 * clicking buttons and navigating dialogs just like a real user would.
 *
 * This validates both:
 * 1. The InjectedActor API (cursor injection, clicking, typing)
 * 2. The player UI (studio mode, pane popups, URL dialog)
 */

import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

// InjectedActor is imported from the workspace package
import { InjectedActor } from "browser2video/injected-actor";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9561;
const TEST_CDP_PORT = 9365;

let electronApp: ElectronApplication;
let page: Page;

function isPortFree(port: number): boolean {
    try {
        const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
        return pids.length === 0;
    } catch {
        return true;
    }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
    const t0 = performance.now();
    const ms = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

    console.log(`[self-test ${ms()}] Launching Electron...`);
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
    console.log(`[self-test ${ms()}] Electron launched`);

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    console.log(`[self-test ${ms()}] domcontentloaded`);
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
    } catch { /* already exited or disposed */ }
});

/** Wait for the player's studio-react mode to be ready. */
async function waitForStudioReady() {
    await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 90_000 });
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

test("injected actor: cursor overlay appears in the page", async () => {
    test.setTimeout(120_000);
    await waitForStudioReady();

    const actor = new InjectedActor(page, "self-tester", { mode: "fast" });
    await actor.init();

    // Move cursor to center of viewport
    await actor.moveCursorTo(640, 360);

    // The cursor element should now exist in the DOM
    const cursor = page.locator("#__b2v_cursor_self-tester");
    await expect(cursor).toBeAttached({ timeout: 5_000 });
});

test("injected actor: clicks the + placeholder to open popup", async () => {
    test.setTimeout(30_000);

    const actor = new InjectedActor(page, "self-tester", { mode: "fast" });

    // Click the "+" placeholder button
    await actor.click("[data-testid='studio-placeholder-add']");

    // Popup should appear with Browser and Terminal options
    const popup = page.locator("[data-testid='studio-add-pane-popup']");
    await expect(popup).toBeVisible({ timeout: 5_000 });

    const browserBtn = page.locator("[data-testid='studio-add-browser']");
    const terminalBtn = page.locator("[data-testid='studio-add-terminal']");
    await expect(browserBtn).toBeVisible();
    await expect(terminalBtn).toBeVisible();
});

test("injected actor: clicks Browser to open URL dialog", async () => {
    test.setTimeout(30_000);

    const actor = new InjectedActor(page, "self-tester", { mode: "fast" });

    // Click the Browser option
    await actor.click("[data-testid='studio-add-browser']");

    // URL dialog should appear
    const urlDialog = page.locator("[data-testid='studio-browser-url-dialog']");
    await expect(urlDialog).toBeVisible({ timeout: 5_000 });

    // URL input should have the default GitHub URL
    const urlInput = page.locator("[data-testid='studio-browser-url-input']");
    await expect(urlInput).toBeVisible();
    const value = await urlInput.inputValue();
    expect(value).toContain("github.com");

    // Confirm button should be visible
    const confirmBtn = page.locator("[data-testid='studio-browser-url-confirm']");
    await expect(confirmBtn).toBeVisible();
});

test("injected actor: confirms URL and browser iframe appears", async () => {
    test.setTimeout(60_000);

    const actor = new InjectedActor(page, "self-tester", { mode: "fast" });

    // Click confirm
    await actor.click("[data-testid='studio-browser-url-confirm']");

    // URL dialog should close
    const urlDialog = page.locator("[data-testid='studio-browser-url-dialog']");
    await expect(urlDialog).toBeHidden({ timeout: 5_000 });

    // Browser iframe should appear
    const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
    await expect(browserIframe).toBeVisible({ timeout: 15_000 });

    // Verify the iframe src contains the GitHub URL
    const src = await browserIframe.getAttribute("src");
    expect(src).toContain("github.com");
});

test("injected actor: clean shutdown — no zombie processes", async () => {
    test.setTimeout(30_000);

    const pid = electronApp.process().pid;
    if (pid) {
        process.kill(pid, "SIGTERM");
    }

    // Wait for exit
    await new Promise<void>((resolve) => {
        const proc = electronApp.process();
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        proc.on("exit", () => resolve());
    });

    // Wait for ports to be released
    for (let i = 0; i < 20; i++) {
        if (isPortFree(TEST_PORT) && isPortFree(TEST_CDP_PORT)) break;
        await new Promise((r) => setTimeout(r, 500));
    }

    expect(isPortFree(TEST_PORT)).toBe(true);
    expect(isPortFree(TEST_CDP_PORT)).toBe(true);
});
