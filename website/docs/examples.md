---
title: Video examples
---

## Kanban board with narration

A narrated walkthrough of a Kanban board task lifecycle. The narrator explains each column while the cursor highlights it.

<video
  controls
  muted
  playsInline
  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
  src="https://github.com/holiber/browser2video/releases/download/examples-v3/kanban-demo.mp4"
/>

<details>
  <summary>Show code</summary>

```ts
import { createSession, startServer } from "@browser2video/runner";

const server = await startServer({ type: "vite", root: "apps/demo" });
const session = await createSession({ narration: { enabled: true } });
const { step } = session;
const { page, actor } = await session.openPage({
  url: `${server.baseURL}/kanban`,
  viewport: { width: 1060, height: 720 },
});

await step("Open Kanban board",
  "Welcome! Let me walk you through this Kanban board.",
  async () => {
    await actor.waitFor('[data-testid="kanban-board"]');
  },
);

await step("Explain Backlog column",
  "The Backlog column holds all planned work.",
  async () => {
    await actor.circleAround('[data-testid="column-title-backlog"]');
  },
);

// ... more steps ...

await session.finish();
server.close();
```

</details>

## Collaborative todo list

Two browser windows sharing a real-time synced todo list, with a terminal reviewer approving items.

<video
  controls
  muted
  playsInline
  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
  src="https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.mp4"
/>

<details>
  <summary>Show code</summary>

```ts
import { createSession, startServer, startSyncServer } from "@browser2video/runner";

const server = await startServer({ type: "vite", root: "apps/demo" });
const sync = await startSyncServer();
const session = await createSession({ layout: "row" });
const { step } = session;

const boss = await session.openPage({
  url: `${server.baseURL}/notes?sync=${sync.wsUrl}&name=Boss`,
  viewport: { width: 500, height: 720 },
  label: "Boss",
});

const worker = await session.openPage({
  url: `${server.baseURL}/notes?sync=${sync.wsUrl}&name=Worker`,
  viewport: { width: 500, height: 720 },
  label: "Worker",
});

const { terminal } = await session.openTerminal({
  command: "node packages/runner/src/reviewer-cli.js",
  viewport: { width: 460, height: 720 },
  label: "Reviewer",
});

await step("Boss adds a task", async () => {
  await boss.actor.type('[data-testid="note-input"]', "Write tests");
  await boss.actor.click('[data-testid="note-add-btn"]');
});

// ... more steps ...

await session.finish();
```

</details>

## Basic UI interactions

Scrolling, drag-and-drop, canvas drawing, form inputs, and React Flow nodes.

<video
  controls
  muted
  playsInline
  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
  src="https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.mp4"
/>

<details>
  <summary>Show code</summary>

```ts
import { createSession, startServer } from "@browser2video/runner";

const server = await startServer({ type: "vite", root: "apps/demo" });
const session = await createSession();
const { step } = session;
const { page, actor } = await session.openPage({
  url: `${server.baseURL}/`,
  viewport: { width: 650, height: 720 },
});

await step("Fill form", async () => {
  await actor.type('[data-testid="form-name"]', "Jane Doe");
  await actor.type('[data-testid="form-email"]', "jane@example.com");
});

await step("Scroll and drag", async () => {
  await actor.scroll(null, 400);
  await actor.drag('[data-testid="drag-item-task-1"]', '[data-testid="drag-item-task-3"]');
});

await step("Draw on canvas", async () => {
  await actor.scroll(null, 500);
  await actor.click('[data-testid="draw-tool-freehand"]');
  await actor.draw('[data-testid="draw-canvas"]', [
    { x: 0.2, y: 0.3 }, { x: 0.5, y: 0.1 }, { x: 0.8, y: 0.5 },
  ]);
});

await session.finish();
server.close();
```

</details>

**[Auto-generated scenario videos](https://holiber.github.io/browser2video/videos/)**
