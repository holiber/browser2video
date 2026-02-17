/**
 * Generated scenario: kanban
 * Narrated Kanban board — create tasks and move them through columns.
 * TTS narration is warmed up in advance for each step to avoid gaps.
 */
import { createSession, startServer, type Actor, type Page } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });
if (!server) throw new Error("Failed to start Vite server");

const session = await createSession({
  record: true,
  mode: "human",
  narration: { enabled: true },
});
session.addCleanup(() => server.stop());
const { step } = session;
const { page, actor } = await session.openPage({
  url: `${server.baseURL}/kanban`,
  viewport: { width: 1060, height: 720 },
});

async function addCard(a: Actor, columnId: string, title: string) {
  await a.click(`[data-testid="add-card-btn-${columnId}"]`);
  await a.type(`[data-testid="add-card-input-${columnId}"]`, title);
  await a.click(`[data-testid="add-card-confirm-${columnId}"]`);
}

async function dragCardToColumn(a: Actor, p: Page, cardTitle: string, toColumnId: string) {
  const cardId = await p.evaluate((title: string) => {
    const cards = document.querySelectorAll("[data-card-id]");
    for (const card of cards) {
      if (card.textContent?.trim() === title) return card.getAttribute("data-card-id");
    }
    return null;
  }, cardTitle);
  if (!cardId) throw new Error(`Card "${cardTitle}" not found on the board`);
  await a.drag(`[data-card-id="${cardId}"]`, `[data-testid="column-${toColumnId}"]`);
}

// Pre-warm all narration audio so there are no gaps during playback
const narrations = [
  "Welcome! In this video we'll walk through a complete task lifecycle on a Kanban board. Let me explain each column.",
  "The Backlog column holds all planned work that hasn't started yet.",
  "In Progress is for tasks a developer is actively working on.",
  "Code Review holds tasks waiting for peer review before merging.",
  "Done means the task is merged and verified.",
  "Released indicates the feature has been deployed to production.",
  "Let's create our first task in the Backlog.",
  "And another task for writing the API test suite.",
  "One more: updating the project documentation.",
  "A developer picks up the authentication task and moves it to In Progress.",
  "After completing the implementation, the task moves to Code Review.",
  "The code review passes — the task is now Done.",
  "After deployment, we move the task to Released. That completes the full lifecycle of our first task.",
  "Now let's move the API tests task through the pipeline.",
  "And there you have it — a complete Kanban workflow demonstrating how tasks flow from Backlog through development, code review, and finally to Done and Released. This board helps teams visualize their work and maintain a steady delivery pace.",
];

await step("Warm up narration cache", async () => {
  await Promise.all(narrations.map((text) => session.audio.warmup(text)));
});

await step("Open Kanban board", narrations[0], async () => {
  await actor.waitFor('[data-testid="kanban-board"]');
});

await step("Explain Backlog column", narrations[1], async () => {
  await actor.circleAround('[data-testid="column-title-backlog"]');
});

await step("Explain In Progress column", narrations[2], async () => {
  await actor.circleAround('[data-testid="column-title-in-progress"]');
});

await step("Explain Code Review column", narrations[3], async () => {
  await actor.circleAround('[data-testid="column-title-code-review"]');
});

await step("Explain Done column", narrations[4], async () => {
  await actor.circleAround('[data-testid="column-title-done"]');
});

await step("Explain Released column", narrations[5], async () => {
  await actor.circleAround('[data-testid="column-title-released"]');
});

await step("Create task: Implement user authentication", narrations[6], async () => {
  await actor.circleAround('[data-testid="column-backlog"]');
  await addCard(actor, "backlog", "Implement user authentication");
});

await step("Create task: Write API tests", narrations[7], async () => {
  await addCard(actor, "backlog", "Write API tests");
});

await step("Create task: Update documentation", narrations[8], async () => {
  await addCard(actor, "backlog", "Update documentation");
});

await step("Start work on authentication task", narrations[9], async () => {
  await actor.circleAround('[data-testid="column-title-in-progress"]');
  await dragCardToColumn(actor, page, "Implement user authentication", "in-progress");
});

await step("Submit authentication for code review", narrations[10], async () => {
  await actor.circleAround('[data-testid="column-title-code-review"]');
  await dragCardToColumn(actor, page, "Implement user authentication", "code-review");
});

await step("Code review approved", narrations[11], async () => {
  await actor.circleAround('[data-testid="column-title-done"]');
  await dragCardToColumn(actor, page, "Implement user authentication", "done");
});

await step("Release authentication feature", narrations[12], async () => {
  await actor.circleAround('[data-testid="column-title-released"]');
  await dragCardToColumn(actor, page, "Implement user authentication", "released");
});

await step("Start work on API tests", narrations[13], async () => {
  await dragCardToColumn(actor, page, "Write API tests", "in-progress");
});

await step("Submit API tests for review", async () => {
  await dragCardToColumn(actor, page, "Write API tests", "code-review");
});

await step("API tests review approved", async () => {
  await dragCardToColumn(actor, page, "Write API tests", "done");
});

await step("Summary", narrations[14], async () => {
  await actor.circleAround('[data-testid="kanban-board"]');
});

const result = await session.finish();
console.log("Video:", result.video);
