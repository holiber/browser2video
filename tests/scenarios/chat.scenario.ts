/**
 * Chat scenario: Two users chatting via Automerge-synced chat UI.
 *
 * Three voices:
 *   - Narrator (alloy): Intro with circleAround on panes + outro
 *   - Alice (shimmer): Speaks her chat messages as she types them
 *   - Bob (echo): Speaks his chat messages as he types them
 *
 * Layout:
 *   Row 0: [Alice browser (chat) | Bob browser (about:blank → chat → calendar → chat)]
 *   Row 1: [Alice browser (chat) | Bob terminal]
 */
import path from "path";
import { defineScenario, startServer, Actor, type TerminalActor, type Frame, type GridHandle } from "browser2video";
import { startSyncServer } from "../../apps/demo/scripts/sync-server.ts";

type DOMContext = Frame;

interface Ctx {
    alice: TerminalActor;
    bobBrowser: TerminalActor;
    bobTerminal: TerminalActor;
    /** Narrator pointer on the grid page (for circling around panes) */
    pointer: Actor;
    grid: GridHandle;
    chatBaseUrl: string;
    calendarUrl: string;
    docHash: string;
    narrate: (text: string) => Promise<void>;
}

const NARRATOR_VOICE = "alloy";

// Chat messages — actors speak exactly what they type
const CHAT = {
    aliceMsg: "Hey Bob! Are you free this Friday evening? There's a new sci-fi movie I wanna see!",
    bobReply1: "Hey! Let me check my calendar real quick",
    bobReply2: "Friday works! What time?",
    aliceReply: "Awesome! Let's do 7pm at the IMAX!",
} as const;

const NARRATOR = {
    intro: "Welcome to Browser 2 Video. In this demo, we record a scenario with multiple actors, each with their own unique voice. On the left is Alice's chat window. On the right, Bob has a browser and a terminal.",
    outro: "And that's it. Different actors, different voices, dynamic layouts. All in one recording.",
} as const;

export default defineScenario<Ctx>("Chat Demo", (s) => {
    s.options({ layout: "row" });

    s.setup(async (session) => {
        const server = await startServer({ type: "vite", root: "apps/demo" });
        if (!server) throw new Error("Failed to start Vite server");

        const sync = await startSyncServer({ artifactDir: path.resolve("artifacts", "chat-sync") });
        session.addCleanup(() => sync.stop());
        session.addCleanup(() => server.stop());

        const aliceChatUrl = new URL(`${server.baseURL}/chat?role=alice`);
        aliceChatUrl.searchParams.set("ws", sync.wsUrl);

        const grid = await session.createGrid(
            [
                { url: aliceChatUrl.toString(), label: "Alice" },
                { url: "about:blank", label: "Bob" },
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

        // Narrator pointer on the grid page — only used during intro, never concurrently with actors
        const pointer = new Actor(grid.page, "human");

        alice.setVoice("shimmer");
        bobBrowser.setVoice("echo");
        bobTerminal.setVoice("echo");

        const narrate = (text: string) => alice.speak(text, { voice: NARRATOR_VOICE });

        // Wait for doc hash
        const aliceFrame = alice.frame as DOMContext;
        await aliceFrame.waitForFunction(
            () => document.location.hash.length > 1,
            undefined,
            { timeout: 20000 },
        );
        const hash = await aliceFrame.evaluate(() => document.location.hash);
        const docHash = hash.startsWith("#") ? hash.slice(1) : hash;
        console.error(`  Doc hash: ${hash}`);

        // Warmup TTS
        const allLines = [
            ...Object.values(NARRATOR).map((t) => ({ text: t, voice: NARRATOR_VOICE })),
            ...Object.values(CHAT).map((t, i) => ({ text: t, voice: i % 2 === 0 ? "shimmer" : "echo" })),
        ];
        console.error(`  Warming up ${allLines.length} TTS clips...`);
        await Promise.all(allLines.map(({ text, voice }) => alice.warmup(text, { voice })));
        console.error(`  TTS warmup complete.`);

        const chatBaseUrl = `${server.baseURL}/chat?role=bob&ws=${encodeURIComponent(sync.wsUrl)}`;
        const calendarUrl = `${server.baseURL}/calendar?role=bob`;

        return { alice, bobBrowser, bobTerminal, pointer, grid, chatBaseUrl, calendarUrl, docHash, narrate };
    });

    // ── Narrator intro: circle around each pane ───────────────────────
    s.step("Introduction",
        ({ narrate }) => narrate(NARRATOR.intro),
        async ({ pointer, grid }) => {
            await grid.page.waitForTimeout(2000);
            // Circle around Alice's pane
            await pointer.circleAround('[data-testid="browser-pane-0"]');
            await grid.page.waitForTimeout(1000);
            // Circle around Bob's browser pane
            await pointer.circleAround('[data-testid="browser-pane-1"]');
            await grid.page.waitForTimeout(500);
            // Circle around Bob's terminal pane
            await pointer.circleAround('[data-testid="xterm-term-shell-2"]');
            await grid.page.waitForTimeout(1000);
        },
    );

    // ── Bob types brainfuck in terminal (sequential, no cursor conflict) ──
    s.step("Bob codes in terminal", async ({ bobTerminal, grid }) => {
        await grid.page.waitForTimeout(500);
        await bobTerminal.typeAndEnter('echo "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>." | head -c 40');
        await grid.page.waitForTimeout(1000);
    });

    // ── Alice types + speaks her message ──────────────────────────────
    s.step("Alice sends a message", async ({ alice, grid }) => {
        await alice.type('[data-testid="chat-input"]', CHAT.aliceMsg + " 🎬").speak(CHAT.aliceMsg);
        await alice.click('[data-testid="chat-send"]');
        await grid.page.waitForTimeout(500);
    });

    // ── Bob opens chat, sees Alice's message (silent) ─────────────────
    s.step("Bob sees the message", async ({ bobBrowser, grid, chatBaseUrl, docHash }) => {
        await grid.page.waitForTimeout(1000);
        const bobChatUrl = `${chatBaseUrl}#${docHash}`;
        await bobBrowser.goto(bobChatUrl);
        const f = bobBrowser.frame as DOMContext;
        await f.waitForSelector('[data-testid="chat-page"]', { timeout: 20000 });
        await f.waitForFunction(
            () => document.querySelectorAll('[data-testid^="chat-msg-"]').length > 0,
            undefined,
            { timeout: 15000 },
        );
        await grid.page.waitForTimeout(1000);
    });

    // ── Bob types + speaks his reply ──────────────────────────────────
    s.step("Bob responds", async ({ bobBrowser, grid }) => {
        await bobBrowser.type('[data-testid="chat-input"]', CHAT.bobReply1 + " 📅").speak(CHAT.bobReply1);
        await bobBrowser.click('[data-testid="chat-send"]');
        await grid.page.waitForTimeout(500);
    });

    // ── Bob checks calendar (silent) ──────────────────────────────────
    s.step("Bob opens calendar", async ({ bobBrowser, grid, calendarUrl }) => {
        await bobBrowser.goto(calendarUrl);
        const f = bobBrowser.frame as DOMContext;
        await f.waitForSelector('[data-testid="calendar-page"]', { timeout: 20000 });
        await grid.page.waitForTimeout(1500);
    });

    // ── Bob checks Friday (silent) ────────────────────────────────────
    s.step("Bob checks Friday", async ({ bobBrowser, grid }) => {
        const f = bobBrowser.frame as DOMContext;
        await f.waitForSelector('[data-testid="cal-friday-free"]', { timeout: 5000 });
        await bobBrowser.hover('[data-testid="cal-day-fri"]');
        await grid.page.waitForTimeout(2000);
    });

    // ── Bob returns to chat (silent) ──────────────────────────────────
    s.step("Bob returns to chat", async ({ bobBrowser, grid, chatBaseUrl, docHash }) => {
        const bobChatUrl = `${chatBaseUrl}#${docHash}`;
        await bobBrowser.goto(bobChatUrl);
        const f = bobBrowser.frame as DOMContext;
        await f.waitForSelector('[data-testid="chat-page"]', { timeout: 20000 });
        await grid.page.waitForTimeout(500);
    });

    // ── Bob types + speaks his confirmation ───────────────────────────
    s.step("Bob confirms", async ({ bobBrowser, grid }) => {
        await bobBrowser.type('[data-testid="chat-input"]', CHAT.bobReply2 + " 🍿").speak(CHAT.bobReply2);
        await bobBrowser.click('[data-testid="chat-send"]');
        await grid.page.waitForTimeout(500);
    });

    // ── Alice types + speaks her final message ────────────────────────
    s.step("Alice celebrates", async ({ alice, grid }) => {
        const f = alice.frame as DOMContext;
        await f.waitForFunction(
            () => document.querySelectorAll('[data-testid^="chat-msg-"]').length >= 3,
            undefined,
            { timeout: 15000 },
        );
        await alice.type('[data-testid="chat-input"]', CHAT.aliceReply + " 🎉").speak(CHAT.aliceReply);
        await alice.click('[data-testid="chat-send"]');
        await grid.page.waitForTimeout(1000);
    });

    // ── Narrator outro ────────────────────────────────────────────────
    s.step("Outro",
        ({ narrate }) => narrate(NARRATOR.outro),
        async ({ grid }) => {
            await grid.page.waitForTimeout(3000);
        },
    );
});
