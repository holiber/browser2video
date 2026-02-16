/**
 * @description Core primitive schemas shared across the API.
 */
import { z } from "zod";

export const ModeSchema = z
  .enum(["human", "fast"])
  .describe("Execution speed mode. 'human' adds realistic delays and animations; 'fast' skips them.");

export type Mode = z.infer<typeof ModeSchema>;

export const RecordModeSchema = z
  .enum(["screencast", "screen", "none"])
  .describe("Video recording backend.");

export type RecordMode = z.infer<typeof RecordModeSchema>;

export const DelayRangeSchema = z
  .tuple([z.number().describe("minMs"), z.number().describe("maxMs")])
  .readonly()
  .describe("Delay range [minMs, maxMs] — the midpoint is used.");

export type DelayRange = z.infer<typeof DelayRangeSchema>;

export const ActorDelaysSchema = z.object({
  breatheMs: DelayRangeSchema.describe("Pause between major steps."),
  afterScrollIntoViewMs: DelayRangeSchema.describe("Pause after scrolling an element into view."),
  mouseMoveStepMs: DelayRangeSchema.describe("Delay per cursor-path point."),
  clickEffectMs: DelayRangeSchema.describe("Duration of the click ripple effect."),
  clickHoldMs: DelayRangeSchema.describe("How long the mouse button is held down."),
  afterClickMs: DelayRangeSchema.describe("Pause after a click."),
  beforeTypeMs: DelayRangeSchema.describe("Pause before typing begins."),
  keyDelayMs: DelayRangeSchema.describe("Delay between keystrokes."),
  keyBoundaryPauseMs: DelayRangeSchema.describe("Extra pause at word boundaries (space, @, .)."),
  afterTypeMs: DelayRangeSchema.describe("Pause after typing finishes."),
  selectOpenMs: DelayRangeSchema.describe("Pause after opening a select dropdown."),
  selectOptionMs: DelayRangeSchema.describe("Pause before clicking a dropdown option."),
  afterDragMs: DelayRangeSchema.describe("Pause after a drag-and-drop."),
});

export type ActorDelays = z.infer<typeof ActorDelaysSchema>;

export const LayoutConfigSchema = z.union([
  z.literal("auto").describe("Automatically choose layout based on pane count."),
  z.literal("row").describe("Side-by-side horizontal layout."),
  z.literal("grid").describe("Grid layout."),
  z.object({ cols: z.number().int().positive().describe("Number of columns in a custom grid.") }),
]).describe("Layout for multi-pane video composition.");

export type LayoutConfig = z.infer<typeof LayoutConfigSchema>;

export const ViewportSchema = z.object({
  width: z.number().int().positive().optional().describe("Viewport width in pixels."),
  height: z.number().int().positive().optional().describe("Viewport height in pixels."),
}).describe("Browser viewport dimensions.");

export type Viewport = z.infer<typeof ViewportSchema>;
