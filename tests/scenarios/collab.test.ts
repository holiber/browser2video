/**
 * Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 */
import { fileURLToPath } from "url";
import { createSession, startServer, type Page } from "@browser2video/runner";
import { startSyncServer } from "../../apps/demo/scripts/sync-server.ts";
import path from "path";

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const sync = await startSyncServer({ artifactDir: path.resolve("artifacts", "collab-sync") });
  const session = await createSession({ layout: "row" });
  const { step } = session;

  // Open both browser panes first (without URLs) so recordings start simultaneously
  const { page: bossPage, actor: boss } = await session.openPage({
    viewport: { width: 460, height: 720 },
    label: "Boss",
  });
  const { page: workerPage, actor: worker } = await session.openPage({
    viewport: { width: 460, height: 720 },
    label: "Worker",
  });

  // Navigate Boss first to create the Automerge doc
  const bossUrl = new URL(`${server.baseURL}/notes?role=boss`);
  bossUrl.searchParams.set("ws", sync.wsUrl);
  await boss.goto(bossUrl.toString());

  // Wait for Boss to create the Automerge doc
  await bossPage.waitForFunction(
    () => (globalThis as any).document.location.hash.length > 1,
    undefined,
    { timeout: 10000 },
  );
  const hash = await bossPage.evaluate(() => (globalThis as any).document.location.hash);
  const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;
  console.log(`  Doc hash: ${hash}`);

  // Navigate Worker with the shared hash
  const workerUrl = new URL(`${server.baseURL}/notes?role=worker`);
  workerUrl.searchParams.set("ws", sync.wsUrl);
  workerUrl.hash = hash;
  await worker.goto(workerUrl.toString());

  // Reviewer terminal (open after both browser panes so it doesn't delay them)
  const reviewerCmd = `cd ${JSON.stringify(process.cwd())} && node apps/demo/scripts/reviewer-cli.ts --ws ${JSON.stringify(sync.wsUrl)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer.log"))}`;
  const { terminal: reviewer } = await session.openTerminal({
    command: reviewerCmd,
    viewport: { width: 500, height: 720 },
    label: "Reviewer",
  });

  // Wait for Automerge sync
  await new Promise((r) => setTimeout(r, 800));

  try {
    const TASKS = ["create schemas", "add new note", "edit note"];
    const EXTRA_TASKS = ["write tests", "deploy"];

    await step("Verify both pages are ready", async () => {
      await boss.waitFor('[data-testid="notes-page"]');
      await worker.waitFor('[data-testid="notes-page"]');
    });

    // Boss creates tasks, Worker completes, Reviewer approves
    for (let i = 0; i < TASKS.length; i++) {
      const t = TASKS[i];

      await step(`Boss adds task: "${t}"`, async () => {
        await boss.type('[data-testid="note-input"]', t);
        await boss.click('[data-testid="note-add-btn"]');
      });

      await step(`Worker sees "${t}" appear`, async () => {
        await waitForTitle(workerPage, t);
      });

      await step(`Worker marks "${t}" completed`, async () => {
        const idx = await getIndexByTitle(workerPage, t);
        if (idx < 0) throw new Error(`Worker: could not find task "${t}" to complete`);
        await worker.click(`[data-testid="note-check-${idx}"]`);
      });

      await step(`Boss sees "${t}" completed`, async () => {
        await waitForCompletedByTitle(bossPage, t);
      });

      await step(`Reviewer approves "${t}"`, async () => {
        await reviewer.send(`APPROVE "${t}"`);
      });

      await step(`Boss sees "${t}" approved`, async () => {
        await waitForApprovedByTitle(bossPage, t);
      });

      await step(`Worker sees "${t}" approved`, async () => {
        await waitForApprovedByTitle(workerPage, t);
      });
    }

    // Boss adds extra tasks
    for (const t of EXTRA_TASKS) {
      await step(`Boss adds task: "${t}"`, async () => {
        await boss.type('[data-testid="note-input"]', t);
        await boss.click('[data-testid="note-add-btn"]');
      });
      await step(`Worker sees "${t}" appear`, async () => {
        await waitForTitle(workerPage, t);
      });
    }

    // Boss rearranges
    await step('Boss moves "write tests" above "deploy"', async () => {
      const idxWT = await getIndexByTitle(bossPage, "write tests");
      const idxD = await getIndexByTitle(bossPage, "deploy");
      if (idxWT < 0 || idxD < 0) throw new Error("Boss: reorder items not found");
      await boss.drag(`[data-testid="note-item-${idxWT}"]`, `[data-testid="note-item-${idxD}"]`);
    });

    // Worker rearranges
    await step('Worker moves "deploy" above "write tests"', async () => {
      const idxD = await getIndexByTitle(workerPage, "deploy");
      const idxWT = await getIndexByTitle(workerPage, "write tests");
      if (idxD < 0 || idxWT < 0) throw new Error("Worker: reorder items not found");
      await worker.drag(`[data-testid="note-item-${idxD}"]`, `[data-testid="note-item-${idxWT}"]`);
    });

    // Boss deletes "edit note"
    await step('Boss deletes "edit note"', async () => {
      const idx = await getIndexByTitle(bossPage, "edit note");
      if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
      await boss.click(`[data-testid="note-delete-${idx}"]`);
    });

    await step('Worker sees "edit note" disappear', async () => {
      await waitForTitleGone(workerPage, "edit note");
    });

    // Verify final order
    const expectedOrder = ["deploy", "write tests", "add new note", "create schemas"];

    await step("Verify final order (Boss)", async () => {
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

    await step("Verify final order (Worker)", async () => {
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

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("collab", scenario);
}
