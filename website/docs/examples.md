---
title: Video examples
---

## Collab scenario

This is a short demo generated from the built-in `collab` scenario.

<video
  controls
  muted
  playsInline
  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
  src="https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.mp4"
/>

Download: [`collab-demo.mp4`](https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.mp4)

<details>
  <summary>Show code</summary>

```ts
// tests/scenarios/collab-scenario.ts
import type { CollabScenarioContext } from "@browser2video/runner";
import type { Page } from "puppeteer";

const TASKS = ["create schemas", "add new note", "edit note"];
const EXTRA_TASKS = ["write tests", "deploy"];
const MORE_TASKS = ["add pagination", "setup CI/CD", "write API docs", "add dark mode", "fix login bug"];

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
    { timeout: 5000 },
    title,
  );
}

export async function collabScenario(ctx: CollabScenarioContext) {
  const { step, actorIds, actorNames, actors, pages, reviewerCmd } = ctx;

  const [creatorId, followerId] = actorIds;
  const creatorName = actorNames[creatorId] ?? creatorId;
  const followerName = actorNames[followerId] ?? followerId;

  const creator = actors[creatorId];
  const follower = actors[followerId];
  const creatorPage = pages[creatorId];
  const followerPage = pages[followerId];

  await step("both", "Verify both pages are ready", async () => {
    await creator.waitFor('[data-testid="notes-page"]');
    await follower.waitFor('[data-testid="notes-page"]');
  });

  for (const taskTitle of TASKS) {
    await step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      await creator.type('[data-testid="note-input"]', taskTitle);
      await sleep(160);
      await creator.click('[data-testid="note-add-btn"]');
    });

    await step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
      await sleep(300);
    });

    if (taskTitle === "add new note") {
      await step("both", 'Reviewer approves "add new note"', async () => {
        await reviewerCmd('APPROVE "add new note"');
        await sleep(300);
      });
    }

    await step(followerId, `${followerName} marks "${taskTitle}" completed`, async () => {
      const idx = await getIndexByTitle(followerPage, taskTitle);
      await follower.click(`[data-testid="note-check-${idx}"]`);
    });

    await step(creatorId, `${creatorName} sees "${taskTitle}" completed`, async () => {
      await creatorPage.waitForTimeout(250);
    });
  }

  for (const taskTitle of EXTRA_TASKS) {
    await step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      await creator.type('[data-testid="note-input"]', taskTitle);
      await sleep(120);
      await creator.click('[data-testid="note-add-btn"]');
    });
    await step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
    });
  }

  for (const taskTitle of MORE_TASKS) {
    await step(creatorId, `${creatorName} adds task: "${taskTitle}"`, async () => {
      await creator.type('[data-testid="note-input"]', taskTitle);
      await sleep(90);
      await creator.click('[data-testid="note-add-btn"]');
    });
    await step(followerId, `${followerName} sees "${taskTitle}" appear`, async () => {
      await waitForTitle(followerPage, taskTitle);
    });
  }
}
```

</details>

## Single-browser scenario (scrolling)

This is a single-page demo generated from the built-in `basic-ui` scenario (scrolling + drag + drawing).

<video
  controls
  muted
  playsInline
  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
  src="https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.mp4"
/>

Download: [`basic-ui-demo.mp4`](https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.mp4)

<details>
  <summary>Show code</summary>

```ts
// tests/scenarios/scenario.ts
import type { ScenarioContext } from "@browser2video/runner";

export async function basicUiScenario(ctx: ScenarioContext) {
  const { step, actor, baseURL } = ctx;

  await step("Open dashboard", async () => {
    await actor.goto(`${baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });

  await step("Fill full name", async () => {
    await actor.type('[data-testid="form-name"]', "Jane Doe");
  });

  await step("Fill email field", async () => {
    await actor.type('[data-testid="form-email"]', "jane@example.com");
  });

  await step("Toggle preferences", async () => {
    await actor.click('[data-testid="form-pref-updates"]');
    await actor.click('[data-testid="form-pref-analytics"]');
  });

  await step("Enable notifications", async () => {
    await actor.click('[data-testid="form-notifications"]');
  });

  await step("Scroll page down to scrollable area", async () => {
    await actor.scroll(null, 400);
  });

  await step("Scroll inside the scroll area", async () => {
    await actor.scroll('[data-testid="scroll-area"]', 600);
  });

  await step("Scroll page to drag section", async () => {
    await actor.scroll(null, 400);
  });

  await step("Reorder drag items", async () => {
    await actor.drag(
      '[data-testid="drag-item-task-1"]',
      '[data-testid="drag-item-task-3"]',
    );
  });

  await step("Scroll to node graph", async () => {
    await actor.scroll(null, 500);
  });

  await step("Connect Data Source to Transform", async () => {
    await actor.waitFor('[data-testid="flow-container"] .react-flow__node');
    await actor.drag(
      '.react-flow__node[data-id="source"] .react-flow__handle.source',
      '.react-flow__node[data-id="transform"] .react-flow__handle.target',
    );
  });

  await step("Connect Transform to Output", async () => {
    await actor.drag(
      '.react-flow__node[data-id="transform"] .react-flow__handle.source',
      '.react-flow__node[data-id="output"] .react-flow__handle.target',
    );
  });

  await step("Move Data Source node down", async () => {
    await actor.dragByOffset('.react-flow__node[data-id="source"]', 0, 80);
  });

  await step("Move Output node up", async () => {
    await actor.dragByOffset('.react-flow__node[data-id="output"]', 0, -60);
  });

  await step("Scroll to drawing section", async () => {
    await actor.scroll(null, 500);
  });

  await step("Select rectangle tool and draw", async () => {
    await actor.click('[data-testid="draw-tool-rectangle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      // Square
      { x: 0.35, y: 0.2 },
      { x: 0.75, y: 0.6 },
    ]);
  });

  await step("Draw a star inside the square", async () => {
    await actor.click('[data-testid="draw-tool-freehand"]');
    const cx = 0.55;
    const cy = 0.4;
    const rOuter = 0.14;
    const rInner = 0.06;
    const starPoints: Array<{ x: number; y: number }> = [];
    // 5-point star (10 segments). Close the shape by repeating the first point.
    for (let k = 0; k <= 10; k++) {
      const angle = (-Math.PI / 2) + (k * Math.PI) / 5;
      const r = k % 2 === 0 ? rOuter : rInner;
      starPoints.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    }
    await actor.draw('[data-testid="draw-canvas"]', starPoints);
  });

  await step("Draw a stickman on the left", async () => {
    await actor.click('[data-testid="draw-tool-circle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      // Head
      { x: 0.12, y: 0.22 },
      { x: 0.24, y: 0.36 },
    ]);

    await actor.click('[data-testid="draw-tool-freehand"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      // Start near neck
      { x: 0.18, y: 0.36 },
      // Left arm
      { x: 0.1, y: 0.44 },
      { x: 0.18, y: 0.4 },
      // Right arm
      { x: 0.26, y: 0.44 },
      { x: 0.18, y: 0.4 },
      // Body down
      { x: 0.18, y: 0.58 },
      // Left leg
      { x: 0.1, y: 0.72 },
      { x: 0.18, y: 0.58 },
      // Right leg
      { x: 0.26, y: 0.72 },
    ]);
  });
}
```

</details>

