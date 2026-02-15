/**
 * @description Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 */
import type { ScenarioConfig, ScenarioContext } from "@browser2video/runner";
import type { Page } from "@playwright/test";
import path from "path";

export const config: ScenarioConfig = {
  server: { type: "vite", root: "apps/demo" },
  sync: { type: "automerge" },
  panes: [
    {
      id: "boss",
      type: "browser",
      path: "/notes?role=boss",
      label: "Boss",
      viewport: { width: 460 },
    },
    {
      id: "worker",
      type: "browser",
      path: "/notes?role=worker",
      label: "Worker",
      viewport: { width: 460 },
    },
    {
      id: "reviewer",
      type: "terminal",
      label: "Reviewer",
      command: (info) =>
        `cd ${JSON.stringify(process.cwd())} && npx tsx packages/runner/src/reviewer-cli.ts --ws ${JSON.stringify(info.syncWsUrl ?? "")} --doc ${JSON.stringify(info.docUrl ?? "")} --log ${JSON.stringify(path.join(process.cwd(), "artifacts", "reviewer.log"))}`,
    },
  ],
  layout: "row",
};

/** The tasks the Boss will create, in order */
const TASKS = [
  "create schemas",
  "add new note",
  "edit note",
];

/** Extra tasks the Boss adds at the end for the reorder demo */
const EXTRA_TASKS = ["write tests", "deploy"];

/**
 * Small helper: wait for an element matching `selector` to appear inside a
 * page managed by an Actor. Uses page.waitForSelector under the hood.
 */
async function getIndexByTitle(page: Page, title: string): Promise<number> {
  return await page.evaluate((t: string) => {
    const doc = (globalThis as any).document;
    const items = doc.querySelectorAll('[data-testid^="note-title-"]');
    const arr = Array.from(items);
    const idx = arr.findIndex((el: any) => {
      const titleSpan =
        el?.querySelector?.("div > span") ??
        el?.querySelector?.("span") ??
        el;
      return String(titleSpan?.textContent ?? "").trim() === t;
    });
    return idx;
  }, title);
}

async function waitForTitle(page: Page, title: string) {
  await page.waitForFunction(
    (t: string) => {
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).some((el: any) => {
        const titleSpan =
          el?.querySelector?.("div > span") ??
          el?.querySelector?.("span") ??
          el;
        return String(titleSpan?.textContent ?? "").trim() === t;
      });
    },
    title,
    { timeout: 5000 },
  );
}

async function waitForTitleGone(page: Page, title: string) {
  await page.waitForFunction(
    (t: string) => {
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-title-"]');
      return !Array.from(items).some((el: any) => {
        const titleSpan =
          el?.querySelector?.("div > span") ??
          el?.querySelector?.("span") ??
          el;
        return String(titleSpan?.textContent ?? "").trim() === t;
      });
    },
    title,
    { timeout: 5000 },
  );
}

async function waitForCompletedByTitle(page: Page, title: string) {
  await page.waitForFunction(
    (t: string) => {
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-item-"]');
      for (const item of Array.from(items) as any[]) {
        const titleEl = item.querySelector('[data-testid^="note-title-"]');
        const titleSpan =
          titleEl?.querySelector?.("div > span") ??
          titleEl?.querySelector?.("span") ??
          titleEl;
        if (String(titleSpan?.textContent ?? "").trim() !== t) continue;
        const check = item.querySelector('[data-testid^="note-check-"]');
        const svg = check?.querySelector("svg");
        // completed items are amber-400, approved+completed items are emerald-500
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
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-item-"]');
      for (const item of Array.from(items) as any[]) {
        const titleEl = item.querySelector('[data-testid^="note-title-"]');
        const titleSpan =
          titleEl?.querySelector?.("div > span") ??
          titleEl?.querySelector?.("span") ??
          titleEl;
        if (String(titleSpan?.textContent ?? "").trim() !== t) continue;
        return item.textContent?.includes("Approved") ?? false;
      }
      return false;
    },
    title,
    { timeout: 5000 },
  );
}

export default async function scenario(ctx: ScenarioContext) {
  const creatorId = "boss";
  const followerId = "worker";
  const creatorName = "Boss";
  const followerName = "Worker";

  const creator = ctx.actor(creatorId);
  const follower = ctx.actor(followerId);
  const creatorPage = ctx.page(creatorId);
  const followerPage = ctx.page(followerId);
  let seq = 0;

  /** Set overlay sequence number on a pane */
  async function setOverlaySeq(paneId: string, s: number, title: string) {
    const p = ctx.page(paneId);
    await p.evaluate(([seqNum, t]: [number, string]) => {
      (window as any).__b2v_setOverlaySeq?.(seqNum, t);
    }, [s, title] as [number, string]);
  }

  /** Set overlay applied status on a pane */
  async function setOverlayApplied(paneId: string, s: number, title: string) {
    const p = ctx.page(paneId);
    await p.evaluate(([seqNum, t]: [number, string]) => {
      (window as any).__b2v_setOverlayApplied?.(seqNum, t);
    }, [s, title] as [number, string]);
  }

  // Pages are already navigated by the runner (bossPath / workerPath).
  // Verify they loaded correctly.
  await ctx.step("all", "Verify both pages are ready", async () => {
    await creator.waitFor('[data-testid="notes-page"]');
    await follower.waitFor('[data-testid="notes-page"]');
  });

  // ------------------------------------------------------------------
  //  Boss creates tasks one by one, Worker marks each completed
  // ------------------------------------------------------------------

  for (let i = 0; i < TASKS.length; i++) {
    const taskTitle = TASKS[i];

    await ctx.step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      seq += 1;
      await creator.type('[data-testid="note-input"]', taskTitle);
      await creator.click('[data-testid="note-add-btn"]');
      await setOverlaySeq(creatorId, seq, taskTitle);
    });

    // Wait for the task to sync to Worker's page
    await ctx.step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
      await setOverlayApplied(followerId, seq, taskTitle);
    });

    if (taskTitle === "add new note") {
      await ctx.step("all", 'Reviewer approves "add new note"', async () => {
        await ctx.terminal("reviewer").send('APPROVE "add new note"');
      });

      await ctx.step(creatorId, `${creatorName} sees "add new note" approved`, async () => {
        await waitForApprovedByTitle(creatorPage, "add new note");
      });

      await ctx.step(followerId, `${followerName} sees "add new note" approved`, async () => {
        await waitForApprovedByTitle(followerPage, "add new note");
      });
    }

    await ctx.step(followerId, `${followerName} marks "${taskTitle}" completed`, async () => {
      const idx = await getIndexByTitle(followerPage, taskTitle);
      if (idx < 0) throw new Error(`${followerName}: could not find task "${taskTitle}" to complete`);
      await follower.click(`[data-testid="note-check-${idx}"]`);
    });

    // Wait for the completion to sync back to Boss
    await ctx.step(creatorId, `${creatorName} sees "${taskTitle}" completed`, async () => {
      await waitForCompletedByTitle(creatorPage, taskTitle);
    });
  }

  // ------------------------------------------------------------------
  //  3. Boss adds extra tasks
  // ------------------------------------------------------------------

  for (let i = 0; i < EXTRA_TASKS.length; i++) {
    const taskTitle = EXTRA_TASKS[i];

    await ctx.step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      seq += 1;
      await creator.type('[data-testid="note-input"]', taskTitle);
      await creator.click('[data-testid="note-add-btn"]');
      await setOverlaySeq(creatorId, seq, taskTitle);
    });

    // Wait for the task to sync to Worker
    await ctx.step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
      await setOverlayApplied(followerId, seq, taskTitle);
    });
  }

  // ------------------------------------------------------------------
  //  4. Boss rearranges uncompleted todos
  // ------------------------------------------------------------------

  // With top-insert, after adding write tests then deploy, the list head is:
  //   0: deploy
  //   1: write tests
  //   2: edit note
  //   3: add new note
  //   4: create schemas
  //
  // Reorder demo: swap so write tests becomes above deploy.
  await ctx.step(creatorId, `${creatorName} moves "write tests" above "deploy"`, async () => {
    const idxWriteTests = await getIndexByTitle(creatorPage, "write tests");
    const idxDeploy = await getIndexByTitle(creatorPage, "deploy");
    if (idxWriteTests < 0 || idxDeploy < 0) {
      throw new Error(`Boss: could not find reorder items (write tests=${idxWriteTests}, deploy=${idxDeploy})`);
    }
    await creator.drag(
      `[data-testid="note-item-${idxWriteTests}"]`,
      `[data-testid="note-item-${idxDeploy}"]`,
    );
  });

  // ------------------------------------------------------------------
  //  4b. Boss deletes "edit note" (index 2, a completed item)
  // ------------------------------------------------------------------

  await ctx.step(creatorId, `${creatorName} deletes "edit note"`, async () => {
    const idx = await getIndexByTitle(creatorPage, "edit note");
    if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
    await creator.click(`[data-testid="note-delete-${idx}"]`);
  });

  await ctx.step(followerId, `${followerName} sees "edit note" disappear`, async () => {
    await waitForTitleGone(followerPage, "edit note");
  });

  // ------------------------------------------------------------------
  //  5. Verify all items are present and in the correct order on both pages
  // ------------------------------------------------------------------

  // After the reorder + delete we have (top-insert, write tests swapped above deploy):
  //   [write tests, deploy, add new note, create schemas]
  const expectedOrder = [
    "write tests",
    "deploy",
    "add new note",
    "create schemas",
  ];

  await ctx.step("all", `Verify all items are in the right order (${creatorName})`, async () => {
    const creatorOrder = await creatorPage.evaluate(() => {
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).map((el: any) => {
        const titleSpan =
          el?.querySelector?.("div > span") ??
          el?.querySelector?.("span") ??
          el;
        return String(titleSpan?.textContent ?? "").trim();
      });
    });
    for (let i = 0; i < expectedOrder.length; i++) {
      if (creatorOrder[i] !== expectedOrder[i]) {
        throw new Error(
          `${creatorName} order mismatch at index ${i}: expected "${expectedOrder[i]}", got "${creatorOrder[i]}"\n` +
          `  Full order:      ${JSON.stringify(creatorOrder)}\n` +
          `  Expected order:  ${JSON.stringify(expectedOrder)}`
        );
      }
    }
    console.log(`    ${creatorName}: all ${expectedOrder.length} items in correct order`);
  });

  await ctx.step("all", `Verify all items are in the right order (${followerName})`, async () => {
    const followerOrder = await followerPage.evaluate(() => {
      const doc = (globalThis as any).document;
      const items = doc.querySelectorAll('[data-testid^="note-title-"]');
      return Array.from(items).map((el: any) => {
        const titleSpan =
          el?.querySelector?.("div > span") ??
          el?.querySelector?.("span") ??
          el;
        return String(titleSpan?.textContent ?? "").trim();
      });
    });
    for (let i = 0; i < expectedOrder.length; i++) {
      if (followerOrder[i] !== expectedOrder[i]) {
        throw new Error(
          `${followerName} order mismatch at index ${i}: expected "${expectedOrder[i]}", got "${followerOrder[i]}"\n` +
          `  Full order:        ${JSON.stringify(followerOrder)}\n` +
          `  Expected order:    ${JSON.stringify(expectedOrder)}`
        );
      }
    }
    console.log(`    ${followerName}: all ${expectedOrder.length} items in correct order`);
  });

}
