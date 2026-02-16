/**
 * Narrated Kanban board scenario: create tasks, move them through
 * columns (Backlog -> In Progress -> Code Review -> Done -> Released).
 * Narrator explains each column's purpose while cursor highlights it.
 */
import { fileURLToPath } from "url";
import { createSession, startServer, type Actor, type Page } from "@browser2video/runner";

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const session = await createSession({
    narration: { enabled: true },
  });
  const { step } = session;
  const { page, actor } = await session.openPage({
    url: `${server.baseURL}/kanban`,
    viewport: { width: 1060, height: 720 },
  });

  try {
    await step("Open Kanban board",
      "Welcome! In this video we'll walk through a complete task lifecycle on a Kanban board. Let me explain each column.",
      async () => {
        await actor.waitFor('[data-testid="kanban-board"]');
      },
    );

    await step("Explain Backlog column",
      "The Backlog column holds all planned work that hasn't started yet.",
      async () => { await actor.circleAround('[data-testid="column-title-backlog"]'); },
    );

    await step("Explain In Progress column",
      "In Progress is for tasks a developer is actively working on.",
      async () => { await actor.circleAround('[data-testid="column-title-in-progress"]'); },
    );

    await step("Explain Code Review column",
      "Code Review holds tasks waiting for peer review before merging.",
      async () => { await actor.circleAround('[data-testid="column-title-code-review"]'); },
    );

    await step("Explain Done column",
      "Done means the task is merged and verified.",
      async () => { await actor.circleAround('[data-testid="column-title-done"]'); },
    );

    await step("Explain Released column",
      "Released indicates the feature has been deployed to production.",
      async () => { await actor.circleAround('[data-testid="column-title-released"]'); },
    );

    await step("Create task: Implement user authentication",
      "Let's create our first task in the Backlog.",
      async () => {
        await actor.circleAround('[data-testid="column-backlog"]');
        await addCard(actor, "backlog", "Implement user authentication");
      },
    );

    await step("Create task: Write API tests",
      "And another task for writing the API test suite.",
      async () => { await addCard(actor, "backlog", "Write API tests"); },
    );

    await step("Create task: Update documentation",
      "One more: updating the project documentation.",
      async () => { await addCard(actor, "backlog", "Update documentation"); },
    );

    await step("Start work on authentication task",
      "A developer picks up the authentication task and moves it to In Progress.",
      async () => {
        await actor.circleAround('[data-testid="column-title-in-progress"]');
        await dragCardToColumn(actor, page, "Implement user authentication", "in-progress");
      },
    );

    await step("Submit authentication for code review",
      "After completing the implementation, the task moves to Code Review.",
      async () => {
        await actor.circleAround('[data-testid="column-title-code-review"]');
        await dragCardToColumn(actor, page, "Implement user authentication", "code-review");
      },
    );

    await step("Code review approved",
      "The code review passes — the task is now Done.",
      async () => {
        await actor.circleAround('[data-testid="column-title-done"]');
        await dragCardToColumn(actor, page, "Implement user authentication", "done");
      },
    );

    await step("Release authentication feature",
      "After deployment, we move the task to Released. That completes the full lifecycle of our first task.",
      async () => {
        await actor.circleAround('[data-testid="column-title-released"]');
        await dragCardToColumn(actor, page, "Implement user authentication", "released");
      },
    );

    await step("Start work on API tests",
      "Now let's move the API tests task through the pipeline.",
      async () => { await dragCardToColumn(actor, page, "Write API tests", "in-progress"); },
    );

    await step("Submit API tests for review", async () => {
      await dragCardToColumn(actor, page, "Write API tests", "code-review");
    });

    await step("API tests review approved", async () => {
      await dragCardToColumn(actor, page, "Write API tests", "done");
    });

    await step("Summary",
      "And there you have it — a complete Kanban workflow demonstrating how tasks flow from Backlog through development, code review, and finally to Done and Released. This board helps teams visualize their work and maintain a steady delivery pace.",
      async () => { await actor.circleAround('[data-testid="kanban-board"]'); },
    );

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

  if (!cardId) throw new Error(`Card "${cardTitle}" not found on the board`);
  await actor.drag(`[data-card-id="${cardId}"]`, `[data-testid="column-${toColumnId}"]`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("kanban", scenario);
}
