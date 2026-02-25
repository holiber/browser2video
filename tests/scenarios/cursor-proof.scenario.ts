/**
 * Cursor Proof scenario — spawns an inner player, loads simple-click,
 * plays the scenario, then captures a proof screenshot while BOTH cursors
 * are visible at once:
 *
 * - Outer cursor: InjectedActor (pink) rendered in the inner player's UI DOM
 * - Inner cursor: scenario Actor cursor (from B2V_CURSOR_COLOR) rendered inside
 *   the scenario preview image (live screencast frame)
 *
 * Modeled EXACTLY after player-self-test.scenario.ts setup.
 */
import { defineScenario, InjectedActor, type Session } from "browser2video";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const PLAYER_DIR = path.resolve(import.meta.dirname, "../../apps/studio-player");
const INNER_PORT = 9581;
const INNER_CDP_PORT = 9385;

interface Ctx {
    page: Awaited<ReturnType<Session["openPage"]>>["page"];
    injected: InjectedActor;
    innerProcess: ChildProcess;
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
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

export default defineScenario<Ctx>("Cursor Proof", (s) => {
    s.setup(async (session: Session) => {
        const t0 = Date.now();
        const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

        const { execSync } = await import("node:child_process");

        // Kill stale processes on inner ports (same as self-test)
        for (const port of [INNER_PORT, INNER_CDP_PORT]) {
            try {
                const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
                if (pids) {
                    for (const pid of pids.split("\n").filter(Boolean)) {
                        if (pid === String(process.pid)) continue;
                        try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
                    }
                    await new Promise((r) => setTimeout(r, 300));
                }
            } catch { }
        }
        console.error(`[cursor-proof ${elapsed()}] Port cleanup done`);

        const electronPath = path.resolve(PLAYER_DIR, "node_modules/.bin/electron");
        console.error(`[cursor-proof ${elapsed()}] Spawning inner player on port ${INNER_PORT}...`);
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
                    B2V_CURSOR_COLOR: "#fb923c,#9a3412",   // orange scenario cursor
                },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        innerProcess.stdout?.on("data", (d: Buffer) => process.stderr.write(`[inner] ${d}`));
        innerProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[inner] ${d}`));

        session.addCleanup(async () => {
            if (!innerProcess.killed && innerProcess.exitCode === null) {
                try { innerProcess.kill("SIGTERM"); } catch { }
                await new Promise((r) => setTimeout(r, 1000));
                try { innerProcess.kill("SIGKILL"); } catch { }
            }
        });

        console.error(`[cursor-proof ${elapsed()}] Waiting for inner player HTTP...`);
        await waitForPort(INNER_PORT, 60_000);
        console.error(`[cursor-proof ${elapsed()}] Inner player HTTP is up, opening page...`);

        const { page } = await session.openPage({
            url: `http://localhost:${INNER_PORT}`,
            viewport: { width: 1280, height: 720 },
        });
        console.error(`[cursor-proof ${elapsed()}] Page created`);
        await page.waitForLoadState("domcontentloaded");
        console.error(`[cursor-proof ${elapsed()}] domcontentloaded`);

        // Wait for studio-react mode (same 3-retry pattern as self-test)
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.waitForSelector("[data-preview-mode='studio-react']", { timeout: 15_000 });
                break;
            } catch {
                console.error(`[cursor-proof ${elapsed()}] Attempt ${attempt + 1}: studio not ready, reloading...`);
                await page.reload();
                await page.waitForLoadState("domcontentloaded");
            }
        }
        console.error(`[cursor-proof ${elapsed()}] Inner player UI ready!`);

        // Pink InjectedActor cursor (tester cursor) over inner player page
        const injected = new InjectedActor(page, "tester", {
            mode: session.modeRef,
            cursorColor: { fill: "#ff69b4", stroke: "#c2185b" },
        });
        await injected.init();
        await page.setViewportSize({ width: 1280, height: 720 });

        return { page, injected, innerProcess };
    });

    // Step 1: Load simple-click scenario into the inner player
    s.step("Load simple-click scenario", async ({ injected, page }) => {
        await page.selectOption("[data-testid='picker-select']", {
            label: "tests/scenarios/simple-click.scenario.ts",
        });
        await page.waitForTimeout(2000);
        await page.waitForSelector("[data-testid='step-card-0']", { timeout: 30_000 });
        console.error("[cursor-proof] simple-click loaded");
        await injected.breathe();
    });

    // Step 2: Run the inner scenario (step 2) and capture proof screenshot
    s.step("Play and capture cursor proof", async ({ injected, page }) => {
        // Play all steps so step screenshots are generated inside the inner UI.
        // We'll use the step-2 thumbnail (hover confirm) as the "inner cursor" proof surface.
        await injected.click("[data-testid='ctrl-play-all']");
        console.error("[cursor-proof] Play All clicked in inner player");

        // Wait for step-card-1 to receive a screenshot thumbnail (means stepComplete arrived).
        const stepCard = page.locator("[data-testid='step-card-1']");
        await stepCard.locator("img").first().waitFor({ state: "visible", timeout: 120_000 });

        const artifactsDir = process.env.B2V_TEST_ARTIFACTS_DIR || "/tmp";
        try { fs.mkdirSync(artifactsDir, { recursive: true }); } catch { /* ignore */ }
        const proofPath = path.join(artifactsDir, "b2v-cursor-proof.png");

        // Poll until BOTH cursors are visible:
        // - Outer (InjectedActor) cursor: DOM element `#__b2v_cursor_tester`
        // - Inner (scenario Actor) cursor: orange pixels inside the step-card-1 screenshot thumbnail
        const t0 = Date.now();
        const deadline = t0 + 20_000;
        const target = { r: 0xfb, g: 0x92, b: 0x3c }; // #fb923c (inner cursor fill)
        const tol = 28;
        const minMatches = 140;

        let lastDebug = "";
        let outerVisible = false;
        let innerVisible = false;

        while (Date.now() < deadline) {
            const res = await page.evaluate(({ target, tol, minMatches }) => {
                const outerEl = document.getElementById("__b2v_cursor_tester") as HTMLElement | null;
                const outerVisible =
                    !!outerEl &&
                    getComputedStyle(outerEl).display !== "none" &&
                    outerEl.getBoundingClientRect().width > 0;

                const stepImg = document.querySelector("[data-testid='step-card-1'] img") as HTMLImageElement | null;
                const img = stepImg ?? null;
                if (!img || !img.complete || img.naturalWidth < 10 || img.naturalHeight < 10) {
                    return { outerVisible, innerMatches: 0, previewMode: "step-card-1", hasImg: !!img };
                }

                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext("2d", { willReadFrequently: true } as any);
                if (!ctx) return { outerVisible, innerMatches: 0, previewMode: "step-card-1", hasImg: true };

                ctx.drawImage(img, 0, 0);
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

                let matches = 0;
                const stride = 2; // sample every 2 pixels for speed
                const w = canvas.width;
                const h = canvas.height;
                for (let y = 0; y < h; y += stride) {
                    for (let x = 0; x < w; x += stride) {
                        const i = (y * w + x) * 4;
                        const a = data[i + 3];
                        if (a < 200) continue;
                        const r = data[i], g = data[i + 1], b = data[i + 2];
                        if (Math.abs(r - target.r) <= tol && Math.abs(g - target.g) <= tol && Math.abs(b - target.b) <= tol) {
                            matches++;
                            if (matches >= minMatches) {
                                return { outerVisible, innerMatches: matches, previewMode: "step-card-1", hasImg: true };
                            }
                        }
                    }
                }
                return { outerVisible, innerMatches: matches, previewMode: "step-card-1", hasImg: true };
            }, { target, tol, minMatches });

            outerVisible = res.outerVisible;
            innerVisible = res.innerMatches >= minMatches;
            const dbg = `mode=${res.previewMode} img=${res.hasImg} outer=${outerVisible} innerMatches=${res.innerMatches}`;
            if (dbg !== lastDebug) {
                console.error(`[cursor-proof] ${dbg}`);
                lastDebug = dbg;
            }

            if (outerVisible && innerVisible) break;
            await page.waitForTimeout(250);
        }

        if (!outerVisible) {
            throw new Error("Outer InjectedActor cursor did not become visible (expected #__b2v_cursor_tester).");
        }
        if (!innerVisible) {
            throw new Error(`Inner scenario cursor was not detected in preview image within ${(Date.now() - t0) / 1000}s.`);
        }

        await page.screenshot({ path: proofPath, type: "png" });
        console.error(`[cursor-proof] ✅ Proof screenshot saved: ${proofPath}`);

        await page.waitForTimeout(500);
        await injected.breathe();
    });
});
