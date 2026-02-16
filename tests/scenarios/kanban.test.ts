/**
 * Narrated Kanban board scenario: create tasks, move them through
 * columns (Backlog -> In Progress -> Code Review -> Done -> Released).
 */
import { test } from "@playwright/test";
import { fileURLToPath } from "url";
import { createSession, startServer, type Actor, type Page } from "@browser2video/runner";

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const session = await createSession();
  const { page, actor } = await session.openPage({
    url: `${server.baseURL}/kanban`,
  });
  const audio = session.audio;

  try {
    await session.step("Open Kanban board", async () => {
      await audio.speak(
        "Welcome! In this video we'll walk through a complete task lifecycle " +
        "on a Kanban board, from creation all the way to release.",
      );
      await actor.waitFor('[data-testid="kanban-board"]');
    });

    await session.step("Create task: Implement user authentication", async () => {
      await audio.speak(
        "Let's create our first task. We'll add 'Implement user authentication' " +
        "to the Backlog column.",
      );
      await addCard(actor, "backlog", "Implement user authentication");
    });

    await session.step("Create task: Write API tests", async () => {
      await audio.speak("And let's add another task for writing the API test suite.");
      await addCard(actor, "backlog", "Write API tests");
    });

    await session.step("Create task: Update documentation", async () => {
      await audio.speak("One more task: updating the project documentation.");
      await addCard(actor, "backlog", "Update documentation");
    });

    await session.step("Start work on authentication task", async () => {
      await audio.speak("A developer picks up the authentication task and moves it to In Progress.");
      await dragCardToColumn(actor, page, "Implement user authentication", "in-progress");
    });

    await session.step("Submit authentication for code review", async () => {
      await audio.speak("After completing the implementation, the task moves to Code Review.");
      await dragCardToColumn(actor, page, "Implement user authentication", "code-review");
    });

    await session.step("Code review approved", async () => {
      await audio.speak("The code review passes — the task is now Done.");
      await dragCardToColumn(actor, page, "Implement user authentication", "done");
    });

    await session.step("Release authentication feature", async () => {
      await audio.speak(
        "After deployment, we move the task to Released. " +
        "That completes the full lifecycle of our first task.",
      );
      await dragCardToColumn(actor, page, "Implement user authentication", "released");
    });

    await session.step("Start work on API tests", async () => {
      await audio.speak("Now let's move the API tests task through the pipeline.");
      await dragCardToColumn(actor, page, "Write API tests", "in-progress");
    });

    await session.step("Submit API tests for review", async () => {
      await dragCardToColumn(actor, page, "Write API tests", "code-review");
    });

    await session.step("API tests review approved", async () => {
      await dragCardToColumn(actor, page, "Write API tests", "done");
    });

    await session.step("Summary", async () => {
      await audio.speak(
        "And there you have it — a complete Kanban workflow demonstrating " +
        "how tasks flow from Backlog through development, code review, " +
        "and finally to Done and Released. " +
        "This board helps teams visualize their work and maintain a steady delivery pace.",
      );
    });

    await session.finish();
  } finally {
    await server.stop();
  }
}

async function addCard(actor: Actor, columnId: string, title: string) {
  await actor.click(`[data-testid="add-card-btn-${columnId}"]`);
  await actor.type(`[data-testid="add-card-input-${columnId}"]`, title);
  await actor.click(`[data-testid="add-card-confirm-${columnId}"]`);
}

async function dragCardToColumn(actor: Actor, page: Page, cardTitle: string, toColumnId: string) {
  const cardId = await page.evaluate((title: string) => {
    const cards = document.querySelectorAll("[data-card-id]");
    for (const card of cards) {
      if (card.textContent?.trim() === title) return card.getAttribute("data-card-id");
    }
    return null;
  }, cardTitle);

  if (!cardId) {
    console.warn(`    Card "${cardTitle}" not found, using API fallback`);
    await apiFallbackMove(page, cardTitle, toColumnId);
    return;
  }

  await actor.drag(`[data-card-id="${cardId}"]`, `[data-testid="column-${toColumnId}"]`);

  const movedOk = await page.evaluate(
    ([title, colId]: [string, string]) => {
      const col = document.querySelector(`[data-testid="column-${colId}"]`);
      if (!col) return false;
      return Array.from(col.querySelectorAll("[data-card-id]")).some(
        (c) => c.textContent?.trim() === title,
      );
    },
    [cardTitle, toColumnId] as [string, string],
  );

  if (!movedOk) {
    console.log(`    Drag didn't register, using API fallback for "${cardTitle}"`);
    await apiFallbackMove(page, cardTitle, toColumnId);
  }
}

async function apiFallbackMove(page: Page, cardTitle: string, toColumnId: string) {
  await page.evaluate(
    ([title, colId]: [string, string]) => {
      const cards = document.querySelectorAll("[data-card-id]");
      for (const c of cards) {
        if (c.textContent?.trim() === title) {
          (window as any).__kanban?.moveCard(c.getAttribute("data-card-id"), colId);
          return;
        }
      }
    },
    [cardTitle, toColumnId] as [string, string],
  );
}

test("kanban", scenario);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
