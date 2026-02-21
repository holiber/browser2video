/**
 * All-in-One Demo — comprehensive showcase of browser2video capabilities.
 *
 * 1. 1x1: basic UI demo with narration (form, scroll, drag, graph, canvas)
 * 2. 1x1: Kanban board demo (create and manage tasks)
 * 3. 3-col: collaborative scenario (Boss + Worker + Reviewer terminal)
 * 4. 2-pane: TUI terminals (mc + vim)
 *
 * Each section uses a separate grid with appropriate layout.
 */
import path from "path";
import { defineScenario, startServer, type Session, type Frame, type GridHandle } from "browser2video";
import { startSyncServer } from "../../../apps/demo/scripts/sync-server.ts";

type DOMContext = Frame;

interface Ctx {
  session: Session;
  grid: GridHandle;
  demoBaseURL: string;
  syncWsUrl: string;
}

const narrations = {
  intro: "Welcome to browser2video! This demo showcases every major capability in a single recording.",
  formIntro: "Let's start with form interactions — human-like typing, clicks, and toggles.",
  scroll: "We can scroll pages and containers, and drag items to reorder them.",
  graph: "Here we connect nodes in a flow graph by dragging between handles.",
  draw: "The drawing canvas supports shapes and freehand — all recorded smoothly.",
  kanbanIntro: "Now let's switch to a Kanban board. Notice how the layout resets — all panes are destroyed and recreated when switching layouts.",
  kanbanBacklog: "The Backlog column holds all planned work that hasn't started yet.",
  kanbanInProgress: "In Progress is for tasks a developer is actively working on.",
  kanbanCodeReview: "Code Review holds tasks waiting for peer review before merging.",
  kanbanDone: "Done means the task is merged and verified.",
  kanbanReleased: "Released indicates the feature has been deployed to production.",
  kanbanCreate: "Let's create some tasks in the Backlog.",
  kanbanMove: "Now we'll drag a task through the full pipeline — from Backlog all the way to Released.",
  collabIntro: "For the collaborative workflow, we switch to a three-column layout with Boss, Worker, and a Reviewer terminal.",
  collabTasks: "The Boss creates tasks while the Worker marks them complete. Everything syncs in real-time via Automerge.",
  collabReview: "The Reviewer approves completed tasks from the terminal CLI.",
  tuiIntro: "browser2video can also record full TUI applications running in real terminals — here's Midnight Commander and vim.",
  tuiMc: "We can click and navigate files in Midnight Commander, just like a real user.",
  tuiVim: "Vim runs natively in the browser terminal — we type text, then exit.",
  summary: "That's the full demo! browser2video records all of this into a composed video with subtitles and narration.",
};

export default defineScenario<Ctx>("All-in-One Demo", (s) => {
  s.options({ layout: "auto" });

  s.setup(async (session) => {
    const server = await startServer({ type: "vite", root: "apps/demo" });
    if (!server) throw new Error("Failed to start Vite server");
    session.addCleanup(() => server.stop());

    const sync = await startSyncServer({ artifactDir: path.resolve("artifacts", "all-in-one-sync") });
    session.addCleanup(() => sync.stop());

    const grid = await session.createGrid(
      [{ url: server.baseURL, label: "Demo" }],
      { viewport: { width: 1280, height: 720 }, grid: [[0]] },
    );

    return {
      session,
      grid,
      demoBaseURL: server.baseURL,
      syncWsUrl: sync.wsUrl,
    };
  });

  // ---- Warm up narration ----

  s.step("Warm up narration", async ({ session }) => {
    await Promise.all(Object.values(narrations).map((text) => session.audio.warmup(text)));
  });

  // ====================================================================
  //  PART 1: Basic UI Demo (1x1 layout — already selected)
  // ====================================================================

  s.step("Introduction", narrations.intro, async ({ grid }) => {
    const actor = grid.actors[0];
    await actor.waitFor('[data-testid="app-page"]');
  });

  s.step("Fill form fields", narrations.formIntro, async ({ grid }) => {
    const actor = grid.actors[0];
    await actor.type('[data-testid="form-name"]', "Jane Doe");
    await actor.type('[data-testid="form-email"]', "jane@example.com");
    await actor.click('[data-testid="form-pref-updates"]');
    await actor.click('[data-testid="form-notifications"]');
  });

  s.step("Scroll and drag", narrations.scroll, async ({ grid }) => {
    const actor = grid.actors[0];
    await actor.scroll(null, 800);
    await actor.scroll('[data-testid="scroll-area"]', 400);
    await actor.scroll(null, 400);
    await actor.drag('[data-testid="drag-item-task-1"]', '[data-testid="drag-item-task-3"]');
  });

  s.step("Connect nodes in graph", narrations.graph, async ({ grid }) => {
    const actor = grid.actors[0];
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

  s.step("Draw shapes on canvas", narrations.draw, async ({ grid }) => {
    const actor = grid.actors[0];
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

  // ====================================================================
  //  PART 2: Kanban Board Demo (switch layout to 1x1 — demonstrates layout switching)
  // ====================================================================

  s.step("Switch to Kanban board", narrations.kanbanIntro, async (ctx) => {
    const kanbanGrid = await ctx.session.createGrid(
      [{ url: `${ctx.demoBaseURL}/kanban`, label: "Kanban" }],
      { viewport: { width: 1060, height: 720 }, grid: [[0]] },
    );
    ctx.grid = kanbanGrid;
    const actor = kanbanGrid.actors[0];
    await actor.waitFor('[data-testid="kanban-board"]', 15000);
  });

  s.step("Highlight Backlog column", narrations.kanbanBacklog, async ({ grid }) => {
    await grid.actors[0].circleAround('[data-testid="column-title-backlog"]');
  });

  s.step("Highlight In Progress column", narrations.kanbanInProgress, async ({ grid }) => {
    await grid.actors[0].circleAround('[data-testid="column-title-in-progress"]');
  });

  s.step("Highlight Code Review column", narrations.kanbanCodeReview, async ({ grid }) => {
    await grid.actors[0].circleAround('[data-testid="column-title-code-review"]');
  });

  s.step("Highlight Done column", narrations.kanbanDone, async ({ grid }) => {
    await grid.actors[0].circleAround('[data-testid="column-title-done"]');
  });

  s.step("Highlight Released column", narrations.kanbanReleased, async ({ grid }) => {
    await grid.actors[0].circleAround('[data-testid="column-title-released"]');
  });

  s.step("Create Kanban tasks", narrations.kanbanCreate, async ({ grid }) => {
    const actor = grid.actors[0];
    await actor.circleAround('[data-testid="column-backlog"]');

    await actor.click('[data-testid="add-card-btn-backlog"]');
    await actor.type('[data-testid="add-card-input-backlog"]', "Implement auth");
    await actor.click('[data-testid="add-card-confirm-backlog"]');

    await actor.click('[data-testid="add-card-btn-backlog"]');
    await actor.type('[data-testid="add-card-input-backlog"]', "Write API tests");
    await actor.click('[data-testid="add-card-confirm-backlog"]');

    await actor.click('[data-testid="add-card-btn-backlog"]');
    await actor.type('[data-testid="add-card-input-backlog"]', "Update docs");
    await actor.click('[data-testid="add-card-confirm-backlog"]');
  });

  s.step("Move task through pipeline", narrations.kanbanMove, async ({ grid }) => {
    const actor = grid.actors[0];
    const frame = actor.frame as DOMContext;

    const findCardId = async (title: string) => {
      return frame.evaluate((t: string) => {
        const cards = document.querySelectorAll("[data-card-id]");
        for (const card of cards) {
          if (card.textContent?.trim() === t) return card.getAttribute("data-card-id");
        }
        return null;
      }, title);
    };

    const dragToColumn = async (title: string, columnId: string) => {
      const cardId = await findCardId(title);
      if (!cardId) throw new Error(`Card "${title}" not found on the board`);
      await actor.circleAround(`[data-testid="column-title-${columnId}"]`);
      await actor.drag(`[data-card-id="${cardId}"]`, `[data-testid="column-${columnId}"]`);
    };

    await dragToColumn("Implement auth", "in-progress");
    await dragToColumn("Implement auth", "code-review");
    await dragToColumn("Implement auth", "done");
    await dragToColumn("Implement auth", "released");
  });

  // ====================================================================
  //  PART 3: Collaboration Demo (switch to 3 columns)
  // ====================================================================

  s.step("Switch to collaboration layout", narrations.collabIntro, async (ctx) => {
    const { session, demoBaseURL, syncWsUrl } = ctx;

    const bossUrl = new URL(`${demoBaseURL}/notes?role=boss`);
    bossUrl.searchParams.set("ws", syncWsUrl);

    // Create a fresh grid with proper browser panes (like the standalone collab test)
    const collabGrid = await session.createGrid(
      [
        { url: bossUrl.toString(), label: "Boss" },
        { url: "about:blank", label: "Worker" },
        { label: "Reviewer" },
      ],
      {
        viewport: { width: 1280, height: 720 },
        grid: [[0, 1, 2]],
      },
    );

    const [boss, worker, reviewer] = collabGrid.actors;
    ctx.grid = collabGrid;

    const bossFrame = boss.frame as DOMContext;
    await bossFrame.waitForFunction(
      () => document.location.hash.length > 1,
      undefined,
      { timeout: 20000 },
    );
    const hash = await bossFrame.evaluate(() => document.location.hash);
    const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;

    const workerUrl = new URL(`${demoBaseURL}/notes?role=worker`);
    workerUrl.searchParams.set("ws", syncWsUrl);
    workerUrl.hash = hash;
    await worker.goto(workerUrl.toString());

    const reviewerCmd = `cd ${JSON.stringify(process.cwd())} && node apps/demo/scripts/reviewer-cli.ts --ws ${JSON.stringify(syncWsUrl)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer-all-in-one.log"))}`;
    await reviewer.typeAndEnter(reviewerCmd);
  });

  s.step("Verify pages ready", async ({ grid }) => {
    const [boss, worker] = grid.actors;
    const bossFrame = boss.frame as DOMContext;
    const workerFrame = worker.frame as DOMContext;
    await bossFrame.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
    await workerFrame.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
  });

  const COLLAB_TASKS = ["setup database", "write API routes"];

  for (const task of COLLAB_TASKS) {
    s.step(`Boss adds "${task}"`, async ({ grid }) => {
      const boss = grid.actors[0];
      await boss.type('[data-testid="note-input"]', task);
      await boss.click('[data-testid="note-add-btn"]');
    });

    s.step(`Worker sees "${task}"`, async ({ grid }) => {
      const worker = grid.actors[1];
      const workerFrame = worker.frame as DOMContext;
      await workerFrame.waitForFunction(
        (t: string) => {
          const items = document.querySelectorAll('[data-testid^="note-title-"]');
          return Array.from(items).some((el: any) => {
            const sp = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
            return String(sp?.textContent ?? "").trim() === t;
          });
        },
        task,
        { timeout: 20000 },
      );
    });

    s.step(`Worker marks "${task}" done`, narrations.collabTasks, async ({ grid }) => {
      const worker = grid.actors[1];
      const workerFrame = worker.frame as DOMContext;
      const idx = await workerFrame.evaluate((t: string) => {
        const items = document.querySelectorAll('[data-testid^="note-title-"]');
        return Array.from(items).findIndex((el: any) => {
          const sp = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
          return String(sp?.textContent ?? "").trim() === t;
        });
      }, task);
      if (idx < 0) throw new Error(`Worker: could not find "${task}"`);
      await worker.click(`[data-testid="note-check-${idx}"]`);
    });

    s.step(`Reviewer approves "${task}"`, narrations.collabReview, async ({ grid }) => {
      const reviewer = grid.actors[2];
      await reviewer.typeAndEnter(`APPROVE "${task}"`);
    });
  }

  // ====================================================================
  //  PART 4: TUI Terminals (mc + vim in a 2-pane grid)
  // ====================================================================

  s.step("Switch to TUI terminals", narrations.tuiIntro, async (ctx) => {
    const tuiGrid = await ctx.session.createGrid(
      [
        { command: "mc", label: "Midnight Commander" },
        { label: "Shell" },
      ],
      { viewport: { width: 1280, height: 720 }, grid: [[0, 1]] },
    );
    ctx.grid = tuiGrid;
    const mc = tuiGrid.actors[0];
    await mc.waitForText(["1Help"], 30000);
  });

  s.step("Browse files in mc", narrations.tuiMc, async ({ grid }) => {
    const mc = grid.actors[0];
    await mc.click(0.15, 0.25);
    await mc.click(0.15, 0.35);
    await mc.click(0.15, 0.45);
    await mc.click(0.65, 0.25);
    await mc.click(0.65, 0.35);
  });

  s.step("Vim in shell", narrations.tuiVim, async ({ grid }) => {
    const shell = grid.actors[1];
    await shell.waitForPrompt();
    await shell.typeAndEnter("vim");
    await shell.waitForText(["~"], 10000);
    await shell.pressKey("i");
    await shell.typeAndEnter("Hello from the all-in-one demo!");
    await shell.type("TUI apps work seamlessly in browser2video.");
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":q!");
    await shell.waitForPrompt();
  });

  // ====================================================================
  //  Summary
  // ====================================================================

  s.step("Summary", narrations.summary, async (ctx) => {
    const summaryGrid = await ctx.session.createGrid(
      [{ url: ctx.demoBaseURL, label: "Summary" }],
      { viewport: { width: 1280, height: 720 }, grid: [[0]] },
    );
    ctx.grid = summaryGrid;
    const actor = summaryGrid.actors[0];
    await actor.waitFor('[data-testid="app-page"]', 15000);
  });
});
