/**
 * Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 */
import path from "path";
import { defineScenario, startServer, type Actor, type Page, type TerminalHandle } from "browser2video";
import { startSyncServer } from "../../apps/demo/scripts/sync-server.ts";

interface Ctx {
  boss: Actor;
  worker: Actor;
  bossPage: Page;
  workerPage: Page;
  reviewer: TerminalHandle;
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

    const { page: bossPage, actor: boss } = await session.openPage({
      viewport: { width: 460, height: 720 },
      label: "Boss",
    });
    const { page: workerPage, actor: worker } = await session.openPage({
      viewport: { width: 460, height: 720 },
      label: "Worker",
    });

    const bossUrl = new URL(`${server.baseURL}/notes?role=boss`);
    bossUrl.searchParams.set("ws", sync.wsUrl);
    await boss.goto(bossUrl.toString());

    await bossPage.waitForFunction(
      () => (globalThis as any).document.location.hash.length > 1,
      undefined,
      { timeout: 20000 },
    );
    const hash = await bossPage.evaluate(() => (globalThis as any).document.location.hash);
    const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;
    console.error(`  Doc hash: ${hash}`);

    const workerUrl = new URL(`${server.baseURL}/notes?role=worker`);
    workerUrl.searchParams.set("ws", sync.wsUrl);
    workerUrl.hash = hash;
    await worker.goto(workerUrl.toString());

    const reviewerCmd = `cd ${JSON.stringify(process.cwd())} && node apps/demo/scripts/reviewer-cli.ts --ws ${JSON.stringify(sync.wsUrl)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer.log"))}`;
    const { terminal: reviewer } = await session.openTerminal({
      command: reviewerCmd,
      viewport: { width: 500, height: 720 },
      label: "Reviewer",
    });

    return { boss, worker, bossPage, workerPage, reviewer };
  });

  s.step("Verify both pages are ready", async ({ bossPage, workerPage }) => {
    await bossPage.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
    await workerPage.waitForSelector('[data-testid="notes-page"]', { timeout: 20000 });
  });

  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];

    s.step(`Boss adds task: "${t}"`, async ({ boss }) => {
      await boss.type('[data-testid="note-input"]', t);
      await boss.click('[data-testid="note-add-btn"]');
    });

    s.step(`Worker sees "${t}" appear`, async ({ workerPage }) => {
      await waitForTitle(workerPage, t);
    });

    s.step(`Worker marks "${t}" completed`, async ({ worker, workerPage }) => {
      const idx = await getIndexByTitle(workerPage, t);
      if (idx < 0) throw new Error(`Worker: could not find task "${t}" to complete`);
      await worker.click(`[data-testid="note-check-${idx}"]`);
      try {
        await waitForCompletedByTitle(workerPage, t, 3000);
      } catch {
        await workerPage.locator(`[data-testid="note-check-${idx}"]`).click({ force: true });
        await waitForCompletedByTitle(workerPage, t);
      }
    });

    s.step(`Boss sees "${t}" completed`, async ({ bossPage }) => {
      await waitForCompletedByTitle(bossPage, t);
    });

    s.step(`Reviewer approves "${t}"`, async ({ reviewer }) => {
      await reviewer.send(`APPROVE "${t}"`);
    });

    s.step(`Boss sees "${t}" approved`, async ({ bossPage }) => {
      await waitForApprovedByTitle(bossPage, t);
    });

    s.step(`Worker sees "${t}" approved`, async ({ workerPage }) => {
      await waitForApprovedByTitle(workerPage, t);
    });
  }

  for (const t of EXTRA_TASKS) {
    s.step(`Boss adds task: "${t}"`, async ({ boss }) => {
      await boss.type('[data-testid="note-input"]', t);
      await boss.click('[data-testid="note-add-btn"]');
    });
    s.step(`Worker sees "${t}" appear`, async ({ workerPage }) => {
      await waitForTitle(workerPage, t);
    });
  }

  s.step('Boss moves "write tests" above "deploy"', async ({ boss, bossPage }) => {
    const idxWT = await getIndexByTitle(bossPage, "write tests");
    const idxD = await getIndexByTitle(bossPage, "deploy");
    if (idxWT < 0 || idxD < 0) throw new Error("Boss: reorder items not found");
    await boss.drag(`[data-testid="note-item-${idxWT}"]`, `[data-testid="note-item-${idxD}"]`);
  });

  s.step('Worker moves "deploy" above "write tests"', async ({ worker, workerPage }) => {
    await workerPage.waitForTimeout(2000);
    const idxD = await getIndexByTitle(workerPage, "deploy");
    const idxWT = await getIndexByTitle(workerPage, "write tests");
    if (idxD < 0 || idxWT < 0) throw new Error("Worker: reorder items not found");
    await worker.drag(`[data-testid="note-item-${idxD}"]`, `[data-testid="note-item-${idxWT}"]`);
  });

  s.step('Boss deletes "edit note"', async ({ boss, bossPage }) => {
    const idx = await getIndexByTitle(bossPage, "edit note");
    if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
    await boss.click(`[data-testid="note-delete-${idx}"]`);
  });

  s.step('Worker sees "edit note" disappear', async ({ workerPage }) => {
    await waitForTitleGone(workerPage, "edit note");
  });

  const expectedItems = new Set(["deploy", "write tests", "add new note", "create schemas"]);

  s.step("Verify final order (Boss)", async ({ bossPage }) => {
    await bossPage.waitForTimeout(1000);
    const order = await getOrder(bossPage);
    const items = new Set(order);
    for (const e of expectedItems) {
      if (!items.has(e)) throw new Error(`Boss: missing item "${e}"\n  Got: ${JSON.stringify(order)}`);
    }
    if (order.length !== expectedItems.size) {
      throw new Error(`Boss: expected ${expectedItems.size} items, got ${order.length}\n  Got: ${JSON.stringify(order)}`);
    }
    console.error(`    Boss: all ${expectedItems.size} items present: ${JSON.stringify(order)}`);
  });

  s.step("Verify final order (Worker)", async ({ bossPage, workerPage }) => {
    await workerPage.waitForTimeout(1000);
    const bossOrder = await getOrder(bossPage);
    const workerOrder = await getOrder(workerPage);
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
//  DOM helpers
// ---------------------------------------------------------------------------

async function getIndexByTitle(page: Page, title: string): Promise<number> {
  return page.evaluate((t: string) => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).findIndex((el: any) => {
      const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(s?.textContent ?? "").trim() === t;
    });
  }, title);
}

async function getOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).map((el: any) => {
      const s = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(s?.textContent ?? "").trim();
    });
  });
}

async function waitForTitle(page: Page, title: string) {
  await page.waitForFunction(
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

async function waitForTitleGone(page: Page, title: string) {
  await page.waitForFunction(
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

async function waitForCompletedByTitle(page: Page, title: string, timeout = 20000) {
  await page.waitForFunction(
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

async function waitForApprovedByTitle(page: Page, title: string) {
  await page.waitForFunction(
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
