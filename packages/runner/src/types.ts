/**
 * @description Type definitions for the unified Browser2Video scenario runner.
 */
import type { Page } from "playwright";
import type { AudioDirectorAPI, AudioEvent, NarrationOptions } from "./narrator.js";

// ---------------------------------------------------------------------------
//  Core types (shared by old & new runner code)
// ---------------------------------------------------------------------------

export type Mode = "human" | "fast";
export type RecordMode = "screencast" | "screen" | "none";
export type DelayRange = readonly [minMs: number, maxMs: number];

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
  selectOpenMs: DelayRange;
  selectOptionMs: DelayRange;
  afterDragMs: DelayRange;
}

export interface StepRecord {
  index: number;
  caption: string;
  startMs: number;
  endMs: number;
  /** Pane that performed the step (or "all" for multi-pane steps). */
  paneId?: string;
}

export interface RunResult {
  mode: Mode;
  recordMode: RecordMode;
  videoPath?: string;
  subtitlesPath: string;
  metadataPath: string;
  steps: StepRecord[];
  durationMs: number;
  audioEvents?: AudioEvent[];
}

// ---------------------------------------------------------------------------
//  Scenario config — exported from *.scenario.ts files
// ---------------------------------------------------------------------------

/** Server configuration — how to start the web server. */
export type ServerConfig =
  | { type: "vite"; root: string; port?: number }
  | { type: "next"; root: string; port?: number }
  | { type: "command"; cmd: string; port: number; readyPattern?: string }
  | { type: "static"; root: string; port?: number };

/** Browser pane — a separate Playwright browser context / page. */
export interface BrowserPaneConfig {
  id: string;
  type: "browser";
  /** Absolute URL — for internet pages, no server needed. */
  url?: string;
  /** Relative path — appended to the server baseURL. */
  path?: string;
  label?: string;
  viewport?: { width?: number; height?: number };
}

/** Terminal pane — rendered in a browser page with terminal styling. */
export interface TerminalPaneConfig {
  id: string;
  type: "terminal";
  /**
   * Command to run. String = static command, function = late-bound
   * (called once sync info is available).
   */
  command?: string | ((ctx: { syncWsUrl?: string; baseURL?: string; docUrl?: string }) => string);
  label?: string;
  viewport?: { width?: number; height?: number };
}

export type PaneConfig = BrowserPaneConfig | TerminalPaneConfig;

/** Sync config for collaborative (Automerge) scenarios. */
export interface SyncConfig {
  type: "automerge";
  wsUrl?: string;
}

/** How to lay out multiple panes. */
export type LayoutConfig = "auto" | "row" | "grid" | { cols: number };

/** Top-level scenario config — exported as `config` from scenario files. */
export interface ScenarioConfig {
  /** Server to start (omit for external URLs). */
  server?: ServerConfig | null;
  /** Panes to display: browser windows, terminals, etc. */
  panes: PaneConfig[];
  /** Sync for collaborative scenarios. */
  sync?: SyncConfig;
  /** Layout mode (default: "auto"). */
  layout?: LayoutConfig;
  /** Show server logs in a terminal pane (default: true when server is set). */
  serverLogs?: boolean | "hidden";
}

// ---------------------------------------------------------------------------
//  Terminal handle — returned by ctx.terminal(id)
// ---------------------------------------------------------------------------

export interface TerminalHandle {
  /** Send text / command to the terminal process stdin. */
  send(text: string): Promise<void>;
  /** The browser page rendering this terminal (for assertions). */
  page: Page;
}

// ---------------------------------------------------------------------------
//  Unified scenario context — replaces both ScenarioContext and
//  CollabScenarioContext from the old runners.
// ---------------------------------------------------------------------------

export interface ScenarioContext {
  /** Get the Actor for a browser pane. */
  actor(paneId: string): import("./actor.js").Actor;
  /** Get the Playwright Page for any pane (browser or terminal). */
  page(paneId: string): Page;
  /** Get a terminal handle for sending commands. */
  terminal(paneId: string): TerminalHandle;
  /** Track a step. */
  step(paneId: string | "all", caption: string, fn: () => Promise<void>): Promise<void>;
  /** Audio director for narration and sound effects. */
  audio: AudioDirectorAPI;
  /** Base URL of the started server (if any). */
  baseURL?: string;
  /** All pane IDs in display order. */
  paneIds: readonly string[];
  /** Sync WebSocket URL (when sync is configured). */
  syncWsUrl?: string;
  /** Automerge document URL from first browser pane. */
  docUrl?: string;
}

// ---------------------------------------------------------------------------
//  Run options — passed alongside config to the unified run()
// ---------------------------------------------------------------------------

export interface RunOptions {
  mode: Mode;
  /** Override server baseURL (skip server start). */
  baseURL?: string;
  artifactDir: string;
  recordMode?: RecordMode;
  ffmpegPath?: string;
  headless?: boolean;
  delays?: Partial<ActorDelays>;
  devtools?: boolean;
  /** macOS screen index for screen recording. */
  screenIndex?: number;
  /** Linux DISPLAY for screen recording. */
  display?: string;
  /** Linux display size for screen recording. */
  displaySize?: string;
  narration?: NarrationOptions;
  debugOverlay?: boolean;
  userDataDir?: string;
  executablePath?: string;
}
