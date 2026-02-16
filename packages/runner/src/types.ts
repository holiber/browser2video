/**
 * @description Type definitions for the Browser2Video library.
 * Re-exports from @browser2video/lib (single source of truth)
 * plus runner-specific types that depend on Playwright.
 */
import type { Page } from "playwright";

// Re-export all shared types from lib
export type {
  Mode,
  RecordMode,
  DelayRange,
  ActorDelays,
  LayoutConfig,
  SessionOptions,
  PageOptions,
  TerminalOptions,
  SessionResult,
  StepRecord,
  ServerConfig,
} from "@browser2video/lib";

// Runner-specific types (depend on Playwright)

export interface TerminalHandle {
  /** Send text / command to the terminal process stdin. */
  send(text: string): Promise<void>;
  /** The browser page rendering this terminal (for assertions). */
  page: Page;
}
