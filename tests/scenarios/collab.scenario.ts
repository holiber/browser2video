/**
 * @description Collaborative scenario: Boss creates tasks in a shared todo list,
 * Worker marks them completed. Both windows are synced via Automerge.
 */
import type { CollabScenarioContext } from "@browser2video/runner";
import type { Page } from "@playwright/test";

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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
        return svg?.classList.contains("text-green-500") ?? false;
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

export async function collabScenario(ctx: CollabScenarioContext) {
  const {
    step,
    actorIds,
    actorNames,
    actors,
    pages,
    setOverlaySeq,
    setOverlayApplied,
    reviewerCmd,
  } = ctx;

  const [creatorId, followerId] = actorIds;
  const creatorName = actorNames[creatorId] ?? creatorId;
  const followerName = actorNames[followerId] ?? followerId;

  const creator = actors[creatorId];
  const follower = actors[followerId];
  const creatorPage = pages[creatorId];
  const followerPage = pages[followerId];
  let seq = 0;

  // Pages are already navigated by the runner (bossPath / workerPath).
  // Verify they loaded correctly.
  await step("both", "Verify both pages are ready", async () => {
    await creator.waitFor('[data-testid="notes-page"]');
    await follower.waitFor('[data-testid="notes-page"]');
  });

  // ------------------------------------------------------------------
  //  Boss creates tasks one by one, Worker marks each completed
  // ------------------------------------------------------------------

  for (let i = 0; i < TASKS.length; i++) {
    const taskTitle = TASKS[i];

    await step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      seq += 1;
      await creator.type('[data-testid="note-input"]', taskTitle);
      await sleep(160);
      await creator.click('[data-testid="note-add-btn"]');
      await setOverlaySeq(creatorId, seq, taskTitle);
    });

    // Wait for the task to sync to Worker's page
    await step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
      await setOverlayApplied(followerId, seq, taskTitle);
      // Small visual pause so viewers can see the sync
      await sleep(300);
    });

    if (taskTitle === "add new note") {
      await step("both", 'Reviewer approves "add new note"', async () => {
        await reviewerCmd('APPROVE "add new note"');
        await sleep(300);
      });

      await step(creatorId, `${creatorName} sees "add new note" approved`, async () => {
        await waitForApprovedByTitle(creatorPage, "add new note");
        await sleep(200);
      });

      await step(followerId, `${followerName} sees "add new note" approved`, async () => {
        await waitForApprovedByTitle(followerPage, "add new note");
        await sleep(200);
      });
    }

    await step(followerId, `${followerName} marks "${taskTitle}" completed`, async () => {
      const idx = await getIndexByTitle(followerPage, taskTitle);
      if (idx < 0) throw new Error(`${followerName}: could not find task "${taskTitle}" to complete`);
      await follower.click(`[data-testid="note-check-${idx}"]`);
    });

    // Wait for the completion to sync back to Boss
    await step(creatorId, `${creatorName} sees "${taskTitle}" completed`, async () => {
      await waitForCompletedByTitle(creatorPage, taskTitle);
      await sleep(300);
    });
  }

  // ------------------------------------------------------------------
  //  3. Boss adds extra tasks
  // ------------------------------------------------------------------

  for (let i = 0; i < EXTRA_TASKS.length; i++) {
    const taskTitle = EXTRA_TASKS[i];

    await step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      seq += 1;
      await creator.type('[data-testid="note-input"]', taskTitle);
      await sleep(160);
      await creator.click('[data-testid="note-add-btn"]');
      await setOverlaySeq(creatorId, seq, taskTitle);
    });

    // Wait for the task to sync to Worker
    await step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
      await setOverlayApplied(followerId, seq, taskTitle);
      await sleep(300);
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
  await step(creatorId, `${creatorName} moves "write tests" above "deploy"`, async () => {
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

  await sleep(800);

  // ------------------------------------------------------------------
  //  4b. Boss deletes "edit note" (index 2, a completed item)
  // ------------------------------------------------------------------

  await step(creatorId, `${creatorName} deletes "edit note"`, async () => {
    const idx = await getIndexByTitle(creatorPage, "edit note");
    if (idx < 0) throw new Error('Boss: could not find "edit note" to delete');
    await creator.click(`[data-testid="note-delete-${idx}"]`);
  });

  await step(followerId, `${followerName} sees "edit note" disappear`, async () => {
    await waitForTitleGone(followerPage, "edit note");
    await sleep(300);
  });

  await sleep(500);

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

  await step("both", `Verify all items are in the right order (${creatorName})`, async () => {
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

  await step("both", `Verify all items are in the right order (${followerName})`, async () => {
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

  // ------------------------------------------------------------------
  //  6. Boss types a command in the terminal (if terminal pane is visible)
  // ------------------------------------------------------------------

  const hasTerminal = await creatorPage.evaluate(() => {
    return !!document.querySelector('[data-testid="xterm-notes-terminal"]');
  });

  if (hasTerminal) {
    await step(creatorId, `${creatorName} types a command in the terminal`, async () => {
      // Click into the terminal to focus it
      await creator.click('[data-testid="xterm-notes-terminal"]');
      await sleep(400);
      // Type a command using page.keyboard (terminal isn't a regular input)
      await creatorPage.keyboard.type("ls -la", { delay: 80 });
      await sleep(200);
      await creatorPage.keyboard.press("Enter");
      await sleep(1500);
    });
  }

  // Final pause so viewers can see the end state
  await sleep(1200);
}
