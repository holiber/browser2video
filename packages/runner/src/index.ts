/**
 * @description Public API for the Browser2Video library.
 *
 * Primary usage:
 * ```ts
 * import { createSession } from "@browser2video/runner";
 *
 * const session = await createSession();
 * const { step } = session;
 * const { page, actor } = await session.openPage({ url: "https://example.com" });
 * await step("Do something", () => actor.click("button"));
 * await session.finish();
 * ```
 */

// Session API (primary)
export { createSession, Session } from "./session.js";

// Actor (cursor, clicks, typing, scrolling, drawing)
export { Actor, generateWebVTT } from "./actor.js";

// Standalone helpers for complex scenarios
export { startServer, type ManagedServer } from "./server-manager.js";
export { startSyncServer } from "./sync-server.js";

// Playwright re-export (escape hatch for advanced usage)
export { chromium, firefox, webkit } from "playwright";
export type { Page, Browser, BrowserContext, Locator, ElementHandle } from "playwright";

// Types
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
} from "./types.js";

// Narration
export type { NarrationOptions, AudioDirectorAPI, AudioEvent } from "./narrator.js";

// Shared utilities (less common, but available)
export { composeVideos } from "./video-compositor.js";
export { startScreenCapture, tryParseDisplaySize } from "./screen-capture.js";

// Legacy exports (backward compatibility — will be removed)
export { run } from "./unified-runner.js";
export { scenarioTest } from "./playwright-helper.js";
export type {
  ScenarioConfig,
  ScenarioContext,
  RunOptions,
  RunResult,
  BrowserPaneConfig,
  TerminalPaneConfig,
  PaneConfig,
  SyncConfig,
} from "./types.js";
