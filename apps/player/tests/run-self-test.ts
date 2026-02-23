/**
 * Player Self-Test Runner
 *
 * Launches the Player Electron app, loads the player-self-test scenario via WS,
 * runs all steps, waits for completion, and exits with status.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings apps/player/tests/run-self-test.ts
 */
import { _electron } from "@playwright/test";
import WebSocket from "ws";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const SCENARIO_FILE = "tests/scenarios/player-self-test.scenario.ts";
const TEST_PORT = 9521;
const TEST_CDP_PORT = 9334;

async function main() {
    const t0 = performance.now();
    const ms = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

    // Launch the Player Electron app
    console.log(`[${ms()}] Launching Player...`);
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
    console.log(`[${ms()}] Player loaded`);

    // Connect to the Player's WS server
    const wsUrl = `ws://localhost:${TEST_PORT}/ws`;
    const result = await new Promise<{
        passed: number;
        total: number;
        videoPath: string | null;
        error: string | null;
    }>((resolve) => {
        const ws = new WebSocket(wsUrl);
        let loaded = false;
        let total = 0;
        let passed = 0;
        let videoPath: string | null = null;

        const timeout = setTimeout(() => {
            resolve({ passed, total, videoPath, error: "Timeout after 5 minutes" });
            ws.close();
        }, 5 * 60 * 1000);

        ws.on("open", () => {
            console.log(`[${ms()}] WS connected, loading scenario...`);
            ws.send(JSON.stringify({ type: "load", file: SCENARIO_FILE }));
        });

        ws.on("message", (data: Buffer) => {
            const msg = JSON.parse(data.toString());

            if (msg.type === "scenario" && !loaded) {
                loaded = true;
                total = msg.steps.length;
                console.log(`[${ms()}] Loaded: ${msg.name} (${total} steps)`);
                // Small delay to let the UI render
                setTimeout(() => {
                    console.log(`[${ms()}] Starting runAll...`);
                    ws.send(JSON.stringify({ type: "runAll" }));
                }, 2000);
            } else if (msg.type === "stepComplete") {
                passed++;
                const hasScreenshot = msg.screenshot ? "📸" : "⬛";
                console.log(`  ${hasScreenshot} Step ${msg.index} done (${msg.durationMs}ms)`);
            } else if (msg.type === "finished") {
                videoPath = msg.videoPath || null;
                clearTimeout(timeout);
                resolve({ passed, total, videoPath, error: null });
                ws.close();
            } else if (msg.type === "error" || msg.type === "setupError") {
                clearTimeout(timeout);
                resolve({ passed, total, videoPath, error: msg.message });
                ws.close();
            }
        });

        ws.on("error", (err: Error) => {
            clearTimeout(timeout);
            resolve({ passed, total, videoPath, error: `WS error: ${err.message}` });
        });

        ws.on("close", () => {
            // If WS closes before we get a "finished" message, resolve with what we have
            clearTimeout(timeout);
            if (total > 0 && passed === 0) {
                // WS disconnected during execution — this is expected if the server
                // disconnects the client during scenario setup. Wait for the executor.
            }
        });
    });

    // Report results
    console.log(`\n${"=".repeat(50)}`);
    if (result.error) {
        console.error(`❌ FAILED: ${result.error}`);
    } else {
        console.log(`✅ ${result.passed}/${result.total} steps passed`);
    }
    if (result.videoPath) {
        console.log(`🎬 Video: ${result.videoPath}`);
    }
    console.log(`⏱  Duration: ${ms()}`);
    console.log("=".repeat(50));

    // Shutdown Electron
    console.log(`[${ms()}] Shutting down Player...`);
    const pid = electronApp.process().pid;
    if (pid) {
        process.kill(pid, "SIGTERM");
        await new Promise<void>((resolve) => {
            const proc = electronApp.process();
            if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
            proc.on("exit", () => resolve());
            setTimeout(() => {
                try { process.kill(pid, "SIGKILL"); } catch { }
                resolve();
            }, 5_000);
        });
    }
    console.log(`[${ms()}] Player shut down.`);

    process.exit(result.error ? 1 : 0);
}

main().catch((err) => {
    console.error("Self-test failed:", err);
    process.exit(1);
});
