/**
 * @description Public API for the Browser2Video library.
 *
 * Primary usage:
 * ```ts
 * import { createSession } from "browser2video";
 *
 * const session = await createSession();
 * const { step } = session;
 * const { page, actor } = await session.openPage({ url: "https://example.com" });
 * await step("Do something", () => actor.click("button"));
 * await session.finish();
 * ```
 */

// ---------------------------------------------------------------------------
//  Session API (primary)
// ---------------------------------------------------------------------------

export { createSession, Session } from "./session.ts";

// ---------------------------------------------------------------------------
//  Actor (cursor, clicks, typing, scrolling, drawing)
// ---------------------------------------------------------------------------

export { Actor, generateWebVTT } from "./actor.ts";
export { TerminalActor } from "./terminal-actor.ts";

// ---------------------------------------------------------------------------
//  Standalone helpers for complex scenarios
// ---------------------------------------------------------------------------

export { startServer, type ManagedServer } from "./server-manager.ts";

// ---------------------------------------------------------------------------
//  Playwright re-export (escape hatch for advanced usage)
// ---------------------------------------------------------------------------

export { chromium, firefox, webkit } from "playwright";
export type { Page, Browser, BrowserContext, Locator, ElementHandle } from "playwright";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type {
  SessionOptions,
  SessionResult,
  PageOptions,
  TerminalOptions,
  StepRecord,
  TerminalHandle,
  Mode,
  RecordMode,
  DelayRange,
  ActorDelays,
  LayoutConfig,
  ServerConfig,
} from "./types.ts";

// Narration
export type { NarrationOptions, AudioDirectorAPI, AudioEvent } from "./narrator.ts";

// Shared utilities (less common, but available)
export { composeVideos } from "./video-compositor.ts";
export { startScreenCapture, tryParseDisplaySize } from "./screen-capture.ts";

// ---------------------------------------------------------------------------
//  Schemas & operations registry (from former @browser2video/lib)
// ---------------------------------------------------------------------------

// Define-op helper
export { defineOp, type OpDef, type OpExample } from "./define-op.ts";

// Registry
export { ops, mcpTools, cliCommands, getOp, getOpsByCategory } from "./registry.ts";

// Schemas — common
export {
  ModeSchema,
  RecordModeSchema,
  DelayRangeSchema,
  ActorDelaysSchema,
  LayoutConfigSchema,
  ViewportSchema, type Viewport,
} from "./schemas/common.ts";

// Schemas — session
export {
  SessionOptionsSchema,
  PageOptionsSchema,
  TerminalOptionsSchema,
  StepRecordSchema,
  SessionResultSchema,
} from "./schemas/session.ts";

// Schemas — narration
export {
  NarrationOptionsSchema,
  SpeakOptionsSchema, type SpeakOptions,
  EffectOptionsSchema, type EffectOptions,
  AudioEventSchema,
} from "./schemas/narration.ts";

// Schemas — server
export {
  ServerConfigSchema,
  ManagedServerSchema,
} from "./schemas/server.ts";

// Tool-level schemas (used by CLI and MCP)
export {
  RunInputSchema, type RunInput,
  RunOutputSchema, type RunOutput,
  runTool, listTool, doctorTool,
} from "./ops/tools.ts";

// Ops by category (for advanced usage)
export { sessionOps } from "./ops/session.ts";
export { actorOps } from "./ops/actor.ts";
export { narrationOps } from "./ops/narration.ts";
export { serverOps } from "./ops/server.ts";
export { toolOps } from "./ops/tools.ts";
