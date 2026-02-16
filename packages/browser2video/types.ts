/**
 * @description Type definitions for the Browser2Video library.
 * Re-exports from local schemas (single source of truth)
 * plus runner-specific types that depend on Playwright.
 */
import type { Page } from "playwright";

// Re-export all shared types from schemas
export type {
  Mode,
  RecordMode,
  DelayRange,
  ActorDelays,
  LayoutConfig,
} from "./schemas/common.ts";

export type {
  SessionOptions,
  PageOptions,
  TerminalOptions,
  SessionResult,
  StepRecord,
} from "./schemas/session.ts";

export type {
  ServerConfig,
} from "./schemas/server.ts";

// Runner-specific types (depend on Playwright)

export interface TerminalHandle {
  /** Send text / command to the terminal process stdin. */
  send(text: string): Promise<void>;
  /** The browser page rendering this terminal (for assertions). */
  page: Page;
}
