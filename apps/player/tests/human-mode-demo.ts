/**
 * Human-mode demo runner for InjectedActor.
 * Launches the player, injects a visible cursor, clicks through the UI,
 * and saves screenshots at each step.
 *
 * Run: node --experimental-strip-types --no-warnings apps/player/tests/human-mode-demo.ts
 */
import { _electron } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { InjectedActor } from "browser2video/injected-actor";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const SCREENSHOTS_DIR = path.resolve(PROJECT_ROOT, "artifacts", "self-test-human-demo");
const TEST_PORT = 9571;
const TEST_CDP_PORT = 9375;

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function main() {
    console.log("Launching Electron player...");
    const electronApp = await _electron.launch({
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

    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    console.log("Player loaded.");

    // Wait for studio to be ready
    console.log("Waiting for studio UI...");
    await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 90_000 });
    console.log("Studio ready!");

    // Create injected actor in HUMAN mode — visible cursor animations!
    const actor = new InjectedActor(page, "demo-actor", {
        mode: "human",
        delays: {
            // Faster than default for demo but still visible
            mouseMoveStepMs: [2, 2],
            clickEffectMs: [20, 20],
            clickHoldMs: [60, 60],
            afterClickMs: [200, 200],
            beforeTypeMs: [40, 40],
            keyDelayMs: [25, 25],
            afterTypeMs: [100, 100],
            breatheMs: [100, 100],
            afterScrollIntoViewMs: [200, 200],
            keyBoundaryPauseMs: [20, 20],
            selectOpenMs: [80, 80],
            selectOptionMs: [50, 50],
            afterDragMs: [80, 80],
        },
    });

    // Step 1: Initial state with studio ready
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "01-studio-ready.png") });
    console.log("📸 01: Studio ready");

    // Step 2: Move cursor to the + placeholder
    await actor.moveCursorTo(640, 400);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "02-cursor-visible.png") });
    console.log("📸 02: Cursor visible in page");

    // Step 3: Click the + placeholder
    await actor.click("[data-testid='studio-placeholder-add']");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "03-popup-open.png") });
    console.log("📸 03: Popup opened");

    // Step 4: Click Browser option
    await actor.click("[data-testid='studio-add-browser']");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "04-url-dialog.png") });
    console.log("📸 04: URL dialog opened");

    // Step 5: Confirm URL
    await actor.click("[data-testid='studio-browser-url-confirm']");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "05-browser-loading.png") });
    console.log("📸 05: Browser pane loading");

    // Step 6: Wait for iframe to appear
    await page.waitForSelector("[data-testid='studio-browser-iframe']", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "06-browser-loaded.png") });
    console.log("📸 06: Browser iframe loaded");

    console.log(`\n✅ Demo complete! Screenshots saved to: ${SCREENSHOTS_DIR}`);

    // Clean shutdown
    const pid = electronApp.process().pid;
    if (pid) process.kill(pid, "SIGTERM");
    await new Promise<void>((resolve) => {
        const proc = electronApp.process();
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        proc.on("exit", () => resolve());
        setTimeout(() => {
            try { process.kill(pid!, "SIGKILL"); } catch { }
            resolve();
        }, 5_000);
    });

    console.log("Player shut down cleanly.");
    process.exit(0);
}

main().catch((err) => {
    console.error("Demo failed:", err);
    process.exit(1);
});
