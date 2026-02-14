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
      { x: 0.1, y: 0.15 },
      { x: 0.45, y: 0.55 },
    ]);
  });

  await step("Draw a freehand stroke", async () => {
    await actor.click('[data-testid="draw-tool-freehand"]');
    const wavePoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 20; i++) {
      wavePoints.push({
        x: 0.5 + (i / 20) * 0.4,
        y: 0.4 + Math.sin((i / 20) * Math.PI * 2) * 0.15,
      });
    }
    await actor.draw('[data-testid="draw-canvas"]', wavePoints);
  });

  await step("Draw a circle", async () => {
    await actor.click('[data-testid="draw-tool-circle"]');
    await actor.draw('[data-testid="draw-canvas"]', [
      { x: 0.55, y: 0.1 },
      { x: 0.85, y: 0.45 },
    ]);
  });
}
