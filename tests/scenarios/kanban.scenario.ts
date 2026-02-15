/**
 * @description Narrated Kanban board scenario demonstrating the complete
 * lifecycle of a task: creation, progression through columns, and release.
 * Uses the local kanban-demo app with data-testid selectors.
 */
import type { ScenarioConfig, ScenarioContext } from "@browser2video/runner";

export const config: ScenarioConfig = {
  server: { type: "vite", root: "apps/demo" },
  panes: [{ id: "main", type: "browser", path: "/kanban" }],
};

export default async function scenario(ctx: ScenarioContext) {
  const actor = ctx.actor("main");
  const page = ctx.page("main");
  const { baseURL, audio } = ctx;

  // ------------------------------------------------------------------
  //  Act 1: Open the board
  // ------------------------------------------------------------------

  await ctx.step("main", "Open Kanban board", async () => {
    await audio.speak(
      "Welcome! In this video we'll walk through a complete task lifecycle " +
      "on a Kanban board, from creation all the way to release.",
    );
    await actor.goto(`${baseURL}/kanban`);
    await actor.waitFor('[data-testid="kanban-board"]');
  });

  // ------------------------------------------------------------------
  //  Act 2: Create tasks in Backlog
  // ------------------------------------------------------------------

  await ctx.step("main", "Create task: Implement user authentication", async () => {
    await audio.speak(
      "Let's create our first task. We'll add 'Implement user authentication' " +
      "to the Backlog column.",
    );
    await addCard(ctx, "backlog", "Implement user authentication");
  });

  await ctx.step("main", "Create task: Write API tests", async () => {
    await audio.speak(
      "And let's add another task for writing the API test suite.",
    );
    await addCard(ctx, "backlog", "Write API tests");
  });

  await ctx.step("main", "Create task: Update documentation", async () => {
    await audio.speak(
      "One more task: updating the project documentation.",
    );
    await addCard(ctx, "backlog", "Update documentation");
  });

  // ------------------------------------------------------------------
  //  Act 3: Task lifecycle — move first task through all columns
  // ------------------------------------------------------------------

  await ctx.step("main", "Start work on authentication task", async () => {
    await audio.speak(
      "A developer picks up the authentication task and moves it to In Progress.",
    );
    await dragCardToColumn(ctx, "Implement user authentication", "in-progress");
  });

  await ctx.step("main", "Submit authentication for code review", async () => {
    await audio.speak(
      "After completing the implementation, the task moves to Code Review.",
    );
    await dragCardToColumn(ctx, "Implement user authentication", "code-review");
  });

  await ctx.step("main", "Code review approved", async () => {
    await audio.speak(
      "The code review passes — the task is now Done.",
    );
    await dragCardToColumn(ctx, "Implement user authentication", "done");
  });

  await ctx.step("main", "Release authentication feature", async () => {
    await audio.speak(
      "After deployment, we move the task to Released. " +
      "That completes the full lifecycle of our first task.",
    );
    await dragCardToColumn(ctx, "Implement user authentication", "released");
  });

  // ------------------------------------------------------------------
  //  Act 4: Move second task through the pipeline
  // ------------------------------------------------------------------

  await ctx.step("main", "Start work on API tests", async () => {
    await audio.speak(
      "Now let's move the API tests task through the pipeline.",
    );
    await dragCardToColumn(ctx, "Write API tests", "in-progress");
  });

  await ctx.step("main", "Submit API tests for review", async () => {
    await dragCardToColumn(ctx, "Write API tests", "code-review");
  });

  await ctx.step("main", "API tests review approved", async () => {
    await dragCardToColumn(ctx, "Write API tests", "done");
  });

  // ------------------------------------------------------------------
  //  Act 5: Closing
  // ------------------------------------------------------------------

  await ctx.step("main", "Summary", async () => {
    await audio.speak(
      "And there you have it — a complete Kanban workflow demonstrating " +
      "how tasks flow from Backlog through development, code review, " +
      "and finally to Done and Released. " +
      "This board helps teams visualize their work and maintain a steady delivery pace.",
    );
  });
}

// ---------------------------------------------------------------------------
//  Action helpers
// ---------------------------------------------------------------------------

async function addCard(ctx: ScenarioContext, columnId: string, title: string) {
  const actor = ctx.actor("main");

  await actor.click(`[data-testid="add-card-btn-${columnId}"]`);
  await actor.type(`[data-testid="add-card-input-${columnId}"]`, title);
  await actor.click(`[data-testid="add-card-confirm-${columnId}"]`);
}

/**
 * Find a card's data-card-id attribute by its visible title text.
 * Returns null if not found.
 */
async function findCardIdByTitle(
  ctx: ScenarioContext,
  cardTitle: string,
): Promise<string | null> {
  const page = ctx.page("main");
  return page.evaluate((title: string) => {
    const cards = document.querySelectorAll("[data-card-id]");
    for (const card of cards) {
      if (card.textContent?.trim() === title) {
        return card.getAttribute("data-card-id");
      }
    }
    return null;
  }, cardTitle);
}

/**
 * Move a card (found by title) into a target column using actor.drag().
 * Falls back to a programmatic API if the drag doesn't register.
 */
async function dragCardToColumn(
  ctx: ScenarioContext,
  cardTitle: string,
  toColumnId: string,
) {
  const actor = ctx.actor("main");
  const page = ctx.page("main");

  const cardId = await findCardIdByTitle(ctx, cardTitle);
  if (!cardId) {
    console.warn(`    Card "${cardTitle}" not found, using API fallback`);
    await apiFallbackMove(page, cardTitle, toColumnId);
    return;
  }

  // Use the Actor's built-in drag (WindMouse path, cursor overlay, proper delays)
  const fromSelector = `[data-card-id="${cardId}"]`;
  const toSelector = `[data-testid="column-${toColumnId}"]`;

  await actor.drag(fromSelector, toSelector);

  // Verify the move happened; if not, use the API fallback
  const movedOk = await page.evaluate(
    ([title, colId]: [string, string]) => {
      const col = document.querySelector(`[data-testid="column-${colId}"]`);
      if (!col) return false;
      const cards = col.querySelectorAll("[data-card-id]");
      for (const c of cards) {
        if (c.textContent?.trim() === title) return true;
      }
      return false;
    },
    [cardTitle, toColumnId] as [string, string],
  );

  if (!movedOk) {
    console.log(`    Drag didn't register, using API fallback for "${cardTitle}"`);
    await apiFallbackMove(page, cardTitle, toColumnId);
  }
}

/** Programmatic fallback: move a card via the app's __kanban API. */
async function apiFallbackMove(
  page: import("@playwright/test").Page,
  cardTitle: string,
  toColumnId: string,
) {
  await page.evaluate(
    ([title, colId]: [string, string]) => {
      const cards = document.querySelectorAll("[data-card-id]");
      for (const c of cards) {
        if (c.textContent?.trim() === title) {
          (window as any).__kanban?.moveCard(
            c.getAttribute("data-card-id"),
            colId,
          );
          return;
        }
      }
    },
    [cardTitle, toColumnId] as [string, string],
  );
}
