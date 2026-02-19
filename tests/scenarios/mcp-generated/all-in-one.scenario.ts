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
import { defineScenario, startServer, type Session, type Actor, type Page, type TerminalActor } from "browser2video";

interface Ctx {
  session: Session;
  page: Page;
  actor: Actor;
  baseURL: string;
  mc?: TerminalActor;
  htop?: TerminalActor;
  shell?: TerminalActor;
}

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

export default defineScenario<Ctx>("All-in-One Demo", (s) => {
  s.setup(async (session) => {
    const server = await startServer({ type: "vite", root: "apps/demo" });
    if (!server) throw new Error("Failed to start Vite server");
    session.addCleanup(() => server.stop());

    const { page, actor } = await session.openPage({
      url: server.baseURL,
      viewport: { width: 1060, height: 720 },
    });

    return { session, page, actor, baseURL: server.baseURL };
  });

  s.step("Warm up narration cache", async ({ session }) => {
    await Promise.all(Object.values(narrations).map((text) => session.audio.warmup(text)));
  });

  // PART 1: Form, scroll, drag, graph, drawing

  s.step("Introduction", narrations.intro, async ({ actor, baseURL }) => {
    await actor.goto(`${baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });

  s.step("Fill form fields", narrations.form, async ({ actor }) => {
    await actor.type('[data-testid="form-name"]', "Jane Doe");
    await actor.type('[data-testid="form-email"]', "jane@example.com");
    await actor.click('[data-testid="form-pref-updates"]');
    await actor.click('[data-testid="form-notifications"]');
  });

  s.step("Scroll and drag", narrations.scroll, async ({ actor }) => {
    await actor.scroll(null, 800);
    await actor.scroll('[data-testid="scroll-area"]', 400);
    await actor.scroll(null, 400);
    await actor.drag('[data-testid="drag-item-task-1"]', '[data-testid="drag-item-task-3"]');
  });

  s.step("Connect nodes in graph", narrations.graph, async ({ actor }) => {
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

  s.step("Draw shapes", narrations.draw, async ({ actor }) => {
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

  // PART 2: Console panel

  s.step("Open console panel", narrations.console, async ({ actor, baseURL }) => {
    await actor.goto(`${baseURL}/notes?role=boss&showConsole=true`);
    await actor.waitFor('[data-testid="notes-page"]');
    await actor.waitFor('[data-testid="console-panel"]');
  });

  s.step('Add task: "setup database"', async ({ actor }) => {
    await actor.type('[data-testid="note-input"]', "setup database");
    await actor.click('[data-testid="note-add-btn"]');
  });

  s.step('Add task: "write API routes"', async ({ actor }) => {
    await actor.type('[data-testid="note-input"]', "write API routes");
    await actor.click('[data-testid="note-add-btn"]');
  });

  s.step('Complete: "setup database"', async ({ actor, page }) => {
    const idx = await page.evaluate((title: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).findIndex((el: any) => {
        const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(span?.textContent ?? "").trim() === title;
      });
    }, "setup database");
    if (idx >= 0) await actor.click(`[data-testid="note-check-${idx}"]`);
  });

  // PART 3: Kanban board

  s.step("Open Kanban board", narrations.kanbanIntro, async ({ actor, baseURL }) => {
    await actor.goto(`${baseURL}/kanban`);
    await actor.waitFor('[data-testid="kanban-board"]');
  });

  s.step("Create Kanban tasks", narrations.kanbanCreate, async ({ actor }) => {
    await addKanbanCard(actor, "backlog", "Implement auth");
    await addKanbanCard(actor, "backlog", "Write tests");
  });

  s.step("Move tasks through columns", narrations.kanbanMove, async ({ actor, page }) => {
    await dragKanbanCard(actor, page, "Implement auth", "in-progress");
    await dragKanbanCard(actor, page, "Implement auth", "code-review");
  });

  s.step("Complete tasks", narrations.kanbanDone, async ({ actor, page }) => {
    await dragKanbanCard(actor, page, "Implement auth", "done");
    await dragKanbanCard(actor, page, "Implement auth", "released");
  });

  // PART 4: TUI terminals

  s.step("Open terminals", narrations.tuiIntro, async (ctx) => {
    ctx.mc = await ctx.session.createTerminal("mc", { label: "Midnight Commander" });
    ctx.htop = await ctx.session.createTerminal("htop", { label: "htop" });
    ctx.shell = await ctx.session.createTerminal(undefined, { label: "Shell" });
    await ctx.mc.waitForText(["1Help"]);
    await ctx.htop.waitForText(["CPU"]);
  });

  s.step("Navigate Midnight Commander", narrations.tuiMc, async ({ mc }) => {
    if (!mc) throw new Error("mc terminal not initialized");
    await mc.click(0.25, 0.25);
    for (let i = 0; i < 3; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("Tab");
    for (let i = 0; i < 2; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("Tab");
  });

  s.step("Use Vim in terminal", narrations.tuiVim, async ({ shell }) => {
    if (!shell) throw new Error("shell terminal not initialized");
    await shell.waitForPrompt();
    await shell.typeAndEnter("vim");
    await shell.waitForText(["~"], 10000);
    await shell.pressKey("i");
    await shell.type("Hello from browser2video!");
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":q!");
  });

  // SUMMARY

  s.step("Summary", narrations.summary, async ({ actor, baseURL }) => {
    await actor.goto(`${baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });
});
