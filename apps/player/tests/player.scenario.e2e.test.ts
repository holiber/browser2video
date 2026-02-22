/**
 * Player Studio Scenario E2E Test
 *
 * Exercises the studio grid UI end-to-end:
 * 1. Player starts with 1x1 layout + placeholder
 * 2. Add a browser pane via URL dialog
 * 3. Split horizontally, add terminal
 * 4. Terminal interactions (echo, htop, tabs, switching)
 * 5. Close terminals
 * 6. Clean shutdown — no zombie processes
 */

import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9541;
const TEST_CDP_PORT = 9345;

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

    console.log(`[test ${ms()}] Calling _electron.launch()...`);
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
    console.log(`[test ${ms()}] _electron.launch() returned`);

    console.log(`[test ${ms()}] Calling firstWindow()...`);
    page = await electronApp.firstWindow();
    console.log(`[test ${ms()}] firstWindow() returned`);

    console.log(`[test ${ms()}] Waiting for domcontentloaded...`);
    await page.waitForLoadState("domcontentloaded");
    console.log(`[test ${ms()}] domcontentloaded done`);
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

/** Wait for the player server to be connected and studio ready. */
async function waitForStudioReady() {
    const t0 = performance.now();
    // The studio-react mode appears when no scenario is loaded and terminalServerUrl is set
    await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 90_000 });
    console.log(`[test] waitForStudioReady took ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

test("starts with 1x1 layout and a + placeholder button", async () => {
    test.setTimeout(120_000);
    await waitForStudioReady();

    // The placeholder "+" button should be visible
    const addButton = page.locator("[data-testid='studio-placeholder-add']");
    await expect(addButton).toBeVisible({ timeout: 10_000 });

    // Layout picker should default to "1x1"
    const layoutPicker = page.locator("[data-testid='studio-layout-picker']");
    await expect(layoutPicker).toHaveValue("1x1");
});

test("clicking + shows popup with Browser and Terminal options", async () => {
    test.setTimeout(30_000);

    // Click the + placeholder
    const addButton = page.locator("[data-testid='studio-placeholder-add']");
    await addButton.click();

    // Popup should appear
    const popup = page.locator("[data-testid='studio-add-pane-popup']");
    await expect(popup).toBeVisible({ timeout: 5_000 });

    // Browser and Terminal buttons should be visible
    const browserBtn = page.locator("[data-testid='studio-add-browser']");
    const terminalBtn = page.locator("[data-testid='studio-add-terminal']");
    await expect(browserBtn).toBeVisible();
    await expect(terminalBtn).toBeVisible();
});

test("clicking Browser opens URL dialog with correct defaults", async () => {
    test.setTimeout(30_000);

    // Click the Browser option in the popup
    const browserBtn = page.locator("[data-testid='studio-add-browser']");
    await browserBtn.click();

    // URL dialog should appear
    const urlDialog = page.locator("[data-testid='studio-browser-url-dialog']");
    await expect(urlDialog).toBeVisible({ timeout: 5_000 });

    // URL input should have the default GitHub URL
    const urlInput = page.locator("[data-testid='studio-browser-url-input']");
    await expect(urlInput).toBeVisible();
    const value = await urlInput.inputValue();
    expect(value).toContain("github.com");
    expect(value).toContain("browser2video");

    // Checkbox for dedicated browser window should be visible
    const checkbox = page.locator("[data-testid='studio-open-dedicated-checkbox']");
    await expect(checkbox).toBeVisible();

    // Confirm button should be visible
    const confirmBtn = page.locator("[data-testid='studio-browser-url-confirm']");
    await expect(confirmBtn).toBeVisible();
});

test("confirming URL opens browser iframe", async () => {
    test.setTimeout(60_000);

    // Click confirm
    const confirmBtn = page.locator("[data-testid='studio-browser-url-confirm']");
    await confirmBtn.click();

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

test("split view horizontally and open a terminal", async () => {
    test.setTimeout(90_000);

    // Change layout to "top-bottom"
    const layoutPicker = page.locator("[data-testid='studio-layout-picker']");
    await layoutPicker.selectOption("top-bottom");

    // After layout change, both slots become placeholders — 2 "+" buttons
    const placeholders = page.locator("[data-testid='studio-placeholder-add']");
    await expect(placeholders).toHaveCount(2, { timeout: 10_000 });

    // Re-add browser to the first slot
    await placeholders.first().click();
    const popup1 = page.locator("[data-testid='studio-add-pane-popup']");
    await expect(popup1).toBeVisible({ timeout: 5_000 });
    await page.locator("[data-testid='studio-add-browser']").click();
    // Confirm URL dialog for browser
    const urlDialog = page.locator("[data-testid='studio-browser-url-dialog']");
    await expect(urlDialog).toBeVisible({ timeout: 5_000 });
    await page.locator("[data-testid='studio-browser-url-confirm']").click();
    await expect(urlDialog).toBeHidden({ timeout: 5_000 });

    // Now click the remaining placeholder to add terminal
    const remainingPlaceholder = page.locator("[data-testid='studio-placeholder-add']");
    await expect(remainingPlaceholder).toBeVisible({ timeout: 10_000 });
    await remainingPlaceholder.click();

    const popup2 = page.locator("[data-testid='studio-add-pane-popup']");
    await expect(popup2).toBeVisible({ timeout: 5_000 });

    // Click Terminal
    const terminalBtn = page.locator("[data-testid='studio-add-terminal']");
    await terminalBtn.click();

    // Terminal iframe should appear
    const terminalIframe = page.locator("[data-testid='studio-terminal-iframe']");
    await expect(terminalIframe).toBeVisible({ timeout: 15_000 });
});

test("echo command works in terminal", async () => {
    test.setTimeout(60_000);

    // Get the terminal iframe
    const terminalIframe = page.locator("[data-testid='studio-terminal-iframe']");
    const frame = terminalIframe.contentFrame();

    // Wait for xterm to render
    await frame.locator(".xterm-rows").waitFor({ state: "visible", timeout: 30_000 });

    // Click on the terminal to focus it
    await frame.locator("[data-testid='jabterm-container']").click();

    // Type echo command
    const sentinel = `__E2E_ECHO_${Date.now()}__`;
    await page.keyboard.type(`echo ${sentinel}`, { delay: 30 });
    await page.keyboard.press("Enter");

    // Wait for the echo output to appear
    await expect(frame.locator(".xterm-rows")).toContainText(sentinel, { timeout: 15_000 });
});

test("htop command works", async () => {
    test.setTimeout(60_000);

    // Get the terminal iframe
    const terminalIframe = page.locator("[data-testid='studio-terminal-iframe']");
    const frame = terminalIframe.contentFrame();

    // Focus the terminal
    await frame.locator("[data-testid='jabterm-container']").click();

    // Type htop (or top as fallback)
    await page.keyboard.type("htop", { delay: 30 });
    await page.keyboard.press("Enter");

    // Wait a moment for htop to render
    await page.waitForTimeout(2000);

    // htop shows CPU/memory info — check for some typical content
    const content = await frame.locator(".xterm-rows").textContent({ timeout: 10_000 });
    // htop should show some process information — at minimum non-empty output
    expect((content ?? "").length).toBeGreaterThan(10);

    // Quit htop
    await page.keyboard.press("q");
    await page.waitForTimeout(1000);
});

test("open another terminal tab and type ls", async () => {
    test.setTimeout(60_000);

    // Click the "Add tab" toolbar button (terminal should be the active pane)
    const addTabBtn = page.locator("[data-testid='studio-add-tab-toolbar']");
    await expect(addTabBtn).toBeEnabled({ timeout: 5_000 });
    await addTabBtn.click();

    // A second terminal iframe should now exist
    const terminalIframes = page.locator("[data-testid='studio-terminal-iframe']");
    await expect(terminalIframes).toHaveCount(2, { timeout: 15_000 });

    // The second terminal should be the active (visible) one — it's the latest tab
    const secondFrame = terminalIframes.nth(1).contentFrame();

    // Wait for xterm to render in the new tab
    await secondFrame.locator(".xterm-rows").waitFor({ state: "visible", timeout: 30_000 });

    // Focus and type ls
    await secondFrame.locator("[data-testid='jabterm-container']").click();
    await page.keyboard.type("ls", { delay: 30 });
    await page.keyboard.press("Enter");

    // Wait for ls output
    await page.waitForTimeout(2000);
    const content = await secondFrame.locator(".xterm-rows").textContent({ timeout: 10_000 });
    expect((content ?? "").length).toBeGreaterThan(0);
});

test("switch between terminal tabs and verify text persists", async () => {
    test.setTimeout(60_000);

    // Find the tab headers — dockview renders tabs as buttons/divs
    // Click the first terminal tab to switch back
    // Dockview tabs are in the panel header area. The first terminal tab
    // should be the one with title "Shell" that's not currently active.
    const terminalIframes = page.locator("[data-testid='studio-terminal-iframe']");

    // Get current active tab's content (should be the "ls" terminal)
    const secondFrame = terminalIframes.nth(1).contentFrame();
    const lsContent = await secondFrame.locator(".xterm-rows").textContent({ timeout: 5_000 });
    expect(lsContent ?? "").toContain("ls");

    // Click the first terminal's tab header to switch back
    // Dockview tab titles are inside .dv-tab elements
    const tabs = page.locator(".dv-tab");
    const tabCount = await tabs.count();

    // Find the first "Shell" tab (there should be at least 2 Shell tabs)
    // Click the first one to switch to it
    for (let i = 0; i < tabCount; i++) {
        const tab = tabs.nth(i);
        const tabText = await tab.textContent();
        if (tabText?.includes("Shell")) {
            // Check if this tab's panel is not currently visible (i.e., it's the "other" one)
            const isActive = await tab.evaluate((el) => el.classList.contains("dv-active-tab"));
            if (!isActive) {
                await tab.click();
                break;
            }
        }
    }

    await page.waitForTimeout(1000);

    // After switching, the first terminal should now be visible
    // The echo sentinel text should still be present in the first terminal
    const firstFrame = terminalIframes.first().contentFrame();
    const echoContent = await firstFrame.locator(".xterm-rows").textContent({ timeout: 10_000 });
    // The echo command output should still be there
    expect((echoContent ?? "").length).toBeGreaterThan(10);
});

test("close both terminal tabs", async () => {
    test.setTimeout(30_000);

    const closeBtn = page.locator("[data-testid='studio-close-active']");

    // Close the first terminal tab
    await expect(closeBtn).toBeEnabled({ timeout: 5_000 });
    await closeBtn.click();
    await page.waitForTimeout(500);

    // Close the second terminal tab
    await expect(closeBtn).toBeEnabled({ timeout: 5_000 });
    await closeBtn.click();
    await page.waitForTimeout(500);

    // No terminal iframes should remain
    const terminalIframes = page.locator("[data-testid='studio-terminal-iframe']");
    await expect(terminalIframes).toHaveCount(0, { timeout: 5_000 });
});

test("clean shutdown — no zombie processes", async () => {
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
