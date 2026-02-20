/**
 * Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 *
 * Uses createGrid() for a 1-row, 3-column layout:
 *   [Boss browser | Worker browser | Reviewer terminal]
 */
import path from "path";
import { defineScenario, startServer, type TerminalActor, type Frame, type GridHandle } from "browser2video";
import { startSyncServer } from "../../apps/demo/scripts/sync-server.ts";

type DOMContext = Frame;

interface Ctx {
  boss: TerminalActor;
  worker: TerminalActor;
  reviewer: TerminalActor;
  grid: GridHandle;
}

const TASKS = ["create schemas", "add new note", "edit note"];
const EXTRA_TASKS = ["write tests", "deploy"];

export default defineScenario<Ctx>("Collaboration Demo", (s) => {
  s.options({ layout: "row" });

  s.setup(async (session) => {
    const server = await startServer({ type: "vite", root: "apps/demo" });
    if (!server) throw new Error("Failed to start Vite server");

    const sync = await startSyncServer({ artifactDir: path.resolve("artifacts", "collab-sync") });
    session.addCleanup(() => sync.stop());
    session.addCleanup(() => server.stop());

    const bossUrl = new URL(`${server.baseURL}/notes?role=boss`);
    bossUrl.searchParams.set("ws", sync.wsUrl);

    const grid = await session.createGrid(
      [
        { url: bossUrl.toString(), label: "Boss" },
        { url: "about:blank", label: "Worker" },
        { label: "Reviewer" },
      ],
      {
        viewport: { width: 1420, height: 720 },
        grid: [[0, 1, 2]],
      },
    );

    const [boss, worker, reviewer] = grid.actors;

    const bossFrame = boss.frame as DOMContext;
    await bossFrame.waitForFunction(
      () => document.location.hash.length > 1,
      undefined,
      { timeout: 20000 },
    );
    const hash = await bossFrame.evaluate(() => document.location.hash);
    const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;
    console.error(`  Doc hash: ${hash}`);

    const workerUrl = new URL(`${server.baseURL}/notes?role=worker`);
    workerUrl.searchParams.set("ws", sync.wsUrl);
    workerUrl.hash = hash;
    await worker.goto(workerUrl.toString());

    const reviewerCmd = `cd ${JSON.stringify(process.cwd())} && node apps/demo/scripts/reviewer-cli.ts --ws ${JSON.stringify(sync.wsUrl)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer.log"))}`;
    await reviewer.typeAndEnter(reviewerCmd);

    return { boss, worker, reviewer, grid };
  });

  s.step("Verify both pages are ready", async ({ boss, worker }) => {
    const bossFrame = boss.frame as DOMContext;
    const workerFrame = worker.frame as DOMContext;
    await bossFrame.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
    await workerFrame.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
  });

  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];

    s.step(`Boss adds task: "${t}"`, async ({ boss }) => {
      await boss.type('[data-testid="note-input"]', t);
      await boss.click('[data-testid="note-add-btn"]');
    });

    s.step(`Worker sees "${t}" appear`, async ({ worker }) => {
      await waitForTitle(worker.frame as DOMContext, t);
    });

    s.step(`Worker marks "${t}" completed`, async ({ worker }) => {
      const frame = worker.frame as DOMContext;
      const idx = await getIndexByTitle(frame, t);
      if (idx < 0) throw new Error(`Worker: could not find task "${t}" to complete`);
      await worker.click(`[data-testid="note-check-${idx}"]`);
      try {
        await waitForCompletedByTitle(frame, t, 3000);
      } catch {
        await frame.locator(`[data-testid="note-check-${idx}"]`).click({ force: true });
        await waitForCompletedByTitle(frame, t);
      }
    });

    s.step(`Boss sees "${t}" completed`, async ({ boss }) => {
      await waitForCompletedByTitle(boss.frame as DOMContext, t);
    });

    s.step(`Reviewer approves "${t}"`, async ({ reviewer }) => {
      await reviewer.typeAndEnter(`APPROVE "${t}"`);
    });

    s.step(`Boss sees "${t}" approved`, async ({ boss }) => {
      await waitForApprovedByTitle(boss.frame as DOMContext, t);
    });

    s.step(`Worker sees "${t}" approved`, async ({ worker }) => {
      await waitForApprovedByTitle(worker.frame as DOMContext, t);
    });
  }

  for (const t of EXTRA_TASKS) {
    s.step(`Boss adds task: "${t}"`, async ({ boss }) => {
      await boss.type('[data-testid="note-input"]', t);
      await boss.click('[data-testid="note-add-btn"]');
    });
    s.step(`Worker sees "${t}" appear`, async ({ worker }) => {
      await waitForTitle(worker.frame as DOMContext, t);
    });
  }

  s.step('Boss moves "write tests" above "deploy"', async ({ boss }) => {
    const bossFrame = boss.frame as DOMContext;
    const idxWT = await getIndexByTitle(bossFrame, "write tests");
    const idxD = await getIndexByTitle(bossFrame, "deploy");
    if (idxWT < 0 || idxD < 0) throw new Error("Boss: reorder items not found");
    await boss.drag(`[data-testid="note-item-${idxWT}"]`, `[data-testid="note-item-${idxD}"]`);
  });

  s.step('Worker moves "deploy" above "write tests"', async ({ worker, grid }) => {
    await grid.page.waitForTimeout(2000);
    const workerFrame = worker.frame as DOMContext;
    const idxD = await getIndexByTitle(workerFrame, "deploy");
    const idxWT = await getIndexByTitle(workerFrame, "write tests");
    if (idxD < 0 || idxWT < 0) throw new Error("Worker: reorder items not found");
    await worker.drag(`[data-testid="note-item-${idxD}"]`, `[data-testid="note-item-${idxWT}"]`);
  });

  s.step('Boss deletes "edit note"', async ({ boss }) => {
    const bossFrame = boss.frame as DOMContext;
    const idx = await getIndexByTitle(bossFrame, "edit note");
    if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
    await boss.click(`[data-testid="note-delete-${idx}"]`);
  });

  s.step('Worker sees "edit note" disappear', async ({ worker }) => {
    await waitForTitleGone(worker.frame as DOMContext, "edit note");
  });

  const expectedItems = new Set(["deploy", "write tests", "add new note", "create schemas"]);

  s.step("Verify final order (Boss)", async ({ boss, grid }) => {
    await grid.page.waitForTimeout(1000);
    const bossFrame = boss.frame as DOMContext;
    const order = await getOrder(bossFrame);
    const items = new Set(order);
    for (const e of expectedItems) {
      if (!items.has(e)) throw new Error(`Boss: missing item "${e}"\n  Got: ${JSON.stringify(order)}`);
    }
    if (order.length !== expectedItems.size) {
      throw new Error(`Boss: expected ${expectedItems.size} items, got ${order.length}\n  Got: ${JSON.stringify(order)}`);
    }
    console.error(`    Boss: all ${expectedItems.size} items present: ${JSON.stringify(order)}`);
  });

  s.step("Verify final order (Worker)", async ({ boss, worker, grid }) => {
    await grid.page.waitForTimeout(1000);
    const bossFrame = boss.frame as DOMContext;
    const workerFrame = worker.frame as DOMContext;
    const bossOrder = await getOrder(bossFrame);
    const workerOrder = await getOrder(workerFrame);
    for (const e of expectedItems) {
      if (!workerOrder.includes(e)) throw new Error(`Worker: missing item "${e}"\n  Got: ${JSON.stringify(workerOrder)}`);
    }
    if (JSON.stringify(bossOrder) !== JSON.stringify(workerOrder)) {
      throw new Error(
        `Pages out of sync!\n  Boss:   ${JSON.stringify(bossOrder)}\n  Worker: ${JSON.stringify(workerOrder)}`,
      );
    }
    console.error(`    Worker: all ${expectedItems.size} items in correct order`);
  });
});

// ---------------------------------------------------------------------------
//  DOM helpers — operate on iframe Frames
// ---------------------------------------------------------------------------

async function getIndexByTitle(frame: DOMContext, title: string): Promise<number> {
  return frame.evaluate((t: string) => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).findIndex((el: any) => {
      const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(s?.textContent ?? "").trim() === t;
    });
  }, title);
}

async function getOrder(frame: DOMContext): Promise<string[]> {
  return frame.evaluate(() => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).map((el: any) => {
      const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(s?.textContent ?? "").trim();
    });
  });
}

async function waitForTitle(frame: DOMContext, title: string) {
  await frame.waitForFunction(
    (t: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).some((el: any) => {
        const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(s?.textContent ?? "").trim() === t;
      });
    },
    title,
    { timeout: 20000 },
  );
}

async function waitForTitleGone(frame: DOMContext, title: string) {
  await frame.waitForFunction(
    (t: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      return !Array.from(items).some((el: any) => {
        const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(s?.textContent ?? "").trim() === t;
      });
    },
    title,
    { timeout: 20000 },
  );
}

async function waitForCompletedByTitle(frame: DOMContext, title: string, timeout = 20000) {
  await frame.waitForFunction(
    (t: string) => {
      const items = document.querySelectorAll('[data-testid^="note-item-"]');
      for (const item of Array.from(items) as any[]) {
        const titleEl = item.querySelector('[data-testid^="note-title-"]');
        const s = titleEl?.querySelector?.("div > span") ?? titleEl?.querySelector?.("span") ?? titleEl;
        if (String(s?.textContent ?? "").trim() !== t) continue;
        const check = item.querySelector('[data-testid^="note-check-"]');
        const svg = check?.querySelector("svg");
        return (svg?.classList.contains("text-amber-400") || svg?.classList.contains("text-emerald-500")) ?? false;
      }
      return false;
    },
    title,
    { timeout },
  );
}

async function waitForApprovedByTitle(frame: DOMContext, title: string) {
  await frame.waitForFunction(
    (t: string) => {
      const items = document.querySelectorAll('[data-testid^="note-item-"]');
      for (const item of Array.from(items) as any[]) {
        const titleEl = item.querySelector('[data-testid^="note-title-"]');
        const s = titleEl?.querySelector?.("div > span") ?? titleEl?.querySelector?.("span") ?? titleEl;
        if (String(s?.textContent ?? "").trim() !== t) continue;
        return item.textContent?.includes("Approved") ?? false;
      }
      return false;
    },
    title,
    { timeout: 20000 },
  );
}
