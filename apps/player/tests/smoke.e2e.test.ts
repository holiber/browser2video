import { test, expect, _electron, type ElectronApplication } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");
const TEST_PORT = 9551;
const TEST_CDP_PORT = 9355;

function isPortFree(port: number): boolean {
    try {
        const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
        return pids.length === 0;
    } catch {
        return true;
    }
}

test("player opens and closes without zombie processes", async () => {
    test.setTimeout(120_000);

    // Launch Electron
    const electronApp: ElectronApplication = await _electron.launch({
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

    // Verify the app rendered something
    const body = page.locator("body");
    await expect(body).toBeVisible({ timeout: 10_000 });

    // Wait for the real page to load (splash page has no title)
    await page.waitForFunction(() => document.title.length > 0, { timeout: 30_000 });
    const title = await page.title();
    expect(title.toLowerCase()).toContain("b2v");

    // Close via SIGTERM (exercises the graceful shutdown path)
    const pid = electronApp.process().pid;
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
