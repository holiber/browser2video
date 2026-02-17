/**
 * @description TerminalActor — scoped actor for interacting with a terminal pane.
 * All methods are selector-free: the actor knows which terminal it controls.
 * Created by session.createTerminal().
 */
import type { Page } from "playwright";
import type { Mode, ActorDelays } from "./types.ts";
import { Actor, pickMs } from "./actor.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class TerminalActor extends Actor {
  /** CSS selector for the terminal container element */
  readonly selector: string;

  /** Watermark for readNew() — tracks lines already returned */
  private _readWatermark = 0;

  constructor(
    page: Page,
    mode: Mode,
    selector: string,
    opts?: { delays?: Partial<ActorDelays> },
  ) {
    super(page, mode, opts);
    this.selector = selector;
  }

  // ─── Overrides (selector-free) ────────────────────────────────────

  /**
   * Click at a relative position within the terminal, or click a CSS selector.
   * @param relX  Horizontal position (0-1, left to right)
   * @param relY  Vertical position (0-1, top to bottom)
   */
  async click(selector: string): Promise<void>;
  async click(relX: number, relY: number): Promise<void>;
  async click(relXOrSelector: string | number, relY?: number): Promise<void> {
    if (typeof relXOrSelector === "string") {
      // Delegate to parent Actor.click(selector) for regular CSS selector clicks
      return super.click(relXOrSelector);
    }
    const box = await this.page.$eval(this.selector, (el: any) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const x = Math.round(box.x + box.width * relXOrSelector);
    const y = Math.round(box.y + box.height * (relY ?? 0.5));
    await this.clickAt(x, y);
  }

  /**
   * Type text into this terminal.
   * Newlines are sent as Enter key presses.
   * Can also be called as type(selector, text) for parent compatibility.
   */
  async type(selector: string, text: string): Promise<void>;
  async type(text: string): Promise<void>;
  async type(selectorOrText: string, text?: string): Promise<void> {
    if (text !== undefined) {
      // Called as type(selector, text) — delegate to parent
      return super.type(selectorOrText, text);
    }
    // Called as type(text) — type into this terminal
    return super.type(this.selector, selectorOrText);
  }

  /**
   * Type text and press Enter.
   * Can also be called as typeAndEnter(selector, text) for parent compatibility.
   */
  async typeAndEnter(selector: string, text: string): Promise<void>;
  async typeAndEnter(text: string): Promise<void>;
  async typeAndEnter(selectorOrText: string, text?: string): Promise<void> {
    if (text !== undefined) {
      return super.typeAndEnter(selectorOrText, text);
    }
    return super.typeAndEnter(this.selector, selectorOrText);
  }

  // ─── Terminal-specific methods ────────────────────────────────────

  /**
   * Wait for specific text to appear in the terminal's rendered output.
   * @param includes  Array of strings that must all appear
   * @param timeout   Timeout in ms (default 20s)
   */
  async waitForText(includes: string[], timeout = 20000) {
    await this.page.waitForFunction(
      ([sel, inc]: [string, string[]]) => {
        const root = document.querySelector(sel);
        if (!root) return false;
        const rows = root.querySelector(".xterm-rows");
        const text = String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
        return inc.every((s: string) => text.includes(s));
      },
      [this.selector, includes] as [string, string[]],
      { timeout },
    );
  }

  /**
   * Wait for a shell prompt (`$` or `#`) to appear — indicates the terminal
   * is idle and waiting for user input.
   * @param timeout  Timeout in ms (default 30s)
   */
  async waitForPrompt(timeout = 30000) {
    await this.page.waitForFunction(
      (sel: string) => {
        const root = document.querySelector(sel);
        if (!root) return false;
        const rows = root.querySelector(".xterm-rows");
        if (!rows) return false;
        const lines = (rows.textContent ?? "").split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (!line) continue;
          return line.endsWith("$") || line.endsWith("#") || line.includes("$ ");
        }
        return false;
      },
      this.selector,
      { timeout },
    );
  }

  /**
   * Check if the terminal is busy (running a command) or idle (prompt visible).
   * Returns `true` if the terminal appears to be executing a command.
   */
  async isBusy(): Promise<boolean> {
    return this.page.evaluate((sel: string) => {
      const root = document.querySelector(sel);
      if (!root) return true;
      const rows = root.querySelector(".xterm-rows");
      if (!rows) return true;
      const lines = (rows.textContent ?? "").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        // Prompt detected = idle
        if (line.endsWith("$") || line.endsWith("#") || line.includes("$ ")) {
          return false;
        }
        return true;
      }
      return true;
    }, this.selector);
  }

  /**
   * Wait until the terminal becomes idle (prompt visible).
   * @param timeout  Timeout in ms (default 30s)
   */
  async waitUntilIdle(timeout = 30000) {
    await this.waitForPrompt(timeout);
  }

  /**
   * Read all visible text from the terminal.
   * Updates the watermark for readNew().
   */
  async read(): Promise<string> {
    const text = await this.page.evaluate((sel: string) => {
      const root = document.querySelector(sel);
      if (!root) return "";
      const rows = root.querySelector(".xterm-rows");
      return String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
    }, this.selector);
    const lines = text.split("\n");
    this._readWatermark = lines.length;
    return text;
  }

  /**
   * Read only new lines since the last read() or readNew() call.
   * On first call, returns all text (same as read()).
   */
  async readNew(): Promise<string> {
    const text = await this.page.evaluate((sel: string) => {
      const root = document.querySelector(sel);
      if (!root) return "";
      const rows = root.querySelector(".xterm-rows");
      return String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
    }, this.selector);
    const lines = text.split("\n");
    const newLines = lines.slice(this._readWatermark);
    this._readWatermark = lines.length;
    return newLines.join("\n");
  }
}
