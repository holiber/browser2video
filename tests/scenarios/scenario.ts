/**
 * @description Demo scenario exercising form, scroll, drag, node graph, and drawing.
 * Shared by both human and fast modes — the Actor handles mode differences.
 */
import type { ScenarioContext } from "@browser2video/runner";

export async function basicUiScenario(ctx: ScenarioContext) {
  const { step, actor, page, baseURL } = ctx;

  // ------------------------------------------------------------------
  //  1. Open dashboard
  // ------------------------------------------------------------------

  await step("Open dashboard", async () => {
    await actor.goto(`${baseURL}/`);
    await actor.waitFor('[data-testid="app-page"]');
  });

  // ------------------------------------------------------------------
  //  2. Fill the demo form
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  //  3. Scroll
  // ------------------------------------------------------------------

  await step("Scroll page down to scrollable area", async () => {
    await actor.scroll(null, 400);
  });

  await step("Scroll inside the scroll area", async () => {
    await actor.scroll('[data-testid="scroll-area"]', 600);
  });

  await step("Scroll page to drag section", async () => {
    await actor.scroll(null, 400);
  });

  // ------------------------------------------------------------------
  //  4. Drag & Drop
  // ------------------------------------------------------------------

  await step("Reorder drag items", async () => {
    await actor.drag(
      '[data-testid="drag-item-task-1"]',
      '[data-testid="drag-item-task-3"]',
    );
  });

  // ------------------------------------------------------------------
  //  5. Node Graph (React Flow)
  // ------------------------------------------------------------------

  await step("Scroll to node graph", async () => {
    await actor.scroll(null, 500);
  });

  await step("Connect Data Source to Transform", async () => {
    // Wait for React Flow to render
    await actor.waitFor('[data-testid="flow-container"] .react-flow__node');
    // Drag from source handle of "source" node to target handle of "transform" node
    // In @xyflow/react v12, handle type is a plain class: .source / .target
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

  // ------------------------------------------------------------------
  //  6. Drawing
  // ------------------------------------------------------------------

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
