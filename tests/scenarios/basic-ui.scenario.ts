/**
 * Basic UI scenario in defineScenario() format — compatible with b2v Player.
 * Demonstrates form, scroll, drag, node graph, and drawing interactions.
 */
import { defineScenario, startServer, type Actor } from "browser2video";

interface Ctx {
  actor: Actor;
}

export default defineScenario<Ctx>("Basic UI Demo", (s) => {
  s.setup(async (session) => {
    const server = await startServer({ type: "vite", root: "apps/demo" });
    if (!server) throw new Error("Failed to start Vite server");
    session.addCleanup(() => server.stop());
    const { actor } = await session.openPage({
      url: server.baseURL,
      viewport: { width: 650 },
    });
    return { actor };
  });

  s.step("Open dashboard", async ({ actor }) => {
    await actor.waitFor('[data-testid="app-page"]');
  });

  s.step("Fill form fields", async ({ actor }) => {
    await actor.type('[data-testid="form-name"]', "Jane Doe");
    await actor.type('[data-testid="form-email"]', "jane@example.com");
  });

  s.step("Configure preferences", async ({ actor }) => {
    await actor.click('[data-testid="form-pref-updates"]');
    await actor.click('[data-testid="form-pref-analytics"]');
    await actor.click('[data-testid="form-notifications"]');
  });

  s.step("Scroll page down", async ({ actor }) => {
    await actor.scroll(null, 400);
  });

  s.step("Scroll inside scroll area", async ({ actor }) => {
    await actor.scroll('[data-testid="scroll-area"]', 600);
  });

  s.step("Scroll to drag section", async ({ actor }) => {
    await actor.scroll(null, 400);
  });

  s.step("Reorder drag items", async ({ actor }) => {
    await actor.drag(
      '[data-testid="drag-item-task-1"]',
      '[data-testid="drag-item-task-3"]',
    );
  });

  s.step("Scroll to node graph", async ({ actor }) => {
    await actor.scroll(null, 500);
  });

  s.step("Connect Data Source to Transform", async ({ actor }) => {
    await actor.waitFor('[data-testid="flow-container"] .react-flow__node');
    await actor.drag(
      '.react-flow__node[data-id="source"] .react-flow__handle.source',
      '.react-flow__node[data-id="transform"] .react-flow__handle.target',
    );
  });

  s.step("Connect Transform to Output", async ({ actor }) => {
    await actor.drag(
      '.react-flow__node[data-id="transform"] .react-flow__handle.source',
      '.react-flow__node[data-id="output"] .react-flow__handle.target',
    );
  });

  s.step("Move Data Source node down", async ({ actor }) => {
    await actor.dragByOffset('.react-flow__node[data-id="source"]', 0, 80);
  });

  s.step("Move Output node up", async ({ actor }) => {
    await actor.dragByOffset('.react-flow__node[data-id="output"]', 0, -60);
  });

  s.step("Scroll to drawing section", async ({ actor }) => {
    await actor.scroll(null, 500);
  });

  s.step("Select rectangle tool and draw", async ({ actor }) => {
    await actor.click('[data-testid="draw-tool-rectangle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      { x: 0.35, y: 0.2 },
      { x: 0.75, y: 0.6 },
    ]);
  });

  s.step("Draw a star inside the square", async ({ actor }) => {
    await actor.click('[data-testid="draw-tool-freehand"]');
    const cx = 0.55, cy = 0.4, rOuter = 0.14, rInner = 0.06;
    const starPoints: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 10; k++) {
      const angle = (-Math.PI / 2) + (k * Math.PI) / 5;
      const r = k % 2 === 0 ? rOuter : rInner;
      starPoints.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    await actor.draw('[data-testid="draw-canvas"]', starPoints);
  });

  s.step("Draw a stickman", async ({ actor }) => {
    await actor.click('[data-testid="draw-tool-circle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      { x: 0.12, y: 0.22 },
      { x: 0.24, y: 0.36 },
    ]);
    await actor.click('[data-testid="draw-tool-freehand"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      { x: 0.18, y: 0.36 }, { x: 0.1, y: 0.44 },
      { x: 0.18, y: 0.4 },  { x: 0.26, y: 0.44 },
      { x: 0.18, y: 0.4 },  { x: 0.18, y: 0.58 },
      { x: 0.1, y: 0.72 },  { x: 0.18, y: 0.58 },
      { x: 0.26, y: 0.72 },
    ]);
  });
});
