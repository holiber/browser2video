/**
 * @description Type definitions for the Browser2Video library.
 */
import type { Page } from "playwright";
import type { AudioEvent, NarrationOptions } from "./narrator.js";

// ---------------------------------------------------------------------------
//  Core primitives
// ---------------------------------------------------------------------------

export type Mode = "human" | "fast";
export type RecordMode = "screencast" | "screen" | "none";
export type DelayRange = readonly [minMs: number, maxMs: number];
export type LayoutConfig = "auto" | "row" | "grid" | { cols: number };

export interface ActorDelays {
  breatheMs: DelayRange;
  afterScrollIntoViewMs: DelayRange;
  mouseMoveStepMs: DelayRange;
  clickEffectMs: DelayRange;
  clickHoldMs: DelayRange;
  afterClickMs: DelayRange;
  beforeTypeMs: DelayRange;
  keyDelayMs: DelayRange;
  keyBoundaryPauseMs: DelayRange;
  afterTypeMs: DelayRange;
  selectOpenMs: DelayRange;
  selectOptionMs: DelayRange;
  afterDragMs: DelayRange;
}

export interface StepRecord {
  index: number;
  caption: string;
  startMs: number;
  endMs: number;
  paneId?: string;
}

// ---------------------------------------------------------------------------
//  Session API types (new)
// ---------------------------------------------------------------------------

export interface SessionOptions {
  /** Execution mode. Default: B2V_MODE env, or "fast" under Playwright, or "human". */
  mode?: Mode;
  /** Enable video recording. Default: B2V_RECORD env, or false under Playwright, or true. */
  record?: boolean;
  /** Output directory for video/subtitles/metadata. Default: auto-generated. */
  outputDir?: string;
  /** Force headed/headless browser. Default: headed in human, headless in fast. */
  headed?: boolean;
  /** Layout for multi-pane video composition. Default: "row". */
  layout?: LayoutConfig;
  /** Override actor delays. */
  delays?: Partial<ActorDelays>;
  /** Path to ffmpeg binary. Default: "ffmpeg". */
  ffmpegPath?: string;
  /** macOS screen index for screen recording. */
  screenIndex?: number;
  /** Linux DISPLAY for screen recording. */
  display?: string;
  /** Linux display size for screen recording, e.g. "2560x720". */
  displaySize?: string;
  /** TTS narration options. */
  narration?: NarrationOptions;
}

export interface PageOptions {
  /** URL to navigate to (external or local). */
  url?: string;
  /** Viewport dimensions. Default: 1280x720. */
  viewport?: { width?: number; height?: number };
  /** Label shown in logs and subtitles. */
  label?: string;
}

export interface TerminalOptions {
  /** Shell command to run. */
  command?: string;
  /** Viewport dimensions. Default: 800x600. */
  viewport?: { width?: number; height?: number };
  /** Label shown in logs and subtitles. */
  label?: string;
}

export interface SessionResult {
  /** Path to the composed video (undefined if recording was off). */
  video?: string;
  /** Path to the WebVTT subtitles file. */
  subtitles: string;
  /** Path to the JSON metadata file. */
  metadata: string;
  /** Output directory containing all artifacts. */
  artifactDir: string;
  /** Total scenario duration in milliseconds. */
  durationMs: number;
  /** Recorded steps with timestamps. */
  steps: StepRecord[];
  /** Audio narration events (if narration was enabled). */
  audioEvents?: AudioEvent[];
}

// ---------------------------------------------------------------------------
//  Terminal handle
// ---------------------------------------------------------------------------

export interface TerminalHandle {
  /** Send text / command to the terminal process stdin. */
  send(text: string): Promise<void>;
  /** The browser page rendering this terminal (for assertions). */
  page: Page;
}

// ---------------------------------------------------------------------------
//  Server config (used by startServer helper)
// ---------------------------------------------------------------------------

export type ServerConfig =
  | { type: "vite"; root: string; port?: number }
  | { type: "next"; root: string; port?: number }
  | { type: "command"; cmd: string; port: number; readyPattern?: string }
  | { type: "static"; root: string; port?: number };
