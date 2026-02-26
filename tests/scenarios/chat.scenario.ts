/**
 * Chat scenario — four concurrent scenes.
 *
 * Alice (iPhone, left pane) and Bob (Pixel, right pane + terminal) act
 * concurrently within each scene.  True parallelism is achieved via
 * `drawViaInject` — cursor overlay + canvas drawing through evaluate() that
 * doesn't touch the shared page.mouse, so Bob can navigate with the mouse
 * at the same time.
 *
 * Scene 0 — Narrator introduces the demo, circles the panes.
 * Scene 1 — Alice browses the movie; Bob reads Wikipedia + codes.
 *           (Interleaved mouse actions for visual concurrency.)
 *           Alice opens Messages and types her invitation while Bob
 *           types his letter to Armillaria in the terminal (concurrent).
 * Scene 2 — Bob gets the notification, checks calendar; Alice draws
 *           an alien spaceship kidnapping Bob on the sketchpad, then sends
 *           it as a picture message.
 *           (Promise.all: draw via inject ‖ mouse nav.)
 * Scene 3 — Bob confirms, Alice reacts with ❤️, then Alice types
 *           the cinema address while Bob tells Armillaria he can't visit
 *           Friday in the terminal (concurrent).  Narrator wraps up.
 *
 * @rule The narrator is an external observer. He MUST NOT reveal what Bob
 *       is working on (brainfuck, Armillaria letter, etc.). The narrator
 *       only sees that "Bob looks busy" or "Bob is doing his thing."
 *       Bob's activities are his secret — the narrator should not spoil them.
 *
 * @rule Whenever Alice types a chat message, Bob MUST be typing in the
 *       terminal at the same time. Use `typeInTerminalViaInject` for Bob
 *       (synthetic DOM events) so it doesn't conflict with Alice's
 *       `page.keyboard`-based typing. Both run inside `Promise.all`.
 *
 * Layout:
 *   Row 0: [Alice (iPhone)  |  Bob browser (Pixel)]
 *   Row 1: [Alice (iPhone)  |  Bob terminal        ]
 */
import path from "path";
import {
    defineScenario, startServer, Actor, translateText,
    type TerminalActor, type Frame, type GridHandle, type Page,
} from "browser2video";
import { startSyncServer } from "../../apps/demo/scripts/sync-server.ts";

type DOMContext = Frame;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Type into an xterm terminal via synthetic DOM events — no page.keyboard.
 * Dispatches InputEvent for characters and KeyboardEvent for Enter,
 * targeting the xterm helper textarea directly. This lets another actor
 * use page.keyboard concurrently (same idea as drawViaInject for page.mouse).
 */
async function typeInTerminalViaInject(
    page: Page,
    dom: DOMContext,
    cursorId: string,
    termSelector: string,
    text: string,
    isHuman: boolean,
) {
    const taSelector = `${termSelector} .xterm-helper-textarea`;

    // Position cursor overlay over the terminal area
    const termBox = await dom.$eval(termSelector, (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.evaluate(
        `window.__b2v_moveCursor?.(${Math.round(termBox.x + termBox.w * 0.3)}, ${Math.round(termBox.y + termBox.h * 0.5)}, '${cursorId}')`,
    );

    for (const ch of text) {
        if (ch === "\n") {
            await dom.$eval(taSelector, (el) => {
                el.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "Enter", code: "Enter", keyCode: 13,
                    which: 13, bubbles: true, cancelable: true,
                }));
            });
        } else {
            await dom.$eval(taSelector, (el, c) => {
                const ta = el as HTMLTextAreaElement;
                ta.value = c;
                ta.dispatchEvent(new InputEvent("input", {
                    data: c, inputType: "insertText", bubbles: true,
                }));
            }, ch);
        }
        if (isHuman) await sleep(8);
    }
}

async function assertMessageText(
    frame: DOMContext, testId: string, expected: string,
) {
    const actual = await frame.$eval(
        `[data-testid="${testId}"] p`,
        (el) => el.textContent?.trim() ?? "",
    );
    if (actual !== expected) {
        throw new Error(
            `Message text mismatch in ${testId}.\n` +
            `  Expected: "${expected}"\n` +
            `  Actual:   "${actual}"`,
        );
    }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface Ctx {
    alice: TerminalActor;
    bobBrowser: TerminalActor;
    bobTerminal: TerminalActor;
    pointer: Actor;
    grid: GridHandle;
    serverBaseURL: string;
    syncWsUrl: string;
    docHash: string;
    narrate: (text: string) => Promise<void>;
    chatText: typeof CHAT;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const NARRATOR_VOICE = "alloy";

const CHAT = {
    aliceMsg: "Hey Bob! Are you free this Friday evening? There's a new sci-fi movie I wanna see!",
    bobReply: "Friday works! What time and where should we meet?",
    aliceReply: "Awesome! Let's meet at seven in the evening at Cinemark Century Daly City!",
} as const;

const NARRATOR = {
    intro:
        "Welcome to Browser 2 Video. In this demo, Alice is on her iPhone " +
        "while Bob is on his Pixel. They each have their own cursor, moving independently.",
    scene1:
        "Alice is browsing 3 Body Problem while Bob looks busy " +
        "with something on his screen and in the terminal.",
    scene2:
        "Alice sends a movie invitation and draws a little picture while waiting. " +
        "Bob receives the notification and checks his calendar.",
    outro:
        "And that's it. Different actors, different devices, concurrent " +
        "actions — all captured in one recording.",
} as const;

/* ------------------------------------------------------------------ */
/*  drawViaInject — canvas drawing without page.mouse                  */
/* ------------------------------------------------------------------ */

/**
 * Draw on a <canvas> via frame.evaluate (no page.mouse involvement).
 * The cursor overlay on the main page is updated via page.evaluate.
 * This lets another actor use page.mouse concurrently.
 *
 * Mirrors Actor.draw() timing: 12 intermediate steps per segment with
 * smooth-step easing and human-like pacing (~6ms base per sub-step).
 */
async function drawViaInject(
    page: Page,
    frame: DOMContext,
    cursorId: string,
    iframeSelector: string,
    canvasSelector: string,
    points: Array<{ x: number; y: number }>,
    isHuman: boolean,
) {
    if (points.length < 2) return;

    const iframeBox = await page.$eval(iframeSelector, (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y };
    });

    const canvasInfo = await frame.$eval(canvasSelector, (el: Element) => {
        const r = el.getBoundingClientRect();
        const c = el as HTMLCanvasElement;
        return { bx: r.x, by: r.y, bw: r.width, bh: r.height, cw: c.width, ch: c.height };
    });

    const STEPS = 12;
    const BASE_MS = 6;

    function smoothStep(t: number) { return t * t * (3 - 2 * t); }

    function toPage(rx: number, ry: number) {
        return {
            px: Math.round(iframeBox.x + canvasInfo.bx + rx * canvasInfo.bw),
            py: Math.round(iframeBox.y + canvasInfo.by + ry * canvasInfo.bh),
        };
    }

    // Move cursor to the first point before drawing
    const first = toPage(points[0]!.x, points[0]!.y);
    await page.evaluate(
        `window.__b2v_moveCursor?.(${first.px}, ${first.py}, '${cursorId}')`,
    );
    if (isHuman) await sleep(60);

    // Hand-tremor amplitude in normalized coords (~1.5px equivalent)
    const jitterAmp = isHuman ? 1.5 / Math.max(canvasInfo.bw, canvasInfo.bh) : 0;
    function jitter(v: number) {
        return v + (Math.random() + Math.random() - 1) * jitterAmp;
    }

    for (let seg = 0; seg < points.length - 1; seg++) {
        const from = points[seg]!;
        const to = points[seg + 1]!;

        let prevRx = from.x;
        let prevRy = from.y;

        for (let s = 1; s <= STEPS; s++) {
            const t = s / STEPS;
            const ease = smoothStep(t);

            const rx = jitter(from.x + (to.x - from.x) * ease);
            const ry = jitter(from.y + (to.y - from.y) * ease);

            const { px, py } = toPage(rx, ry);
            await page.evaluate(
                `window.__b2v_moveCursor?.(${px}, ${py}, '${cursorId}')`,
            );

            await frame.evaluate(
                ({ sel, fx, fy, tx, ty }: { sel: string; fx: number; fy: number; tx: number; ty: number }) => {
                    const c = document.querySelector(sel) as HTMLCanvasElement | null;
                    if (!c) return;
                    const ctx = c.getContext("2d")!;
                    ctx.strokeStyle = "#c084fc";
                    ctx.lineWidth = 3;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(fx, fy);
                    ctx.lineTo(tx, ty);
                    ctx.stroke();
                },
                {
                    sel: canvasSelector,
                    fx: prevRx * canvasInfo.cw,
                    fy: prevRy * canvasInfo.ch,
                    tx: rx * canvasInfo.cw,
                    ty: ry * canvasInfo.ch,
                },
            );

            prevRx = rx;
            prevRy = ry;

            if (isHuman) {
                const t = Math.min(1, Math.max(0, s / (STEPS - 1)));
                await sleep(Math.max(1, Math.round(BASE_MS * (0.3 + 1.2 * t * t))));
            }
        }
    }

    if (isHuman) await sleep(120);
}

/* ------------------------------------------------------------------ */
/*  Scenario definition                                                */
/* ------------------------------------------------------------------ */

export default defineScenario<Ctx>("Chat Demo", (s) => {
    s.options({ layout: "row" });

    /* ── Setup ─────────────────────────────────────────────────────── */

    s.setup(async (session) => {
        const server = await startServer({ type: "vite", root: "apps/demo" });
        if (!server) throw new Error("Failed to start Vite server");

        const sync = await startSyncServer({
            artifactDir: path.resolve("artifacts", "chat-sync"),
        });
        session.addCleanup(() => sync.stop());
        session.addCleanup(() => server.stop());

        const movieUrl = new URL(`${server.baseURL}/movie?role=alice`);
        movieUrl.searchParams.set("ws", sync.wsUrl);

        const wikiUrl = new URL(`${server.baseURL}/wiki?role=bob`);

        const grid = await session.createGrid(
            [
                { url: movieUrl.toString(), label: "Alice" },
                { url: wikiUrl.toString(), label: "Bob" },
                { label: "Bob Terminal" },
            ],
            {
                viewport: { width: 1280, height: 720 },
                grid: [
                    [0, 1],
                    [0, 2],
                ],
            },
        );

        const [alice, bobBrowser, bobTerminal] = grid.actors;

        const pointer = new Actor(grid.page, session.modeRef);
        pointer.cursorId = "narrator";

        alice.setVoice("shimmer");
        alice.cursorId = "alice";
        bobBrowser.setVoice("echo");
        bobBrowser.cursorId = "bob";
        bobTerminal.setVoice("echo");
        bobTerminal.cursorId = "bob";

        const narrate = (text: string) =>
            alice.speak(text, { voice: NARRATOR_VOICE });

        const lang = process.env.B2V_NARRATION_LANGUAGE;
        const chatText = {
            aliceMsg: await translateText(CHAT.aliceMsg, lang),
            bobReply: await translateText(CHAT.bobReply, lang),
            aliceReply: await translateText(CHAT.aliceReply, lang),
        } as typeof CHAT;

        const allLines = [
            ...Object.values(NARRATOR).map((t) => ({ text: t, voice: NARRATOR_VOICE })),
            { text: CHAT.aliceMsg, voice: "shimmer" },
            { text: CHAT.bobReply, voice: "echo" },
            { text: CHAT.aliceReply, voice: "shimmer" },
        ];
        console.error(`  Warming up ${allLines.length} TTS clips...`);
        await Promise.all(
            allLines.map(({ text, voice }) => alice.warmup(text, { voice })),
        );
        console.error(`  TTS warmup complete.`);

        return {
            alice, bobBrowser, bobTerminal, pointer, grid,
            serverBaseURL: server.baseURL,
            syncWsUrl: sync.wsUrl,
            docHash: "",
            narrate, chatText,
        };
    });

    /* ── Scene 0: Introduction ─────────────────────────────────────── */

    s.step("Introduction",
        ({ narrate }) => narrate(NARRATOR.intro),
        async ({ pointer, grid }) => {
            await grid.page.waitForTimeout(500);
            await pointer.circleAround('[data-testid="browser-pane-0"]');
            await grid.page.waitForTimeout(500);
            await pointer.circleAround('[data-testid="browser-pane-1"]');
            await grid.page.waitForTimeout(500);
            await pointer.circleAround('[data-testid="xterm-term-shell-2"]');
            await grid.page.waitForTimeout(1000);
        },
    );

    /* ── Scene 1: Working side by side ─────────────────────────────── */
    // Interleaved: Alice browses movie ↔ Bob reads wiki + codes

    s.step("Working side by side",
        ({ narrate }) => narrate(NARRATOR.scene1),
        async (ctx) => {
            const { alice, bobBrowser, bobTerminal, grid } = ctx;
            const vFrame = alice.frame as DOMContext;
            const bFrame = bobBrowser.frame as DOMContext;

            await vFrame.waitForSelector('[data-testid="movie-page"]', { timeout: 10000 });
            await bFrame.waitForSelector('[data-testid="wiki-page"]', { timeout: 10000 });

            // Assert correct device frames are loaded
            await vFrame.waitForSelector('[data-testid="device-screen"]', { timeout: 5000 });
            await vFrame.waitForSelector('img[src*="iphone-frame"]', { timeout: 5000 });
            await bFrame.waitForSelector('[data-testid="device-screen"]', { timeout: 5000 });
            await bFrame.waitForSelector('img[src*="pixel-frame"]', { timeout: 5000 });

            // ── Interleaved actions ──

            await alice.hover('[data-testid="movie-title"]');
            await bobBrowser.hover('[data-testid="wiki-title"]');
            await grid.page.waitForTimeout(600);

            await bobTerminal.typeAndEnter(
                'echo "++++[>++++++++<-]>+.++++.--------.+++." > armillaria.bf',
            );

            await alice.hover('[data-testid="movie-synopsis"]');
            await grid.page.waitForTimeout(800);

            await bobBrowser.scroll('[data-testid="wiki-page"]', 150);

            await alice.hover('[data-testid="movie-play"]');
            await grid.page.waitForTimeout(600);

            await alice.hover('[data-testid="movie-cast"]');
            await grid.page.waitForTimeout(500);

            await bobBrowser.scroll('[data-testid="wiki-page"]', 120);
            await grid.page.waitForTimeout(500);

            // ── Alice opens Messages in the dock ──

            await alice.hover('[data-testid="dock-messages"]');
            await grid.page.waitForTimeout(400);
            await alice.click('[data-testid="dock-messages"]');

            await vFrame.waitForSelector('[data-testid="chat-page"]', { timeout: 20000 });
            await vFrame.waitForFunction(
                () => document.location.hash.length > 1,
                undefined,
                { timeout: 20000 },
            );
            const hash = await vFrame.evaluate(() => document.location.hash);
            ctx.docHash = hash.startsWith("#") ? hash.slice(1) : hash;
            console.error(`  Doc hash: ${hash}`);
            await grid.page.waitForTimeout(400);

            // ── Alice types her message ‖ Bob writes to Armillaria ──
            // Alice uses page.keyboard, Bob uses synthetic DOM events
            // via typeInTerminalViaInject — no shared resource conflict.
            await Promise.all([
                (async () => {
                    await alice
                        .type('[data-testid="chat-input"]', ctx.chatText.aliceMsg)
                        .speak(CHAT.aliceMsg);
                    await alice.click('[data-testid="chat-send"]');
                })(),
                (async () => {
                    await typeInTerminalViaInject(
                        grid.page, bobTerminal.frame as DOMContext, "bob",
                        bobTerminal.selector,
                        'echo "Dear Armillaria ostoyae,"\n',
                        alice.mode === "human",
                    );
                    await typeInTerminalViaInject(
                        grid.page, bobTerminal.frame as DOMContext, "bob",
                        bobTerminal.selector,
                        'echo "I know they call you pathogenic"\n',
                        alice.mode === "human",
                    );
                    await typeInTerminalViaInject(
                        grid.page, bobTerminal.frame as DOMContext, "bob",
                        bobTerminal.selector,
                        'echo "but you are a farmer, not a parasite"\n',
                        alice.mode === "human",
                    );
                })(),
            ]);
            await vFrame.waitForSelector('[data-testid="chat-msg-0"]', { timeout: 5000 });
            await assertMessageText(vFrame, "chat-msg-0", ctx.chatText.aliceMsg);
            await grid.page.waitForTimeout(500);
        },
    );

    /* ── Scene 2: Bob checks availability · Alice draws ─────────── */
    // True concurrency: drawViaInject (evaluate only) ‖ Bob's mouse nav

    s.step("Bob checks availability",
        ({ narrate }) => narrate(NARRATOR.scene2),
        async (ctx) => {
            const {
                alice, bobBrowser, grid,
                serverBaseURL, syncWsUrl, chatText,
            } = ctx;
            const vFrame = alice.frame as DOMContext;
            const bFrame = bobBrowser.frame as DOMContext;

            // ── Sequential setup before concurrent block ──

            // Open Alice's sketchpad
            await alice.click('[data-testid="chat-sketch-toggle"]');
            await vFrame.waitForSelector('[data-testid="chat-sketch"]', { timeout: 5000 });
            await grid.page.waitForTimeout(300);

            // Inject notification into Bob's browser
            const preview = chatText.aliceMsg.length > 40
                ? chatText.aliceMsg.slice(0, 40) + "…"
                : chatText.aliceMsg;

            await bFrame.evaluate((msg: string) => {
                const el = document.createElement("div");
                el.setAttribute("data-testid", "chat-incoming-notification");
                el.style.cssText = [
                    "position:fixed", "top:40px", "right:16px", "z-index:9999",
                    "display:flex", "align-items:center", "gap:12px",
                    "background:rgba(38,38,38,0.96)", "backdrop-filter:blur(20px)",
                    "border:1px solid rgba(255,255,255,0.12)", "border-radius:14px",
                    "padding:12px 16px", "max-width:320px", "cursor:pointer",
                    "box-shadow:0 8px 32px rgba(0,0,0,0.5)",
                    "animation:b2v-notif-in 0.35s ease-out",
                ].join(";");
                el.innerHTML = `
                    <style>
                        @keyframes b2v-notif-in {
                            from { transform:translateX(120%); opacity:0 }
                            to   { transform:translateX(0); opacity:1 }
                        }
                    </style>
                    <div style="width:36px;height:36px;border-radius:50%;background:#8b5cf6;
                         display:flex;align-items:center;justify-content:center;
                         color:#fff;font-weight:700;font-size:14px;flex-shrink:0">V</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:2px">Alice</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.55);
                             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg}</div>
                    </div>`;
                document.body.appendChild(el);
            }, preview);

            await grid.page.waitForTimeout(800);

            // ── Concurrent: Alice draws (evaluate) ‖ Bob navigates (mouse) ──

            const isHuman = alice.mode === "human";

            // UFO saucer (dome + body arc)
            const ufoDome = [
                { x: 0.38, y: 0.18 }, { x: 0.40, y: 0.10 }, { x: 0.45, y: 0.06 },
                { x: 0.50, y: 0.05 }, { x: 0.55, y: 0.06 }, { x: 0.60, y: 0.10 },
                { x: 0.62, y: 0.18 },
            ];
            const ufoBody = [
                { x: 0.28, y: 0.22 }, { x: 0.35, y: 0.18 }, { x: 0.50, y: 0.16 },
                { x: 0.65, y: 0.18 }, { x: 0.72, y: 0.22 }, { x: 0.65, y: 0.26 },
                { x: 0.50, y: 0.28 }, { x: 0.35, y: 0.26 }, { x: 0.28, y: 0.22 },
            ];
            // Tractor beam (V shape from saucer down)
            const beamLeft = [
                { x: 0.40, y: 0.28 }, { x: 0.30, y: 0.70 },
            ];
            const beamRight = [
                { x: 0.60, y: 0.28 }, { x: 0.70, y: 0.70 },
            ];
            // Stick-figure Bob being lifted
            const bobHead = [
                { x: 0.48, y: 0.55 }, { x: 0.46, y: 0.52 }, { x: 0.47, y: 0.49 },
                { x: 0.50, y: 0.48 }, { x: 0.53, y: 0.49 }, { x: 0.54, y: 0.52 },
                { x: 0.52, y: 0.55 }, { x: 0.48, y: 0.55 },
            ];
            const bobBody = [{ x: 0.50, y: 0.55 }, { x: 0.50, y: 0.72 }];
            const bobLeftArm = [{ x: 0.50, y: 0.60 }, { x: 0.40, y: 0.52 }];
            const bobRightArm = [{ x: 0.50, y: 0.60 }, { x: 0.60, y: 0.52 }];
            const bobLeftLeg = [{ x: 0.50, y: 0.72 }, { x: 0.43, y: 0.85 }];
            const bobRightLeg = [{ x: 0.50, y: 0.72 }, { x: 0.57, y: 0.85 }];

            // Handwritten "Bob" label under the stick figure
            const letterB = [
                { x: 0.42, y: 0.88 }, { x: 0.42, y: 0.97 },
                { x: 0.42, y: 0.88 }, { x: 0.46, y: 0.88 }, { x: 0.47, y: 0.90 },
                { x: 0.46, y: 0.92 }, { x: 0.42, y: 0.92 },
                { x: 0.46, y: 0.92 }, { x: 0.47, y: 0.94 },
                { x: 0.46, y: 0.97 }, { x: 0.42, y: 0.97 },
            ];
            const letterO = [
                { x: 0.50, y: 0.88 }, { x: 0.48, y: 0.90 }, { x: 0.48, y: 0.95 },
                { x: 0.50, y: 0.97 }, { x: 0.52, y: 0.95 }, { x: 0.52, y: 0.90 },
                { x: 0.50, y: 0.88 },
            ];
            const letterB2 = [
                { x: 0.54, y: 0.88 }, { x: 0.54, y: 0.97 },
                { x: 0.54, y: 0.88 }, { x: 0.58, y: 0.88 }, { x: 0.59, y: 0.90 },
                { x: 0.58, y: 0.92 }, { x: 0.54, y: 0.92 },
                { x: 0.58, y: 0.92 }, { x: 0.59, y: 0.94 },
                { x: 0.58, y: 0.97 }, { x: 0.54, y: 0.97 },
            ];

            const ufoStrokes = [
                ufoDome, ufoBody, beamLeft, beamRight,
                bobHead, bobBody, bobLeftArm, bobRightArm, bobLeftLeg, bobRightLeg,
                letterB, letterO, letterB2,
            ];

            await Promise.all([
                // Alice draws alien spaceship kidnapping Bob
                (async () => {
                    for (const stroke of ufoStrokes) {
                        await drawViaInject(
                            grid.page, vFrame, "alice",
                            'iframe[name="browser-pane-0"]',
                            '[data-testid="chat-sketch"]',
                            stroke, isHuman,
                        );
                        if (isHuman) await sleep(200);
                    }
                })(),

                // Bob: notification → chat → calendar → chat (page.mouse)
                (async () => {
                    await bobBrowser.hover('[data-testid="chat-incoming-notification"]');
                    await grid.page.waitForTimeout(400);
                    await bobBrowser.click('[data-testid="chat-incoming-notification"]');
                    await grid.page.waitForTimeout(300);

                    const bobChatUrl = `${serverBaseURL}/chat?role=bob&ws=${encodeURIComponent(syncWsUrl)}#${ctx.docHash}`;
                    await bobBrowser.goto(bobChatUrl);

                    const bf = bobBrowser.frame as DOMContext;
                    await bf.waitForSelector('[data-testid="chat-page"]', { timeout: 20000 });
                    await bf.waitForFunction(
                        () => document.querySelectorAll('[data-testid^="chat-msg-"]').length > 0,
                        undefined,
                        { timeout: 15000 },
                    );
                    await grid.page.waitForTimeout(800);

                    // Check calendar
                    const calUrl = `${serverBaseURL}/calendar?role=bob`;
                    await bobBrowser.goto(calUrl);
                    await (bobBrowser.frame as DOMContext).waitForSelector(
                        '[data-testid="calendar-page"]', { timeout: 20000 },
                    );
                    await grid.page.waitForTimeout(500);
                    await bobBrowser.hover('[data-testid="cal-day-fri"]');
                    await grid.page.waitForTimeout(800);

                    // Return to chat
                    await bobBrowser.goto(bobChatUrl);
                    const bf2 = bobBrowser.frame as DOMContext;
                    await bf2.waitForSelector('[data-testid="chat-page"]', { timeout: 20000 });
                    await grid.page.waitForTimeout(400);

                    // Bob re-reads Alice's message while she finishes drawing
                    await bobBrowser.hover('[data-testid="chat-msg-0"]');
                    await grid.page.waitForTimeout(600);
                    await bobBrowser.hover('[data-testid="chat-input"]');
                    await grid.page.waitForTimeout(300);
                })(),
            ]);

            // Alice sends the sketch as a picture message
            await alice.click('[data-testid="chat-sketch-send"]');
            await grid.page.waitForTimeout(600);
        },
    );

    /* ── Scene 3: Finale ───────────────────────────────────────────── */
    // Bob confirms, Alice reacts, Bob tells Armillaria, narrator outro

    s.step("Finale", async (ctx) => {
            const { alice, bobBrowser, bobTerminal, grid, chatText, narrate } = ctx;
            const vFrame = alice.frame as DOMContext;

            // Close sketchpad if open
            const sketchVisible = await vFrame.$('[data-testid="chat-sketchpad"]');
            if (sketchVisible) {
                await alice.click('[data-testid="chat-sketch-toggle"]');
                await grid.page.waitForTimeout(300);
            }

            // Bob sends his reply
            const bFrame = bobBrowser.frame as DOMContext;
            await bobBrowser
                .type('[data-testid="chat-input"]', chatText.bobReply)
                .speak(CHAT.bobReply);
            await bobBrowser.click('[data-testid="chat-send"]');
            await bFrame.waitForSelector('[data-testid="chat-msg-2"]', { timeout: 5000 });
            await assertMessageText(bFrame, "chat-msg-2", chatText.bobReply);
            await grid.page.waitForTimeout(800);

            // Alice sees the reply
            await vFrame.waitForFunction(
                () => document.querySelectorAll('[data-testid^="chat-msg-"]').length >= 3,
                undefined,
                { timeout: 15000 },
            );

            // Alice reacts with ❤️ on Bob's message (index 2 after sketch at 1)
            await alice.click('[data-testid="chat-react-2"]');
            await grid.page.waitForTimeout(500);

            // Alice replies ‖ Bob types in terminal — truly concurrent.
            // Bob's typing uses synthetic DOM events (typeInTerminalViaInject)
            // so it doesn't touch page.keyboard, which Alice uses.
            await Promise.all([
                (async () => {
                    await alice
                        .type('[data-testid="chat-input"]', chatText.aliceReply)
                        .speak(CHAT.aliceReply);
                    await alice.click('[data-testid="chat-send"]');
                })(),
                typeInTerminalViaInject(
                    grid.page,
                    bobTerminal.frame as DOMContext,
                    "bob",
                    bobTerminal.selector,
                    'echo "P.S. Can\'t come this Friday. Alice invited me to the movies!" >> armillaria.bf\n',
                    alice.mode === "human",
                ),
            ]);
            await vFrame.waitForSelector('[data-testid="chat-msg-3"]', { timeout: 5000 });
            await assertMessageText(vFrame, "chat-msg-3", chatText.aliceReply);
            await grid.page.waitForTimeout(1000);

            // Narrator wraps up — after all actions are done
            await narrate(NARRATOR.outro);
            await grid.page.waitForTimeout(1500);
        },
    );
});
