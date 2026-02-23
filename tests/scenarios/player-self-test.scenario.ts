/**
 * Player Self-Test Scenario: The player testing itself.
 *
 * Architecture:
 *   Root Player (Player A) → loads this scenario → spawns Player B
 *   → session.openPage() connects to Player B's web UI
 *   → InjectedActor drives Player B's studio UI with visible cursor
 *   → Root Player captures screenshots from the session page
 *
 * Each step corresponds to one UI interaction, navigable via Player A's
 * step controls.
 */
import path from "node:path";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { defineScenario, type Actor, type Page } from "browser2video";
import { InjectedActor } from "browser2video/injected-actor";

const PLAYER_DIR = path.resolve(import.meta.dirname, "../../apps/player");
const INNER_PORT = 9581;
const INNER_CDP_PORT = 9385;

interface Ctx {
    page: Page;
    injected: InjectedActor;
    innerProcess: ChildProcess;
}

/** Wait until the inner player's HTTP server is responding. */
async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ok = await new Promise<boolean>((resolve) => {
            const req = http.get(`http://localhost:${port}`, (res) => {
                res.resume();
                resolve(res.statusCode !== undefined);
            });
            req.on("error", () => resolve(false));
            req.setTimeout(1000, () => { req.destroy(); resolve(false); });
        });
        if (ok) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Inner player did not start on port ${port} within ${timeoutMs}ms`);
}

export default defineScenario<Ctx>("Player Self-Test", (s) => {
    s.options({ layout: "row" });

    s.setup(async (session) => {
        // 1. Launch inner Electron player on a different port
        // Resolve electron binary — require('electron') returns the path to the executable
        // electron is a devDep of the player package, so we resolve from there
        const { createRequire } = await import("node:module");
        const playerRequire = createRequire(path.join(PLAYER_DIR, "package.json"));
        const electronPath = playerRequire("electron") as unknown as string;
        console.error(`[self-test] Spawning inner player on port ${INNER_PORT} (electron: ${electronPath})...`);
        const innerProcess = spawn(
            electronPath,
            [PLAYER_DIR],
            {
                cwd: path.resolve(PLAYER_DIR, "../.."),
                env: {
                    ...process.env,
                    NODE_OPTIONS: "--experimental-strip-types --no-warnings",
                    PORT: String(INNER_PORT),
                    B2V_CDP_PORT: String(INNER_CDP_PORT),
                },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // Log inner player output for debugging
        innerProcess.stdout?.on("data", (d) => process.stderr.write(`[inner] ${d}`));
        innerProcess.stderr?.on("data", (d) => process.stderr.write(`[inner] ${d}`));

        // Register cleanup to kill inner player when scenario ends
        session.addCleanup(async () => {
            console.error("[self-test] Cleaning up inner player...");
            try { innerProcess.kill("SIGTERM"); } catch { }
            await new Promise((r) => setTimeout(r, 1000));
            try { innerProcess.kill("SIGKILL"); } catch { }
        });

        // 2. Wait for inner player's HTTP server to be ready
        console.error("[self-test] Waiting for inner player server...");
        await waitForPort(INNER_PORT, 60_000);
        console.error("[self-test] Inner player server is up!");

        // 3. Open inner player's web UI in the session's browser
        const { page } = await session.openPage({
            url: `http://localhost:${INNER_PORT}`,
            viewport: { width: 1280, height: 720 },
        });

        // 4. Wait for the player UI to fully render
        // Wait for the React app to mount and WS to connect
        // The select dropdown appears once WS sends the scenario list
        await page.waitForLoadState("networkidle");
        await page.waitForSelector("select", { timeout: 60_000 });
        console.error("[self-test] Inner player UI is loaded and ready!");

        // 5. Create InjectedActor for visual cursor inside the player page
        const injected = new InjectedActor(page, "tester", { mode: "human" });
        await injected.init();

        return { page, injected, innerProcess };
    });

    // ── Step 1: Verify player UI is ready ──────────────────────────────
    s.step("Player UI is ready", async ({ injected, page }) => {
        // Verify the connected indicator is visible
        await injected.waitFor("[title='Connected']");
        // Move cursor to center to show the overlay is working
        await injected.moveCursorTo(640, 360);
        await injected.breathe();
    });

    // ── Step 2: Open scenario picker ───────────────────────────────────
    s.step("Open scenario picker", async ({ injected, page }) => {
        // The scenario dropdown should be visible
        const dropdown = page.locator("select").first();
        if (await dropdown.isVisible()) {
            await injected.click("select");
            await injected.breathe();
        }
    });

    // ── Step 3: Click the + placeholder to add a pane ──────────────────
    s.step("Click + placeholder", async ({ injected }) => {
        // Navigate to studio mode (no scenario loaded = studio mode)
        await injected.click("[data-testid='studio-placeholder-add']");
        await injected.waitFor("[data-testid='studio-add-pane-popup']");
        await injected.breathe();
    });

    // ── Step 4: Select Browser from the popup ──────────────────────────
    s.step("Select Browser pane", async ({ injected }) => {
        await injected.click("[data-testid='studio-add-browser']");
        await injected.waitFor("[data-testid='studio-browser-url-dialog']");
        await injected.breathe();
    });

    // ── Step 5: Confirm the URL dialog ─────────────────────────────────
    s.step("Confirm URL and load browser", async ({ injected }) => {
        await injected.click("[data-testid='studio-browser-url-confirm']");
        await injected.waitForHidden("[data-testid='studio-browser-url-dialog']");
        await injected.waitFor("[data-testid='studio-browser-iframe']");
        await injected.breathe();
    });
});
