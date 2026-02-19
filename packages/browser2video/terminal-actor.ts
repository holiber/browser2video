/**
 * @description TerminalActor — scoped actor for interacting with a terminal pane.
 * All methods are selector-free: the actor knows which terminal it controls.
 * Supports both standalone terminal pages and iframe-embedded terminals in a grid.
 * Created by session.createTerminal().
 */
import type { Page, Frame } from "playwright";
import type { Mode, ActorDelays } from "./types.ts";
import { Actor, pickMs } from "./actor.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** DOM context for queries — either the page itself or an iframe frame */
type DOMContext = Page | Frame;

/** Track which iframe is currently focused on a given page */
const _focusedIframe = new WeakMap<Page, string>();

export class TerminalActor extends Actor {
  /** CSS selector for the terminal container element */
  readonly selector: string;

  /** Watermark for readNew() — tracks lines already returned */
  private _readWatermark = 0;

  /** DOM context: iframe Frame (grid mode) or Page (standalone mode) */
  private _dom: DOMContext;

  /** Iframe name — set when running inside a grid page */
  private _iframeName: string | undefined;

  constructor(
    page: Page,
    mode: Mode,
    selector: string,
    opts?: {
      delays?: Partial<ActorDelays>;
      frame?: Frame;
      iframeName?: string;
    },
  ) {
    super(page, mode, opts);
    this.selector = selector;
    this._dom = opts?.frame ?? page;
    this._iframeName = opts?.iframeName;
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
      return super.click(relXOrSelector);
    }

    // When inside an iframe, we need to offset by the iframe's position in the grid page
    let iframeOffsetX = 0;
    let iframeOffsetY = 0;
    if (this._iframeName) {
      const iframeBox = await this.page.$eval(
        `iframe[name="${this._iframeName}"]`,
        (el: any) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y };
        },
      );
      iframeOffsetX = iframeBox.x;
      iframeOffsetY = iframeBox.y;
    }

    const box = await this._dom.$eval(this.selector, (el: any) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const x = Math.round(iframeOffsetX + box.x + box.width * relXOrSelector);
    const y = Math.round(iframeOffsetY + box.y + box.height * (relY ?? 0.5));
    await this.clickAt(x, y);
    // Track focus — this iframe is now focused
    if (this._iframeName) {
      _focusedIframe.set(this.page, this._iframeName);
    }
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
      // Called as type(selector, text) — delegate to parent for regular DOM
      return super.type(selectorOrText, text);
    }
    await this._ensureFocus();
    await this._typeIntoTerminal(selectorOrText);
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
    await this._ensureFocus();
    await this._typeIntoTerminal(selectorOrText + "\n");
  }

  /**
   * Internal: type text into the terminal's xterm textarea,
   * using the correct DOM context (iframe frame or main page).
   */
  private async _typeIntoTerminal(text: string) {
    const xtermTextarea = await this._dom.$(`${this.selector} .xterm-helper-textarea`);
    if (xtermTextarea) {
      await xtermTextarea.focus();
    }
    const charDelay = this.mode === "fast" ? 0 : pickMs(this.delays.keyDelayMs);
    for (const ch of text) {
      if (ch === "\n") {
        await this.page.keyboard.press("Enter");
      } else {
        await this.page.keyboard.type(ch, { delay: 0 });
      }
      if (charDelay) await sleep(charDelay);
    }
    await sleep(pickMs(this.delays.afterTypeMs));
  }

  /**
   * Ensure this terminal's iframe is focused on the grid page.
   * Only clicks if focus needs to change (avoids redundant clicks).
   */
  private async _ensureFocus() {
    if (!this._iframeName) return;
    if (_focusedIframe.get(this.page) === this._iframeName) return;

    const iframeBox = await this.page.$eval(
      `iframe[name="${this._iframeName}"]`,
      (el: any) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
    );
    const x = Math.round(iframeBox.x + iframeBox.width / 2);
    const y = Math.round(iframeBox.y + iframeBox.height / 2);
    await this.clickAt(x, y);
    _focusedIframe.set(this.page, this._iframeName);
  }

  /**
   * Press a key in this terminal.
   * In grid mode, focuses the correct iframe first.
   */
  async pressKey(key: string) {
    await this._ensureFocus();
    return super.pressKey(key);
  }

  // ─── Terminal-specific methods ────────────────────────────────────

  /**
   * Wait for specific text to appear in the terminal's rendered output.
   * @param includes  Array of strings that must all appear
   * @param timeout   Timeout in ms (default 20s)
   */
  async waitForText(includes: string[], timeout = 20000) {
    await this._dom.waitForFunction(
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
    await this._dom.waitForFunction(
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
    return this._dom.evaluate((sel: string) => {
      const root = document.querySelector(sel);
      if (!root) return true;
      const rows = root.querySelector(".xterm-rows");
      if (!rows) return true;
      const lines = (rows.textContent ?? "").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
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
    const text = await this._dom.evaluate((sel: string) => {
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
    const text = await this._dom.evaluate((sel: string) => {
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
