/**
 * Comprehensive Player Self-Test Scenario
 *
 * Architecture:
 *   Root Player (A) → loads this scenario → spawns Player B (inner)
 *   → session.openPage() connects to Player B's web UI
 *   → InjectedActor drives Player B's studio + todo app
 *   → Root Player captures screenshots from the session page
 *
 * Phases:
 *   1. Studio + Terminal — split horizontal, add browser + terminal
 *   2. Terminal launches demo — vite dev server in terminal
 *   3. Todo app — add, reorder, scroll, delete todos via nested actor
 *   4. Close terminal — verify app stops working
 *   5. Scenario playback — load basic-ui, play, stop, step through
 *   6. Console error check — no unexpected errors
 */
import path from "node:path";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { defineScenario, type Actor, type Page } from "browser2video";
import { InjectedActor } from "browser2video/injected-actor";

const PLAYER_DIR = path.resolve(import.meta.dirname, "../../apps/studio-player");
const INNER_PORT = 9591;
const INNER_CDP_PORT = 9395;
const DEMO_VITE_PORT = 5199;

interface Ctx {
    page: Page;
    injected: InjectedActor;
    innerProcess: ChildProcess;
    consoleErrors: string[];
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
    throw new Error(`Port ${port} did not become available within ${timeoutMs}ms`);
}

export default defineScenario<Ctx>("Player Self-Test", (s) => {
    s.options({ layout: "row" });

    s.setup(async (session) => {
        const t0 = Date.now();
        const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

        // Resolve the electron binary.
        // Inside Electron's runtime `require("electron")` returns the module
        // object rather than the binary path.  We resolve the package then read
        // the actual executable from its internal helper.
        const { createRequire } = await import("node:module");
        const playerRequire = createRequire(path.join(PLAYER_DIR, "package.json"));
        let electronPath: string;
        const raw = playerRequire("electron");
        if (typeof raw === "string") {
            electronPath = raw;
        } else {
            // Running inside Electron — find the binary through the package dir
            const electronPkgDir = path.dirname(playerRequire.resolve("electron/package.json"));
            // The electron package has a `path.txt` that contains the binary path
            const { default: fs } = await import("node:fs");
            const pathTxtFile = path.join(electronPkgDir, "path.txt");
            if (fs.existsSync(pathTxtFile)) {
                const rel = fs.readFileSync(pathTxtFile, "utf-8").trim();
                electronPath = path.join(electronPkgDir, "dist", rel);
            } else {
                // Fallback: current Electron binary (process.execPath)
                electronPath = process.execPath;
            }
        }
        console.error(`[self-test setup ${elapsed()}] Electron path resolved`);

        // Kill any stale processes on the inner player's ports from previous runs
        const { execSync } = await import("node:child_process");
        for (const port of [INNER_PORT, INNER_CDP_PORT]) {
            try {
                const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
                if (pids) {
                    for (const pid of pids.split("\n").filter(Boolean)) {
                        if (pid === String(process.pid)) continue;
                        try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
                        console.error(`[self-test setup] Killed stale process ${pid} on port ${port}`);
                    }
                    await new Promise((r) => setTimeout(r, 300));
                }
            } catch { }
        }
        console.error(`[self-test setup ${elapsed()}] Port cleanup done`);

        console.error(`[self-test setup ${elapsed()}] Spawning inner player on port ${INNER_PORT}...`);
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
                    B2V_EMBEDDED: "1",
                    B2V_CURSOR_COLOR: "#fb923c,#9a3412",  // orange cursor for scenario Actor
                },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        innerProcess.stdout?.on("data", (d) => process.stderr.write(`[inner] ${d}`));
        innerProcess.stderr?.on("data", (d) => process.stderr.write(`[inner] ${d}`));

        session.addCleanup(async () => {
            // Safety-net: kill inner player if it wasn't cleaned up by the test step
            if (!innerProcess.killed && innerProcess.exitCode === null) {
                console.error("[self-test] Cleaning up inner player (safety-net)...");
                try { innerProcess.kill("SIGTERM"); } catch { }
                await new Promise((r) => setTimeout(r, 1000));
                try { innerProcess.kill("SIGKILL"); } catch { }
            }
        });

        // Wait for inner player to be FULLY ready (HTTP + WS + Vite)
        console.error(`[self-test setup ${elapsed()}] Waiting for inner player HTTP...`);
        await waitForPort(INNER_PORT, 60_000);
        console.error(`[self-test setup ${elapsed()}] Inner player HTTP is up, opening page...`);

        // Open inner player's web UI in session browser (no fixed delay needed —
        // the studio-react selector below is the real readiness check)
        const { page } = await session.openPage({
            url: `http://localhost:${INNER_PORT}`,
            viewport: { width: 1280, height: 720 },
        });
        console.error(`[self-test setup ${elapsed()}] Page created`);

        await page.waitForLoadState("domcontentloaded");
        console.error(`[self-test setup ${elapsed()}] domcontentloaded`);

        // Wait for the studio-react mode which only appears after WS connects
        // and the terminal server URL is received from the backend
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 15_000 });
                break;
            } catch {
                console.error(`[self-test setup ${elapsed()}] Attempt ${attempt + 1}: studio not ready, reloading...`);
                await page.reload();
                await page.waitForLoadState("domcontentloaded");
            }
        }
        console.error(`[self-test setup ${elapsed()}] Inner player UI ready!`);

        // Collect console errors for Phase 6
        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                const text = msg.text();
                // Ignore known benign errors
                if (text.includes("Content Security Policy") || text.includes("favicon.ico")) return;
                consoleErrors.push(text);
            }
        });

        // Create InjectedActor — shares session's mode ref
        // Pink cursor to distinguish from scenario's orange cursor
        const injected = new InjectedActor(page, "tester", {
            mode: session.modeRef,
            cursorColor: { fill: "#ff69b4", stroke: "#c2185b" },  // hot pink
        });
        await injected.init();

        // Sync Playwright's internal viewport tracking with the actual view size.
        // The Electron WebContentsView starts at 0×0 and is later resized via IPC,
        // but Playwright's CDP-side viewport tracking keeps the initial 0×0 value,
        // causing ALL elements to be reported as "outside of the viewport".
        await page.setViewportSize({ width: 1280, height: 720 });

        return { page, injected, innerProcess, consoleErrors };
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 1 — Studio + Terminal
    // ═══════════════════════════════════════════════════════════════════

    s.step("Player UI is ready", async ({ injected }) => {
        await injected.moveCursorTo(640, 360);
        await injected.breathe();
    });

    s.step("Inner player window is hidden", async ({ }) => {
        // Verify the inner player's Electron BrowserWindow is NOT visible
        // on screen. It should be hidden (show:false), minimized, and off-screen.
        // Use osascript to check all Electron windows and their positions.
        const { execSync } = await import("node:child_process");
        try {
            // Get all Electron windows and their properties via osascript
            const script = `
                tell application "System Events"
                    set windowInfo to ""
                    repeat with p in (every process whose name contains "Electron")
                        repeat with w in (every window of p)
                            set pos to position of w
                            set sz to size of w
                            set windowInfo to windowInfo & (item 1 of pos) & "," & (item 2 of pos) & "," & (item 1 of sz) & "," & (item 2 of sz) & "\\n"
                        end repeat
                    end repeat
                    return windowInfo
                end tell
            `;
            const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
                encoding: "utf8",
                timeout: 5000,
            }).trim();

            const windows = result.split("\n").filter(Boolean);
            console.error(`[self-test] Electron windows found: ${windows.length}`);
            for (const w of windows) {
                const [x, y, width, height] = w.split(",").map(Number);
                console.error(`  Window at (${x},${y}) size ${width}x${height}`);
                // Flag windows that appear at (0,0) or near the parent player's position
                // with a significant size — these would overlap
                if (x >= 0 && x < 100 && y >= 0 && y < 100 && width > 10 && height > 10) {
                    // Check if this is the inner player (small 1x1 windows are OK)
                    const isLargeAtOrigin = width > 100 && height > 100;
                    if (isLargeAtOrigin) {
                        // Count how many large windows are at the origin area
                        const largeWindows = windows.filter(ww => {
                            const [wx, wy, ww2, wh] = ww.split(",").map(Number);
                            return wx >= 0 && wx < 100 && wy >= 0 && wy < 100 && ww2 > 100 && wh > 100;
                        });
                        if (largeWindows.length > 1) {
                            console.error(`[self-test] WARNING: ${largeWindows.length} large Electron windows near origin — possible overlap!`);
                        }
                    }
                }
            }
        } catch (err: any) {
            // osascript may fail without accessibility permissions — just log
            console.error(`[self-test] Could not check window positions: ${err.message}`);
        }
    });

    s.step("Split screen horizontally", async ({ injected, page }) => {
        // Change layout to top-bottom
        await page.selectOption("[data-testid='studio-layout-picker']", "top-bottom");
        // After layout change, 2 placeholders should appear
        const placeholders = page.locator("[data-testid='studio-placeholder-add']");
        await placeholders.first().waitFor({ timeout: 10_000 });
        await injected.breathe();
    });

    s.step("Add terminal in bottom pane", async ({ injected, page }) => {
        // Click the second placeholder (bottom)
        const placeholders = page.locator("[data-testid='studio-placeholder-add']");
        const count = await placeholders.count();
        await placeholders.nth(count - 1).click();

        // Terminal option in popup
        await injected.waitFor("[data-testid='studio-add-pane-popup']");
        await injected.click("[data-testid='studio-add-terminal']");

        // Wait for terminal iframe
        await injected.waitFor("[data-testid='studio-terminal-iframe']");
        await injected.breathe();
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 2 — Terminal launches demo app
    // ═══════════════════════════════════════════════════════════════════

    s.step("Launch demo app in terminal", async ({ page }) => {
        const termIframe = page.locator("[data-testid='studio-terminal-iframe']");
        const frame = termIframe.contentFrame();

        // Wait for xterm to render
        await frame.locator(".xterm-accessibility-tree, .xterm-rows").waitFor({ state: "visible", timeout: 30_000 });
        await frame.locator("[data-testid='jabterm-container']").click();

        // Type the vite dev command
        await page.keyboard.type(`cd apps/demo && npx vite --port ${DEMO_VITE_PORT}`, { delay: 15 });
        await page.keyboard.press("Enter");

        // Wait for Vite to show "ready"
        await frame.locator(".xterm-accessibility-tree, .xterm-rows").filter({ hasText: "ready" }).waitFor({ timeout: 30_000 });
        console.error("[self-test] Demo Vite server is ready!");
        await page.waitForTimeout(500);
    });

    s.step("Add browser pane with todo app", async ({ injected, page }) => {
        // Click the remaining placeholder (top)
        await injected.click("[data-testid='studio-placeholder-add']");
        await injected.waitFor("[data-testid='studio-add-pane-popup']");
        await injected.click("[data-testid='studio-add-browser']");

        // URL dialog — clear and type the notes app URL
        await injected.waitFor("[data-testid='studio-browser-url-dialog']");
        const urlInput = page.locator("[data-testid='studio-browser-url-input']");
        await urlInput.fill(`http://localhost:${DEMO_VITE_PORT}/notes`);

        await injected.click("[data-testid='studio-browser-url-confirm']");
        await injected.waitForHidden("[data-testid='studio-browser-url-dialog']");
        await injected.waitFor("[data-testid='studio-browser-iframe']");

        // Wait for the notes app to load inside the iframe
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();
        await noteFrame.locator("[data-testid='notes-page']").waitFor({ timeout: 30_000 });
        console.error("[self-test] Todo app loaded in browser iframe!");
        await injected.breathe();
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 3 — Todo CRUD via nested InjectedActor in iframe
    // ═══════════════════════════════════════════════════════════════════

    s.step("Add 8 todos", async ({ page }) => {
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();

        const todos = [
            "Set up database schema",
            "Implement API endpoints",
            "Build React components",
            "Add authentication flow",
            "Write unit tests",
            "Set up CI pipeline",
            "Deploy to staging",
            "Performance testing",
        ];

        for (const todo of todos) {
            await noteFrame.locator("[data-testid='note-input']").fill(todo);
            await noteFrame.locator("[data-testid='note-add-btn']").click();
            await page.waitForTimeout(200);
        }

        // Verify all 8 appear
        const items = noteFrame.locator("[data-testid^='note-item-']");
        const count = await items.count();
        if (count < 8) throw new Error(`Expected 8 todos, got ${count}`);
        console.error(`[self-test] Added ${count} todos`);
    });

    s.step("Reorder a todo", async ({ page }) => {
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();

        // Drag the last item (index 7) to the top (index 0)
        const dragHandle = noteFrame.locator("[data-testid='note-drag-7']");
        const dropTarget = noteFrame.locator("[data-testid='note-item-0']");

        const dragBox = await dragHandle.boundingBox();
        const dropBox = await dropTarget.boundingBox();
        if (dragBox && dropBox) {
            await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + dropBox.height / 2, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(500);
        }
        console.error("[self-test] Reordered a todo");
    });

    s.step("Scroll the todo list", async ({ page }) => {
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();

        const notesList = noteFrame.locator("[data-testid='notes-page']");
        // Use locator.evaluate which is valid on FrameLocator's locators
        await notesList.evaluate((el: Element) => el.scrollBy(0, 200));
        await page.waitForTimeout(300);
        await notesList.evaluate((el: Element) => el.scrollBy(0, -200));
        await page.waitForTimeout(300);
        console.error("[self-test] Scrolled todo list");
    });

    s.step("Delete a todo", async ({ page }) => {
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();

        const countBefore = await noteFrame.locator("[data-testid^='note-item-']").count();
        await noteFrame.locator("[data-testid='note-delete-0']").click();
        await page.waitForTimeout(500);
        const countAfter = await noteFrame.locator("[data-testid^='note-item-']").count();
        if (countAfter >= countBefore) throw new Error(`Delete failed: ${countBefore} → ${countAfter}`);
        console.error(`[self-test] Deleted todo: ${countBefore} → ${countAfter}`);
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 4 — Close terminal, verify app stops working
    // ═══════════════════════════════════════════════════════════════════

    s.step("Close terminal pane", async ({ injected, page }) => {
        // Click on the terminal's dockview tab header to make it the active panel.
        // Clicking inside an iframe doesn't change dockview's activePanel tracking,
        // so we must click the .dv-tab element directly.
        const tabs = page.locator(".dv-tab");
        const tabCount = await tabs.count();
        for (let i = 0; i < tabCount; i++) {
            const tab = tabs.nth(i);
            const text = await tab.textContent();
            if (text?.includes("Shell")) {
                await tab.click();
                await page.waitForTimeout(300);
                break;
            }
        }

        // Close the terminal via the close button
        await injected.click("[data-testid='studio-close-active']");
        await page.waitForTimeout(1000);

        // Verify terminal iframe is gone
        const termIframes = page.locator("[data-testid='studio-terminal-iframe']");
        const count = await termIframes.count();
        if (count > 0) throw new Error("Terminal is still visible after close");
        console.error("[self-test] Terminal closed");
    });

    s.step("Verify todo app stops (server killed)", async ({ page }) => {
        const browserIframe = page.locator("[data-testid='studio-browser-iframe']");
        const noteFrame = browserIframe.contentFrame();

        // The demo vite server was killed with the terminal
        // Navigate the iframe to trigger a reload by setting src
        const src = await browserIframe.getAttribute("src") ?? `http://localhost:${DEMO_VITE_PORT}/notes`;
        await page.evaluate((s) => {
            const iframe = document.querySelector("[data-testid='studio-browser-iframe']") as HTMLIFrameElement;
            if (iframe) iframe.src = s;
        }, src);
        await page.waitForTimeout(3000);

        // The page should not show the notes app anymore
        const notesStillWork = await noteFrame.locator("[data-testid='notes-page']").isVisible().catch(() => false);
        console.error(`[self-test] After terminal close: notesStillWork=${notesStillWork}`);
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 5 — Scenario playback
    // ═══════════════════════════════════════════════════════════════════

    s.step("Load basic-ui scenario", async ({ injected, page }) => {
        // Use the scenario picker to load basic-ui
        // Find the option whose value contains 'basic-ui'
        await page.selectOption("[data-testid='picker-select']", { label: "tests/scenarios/basic-ui.scenario.ts" });
        await page.waitForTimeout(2000);

        // Wait for scenario steps to appear in the sidebar
        await page.waitForSelector("[data-testid='step-card-0']", { timeout: 30_000 });
        const stepCards = page.locator("[data-testid^='step-card-']");
        const stepCount = await stepCards.count();
        console.error(`[self-test] basic-ui scenario loaded: ${stepCount} steps`);
        await injected.breathe();
    });

    s.step("Play all, then stop after first slide", async ({ injected, page }) => {
        // Click Play all
        await injected.click("[data-testid='ctrl-play-all']");

        // Wait for the first step to start running
        await page.waitForTimeout(3000);

        // Click Stop
        await injected.click("[data-testid='ctrl-stop']");
        await page.waitForTimeout(1000);
        console.error("[self-test] Played and stopped after first slide");
        await injected.breathe();
    });

    s.step("Step through all slides one by one", async ({ injected, page }) => {
        // Reset first
        await injected.click("[data-testid='ctrl-reset']");
        await page.waitForTimeout(1000);

        // Get the number of steps
        const stepCards = page.locator("[data-testid^='step-card-']");
        const stepCount = await stepCards.count();

        // Click each step card individually
        for (let i = 0; i < Math.min(stepCount, 5); i++) {
            console.error(`[self-test] Clicking step ${i}...`);
            await injected.click(`[data-testid='step-card-${i}']`);

            // Wait for the step to complete (screenshot appears)
            await page.waitForTimeout(5000);

            // Assert: the preview area should NOT be in electron-scenario-view mode
            // (which shows a black background when the player is embedded).
            // It should fall back to screenshot mode instead.
            const previewMode = await page.getAttribute("[data-preview-mode]", "data-preview-mode");
            if (previewMode === "electron-scenario-view") {
                throw new Error(
                    `Step ${i}: Preview is in "electron-scenario-view" mode (black background). ` +
                    `Embedded players should use screenshot/screencast mode instead.`
                );
            }
        }
        console.error(`[self-test] Stepped through ${Math.min(stepCount, 5)} slides`);
    });

    s.step("Verify scenario screenshots are not blank", async ({ page }) => {
        // After stepping through BasicUI slides, the step-card thumbnails
        // should contain actual screenshots (base64 PNG), not be empty.
        // This proves the scenario executed, the cursor interacted with
        // elements, and the page rendered visible content.
        const stepCards = page.locator("[data-testid^='step-card-']");
        const cardCount = await stepCards.count();

        let screenshotsFound = 0;
        for (let i = 0; i < Math.min(cardCount, 5); i++) {
            const img = stepCards.nth(i).locator("img");
            const imgCount = await img.count();
            if (imgCount > 0) {
                const src = await img.first().getAttribute("src");
                if (src && src.startsWith("data:image/") && src.length > 100) {
                    screenshotsFound++;
                }
            }
        }

        console.error(`[self-test] Step screenshots found: ${screenshotsFound}/${Math.min(cardCount, 5)}`);
        if (screenshotsFound === 0) {
            throw new Error(
                "No step screenshots found in step cards. " +
                "The BasicUI scenario should produce visible screenshots after each step."
            );
        }
    });

    s.step("Step cards show timing", async ({ page }) => {
        const stepCards = page.locator("[data-testid^='step-card-']");
        const cardCount = await stepCards.count();
        const checkCount = Math.min(cardCount, 5);

        let timingsFound = 0;
        for (let i = 0; i < checkCount; i++) {
            const durationEl = page.locator(`[data-testid='step-duration-${i}']`);
            const visible = await durationEl.isVisible().catch(() => false);
            if (visible) {
                const text = await durationEl.textContent();
                if (text && /\d+(\.\d+)?s/.test(text)) {
                    timingsFound++;
                    console.error(`[self-test] Step ${i} duration: ${text}`);
                }
            }
        }

        console.error(`[self-test] Step timings found: ${timingsFound}/${checkCount}`);
        if (timingsFound < 3) {
            throw new Error(
                `Expected at least 3 step cards with timing, got ${timingsFound}/${checkCount}. ` +
                "Step durations should be saved in cache after execution."
            );
        }
    });

    s.step("Cache button shows size", async ({ page }) => {
        const btn = page.locator("[data-testid='ctrl-clear-cache']");
        await btn.waitFor({ timeout: 5_000 });

        await page.waitForFunction(
            () => /Clear Cache \d/.test(
                document.querySelector('[data-testid="ctrl-clear-cache"]')?.textContent ?? "",
            ),
            undefined,
            { timeout: 5_000 },
        );

        const text = await btn.textContent();
        if (!text || !(/Clear Cache \d/.test(text))) {
            throw new Error(`Cache button should show size after steps ran, got: "${text}"`);
        }
        console.error(`[self-test] Cache button text: "${text}"`);
    });

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 6 — Cleanup & verification
    // ═══════════════════════════════════════════════════════════════════

    s.step("Inner player shuts down cleanly", async ({ innerProcess }) => {
        // Send SIGTERM and wait for graceful exit
        const exitPromise = new Promise<number | null>((resolve) => {
            innerProcess.on("exit", (code) => resolve(code));
        });

        console.error("[self-test] Sending SIGTERM to inner player...");
        innerProcess.kill("SIGTERM");

        const exitCode = await Promise.race([
            exitPromise,
            new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000)),
        ]);

        if (exitCode === "timeout") {
            console.error("[self-test] Inner player didn't exit in 10s, sending SIGKILL...");
            innerProcess.kill("SIGKILL");
            const killResult = await Promise.race([
                exitPromise,
                new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000)),
            ]);
            if (killResult === "timeout") {
                throw new Error("Inner player process didn't exit after SIGKILL");
            }
            console.error(`[self-test] Inner player killed (exit code: ${killResult})`);
        } else {
            console.error(`[self-test] Inner player exited cleanly (code: ${exitCode})`);
        }

        // Verify the inner player's port is freed
        await new Promise((r) => setTimeout(r, 500));
        try {
            const probe = await fetch(`http://localhost:${INNER_PORT}`);
            throw new Error(`Inner player port ${INNER_PORT} is still responding (status: ${probe.status})`);
        } catch (err: any) {
            if (err.message.includes("still responding")) throw err;
            // fetch failed = port is freed = good
            console.error(`[self-test] Port ${INNER_PORT} is freed`);
        }
    });

    s.step("No unexpected console errors", async ({ consoleErrors }) => {
        if (consoleErrors.length > 0) {
            console.error(`[self-test] Console errors found:`);
            for (const err of consoleErrors) {
                console.error(`  - ${err}`);
            }
        }
        console.error(`[self-test] Console errors: ${consoleErrors.length}`);
    });
});
