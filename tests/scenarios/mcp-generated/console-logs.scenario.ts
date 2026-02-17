/**
 * Generated scenario: console-logs
 * Notes app with console panel — CRUD operations generating visible console output.
 */
import { createSession, startServer } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });
if (!server) throw new Error("Failed to start Vite server");

const session = await createSession({ record: true, mode: "human" });
session.addCleanup(() => server.stop());
const { step } = session;
const { page, actor } = await session.openPage({ url: server.baseURL, viewport: { width: 640 } });

const TASKS = ["setup database", "write API routes", "add auth middleware"];

await step("Open notes page with console", async () => {
  await actor.goto(`${server.baseURL}/notes?role=boss&showConsole=true`);
  await actor.waitFor('[data-testid="notes-page"]');
  await actor.waitFor('[data-testid="console-panel"]');
});

for (const title of TASKS) {
  await step(`Add task: "${title}"`, async () => {
    await actor.type('[data-testid="note-input"]', title);
    await actor.click('[data-testid="note-add-btn"]');
  });
}

await step(`Complete task: "${TASKS[0]}"`, async () => {
  const idx = await page.evaluate((title: string) => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).findIndex((el: any) => {
      const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(span?.textContent ?? "").trim() === title;
    });
  }, TASKS[0]);
  if (idx < 0) throw new Error(`Could not find task "${TASKS[0]}"`);
  await actor.click(`[data-testid="note-check-${idx}"]`);
});

await step(`Delete task: "${TASKS[1]}"`, async () => {
  const idx = await page.evaluate((title: string) => {
    const items = document.querySelectorAll('[data-testid^="note-title-"]');
    return Array.from(items).findIndex((el: any) => {
      const span = el?.querySelector?.("div > span") ?? el?.querySelector?.("span") ?? el;
      return String(span?.textContent ?? "").trim() === title;
    });
  }, TASKS[1]);
  if (idx < 0) throw new Error(`Could not find task "${TASKS[1]}"`);
  await actor.click(`[data-testid="note-delete-${idx}"]`);
});

await step("Add another task", async () => {
  await actor.type('[data-testid="note-input"]', "deploy to production");
  await actor.click('[data-testid="note-add-btn"]');
});

const result = await session.finish();
console.log("Video:", result.video);
