/**
 * Combined scenario: all-in-one
 * Demonstrates every capability in a single recording:
 *   1. Form interactions (type, click, toggle)
 *   2. Scroll and drag-and-drop
 *   3. Node graph connections
 *   4. Canvas drawing
 *   5. Console panel with CRUD
 *   6. Narrated Kanban board
 *   7. TUI terminals (mc, htop, vim)
 *
 * TTS narration is warmed up in a dedicated step before playback.
 */
import { createSession, startServer, type Actor, type Page } from "browser2video";
import { startTerminalWsServer } from "browser2video/terminal";

// ── Server setup ────────────────────────────────────────────────────────
const server = await startServer({ type: "vite", root: "apps/demo" });
if (!server) throw new Error("Failed to start Vite server");
const termSrv = await startTerminalWsServer();

const session = await createSession({
  record: true,
  mode: "human",
  narration: { enabled: true },
});
const { step } = session;
const { page, actor } = await session.openPage({
  url: server.baseURL,
  viewport: { width: 1060, height: 720 },
});

// ── Narration texts ─────────────────────────────────────────────────────
const narrations = {
  intro: "Welcome to browser2video! This demo showcases every capability in one recording.",
  form: "First, we fill out a form with human-like typing and click behavior.",
  scroll: "We can scroll pages and containers, and drag items to reorder them.",
  graph: "Here we connect nodes in a flow graph by dragging between handles.",
  draw: "The drawing canvas supports shapes and freehand — all recorded smoothly.",
  console: "The console panel shows real-time logs as we create and manage tasks.",
  kanbanIntro: "Now let's explore a Kanban board with full narration.",
  kanbanCreate: "We'll create tasks in the Backlog column.",
  kanbanMove: "Watch as tasks flow through the development pipeline.",
  kanbanDone: "And finally, tasks reach the Done and Released columns.",
  tuiIntro: "Last but not least — real terminal applications running in the browser.",
  tuiMc: "Midnight Commander lets us browse files with keyboard and mouse.",
  tuiVim: "And here's Vim, running inside an in-browser terminal.",
  summary: "That's everything! browser2video records all of this into a single composed video with subtitles and narration.",
};

// ── Warm up all narration audio ─────────────────────────────────────────
await step("Warm up narration cache", async () => {
  await Promise.all(Object.values(narrations).map((text) => session.audio.warmup(text)));
});

// ── Helpers ──────────────────────────────────────────────────────────────
async function addKanbanCard(a: Actor, columnId: string, title: string) {
  await a.click(`[data-testid="add-card-btn-${columnId}"]`);
  await a.type(`[data-testid="add-card-input-${columnId}"]`, title);
  await a.click(`[data-testid="add-card-confirm-${columnId}"]`);
}

async function dragKanbanCard(a: Actor, p: Page, cardTitle: string, toColumnId: string) {
  const cardId = await p.evaluate((title: string) => {
    const cards = document.querySelectorAll("[data-card-id]");
    for (const card of cards) {
      if (card.textContent?.trim() === title) return card.getAttribute("data-card-id");
    }
    return null;
  }, cardTitle);
  if (!cardId) throw new Error(`Card "${cardTitle}" not found`);
  await a.drag(`[data-card-id="${cardId}"]`, `[data-testid="column-${toColumnId}"]`);
}

async function typeInTerminal(p: Page, testId: string, text: string, opts?: { delay?: number }) {
  const selector = `[data-testid="${testId}"] .xterm-helper-textarea`;
  const el = await p.$(selector);
  if (!el) throw new Error(`Terminal textarea not found: ${selector}`);
  await el.focus();
  for (const ch of text) {
    if (ch === "\n") await p.keyboard.press("Enter");
    else await p.keyboard.type(ch, { delay: 0 });
    if (opts?.delay) await new Promise((r) => setTimeout(r, opts.delay));
  }
}

async function waitForXtermText(p: Page, rootSelector: string, includes: string[], timeoutMs: number) {
  await p.waitForFunction(
    ([sel, inc]: [string, string[]]) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const rows = root.querySelector(".xterm-rows");
      const text = String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
      return inc.every((s: string) => text.includes(s));
    },
    [rootSelector, includes] as [string, string[]],
    { timeout: timeoutMs },
  );
}

async function waitForWsOpen(p: Page, selector: string, timeoutMs = 15000) {
  await p.waitForFunction(
    (sel: string) => (document.querySelector(sel) as any)?.dataset?.b2vWsState === "open",
    selector,
    { timeout: timeoutMs },
  );
}

async function waitForPrompt(p: Page, testId: string, timeoutMs = 30000) {
  await p.waitForFunction(
    ([sel]: [string, number]) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const text = root.querySelector(".xterm-rows")?.textContent ?? "";
      return text.includes("$") || text.includes("#");
    },
    [`[data-testid="${testId}"]`, 0] as [string, number],
    { timeout: timeoutMs },
  );
}

async function termCoords(p: Page, testId: string, relX: number, relY: number) {
  const box = await p.$eval(`[data-testid="${testId}"]`, (el: any) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { x: Math.round(box.x + box.width * relX), y: Math.round(box.y + box.height * relY) };
}

try {
  // ════════════════════════════════════════════════════════════════════════
  //  PART 1: Form, scroll, drag, graph, drawing
  // ════════════════════════════════════════════════════════════════════════

  await step("Introduction", narrations.intro, async () => {
    await actor.goto(`${server.baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });

  await step("Fill form fields", narrations.form, async () => {
    await actor.type('[data-testid="form-name"]', "Jane Doe");
    await actor.type('[data-testid="form-email"]', "jane@example.com");
    await actor.click('[data-testid="form-pref-updates"]');
    await actor.click('[data-testid="form-notifications"]');
  });

  await step("Scroll and drag", narrations.scroll, async () => {
    await actor.scroll(null, 800);
    await actor.scroll('[data-testid="scroll-area"]', 400);
    await actor.scroll(null, 400);
    await actor.drag('[data-testid="drag-item-task-1"]', '[data-testid="drag-item-task-3"]');
  });

  await step("Connect nodes in graph", narrations.graph, async () => {
    await actor.scroll(null, 500);
    await actor.waitFor('[data-testid="flow-container"] .react-flow__node');
    await actor.drag(
      '.react-flow__node[data-id="source"] .react-flow__handle.source',
      '.react-flow__node[data-id="transform"] .react-flow__handle.target',
    );
    await actor.drag(
      '.react-flow__node[data-id="transform"] .react-flow__handle.source',
      '.react-flow__node[data-id="output"] .react-flow__handle.target',
    );
  });

  await step("Draw shapes", narrations.draw, async () => {
    await actor.scroll(null, 500);
    await actor.click('[data-testid="draw-tool-rectangle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      { x: 0.35, y: 0.2 }, { x: 0.75, y: 0.6 },
    ]);
    await actor.click('[data-testid="draw-tool-freehand"]');
    const cx = 0.55, cy = 0.4, rO = 0.14, rI = 0.06;
    const star: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 10; k++) {
      const a = (-Math.PI / 2) + (k * Math.PI) / 5;
      const r = k % 2 === 0 ? rO : rI;
      star.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    await actor.draw('[data-testid="draw-canvas"]', star);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  PART 2: Console panel
  // ════════════════════════════════════════════════════════════════════════

  await step("Open console panel", narrations.console, async () => {
    await actor.goto(`${server.baseURL}/notes?role=boss&showConsole=true`);
    await actor.waitFor('[data-testid="notes-page"]');
    await actor.waitFor('[data-testid="console-panel"]');
  });

  const consoleTasks = ["setup database", "write API routes"];
  for (const t of consoleTasks) {
    await step(`Add task: "${t}"`, async () => {
      await actor.type('[data-testid="note-input"]', t);
      await actor.click('[data-testid="note-add-btn"]');
    });
  }

  await step(`Complete: "${consoleTasks[0]}"`, async () => {
    const idx = await page.evaluate((title: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).findIndex((el: any) => {
        const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(span?.textContent ?? "").trim() === title;
      });
    }, consoleTasks[0]);
    if (idx >= 0) await actor.click(`[data-testid="note-check-${idx}"]`);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  PART 3: Kanban board
  // ════════════════════════════════════════════════════════════════════════

  await step("Open Kanban board", narrations.kanbanIntro, async () => {
    await actor.goto(`${server.baseURL}/kanban`);
    await actor.waitFor('[data-testid="kanban-board"]');
  });

  await step("Create Kanban tasks", narrations.kanbanCreate, async () => {
    await addKanbanCard(actor, "backlog", "Implement auth");
    await addKanbanCard(actor, "backlog", "Write tests");
  });

  await step("Move tasks through columns", narrations.kanbanMove, async () => {
    await dragKanbanCard(actor, page, "Implement auth", "in-progress");
    await dragKanbanCard(actor, page, "Implement auth", "code-review");
  });

  await step("Complete tasks", narrations.kanbanDone, async () => {
    await dragKanbanCard(actor, page, "Implement auth", "done");
    await dragKanbanCard(actor, page, "Implement auth", "released");
  });

  // ════════════════════════════════════════════════════════════════════════
  //  PART 4: TUI terminals
  // ════════════════════════════════════════════════════════════════════════

  await step("Open terminals", narrations.tuiIntro, async () => {
    const url = `${server.baseURL}/terminals?termWs=${encodeURIComponent(termSrv.baseWsUrl)}`;
    await actor.goto(url);
    await actor.waitFor('[data-testid="terminals-page"]');
    await actor.waitFor('[data-testid="xterm-term1"] .xterm');
    await actor.waitFor('[data-testid="xterm-term2"] .xterm');
    await actor.waitFor('[data-testid="xterm-term4"] .xterm');
  });

  await step("Wait for terminal apps", async () => {
    await waitForWsOpen(page, '[data-testid="xterm-term1"]');
    await waitForWsOpen(page, '[data-testid="xterm-term2"]');
    await waitForWsOpen(page, '[data-testid="xterm-term4"]');
    await waitForXtermText(page, '[data-testid="xterm-term1"]', ["1Help"], 20000);
    await waitForXtermText(page, '[data-testid="xterm-term2"]', ["CPU"], 20000);
  });

  await step("Navigate Midnight Commander", narrations.tuiMc, async () => {
    const pos = await termCoords(page, "xterm-term1", 0.25, 0.25);
    await actor.clickAt(pos.x, pos.y);
    for (let i = 0; i < 3; i++) await actor.pressKey("ArrowDown");
    await actor.pressKey("Tab");
    for (let i = 0; i < 2; i++) await actor.pressKey("ArrowDown");
    await actor.pressKey("Tab");
  });

  await step("Use Vim in terminal", narrations.tuiVim, async () => {
    await waitForPrompt(page, "xterm-term4");
    await typeInTerminal(page, "xterm-term4", "vim\n", { delay: 60 });
    await waitForXtermText(page, '[data-testid="xterm-term4"]', ["~"], 10000);
    await actor.pressKey("i");
    await typeInTerminal(page, "xterm-term4", "Hello from browser2video!", { delay: 70 });
    await actor.breathe();
    await actor.pressKey("Escape");
    await typeInTerminal(page, "xterm-term4", ":q!\n", { delay: 80 });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ════════════════════════════════════════════════════════════════════════

  await step("Summary", narrations.summary, async () => {
    await actor.goto(`${server.baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });

  const result = await session.finish();
  console.log("Video:", result.video);
} finally {
  await termSrv.close();
  await server.stop();
}
