/**
 * @description Actor operations — browser interaction methods.
 */
import { z } from "zod";
import { defineOp } from "../define-op.ts";

const selectorInput = z.object({
  selector: z.string().describe("CSS selector for the target element."),
});

export const actorGoto = defineOp({
  name: "actor.goto",
  category: "actor",
  summary: "Navigate to a URL.",
  description: "Navigates the page and waits for network idle. The cursor overlay is auto-injected after navigation in human mode.",
  input: z.object({ url: z.string().describe("URL to navigate to.") }),
  output: z.void(),
  examples: [{ title: "Navigate", code: 'await actor.goto("https://example.com");' }],
  tags: ["navigation"],
});

export const actorWaitFor = defineOp({
  name: "actor.waitFor",
  category: "actor",
  summary: "Wait for an element to appear.",
  description: "Waits until the element matching the selector is visible in the DOM.",
  input: z.object({
    selector: z.string().describe("CSS selector to wait for."),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 3000)."),
  }),
  output: z.void(),
  examples: [{ title: "Wait for button", code: 'await actor.waitFor("button.submit");' }],
  tags: ["assertion"],
});

export const actorClick = defineOp({
  name: "actor.click",
  category: "actor",
  summary: "Click on an element.",
  description:
    "Moves the cursor to the element center using WindMouse physics and clicks. " +
    "In human mode, a ripple click effect is shown and the mouse button is held briefly.",
  input: selectorInput,
  output: z.void(),
  examples: [{ title: "Click a button", code: 'await actor.click("button.submit");' }],
  tags: ["interaction"],
});

export const actorType = defineOp({
  name: "actor.type",
  category: "actor",
  summary: "Type text into an element.",
  description:
    "Clicks the element to focus it, then types text character by character in human mode " +
    "(with word-boundary pauses) or instantly in fast mode.",
  input: z.object({
    selector: z.string().describe("CSS selector for the input element."),
    text: z.string().describe("Text to type."),
  }),
  output: z.void(),
  examples: [{ title: "Type into input", code: 'await actor.type("#email", "user@example.com");' }],
  tags: ["interaction"],
});

export const actorSelectOption = defineOp({
  name: "actor.selectOption",
  category: "actor",
  summary: "Select a dropdown option.",
  description: "Opens a dropdown by clicking the trigger, then finds and clicks the option with matching text.",
  input: z.object({
    triggerSelector: z.string().describe("CSS selector for the dropdown trigger."),
    valueText: z.string().describe("Visible text of the option to select."),
  }),
  output: z.void(),
  examples: [{ title: "Select country", code: 'await actor.selectOption("#country", "Japan");' }],
  tags: ["interaction"],
});

export const actorScroll = defineOp({
  name: "actor.scroll",
  category: "actor",
  summary: "Scroll an element or the page.",
  description:
    "Scrolls within the matched element (auto-detecting scrollable children and Radix scroll areas) " +
    "or the page itself if selector is null. Uses smooth scrolling in human mode.",
  input: z.object({
    selector: z.string().nullable().describe("CSS selector for the scroll container, or null for page scroll."),
    deltaY: z.number().describe("Scroll amount in pixels (positive = down)."),
  }),
  output: z.void(),
  examples: [
    { title: "Scroll page", code: "await actor.scroll(null, 400);" },
    { title: "Scroll element", code: 'await actor.scroll(".content", 200);' },
  ],
  tags: ["interaction"],
});

export const actorDrag = defineOp({
  name: "actor.drag",
  category: "actor",
  summary: "Drag from one element to another.",
  description:
    "Moves the cursor to the source element, presses the mouse, drags to the target element " +
    "with smooth linear interpolation, then releases.",
  input: z.object({
    fromSelector: z.string().describe("CSS selector for the drag source."),
    toSelector: z.string().describe("CSS selector for the drop target."),
  }),
  output: z.void(),
  examples: [{ title: "Drag item", code: 'await actor.drag("#item-1", "#drop-zone");' }],
  tags: ["interaction"],
});

export const actorDragByOffset = defineOp({
  name: "actor.dragByOffset",
  category: "actor",
  summary: "Drag an element by a pixel offset.",
  description: "Grabs the element and drags it by the specified dx/dy pixel offset, then releases.",
  input: z.object({
    selector: z.string().describe("CSS selector for the element to drag."),
    dx: z.number().describe("Horizontal offset in pixels."),
    dy: z.number().describe("Vertical offset in pixels."),
  }),
  output: z.void(),
  examples: [{ title: "Drag right 100px", code: 'await actor.dragByOffset(".slider", 100, 0);' }],
  tags: ["interaction"],
});

export const actorDraw = defineOp({
  name: "actor.draw",
  category: "actor",
  summary: "Draw on a canvas.",
  description:
    "Draws a path on a canvas element. Points use 0–1 normalized coordinates relative to the canvas bounds. " +
    "In human mode, segments are interpolated with smooth easing.",
  input: z.object({
    canvasSelector: z.string().describe("CSS selector for the canvas element."),
    points: z.array(z.object({
      x: z.number().min(0).max(1).describe("Normalized X (0 = left, 1 = right)."),
      y: z.number().min(0).max(1).describe("Normalized Y (0 = top, 1 = bottom)."),
    })).describe("Array of normalized points defining the path."),
  }),
  output: z.void(),
  examples: [{
    title: "Draw a line",
    code: 'await actor.draw("canvas", [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }]);',
  }],
  tags: ["interaction"],
});

export const actorCircleAround = defineOp({
  name: "actor.circleAround",
  category: "actor",
  summary: "Circle the cursor around an element.",
  description:
    "Draws a spiral path (1.5 rotations) around the element, like a presenter circling " +
    "something on a whiteboard. Radius grows from 0.7x to 1.0x with slight noise for " +
    "human imperfection. Duration auto-scales with element size. No-op in fast mode.",
  input: z.object({
    selector: z.string().describe("CSS selector for the element to circle."),
    durationMs: z.number().optional().describe("Override the auto-calculated duration."),
  }),
  output: z.void(),
  examples: [{ title: "Circle a heading", code: 'await actor.circleAround("h1.title");' }],
  tags: ["interaction", "visual"],
});

export const actorBreathe = defineOp({
  name: "actor.breathe",
  category: "actor",
  summary: "Add a breathing pause.",
  description: "Inserts a short pause between major steps for natural pacing. No-op in fast mode.",
  input: z.void(),
  output: z.void(),
  examples: [{ title: "Pause", code: "await actor.breathe();" }],
  tags: ["pacing"],
});

export const actorInjectCursor = defineOp({
  name: "actor.injectCursor",
  category: "actor",
  summary: "Inject the cursor overlay.",
  description: "Injects the SVG cursor overlay and click-ripple effect into the page. Called automatically after navigation in human mode.",
  input: z.void(),
  output: z.void(),
  tags: ["internal"],
});

export const actorMoveCursorTo = defineOp({
  name: "actor.moveCursorTo",
  category: "actor",
  summary: "Move cursor to specific coordinates.",
  description: "Moves the cursor smoothly to the given (x, y) coordinates using WindMouse physics. Useful when interacting with Playwright APIs directly.",
  input: z.object({
    x: z.number().describe("Target X coordinate."),
    y: z.number().describe("Target Y coordinate."),
  }),
  output: z.void(),
  tags: ["interaction"],
});

export const actorClickLocator = defineOp({
  name: "actor.clickLocator",
  category: "actor",
  summary: "Click a Playwright Locator.",
  description: "Moves the cursor to a Playwright Locator's center and clicks it. Useful when working with Playwright's Locator API directly.",
  input: z.object({
    locator: z.any().describe("Playwright Locator instance."),
  }),
  output: z.void(),
  tags: ["interaction"],
});

export const actorOps = [
  actorGoto, actorWaitFor, actorClick, actorType, actorSelectOption,
  actorScroll, actorDrag, actorDragByOffset, actorDraw,
  actorCircleAround, actorBreathe, actorInjectCursor,
  actorMoveCursorTo, actorClickLocator,
] as const;
