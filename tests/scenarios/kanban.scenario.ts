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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    await sleep(500);
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
    await sleep(1500);
  });
}

// ---------------------------------------------------------------------------
//  Action helpers
// ---------------------------------------------------------------------------

async function addCard(ctx: ScenarioContext, columnId: string, title: string) {
  const actor = ctx.actor("main");

  // Click the "+ New card" button
  await actor.click(`[data-testid="add-card-btn-${columnId}"]`);
  await sleep(200);

  // Type the card title
  await actor.type(`[data-testid="add-card-input-${columnId}"]`, title);
  await sleep(150);

  // Click "Add Card"
  await actor.click(`[data-testid="add-card-confirm-${columnId}"]`);
  await sleep(400);
}

async function dragCardToColumn(
  ctx: ScenarioContext,
  cardTitle: string,
  toColumnId: string,
) {
  const actor = ctx.actor("main");
  const page = ctx.page("main");

  // Find the card element by title text
  const cardEl = await page.evaluateHandle((title: string) => {
    const cards = document.querySelectorAll("[data-card-id]");
    for (const card of cards) {
      if (card.textContent?.trim() === title) return card;
    }
    return null;
  }, cardTitle);

  const card = cardEl.asElement();
  if (!card) {
    // Fallback: use the window API
    console.warn(`    Card "${cardTitle}" not found for drag, using API fallback`);
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
    await sleep(300);
    return;
  }

  // Get card position
  const srcBox = await card.boundingBox();
  if (!srcBox) return;

  // Get target column position
  const targetCol = await page.$(`[data-testid="column-${toColumnId}"]`);
  if (!targetCol) return;
  const tgtBox = await targetCol.boundingBox();
  if (!tgtBox) return;

  const from = {
    x: Math.round(srcBox.x + srcBox.width / 2),
    y: Math.round(srcBox.y + srcBox.height / 2),
  };
  const to = {
    x: Math.round(tgtBox.x + tgtBox.width / 2),
    y: Math.round(tgtBox.y + Math.min(tgtBox.height / 3, 150)),
  };

  // Perform smooth drag with cursor overlay
  await page.mouse.move(from.x, from.y);
  await page.evaluate(`window.__b2v_moveCursor?.(${from.x}, ${from.y})`).catch(() => {});
  await sleep(100);
  await page.mouse.down();
  await sleep(200);

  // Animate the drag in steps
  const steps = 25;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t); // smoothstep
    const x = Math.round(from.x + (to.x - from.x) * ease);
    const y = Math.round(from.y + (to.y - from.y) * ease);
    await page.mouse.move(x, y);
    await page.evaluate(`window.__b2v_moveCursor?.(${x}, ${y})`).catch(() => {});
    await sleep(12);
  }

  await sleep(200);
  await page.mouse.up();
  await sleep(400);

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
    await sleep(300);
  }
}
