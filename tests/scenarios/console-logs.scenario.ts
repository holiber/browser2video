/**
 * @description Scenario demonstrating in-page console logging.
 * Opens the notes app with an embedded console panel and performs
 * CRUD operations that generate visible console output.
 */
import type { ScenarioContext } from "@browser2video/runner";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const TASKS = ["setup database", "write API routes", "add auth middleware"];

export async function consoleLogsScenario(ctx: ScenarioContext) {
  const { step, actor, page, baseURL } = ctx;

  // ------------------------------------------------------------------
  //  1. Open the notes page (DevTools console shows logs automatically)
  // ------------------------------------------------------------------

  await step("Open notes page with console", async () => {
    await actor.goto(`${baseURL}/notes?role=boss&showConsole=true`);
    await actor.waitFor('[data-testid="notes-page"]');
    await actor.waitFor('[data-testid="console-panel"]');
  });

  await sleep(600);

  // ------------------------------------------------------------------
  //  2. Add tasks (generates "Task created" console logs)
  // ------------------------------------------------------------------

  for (const title of TASKS) {
    await step(`Add task: "${title}"`, async () => {
      await actor.type('[data-testid="note-input"]', title);
      await sleep(150);
      await actor.click('[data-testid="note-add-btn"]');
      await sleep(400);
    });
  }

  // ------------------------------------------------------------------
  //  3. Complete a task (generates "Task completed" console log)
  // ------------------------------------------------------------------

  await step(`Complete task: "${TASKS[0]}"`, async () => {
    // TASKS are added via unshift, so "setup database" (first added) is at the bottom.
    // The list order after all adds (top-insert) is:
    //   0: add auth middleware
    //   1: write API routes
    //   2: setup database
    const idx = await page.evaluate((title: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      const arr = Array.from(items);
      return arr.findIndex((el: any) => {
        const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(span?.textContent ?? "").trim() === title;
      });
    }, TASKS[0]);
    if (idx < 0) throw new Error(`Could not find task "${TASKS[0]}"`);
    await actor.click(`[data-testid="note-check-${idx}"]`);
    await sleep(500);
  });

  // ------------------------------------------------------------------
  //  4. Delete a task (generates "Task deleted" console log)
  // ------------------------------------------------------------------

  await step(`Delete task: "${TASKS[1]}"`, async () => {
    const idx = await page.evaluate((title: string) => {
      const items = document.querySelectorAll('[data-testid^="note-title-"]');
      const arr = Array.from(items);
      return arr.findIndex((el: any) => {
        const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
        return String(span?.textContent ?? "").trim() === title;
      });
    }, TASKS[1]);
    if (idx < 0) throw new Error(`Could not find task "${TASKS[1]}"`);
    await actor.click(`[data-testid="note-delete-${idx}"]`);
    await sleep(500);
  });

  // ------------------------------------------------------------------
  //  5. Add one more task to generate more console output
  // ------------------------------------------------------------------

  await step("Add another task", async () => {
    await actor.type('[data-testid="note-input"]', "deploy to production");
    await sleep(150);
    await actor.click('[data-testid="note-add-btn"]');
    await sleep(500);
  });

  // Final pause so viewers can see the end state
  await sleep(1500);
}
