/**
 * Player Self-Test E2E — Runs the comprehensive self-test scenario through the player.
 *
 * Architecture:
 *   This Playwright test launches the player (Electron), selects the
 *   "player-self-test" scenario via the picker, clicks "Play All", and
 *   watches all steps complete. The actual test logic lives in
 *   tests/scenarios/player-self-test.scenario.ts which uses InjectedActor
 *   to drive an inner player instance.
 *
 * This is "using our player to test our player".
 */

import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9561;
const TEST_CDP_PORT = 9365;

/**
 * Human mode: visible cursor animations + breathe pauses.
 * Activated via B2V_HUMAN=1 (which also implies --headed in playwright.config).
 * --headed alone gives a visible window but keeps fast mode.
 */
const isHuman = !!process.env.B2V_HUMAN;

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

    console.log(`[self-test ${ms()}] Launching Electron player...`);
    electronApp = await _electron.launch({
        args: [PLAYER_DIR],
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            NODE_OPTIONS: "--experimental-strip-types --no-warnings",
            PORT: String(TEST_PORT),
            B2V_CDP_PORT: String(TEST_CDP_PORT),
            // Pass human mode to the player so the session respects it
            ...(isHuman ? { B2V_MODE: "human" } : {}),
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

// ===========================================================================
//  Test: Run the self-test scenario through the player
// ===========================================================================

test("load and run player-self-test scenario", async () => {
    // This test runs the full comprehensive scenario — give it plenty of time
    test.setTimeout(600_000); // 10 minutes

    // Wait for the player's studio UI to be ready
    console.log("[self-test] Waiting for studio ready...");
    await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 90_000 });
    console.log("[self-test] Studio ready!");

    // Select the player-self-test scenario from the picker
    console.log("[self-test] Loading player-self-test scenario...");
    await page.selectOption("[data-testid='picker-select']", {
        label: "tests/scenarios/player-self-test.scenario.ts",
    });

    // Wait for scenario steps to appear
    await page.waitForSelector("[data-testid='step-card-0']", { timeout: 30_000 });
    const stepCards = page.locator("[data-testid^='step-card-']");
    const totalSteps = await stepCards.count();
    console.log(`[self-test] Scenario loaded: ${totalSteps} steps`);

    // Click "Play All"
    console.log("[self-test] Clicking Play All...");
    await page.click("[data-testid='ctrl-play-all']");

    // Monitor progress — wait for ALL steps to reach "done" state
    // Poll step-card class names to track state
    const maxWaitMs = 8 * 60_000; // 8 minutes max for the scenario
    const pollIntervalMs = 2_000;
    const deadline = Date.now() + maxWaitMs;
    let lastLog = "";

    while (Date.now() < deadline) {
        await page.waitForTimeout(pollIntervalMs);

        // Count states by checking step card CSS classes
        const states: string[] = [];
        const count = await stepCards.count();
        for (let i = 0; i < count; i++) {
            const card = stepCards.nth(i);
            const classes = await card.getAttribute("class") ?? "";
            if (classes.includes("emerald")) states.push("done");
            else if (classes.includes("blue")) states.push("running");
            else if (classes.includes("yellow")) states.push("ff");
            else states.push("pending");
        }

        const doneCount = states.filter((s) => s === "done").length;
        const runningIdx = states.findIndex((s) => s === "running" || s === "ff");
        const summary = `${doneCount}/${count} done` + (runningIdx >= 0 ? `, step ${runningIdx} running` : "");

        if (summary !== lastLog) {
            console.log(`[self-test] ${summary}`);
            lastLog = summary;
        }

        // Check if all done
        if (doneCount === count) {
            console.log(`[self-test] All ${count} steps completed!`);
            break;
        }

        // Check for no running/ff steps while not all done — scenario may have stopped/errored
        if (runningIdx < 0 && doneCount < count && doneCount > 0) {
            // Might be between steps, wait a bit more
            await page.waitForTimeout(3000);
            // Re-check
            const recheck: string[] = [];
            for (let i = 0; i < count; i++) {
                const classes = await stepCards.nth(i).getAttribute("class") ?? "";
                if (classes.includes("emerald")) recheck.push("done");
                else if (classes.includes("blue") || classes.includes("yellow")) recheck.push("active");
                else recheck.push("pending");
            }
            if (recheck.filter((s) => s === "active").length === 0 && recheck.filter((s) => s === "done").length < count) {
                const stuckAt = recheck.findIndex((s) => s === "pending");
                console.error(`[self-test] Scenario appears stuck! ${recheck.filter((s) => s === "done").length}/${count} done, stuck at step ${stuckAt}`);
                break;
            }
        }
    }

    // Final verification
    const finalStates: string[] = [];
    const finalCount = await stepCards.count();
    for (let i = 0; i < finalCount; i++) {
        const classes = await stepCards.nth(i).getAttribute("class") ?? "";
        finalStates.push(classes.includes("emerald") ? "done" : "not-done");
    }

    const doneTotal = finalStates.filter((s) => s === "done").length;
    console.log(`[self-test] Final result: ${doneTotal}/${finalCount} steps done`);

    // All steps should be done
    expect(doneTotal).toBe(finalCount);
});

// ===========================================================================
//  Clean shutdown
// ===========================================================================

test("clean shutdown — no zombie processes", async () => {
    test.setTimeout(30_000);

    const pid = electronApp.process().pid;
    if (pid) {
        process.kill(pid, "SIGTERM");
    }

    await new Promise<void>((resolve) => {
        const proc = electronApp.process();
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        proc.on("exit", () => resolve());
    });

    for (let i = 0; i < 20; i++) {
        if (isPortFree(TEST_PORT) && isPortFree(TEST_CDP_PORT)) break;
        await new Promise((r) => setTimeout(r, 500));
    }

    expect(isPortFree(TEST_PORT)).toBe(true);
    expect(isPortFree(TEST_CDP_PORT)).toBe(true);
});
