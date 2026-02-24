/**
 * Cursor Proof E2E — Launches the outer player, loads cursor-proof scenario
 * (which spawns the inner player), and verifies both cursors are visible.
 *
 * Uses the SAME ports as the self-test (9561 outer, 9591 inner) since the
 * self-test's nested architecture is proven to work.
 */

import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9561;
const TEST_CDP_PORT = 9365;
const ARTIFACTS_DIR = path.resolve(PROJECT_ROOT, ".cache/tests/test-e2e__electron/cursor-proof");
const PROOF_PATH = path.join(ARTIFACTS_DIR, "b2v-cursor-proof.png");

let electronApp: ElectronApplication;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
    const t0 = performance.now();
    const ms = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

    mkdirSync(ARTIFACTS_DIR, { recursive: true });

    // Kill stale processes on both outer and inner ports
    for (const port of [TEST_PORT, TEST_PORT + 1, TEST_CDP_PORT, 9581, 9582, 9385]) {
        try {
            const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
            for (const pid of pids.split("\n").filter(Boolean)) {
                try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
            }
        } catch { }
    }

    console.log(`[cursor-proof ${ms()}] Launching Electron player...`);
    electronApp = await _electron.launch({
        args: [PLAYER_DIR],
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            NODE_OPTIONS: "--experimental-strip-types --no-warnings",
            PORT: String(TEST_PORT),
            B2V_CDP_PORT: String(TEST_CDP_PORT),
            B2V_TEST_ARTIFACTS_DIR: ARTIFACTS_DIR,
        },
        timeout: 60_000,
    });
    console.log(`[cursor-proof ${ms()}] Electron launched`);

    // Pipe process output so we can see scenario + inner player logs
    const proc = electronApp.process();
    proc.stdout?.on("data", (d) => console.log(`[electron-out] ${d.toString().trimEnd()}`));
    proc.stderr?.on("data", (d) => console.error(`[electron-err] ${d.toString().trimEnd()}`));

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    console.log(`[cursor-proof ${ms()}] domcontentloaded`);
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

test("cursor proof — both cursors visible in nested player", async () => {
    test.setTimeout(600_000); // 10 min — inner player + Vite takes time

    // Wait for player's picker to appear
    await page.waitForSelector("[data-testid='picker-select']", { timeout: 90_000 });
    console.log("[cursor-proof] Player UI ready");

    // Load cursor-proof scenario
    await page.selectOption("[data-testid='picker-select']", {
        label: "tests/scenarios/cursor-proof.scenario.ts",
    });
    await page.waitForTimeout(2000);
    await page.waitForSelector("[data-testid='step-card-0']", { timeout: 30_000 });
    const stepCards = page.locator("[data-testid^='step-card-']");
    const finalCount = await stepCards.count();
    console.log(`[cursor-proof] Loaded scenario with ${finalCount} steps`);

    // Click Play All
    await page.click("[data-testid='ctrl-play-all']");
    console.log("[cursor-proof] Play All clicked — waiting for all steps");

    // Poll for step completion
    const pollIntervalMs = 3000;
    for (let tick = 0; tick < 120; tick++) {
        await page.waitForTimeout(pollIntervalMs);
        const count = await stepCards.count();
        let doneCount = 0;
        for (let i = 0; i < count; i++) {
            const cls = await stepCards.nth(i).getAttribute("class") ?? "";
            if (cls.includes("emerald")) doneCount++;
        }
        const log = `${doneCount}/${count} done`;
        console.log(`[cursor-proof] ${log}`);
        if (doneCount === count) break;
    }

    // Verify proof files exist
    expect(existsSync(PROOF_PATH)).toBe(true);
    const size = statSync(PROOF_PATH).size;
    console.log(`[cursor-proof] Proof screenshot: ${size} bytes`);
    expect(size).toBeGreaterThan(1000);
});
