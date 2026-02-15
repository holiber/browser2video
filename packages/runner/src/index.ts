/**
 * @description Public API for Browser2Video runner library.
 */

// Unified runner (new API)
export { run } from "./unified-runner.js";
export { scenarioTest } from "./playwright-helper.js";

// Types
export type {
  ScenarioConfig,
  ScenarioContext,
  RunOptions,
  RunResult,
  StepRecord,
  TerminalHandle,
  BrowserPaneConfig,
  TerminalPaneConfig,
  PaneConfig,
  ServerConfig,
  SyncConfig,
  LayoutConfig,
  Mode,
  RecordMode,
  DelayRange,
  ActorDelays,
} from "./types.js";

// Actor & utilities
export { Actor, generateWebVTT } from "./actor.js";

// Shared modules
export * from "./window-layout.js";
export * from "./narrator.js";
export * from "./screen-capture.js";
export * from "./server-manager.js";
export * from "./sync-server.js";
export * from "./video-compositor.js";
