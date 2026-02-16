/**
 * Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 */
import { test } from "@playwright/test";
import { fileURLToPath } from "url";
import { createSession, startServer, startSyncServer, type Page } from "@browser2video/runner";
import path from "path";

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const sync = await startSyncServer({ artifactDir: path.resolve("artifacts", "collab-sync") });
  const session = await createSession({ layout: "row" });

  // Boss page
  const bossUrl = new URL(`${server.baseURL}/notes?role=boss`);
  bossUrl.searchParams.set("ws", sync.wsUrl);
  const { page: bossPage, actor: boss } = await session.openPage({
    url: bossUrl.toString(),
    viewport: { width: 460, height: 720 },
    label: "Boss",
  });

  // Wait for Boss to create the Automerge doc
  await bossPage.waitForFunction(
    () => (globalThis as any).document.location.hash.length > 1,
    undefined,
    { timeout: 10000 },
  );
  const hash = await bossPage.evaluate(() => (globalThis as any).document.location.hash);
  const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;
  console.log(`  Doc hash: ${hash}`);

  // Worker page (joins with the same hash)
  const workerUrl = new URL(`${server.baseURL}/notes?role=worker`);
  workerUrl.searchParams.set("ws", sync.wsUrl);
  workerUrl.hash = hash;
  const { page: workerPage, actor: worker } = await session.openPage({
    url: workerUrl.toString(),
    viewport: { width: 460, height: 720 },
    label: "Worker",
  });

  // Reviewer terminal
  const reviewerCmd = `cd ${JSON.stringify(process.cwd())} && npx tsx packages/runner/src/reviewer-cli.ts --ws ${JSON.stringify(sync.wsUrl)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer.log"))}`;
  const { terminal: reviewer } = await session.openTerminal({
    command: reviewerCmd,
    viewport: { width: 500, height: 720 },
    label: "Reviewer",
  });

  // Wait for Automerge sync
  await new Promise((r) => setTimeout(r, 800));
  await boss.injectCursor();
  await worker.injectCursor();

  try {
    const TASKS = ["create schemas", "add new note", "edit note"];
    const EXTRA_TASKS = ["write tests", "deploy"];

    await session.step("Verify both pages are ready", async () => {
      await boss.waitFor('[data-testid="notes-page"]');
      await worker.waitFor('[data-testid="notes-page"]');
    });

    // Boss creates tasks, Worker completes, Reviewer approves
    for (let i = 0; i < TASKS.length; i++) {
      const t = TASKS[i];

      await session.step(`Boss adds task: "${t}"`, async () => {
        await boss.type('[data-testid="note-input"]', t);
        await boss.click('[data-testid="note-add-btn"]');
      });

      await session.step(`Worker sees "${t}" appear`, async () => {
        await waitForTitle(workerPage, t);
      });

      await session.step(`Worker marks "${t}" completed`, async () => {
        const idx = await getIndexByTitle(workerPage, t);
        if (idx < 0) throw new Error(`Worker: could not find task "${t}" to complete`);
        await worker.click(`[data-testid="note-check-${idx}"]`);
      });

      await session.step(`Boss sees "${t}" completed`, async () => {
        await waitForCompletedByTitle(bossPage, t);
      });

      await session.step(`Reviewer approves "${t}"`, async () => {
        await reviewer.send(`APPROVE "${t}"`);
      });

      await session.step(`Boss sees "${t}" approved`, async () => {
        await waitForApprovedByTitle(bossPage, t);
      });

      await session.step(`Worker sees "${t}" approved`, async () => {
        await waitForApprovedByTitle(workerPage, t);
      });
    }

    // Boss adds extra tasks
    for (const t of EXTRA_TASKS) {
      await session.step(`Boss adds task: "${t}"`, async () => {
        await boss.type('[data-testid="note-input"]', t);
        await boss.click('[data-testid="note-add-btn"]');
      });
      await session.step(`Worker sees "${t}" appear`, async () => {
        await waitForTitle(workerPage, t);
      });
    }

    // Boss rearranges
    await session.step('Boss moves "write tests" above "deploy"', async () => {
      const idxWT = await getIndexByTitle(bossPage, "write tests");
      const idxD = await getIndexByTitle(bossPage, "deploy");
      if (idxWT < 0 || idxD < 0) throw new Error("Boss: reorder items not found");
      await boss.drag(`[data-testid="note-item-${idxWT}"]`, `[data-testid="note-item-${idxD}"]`);
    });

    // Worker rearranges
    await session.step('Worker moves "deploy" above "write tests"', async () => {
      const idxD = await getIndexByTitle(workerPage, "deploy");
      const idxWT = await getIndexByTitle(workerPage, "write tests");
      if (idxD < 0 || idxWT < 0) throw new Error("Worker: reorder items not found");
      await worker.drag(`[data-testid="note-item-${idxD}"]`, `[data-testid="note-item-${idxWT}"]`);
    });

    // Boss deletes "edit note"
    await session.step('Boss deletes "edit note"', async () => {
      const idx = await getIndexByTitle(bossPage, "edit note");
      if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
      await boss.click(`[data-testid="note-delete-${idx}"]`);
    });

    await session.step('Worker sees "edit note" disappear', async () => {
      await waitForTitleGone(workerPage, "edit note");
    });

    // Verify final order
    const expectedOrder = ["deploy", "write tests", "add new note", "create schemas"];

    await session.step("Verify final order (Boss)", async () => {
      const order = await getOrder(bossPage);
      for (let i = 0; i < expectedOrder.length; i++) {
        if (order[i] !== expectedOrder[i]) {
          throw new Error(
            `Boss order mismatch at ${i}: "${order[i]}" vs "${expectedOrder[i]}"\n` +
            `  Got: ${JSON.stringify(order)}\n  Expected: ${JSON.stringify(expectedOrder)}`,
          );
        }
      }
      console.log(`    Boss: all ${expectedOrder.length} items in correct order`);
    });

    await session.step("Verify final order (Worker)", async () => {
      const order = await getOrder(workerPage);
      for (let i = 0; i < expectedOrder.length; i++) {
        if (order[i] !== expectedOrder[i]) {
          throw new Error(
            `Worker order mismatch at ${i}: "${order[i]}" vs "${expectedOrder[i]}"\n` +
            `  Got: ${JSON.stringify(order)}\n  Expected: ${JSON.stringify(expectedOrder)}`,
          );
        }
      }
      console.log(`    Worker: all ${expectedOrder.length} items in correct order`);
    });

    await session.finish();
  } finally {
    await sync.stop();
    await server.stop();
  }
}

// DOM helpers

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
    { timeout: 5000 },
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
    { timeout: 5000 },
  );
}

async function waitForCompletedByTitle(page: Page, title: string) {
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
    { timeout: 5000 },
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
    { timeout: 5000 },
  );
}

test("collab", scenario);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
