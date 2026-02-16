/**
 * @description Session-level schemas (options, results, step records).
 */
import { z } from "zod";
import { ModeSchema, LayoutConfigSchema, ActorDelaysSchema, ViewportSchema } from "./common.ts";
import { NarrationOptionsSchema, AudioEventSchema } from "./narration.ts";

export const SessionOptionsSchema = z.object({
  mode: ModeSchema.optional().describe("Execution mode. Default: B2V_MODE env, or 'fast' under Playwright, or 'human'."),
  record: z.boolean().optional().describe("Enable video recording. Default: false under Playwright, true otherwise."),
  outputDir: z.string().optional().describe("Output directory for video/subtitles/metadata. Default: auto-generated."),
  headed: z.boolean().optional().describe("Force headed/headless browser. Default: headed in human, headless in fast."),
  layout: LayoutConfigSchema.optional().describe("Layout for multi-pane video composition. Default: 'row'."),
  delays: ActorDelaysSchema.partial().optional().describe("Override actor timing delays."),
  ffmpegPath: z.string().optional().describe("Path to ffmpeg binary. Default: 'ffmpeg'."),
  screenIndex: z.number().int().optional().describe("macOS screen index for screen recording."),
  display: z.string().optional().describe("Linux DISPLAY for screen recording."),
  displaySize: z.string().optional().describe("Linux display size, e.g. '2560x720'."),
  narration: NarrationOptionsSchema.optional().describe("TTS narration options."),
});

export type SessionOptions = z.infer<typeof SessionOptionsSchema>;

export const PageOptionsSchema = z.object({
  url: z.string().optional().describe("URL to navigate to (external or local)."),
  viewport: ViewportSchema.optional().describe("Viewport dimensions. Default: 1280x720."),
  label: z.string().optional().describe("Label shown in logs and subtitles."),
});

export type PageOptions = z.infer<typeof PageOptionsSchema>;

export const TerminalOptionsSchema = z.object({
  command: z.string().optional().describe("Shell command to run."),
  viewport: ViewportSchema.optional().describe("Viewport dimensions. Default: 800x600."),
  label: z.string().optional().describe("Label shown in logs and subtitles."),
});

export type TerminalOptions = z.infer<typeof TerminalOptionsSchema>;

export const StepRecordSchema = z.object({
  index: z.number().int().describe("1-based step number."),
  caption: z.string().describe("Step description text."),
  startMs: z.number().describe("Start time relative to session start (ms)."),
  endMs: z.number().describe("End time relative to session start (ms)."),
  paneId: z.string().optional().describe("ID of the pane this step ran in."),
});

export type StepRecord = z.infer<typeof StepRecordSchema>;

export const SessionResultSchema = z.object({
  video: z.string().optional().describe("Path to the composed video (undefined if recording was off)."),
  subtitles: z.string().describe("Path to the WebVTT subtitles file."),
  metadata: z.string().describe("Path to the JSON metadata file."),
  artifactDir: z.string().describe("Output directory containing all artifacts."),
  durationMs: z.number().describe("Total scenario duration in milliseconds."),
  steps: z.array(StepRecordSchema).describe("Recorded steps with timestamps."),
  audioEvents: z.array(AudioEventSchema).optional().describe("Audio narration events (if narration was enabled)."),
});

export type SessionResult = z.infer<typeof SessionResultSchema>;
