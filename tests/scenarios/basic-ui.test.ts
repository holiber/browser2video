/**
 * Demo scenario exercising form, scroll, drag, node graph, and drawing.
 * Uses the local demo app started via startServer().
 */
import { fileURLToPath } from "url";
import { createSession, startServer } from "@browser2video/runner";

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");

  const session = await createSession();
  const { step } = session;
  const { page, actor } = await session.openPage({ url: server.baseURL, viewport: { width: 650 } });

  try {
    await step("Open dashboard", async () => {
      await actor.goto(`${server.baseURL}/`);
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
        { x: 0.12, y: 0.22 },
        { x: 0.24, y: 0.36 },
      ]);

      await actor.click('[data-testid="draw-tool-freehand"]');
      await actor.draw('[data-testid="draw-canvas"]', [
        { x: 0.18, y: 0.36 },
        { x: 0.1, y: 0.44 },
        { x: 0.18, y: 0.4 },
        { x: 0.26, y: 0.44 },
        { x: 0.18, y: 0.4 },
        { x: 0.18, y: 0.58 },
        { x: 0.1, y: 0.72 },
        { x: 0.18, y: 0.58 },
        { x: 0.26, y: 0.72 },
      ]);
    });

    await session.finish();
  } finally {
    await server.stop();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("basic-ui", scenario);
}
