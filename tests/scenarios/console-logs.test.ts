/**
 * Scenario demonstrating in-page console logging.
 * Opens the notes app with an embedded console panel and performs
 * CRUD operations that generate visible console output.
 */
import { test } from "@playwright/test";
import { fileURLToPath } from "url";
import { createSession, startServer } from "@browser2video/runner";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TASKS = ["setup database", "write API routes", "add auth middleware"];

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const session = await createSession();
  const { page, actor } = await session.openPage({ url: server.baseURL });

  try {
    await session.step("Open notes page with console", async () => {
      await actor.goto(`${server.baseURL}/notes?role=boss&showConsole=true`);
      await actor.waitFor('[data-testid="notes-page"]');
      await actor.waitFor('[data-testid="console-panel"]');
    });

    await sleep(600);

    for (const title of TASKS) {
      await session.step(`Add task: "${title}"`, async () => {
        await actor.type('[data-testid="note-input"]', title);
        await sleep(150);
        await actor.click('[data-testid="note-add-btn"]');
        await sleep(400);
      });
    }

    await session.step(`Complete task: "${TASKS[0]}"`, async () => {
      const idx = await page.evaluate((title: string) => {
        const items = document.querySelectorAll('[data-testid^="note-title-"]');
        return Array.from(items).findIndex((el: any) => {
          const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
          return String(span?.textContent ?? "").trim() === title;
        });
      }, TASKS[0]);
      if (idx < 0) throw new Error(`Could not find task "${TASKS[0]}"`);
      await actor.click(`[data-testid="note-check-${idx}"]`);
      await sleep(500);
    });

    await session.step(`Delete task: "${TASKS[1]}"`, async () => {
      const idx = await page.evaluate((title: string) => {
        const items = document.querySelectorAll('[data-testid^="note-title-"]');
        return Array.from(items).findIndex((el: any) => {
          const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
          return String(span?.textContent ?? "").trim() === title;
        });
      }, TASKS[1]);
      if (idx < 0) throw new Error(`Could not find task "${TASKS[1]}"`);
      await actor.click(`[data-testid="note-delete-${idx}"]`);
      await sleep(500);
    });

    await session.step("Add another task", async () => {
      await actor.type('[data-testid="note-input"]', "deploy to production");
      await sleep(150);
      await actor.click('[data-testid="note-add-btn"]');
      await sleep(500);
    });

    await sleep(1500);
    await session.finish();
  } finally {
    await server.stop();
  }
}

test("console-logs", scenario);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
