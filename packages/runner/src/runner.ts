/**
 * @description Core scenario runner engine with Actor (human/fast modes),
 * cursor overlay injection, video recorder, and WebVTT subtitle generator.
 */
import { chromium, type Browser, type BrowserContext, type Page, type ElementHandle } from "playwright";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import {
  type NarrationOptions,
  type AudioDirectorAPI,
  type AudioEvent,
  createAudioDirector,
  mixAudioIntoVideo,
} from "./narrator.js";

// ---------------------------------------------------------------------------
//  Types
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

const DEFAULT_DELAYS: Record<Mode, ActorDelays> = {
  human: {
    // Deterministic "familiar user" pacing (no randomness)
    breatheMs: [300, 300],
    afterScrollIntoViewMs: [350, 350],
    mouseMoveStepMs: [3, 3],
    clickEffectMs: [25, 25],
    clickHoldMs: [90, 90],
    afterClickMs: [70, 70],
    beforeTypeMs: [55, 55],
    keyDelayMs: [35, 35],
    keyBoundaryPauseMs: [30, 30],
    selectOpenMs: [120, 120],
    selectOptionMs: [70, 70],
    afterDragMs: [120, 120],
  },
  fast: {
    breatheMs: [0, 0],
    afterScrollIntoViewMs: [0, 0],
    mouseMoveStepMs: [0, 0],
    clickEffectMs: [0, 0],
    clickHoldMs: [0, 0],
    afterClickMs: [0, 0],
    beforeTypeMs: [0, 0],
    keyDelayMs: [0, 0],
    keyBoundaryPauseMs: [0, 0],
    selectOpenMs: [0, 0],
    selectOptionMs: [0, 0],
    afterDragMs: [0, 0],
  },
};

function pickMs([minMs, maxMs]: DelayRange) {
  // Deterministic: use a constant value (midpoint if a range is provided).
  if (maxMs <= minMs) return minMs;
  return Math.round((minMs + maxMs) / 2);
}

function mergeDelays(mode: Mode, overrides?: Partial<ActorDelays>): ActorDelays {
  return { ...DEFAULT_DELAYS[mode], ...(overrides ?? {}) };
}

export interface StepRecord {
  index: number;
  caption: string;
  startMs: number;
  endMs: number;
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

export interface ScenarioContext {
  step: (caption: string, fn: () => Promise<void>) => Promise<void>;
  actor: Actor;
  page: Page;
  baseURL: string | undefined;
  /** Audio director for narration and sound effects (no-op when narration is disabled) */
  audio: AudioDirectorAPI;
}

// ---------------------------------------------------------------------------
//  Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * WindMouse algorithm — physics-based human-like cursor path generation.
 * Models cursor as a particle under gravity (toward target) + random wind.
 * Based on https://ben.land/post/2021/04/25/windmouse-human-mouse-movement/
 *
 * @param G_0 Gravity magnitude (pulls toward target)
 * @param W_0 Wind magnitude (random perturbation)
 * @param M_0 Max velocity (speed cap)
 * @param D_0 Distance threshold where wind switches to damped mode
 */
function windMouse(
  from: { x: number; y: number },
  to: { x: number; y: number },
  G_0 = 9,
  W_0 = 3,
  M_0 = 18,
  D_0 = 15,
): Array<{ x: number; y: number }> {
  const sqrt3 = Math.sqrt(3);
  const sqrt5 = Math.sqrt(5);
  const points: Array<{ x: number; y: number }> = [];

  let sx = from.x;
  let sy = from.y;
  const dx = to.x;
  const dy = to.y;
  let vx = 0;
  let vy = 0;
  let wx = 0;
  let wy = 0;
  let m0 = M_0;

  // Safety: cap iterations to avoid infinite loops
  for (let iter = 0; iter < 2000; iter++) {
    const dist = Math.hypot(dx - sx, dy - sy);
    if (dist < 1) break;

    const wMag = Math.min(W_0, dist);

    if (dist >= D_0) {
      // Far from target: random wind fluctuations
      wx = wx / sqrt3 + (Math.random() * 2 - 1) * wMag / sqrt5;
      wy = wy / sqrt3 + (Math.random() * 2 - 1) * wMag / sqrt5;
    } else {
      // Near target: damp wind, reduce max speed
      wx /= sqrt3;
      wy /= sqrt3;
      if (m0 < 3) {
        m0 = Math.random() * 3 + 3;
      } else {
        m0 /= sqrt5;
      }
    }

    // Apply gravity toward target + wind
    vx += wx + G_0 * (dx - sx) / dist;
    vy += wy + G_0 * (dy - sy) / dist;

    // Clip velocity to max
    const vMag = Math.hypot(vx, vy);
    if (vMag > m0) {
      const clip = m0 / 2 + Math.random() * m0 / 2;
      vx = (vx / vMag) * clip;
      vy = (vy / vMag) * clip;
    }

    sx += vx;
    sy += vy;

    const mx = Math.round(sx);
    const my = Math.round(sy);
    // Only record distinct pixel positions
    if (
      points.length === 0 ||
      points[points.length - 1].x !== mx ||
      points[points.length - 1].y !== my
    ) {
      points.push({ x: mx, y: my });
    }
  }

  // Ensure we end exactly at the target
  const last = points[points.length - 1];
  if (!last || last.x !== Math.round(dx) || last.y !== Math.round(dy)) {
    points.push({ x: Math.round(dx), y: Math.round(dy) });
  }

  return points;
}

/** Simple linear interpolation (used for constrained paths like drag/draw) */
function linearPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t); // smoothstep
    points.push({
      x: Math.round(from.x + (to.x - from.x) * ease),
      y: Math.round(from.y + (to.y - from.y) * ease),
    });
  }
  return points;
}

function formatVttTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function stepEaseMultiplier(i: number, n: number, amplitude = 0.4): number {
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 1) return 1;
  const t = Math.min(1, Math.max(0, i / (n - 1)));
  // High at ends, low in the middle: 1±amplitude
  return 1 + amplitude * Math.cos(2 * Math.PI * t);
}

function easedStepMs(baseMs: number, i: number, n: number, factor = 1): number {
  const ms = baseMs * factor * stepEaseMultiplier(i, n);
  return Math.max(0, Math.round(ms));
}

// ---------------------------------------------------------------------------
//  Cursor overlay injection script (runs inside the browser page)
// ---------------------------------------------------------------------------

const CURSOR_OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('__b2v_cursor')) return;

  // --- Cursor element ---
  const cursor = document.createElement('div');
  cursor.id = '__b2v_cursor';
  cursor.style.cssText = \`
    position: fixed; top: 0; left: 0; z-index: 999999;
    width: 20px; height: 20px; pointer-events: none;
    transform: translate(-2px, -2px);
    transition: transform 40ms ease-in-out;
    will-change: transform;
  \`;
  cursor.innerHTML = \`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 2L3 17L7.5 12.5L11.5 18L14 16.5L10 11L16 11L3 2Z" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>\`;
  document.body.appendChild(cursor);

  // --- Ripple container ---
  const rippleContainer = document.createElement('div');
  rippleContainer.id = '__b2v_ripple_container';
  rippleContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999998;pointer-events:none;';
  document.body.appendChild(rippleContainer);

  // --- Enable smooth scrolling on the page ---
  document.documentElement.style.scrollBehavior = 'smooth';

  window.__b2v_moveCursor = function(x, y) {
    cursor.style.transform = \`translate(\${x - 2}px, \${y - 2}px)\`;
  };

  window.__b2v_clickEffect = function(x, y) {
    const ring = document.createElement('div');
    ring.style.cssText = \`
      position: fixed; pointer-events: none;
      left: \${x}px; top: \${y}px;
      width: 0; height: 0;
      border: 3px solid rgba(96, 165, 250, 0.9);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: __b2v_ripple 0.6s ease-out forwards;
    \`;
    rippleContainer.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  };

  if (!document.getElementById('__b2v_style')) {
    const style = document.createElement('style');
    style.id = '__b2v_style';
    style.textContent = \`
      @keyframes __b2v_ripple {
        0%   { width: 0;   height: 0;   opacity: 1; }
        100% { width: 80px; height: 80px; opacity: 0; }
      }
    \`;
    document.head.appendChild(style);
  }
})();
`;

// ---------------------------------------------------------------------------
//  Actor – mode-aware browser interaction
// ---------------------------------------------------------------------------

export class Actor {
  private cursorX = 0;
  private cursorY = 0;
  private delays: ActorDelays;

  constructor(
    public page: Page,
    public mode: Mode,
    opts?: { delays?: Partial<ActorDelays> },
  ) {
    this.delays = mergeDelays(mode, opts?.delays);
  }

  /** Inject cursor overlay into the page (human mode only) */
  async injectCursor() {
    if (this.mode !== "human") return;
    await this.page.evaluate(CURSOR_OVERLAY_SCRIPT);
  }

  /** Navigate and re-inject cursor overlay */
  async goto(url: string) {
    await this.page.goto(url, { waitUntil: "networkidle" });
    await this.injectCursor();
  }

  /** Wait for an element to appear */
  async waitFor(selector: string, timeout = 3000) {
    await this.page.waitForSelector(selector, { state: "visible", timeout });
  }

  /** Move cursor smoothly to an element center (human) or no-op (fast) */
  private async moveTo(
    selector: string,
  ): Promise<{ x: number; y: number; el: ElementHandle }> {
    const el = (await this.page.waitForSelector(selector, {
      state: "visible",
      timeout: 3000,
    }))!;
    // Scroll element into view (smooth in human mode so it looks natural on video)
    const scrollBehavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";
    await el.evaluate((e, b) => e.scrollIntoView({ block: "center", behavior: b }), scrollBehavior);
    await sleep(pickMs(this.delays.afterScrollIntoViewMs));
    const box = (await el.boundingBox())!;
    const target = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };

    if (this.mode === "human") {
      const from = { x: this.cursorX, y: this.cursorY };
      const points = windMouse(from, target);

      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(
          `window.__b2v_moveCursor?.(${p.x}, ${p.y})`,
        );
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, points.length));
      }
    }

    this.cursorX = target.x;
    this.cursorY = target.y;
    return { ...target, el };
  }

  /** Click on an element */
  async click(selector: string) {
    const { x, y } = await this.moveTo(selector);

    if (this.mode === "human") {
      await this.page.evaluate(
        `window.__b2v_clickEffect?.(${x}, ${y})`,
      );
      await sleep(pickMs(this.delays.clickEffectMs));
    }

    // Use an explicit press-and-release so UI `whileTap` animations are visible
    // in the recording (mouse.click() can be too fast).
    if (this.mode === "human") {
      await this.page.mouse.down();
      await sleep(pickMs(this.delays.clickHoldMs));
      await this.page.mouse.up();
    } else {
      await this.page.mouse.click(x, y);
    }

    if (this.mode === "human") {
      await sleep(pickMs(this.delays.afterClickMs));
    }
  }

  /** Type text into a focused element */
  async type(selector: string, text: string) {
    await this.click(selector);
    await sleep(pickMs(this.delays.beforeTypeMs));

    if (this.mode === "fast") {
      await this.page.type(selector, text, { delay: 0 });
      return;
    }

    // Human mode: character-by-character with jitter
    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i], {
        delay: pickMs(this.delays.keyDelayMs),
      });
      // Micro-pause at word boundaries
      if (text[i] === " " || text[i] === "@" || text[i] === ".") {
        await sleep(pickMs(this.delays.keyBoundaryPauseMs));
      }
    }
  }

  /** Open a select dropdown and pick a value */
  async selectOption(triggerSelector: string, valueText: string) {
    await this.click(triggerSelector);
    await sleep(pickMs(this.delays.selectOpenMs));

    // Wait for the popover/content to appear and find the option
    const optionSelector = `[role="option"]`;
    await this.page.waitForSelector(optionSelector, { state: "visible", timeout: 3000 });
    await sleep(pickMs(this.delays.selectOptionMs));

    // Find the option with matching text
    const options = await this.page.$$(optionSelector);
    for (const option of options) {
      const text = await option.evaluate((el: any) => el.textContent?.trim());
      if (text === valueText) {
        const box = (await option.boundingBox())!;
        const target = {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
        };

        if (this.mode === "human") {
          const from = { x: this.cursorX, y: this.cursorY };
          const points = windMouse(from, target);
          for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            await this.page.mouse.move(p.x, p.y);
            await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
            await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, points.length));
          }
          await this.page.evaluate(`window.__b2v_clickEffect?.(${target.x}, ${target.y})`);
          await sleep(pickMs(this.delays.clickEffectMs));
        }

        this.cursorX = target.x;
        this.cursorY = target.y;
        await option.click();
        await sleep(pickMs(this.delays.afterClickMs));
        return;
      }
    }
    throw new Error(`Option "${valueText}" not found`);
  }

  /** Scroll within an element or the page */
  async scroll(selector: string | null, deltaY: number) {
    if (selector) {
      await this.moveTo(selector);
    }

    const behavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";

    if (selector) {
      // The selector may point at a wrapper (e.g. Radix ScrollArea Root) rather than the
      // actual scrollable viewport. Resolve a best-effort scroll target inside the element.
      await this.page.evaluate(
        ({ selector, deltaY, behavior }) => {
          const root = document.querySelector(selector) as HTMLElement | null;
          if (!root) return;

          const isScrollable = (el: HTMLElement) =>
            el.scrollHeight > el.clientHeight + 1 &&
            (getComputedStyle(el).overflowY === "auto" ||
              getComputedStyle(el).overflowY === "scroll" ||
              getComputedStyle(el).overflowY === "overlay");

          const direct =
            root instanceof HTMLElement && isScrollable(root) ? root : null;

          // Radix ScrollArea (our UI) scrolls the Viewport, not the Root.
          const radixViewport = root.querySelector(
            '[data-slot="scroll-area-viewport"]',
          ) as HTMLElement | null;

          const descendantScrollable =
            Array.from(root.querySelectorAll("*"))
              .find((n) => n instanceof HTMLElement && isScrollable(n as HTMLElement)) as
              | HTMLElement
              | undefined;

          const target = direct ?? radixViewport ?? descendantScrollable ?? root;
          target.scrollBy({ top: deltaY, behavior });
        },
        { selector, deltaY, behavior },
      );
    } else {
      await this.page.evaluate(
        ({ deltaY, behavior }) => {
          window.scrollBy({ top: deltaY, behavior });
        },
        { deltaY, behavior },
      );
    }

    // Wait for the scroll animation to finish (~400-600ms in human mode)
    await sleep(this.mode === "human" ? 600 : 50);
  }

  /** Drag from one position to another */
  async drag(
    fromSelector: string,
    toSelector: string,
  ) {
    const fromEl = (await this.page.waitForSelector(fromSelector, { state: "visible", timeout: 3000 }))!;
    const fromBox = (await fromEl.boundingBox())!;
    const from = {
      x: Math.round(fromBox.x + fromBox.width / 2),
      y: Math.round(fromBox.y + fromBox.height / 2),
    };

    const toEl = (await this.page.waitForSelector(toSelector, { state: "visible", timeout: 3000 }))!;
    const toBox = (await toEl.boundingBox())!;
    const to = {
      x: Math.round(toBox.x + toBox.width / 2),
      y: Math.round(toBox.y + toBox.height / 2),
    };

    if (this.mode === "human") {
      // Move to start with natural WindMouse path
      const movePoints = windMouse(
        { x: this.cursorX, y: this.cursorY },
        from,
      );
      for (let i = 0; i < movePoints.length; i++) {
        const p = movePoints[i]!;
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, movePoints.length));
      }
    }

    // Press, drag, release
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await sleep(pickMs(this.delays.clickHoldMs));

    const dragSteps = this.mode === "human" ? 25 : 5;
    const dragPoints = linearPath(from, to, dragSteps);
    for (let i = 0; i < dragPoints.length; i++) {
      const p = dragPoints[i]!;
      await this.page.mouse.move(p.x, p.y);
      if (this.mode === "human") {
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, dragPoints.length));
      }
    }

    await sleep(pickMs(this.delays.afterClickMs));
    await this.page.mouse.up();

    this.cursorX = to.x;
    this.cursorY = to.y;
    await sleep(pickMs(this.delays.afterDragMs));
  }

  /** Drag an element by a pixel offset (useful for repositioning nodes) */
  async dragByOffset(selector: string, dx: number, dy: number) {
    const el = (await this.page.waitForSelector(selector, { state: "visible", timeout: 3000 }))!;
    const scrollBehavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";
    await el.evaluate((e, b) => e.scrollIntoView({ block: "center", behavior: b }), scrollBehavior);
    await sleep(pickMs(this.delays.afterScrollIntoViewMs));
    const box = (await el.boundingBox())!;
    const from = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
    const to = {
      x: from.x + dx,
      y: from.y + dy,
    };

    if (this.mode === "human") {
      const movePoints = windMouse(
        { x: this.cursorX, y: this.cursorY },
        from,
      );
      for (let i = 0; i < movePoints.length; i++) {
        const p = movePoints[i]!;
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, movePoints.length));
      }
    }

    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await sleep(pickMs(this.delays.clickHoldMs));

    const dragSteps = this.mode === "human" ? 25 : 5;
    const dragPoints = linearPath(from, to, dragSteps);
    for (let i = 0; i < dragPoints.length; i++) {
      const p = dragPoints[i]!;
      await this.page.mouse.move(p.x, p.y);
      if (this.mode === "human") {
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, dragPoints.length));
      }
    }

    await sleep(pickMs(this.delays.afterClickMs));
    await this.page.mouse.up();

    this.cursorX = to.x;
    this.cursorY = to.y;
    await sleep(pickMs(this.delays.afterDragMs));
  }

  /**
   * Draw on a canvas element.
   * @param canvasSelector CSS selector for the canvas
   * @param points Array of {x, y} points (relative to canvas, 0-1 normalized)
   */
  async draw(
    canvasSelector: string,
    points: Array<{ x: number; y: number }>,
  ) {
    const canvas = (await this.page.waitForSelector(canvasSelector, {
      state: "visible",
      timeout: 3000,
    }))!;
    const box = (await canvas.boundingBox())!;

    // Convert normalized coords to page coords
    const absPoints = points.map((p) => ({
      x: Math.round(box.x + p.x * box.width),
      y: Math.round(box.y + p.y * box.height),
    }));

    if (absPoints.length < 2) return;

    // Move to first point with natural WindMouse path
    if (this.mode === "human") {
      const movePoints = windMouse(
        { x: this.cursorX, y: this.cursorY },
        absPoints[0],
      );
      for (let i = 0; i < movePoints.length; i++) {
        const p = movePoints[i]!;
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, movePoints.length));
      }
    }

    await this.page.mouse.move(absPoints[0].x, absPoints[0].y);
    await this.page.mouse.down();

    for (let i = 1; i < absPoints.length; i++) {
      const segSteps = this.mode === "human" ? 12 : 1;
      const segPoints = linearPath(absPoints[i - 1], absPoints[i], segSteps);
      for (let j = 0; j < segPoints.length; j++) {
        const p = segPoints[j]!;
        await this.page.mouse.move(p.x, p.y);
        if (this.mode === "human") {
          await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
          // Drawing looks unnaturally fast with the same step pacing as normal moves.
          // Keep it deterministic but slower/more "hand-like".
          await sleep(
            easedStepMs(pickMs(this.delays.mouseMoveStepMs), j, segPoints.length, 2),
          );
        }
      }
    }

    await this.page.mouse.up();
    this.cursorX = absPoints[absPoints.length - 1].x;
    this.cursorY = absPoints[absPoints.length - 1].y;
    await sleep(pickMs(this.delays.afterDragMs));
  }

  /** Add a breathing pause between major steps (human mode only) */
  async breathe() {
    await sleep(pickMs(this.delays.breatheMs));
  }
}

// ---------------------------------------------------------------------------
//  Subtitle (WebVTT) generator
// ---------------------------------------------------------------------------

export function generateWebVTT(steps: StepRecord[]): string {
  let vtt = "WEBVTT\n\n";
  for (const s of steps) {
    vtt += `${formatVttTime(s.startMs)} --> ${formatVttTime(s.endMs)}\n`;
    vtt += `Step ${s.index}: ${s.caption}\n\n`;
  }
  return vtt;
}

// ---------------------------------------------------------------------------
//  Runner – orchestrates browser, recording, and scenario
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  mode: Mode;
  baseURL?: string;
  artifactDir: string;
  scenario: (ctx: ScenarioContext) => Promise<void>;
  ffmpegPath?: string;
  headless?: boolean;
  recordMode?: RecordMode;
  delays?: Partial<ActorDelays>;
  /** Path to a Chrome user-data directory to reuse cookies/sessions */
  userDataDir?: string;
  /** Path to a specific Chrome/Chromium binary (e.g. system Chrome for cookie access) */
  executablePath?: string;
  /** Narration options (TTS voice-over + sound effects) */
  narration?: NarrationOptions;
  /** Open Chrome DevTools automatically (forces headed mode) */
  devtools?: boolean;
  /** macOS only (avfoundation): capture screen index for screen recording */
  screenIndex?: number;
  /** Linux only (x11grab): X11 DISPLAY for screen recording */
  display?: string;
  /** Linux only (x11grab): capture size for screen recording, e.g. "1920x1080" */
  displaySize?: string;
}

export async function run(opts: RunnerOptions): Promise<RunResult> {
  const { mode, baseURL, artifactDir, scenario, ffmpegPath } = opts;
  const wantsDevtools = opts.devtools ?? false;
  let recordMode: RecordMode = opts.recordMode ?? "screencast";

  // Screen recording on headless is impossible — fall back to screencast
  const requestedHeadless = opts.headless ?? (mode === "fast");
  if (requestedHeadless && recordMode === "screen") recordMode = "screencast";

  fs.mkdirSync(artifactDir, { recursive: true });

  const rawVideoPath = recordMode === "screencast" ? path.join(artifactDir, "run.raw.webm") : undefined;
  const videoPath = recordMode === "none" ? undefined : path.join(artifactDir, "run.mp4");
  const subtitlesPath = path.join(artifactDir, "captions.vtt");
  const metadataPath = path.join(artifactDir, "run.json");

  // Determine headless mode — devtools forces headed
  const headless = wantsDevtools ? false : requestedHeadless;

  console.log(`\n  Mode:      ${mode}`);
  console.log(`  Headless:  ${headless}`);
  console.log(`  Record:    ${recordMode}`);
  console.log(`  Base URL:  ${baseURL ?? "(external)"}`);
  console.log(`  Artifacts: ${artifactDir}\n`);

  // Launch browser
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--disable-background-networking",
    ...(wantsDevtools ? ["--auto-open-devtools-for-tabs"] : []),
  ];

  const isScreencast = recordMode === "screencast" && !!rawVideoPath;
  const isScreenRecording = recordMode === "screen" && !!videoPath;
  const contextOptions: {
    viewport: { width: number; height: number };
    recordVideo?: { dir: string; size: { width: number; height: number } };
  } = {
    viewport: { width: 1280, height: 720 },
  };
  if (isScreencast) {
    contextOptions.recordVideo = {
      dir: path.dirname(rawVideoPath!),
      size: { width: 1280, height: 720 },
    };
  }

  let browser: Browser | null = null;
  let context: BrowserContext;

  if (opts.userDataDir) {
    // Persistent context reuses cookies/sessions from a user data directory
    context = await chromium.launchPersistentContext(opts.userDataDir, {
      headless,
      args: launchArgs,
      ...contextOptions,
      ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    });
  } else {
    browser = await chromium.launch({
      headless,
      args: launchArgs,
      ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    });
    context = await browser.newContext(contextOptions);
  }

  const page: Page = context.pages()[0] ?? await context.newPage();

  // Hide default cursor so our overlay is the only one visible
  if (mode === "human") {
    await page.addInitScript(`
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '* { cursor: none !important; }';
        document.head.appendChild(s);
      });
    `);
  }

  // Fast mode: reduce UI animations for determinism and speed.
  if (mode === "fast") {
    await page.addInitScript(`
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = \`
          *, *::before, *::after {
            animation-duration: 1ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 1ms !important;
            scroll-behavior: auto !important;
          }
        \`;
        document.head.appendChild(s);
      });
    `);
  }

  const actor = new Actor(page, mode, { delays: opts.delays });

  // Navigate to initial page (skip for external-site scenarios without baseURL)
  if (baseURL) {
    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  }

  // Video recording
  const resolvedFfmpeg = ffmpegPath ?? "ffmpeg";
  let screenRecorder: { stop: () => Promise<void> } | undefined;

  if (isScreenRecording) {
    const { startScreenCapture } = await import("./screen-capture.js");
    screenRecorder = await startScreenCapture({
      ffmpeg: resolvedFfmpeg,
      outputPath: videoPath!,
      fps: 30,
      screenIndex: opts.screenIndex,
      display: opts.display,
      displaySize: opts.displaySize,
    });
  } else if (isScreencast) {
    console.log("  Recording started (video)");
  } else {
    console.log("  Recording disabled");
  }

  const videoStartTime = Date.now();
  const steps: StepRecord[] = [];
  let stepIndex = 0;

  // Create audio director (real or no-op depending on narration config)
  const audioDirector = createAudioDirector({
    narration: opts.narration,
    videoStartTime,
    ffmpegPath: resolvedFfmpeg,
  });

  // Capture console errors from the page
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`  [Browser Error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`  [Page Error] ${(err as Error).message}`);
  });

  async function step(caption: string, fn: () => Promise<void>) {
    stepIndex++;
    const idx = stepIndex;
    const startMs = Date.now() - videoStartTime;
    console.log(`  [Step ${idx}] ${caption}`);

    await fn();

    // Breathing pause after each step (human mode)
    await actor.breathe();

    const endMs = Date.now() - videoStartTime;
    steps.push({ index: idx, caption, startMs, endMs });
  }

  // Run scenario
  const scenarioStart = Date.now();
  try {
    await scenario({ step, actor, page, baseURL, audio: audioDirector });
  } catch (err) {
    console.error("\n  Scenario failed:", (err as Error).message);
    // Take a failure screenshot
    try {
      await page.screenshot({
        path: path.join(artifactDir, "failure.png"),
      });
      console.log("  Failure screenshot saved.");
    } catch { /* ignore */ }
    throw err;
  } finally {
    const durationMs = Date.now() - scenarioStart;

    // Tail-capture: allow final UI updates to render before stopping recording.
    // Deterministic (no randomness), and 0ms in fast mode.
    const tailCaptureMs = mode === "human" ? 300 : 0;
    if ((isScreencast || isScreenRecording) && tailCaptureMs > 0) {
      try {
        await sleep(tailCaptureMs);
      } catch { /* ignore */ }
    }

    // Show processing overlay so the user sees feedback instead of a frozen page.
    try {
      await page.evaluate(`(() => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
        overlay.innerHTML = '<div style="color:#fff;font-size:1.5rem;font-family:system-ui">Finishing\\u2026</div>';
        document.body.appendChild(overlay);
      })()`);
    } catch { /* page may already be gone on error path */ }

    // Stop screen recording (if active)
    if (screenRecorder) {
      try {
        await screenRecorder.stop();
        if (videoPath) console.log(`  Video saved: ${videoPath}`);
      } catch (e) {
        console.error("  Error stopping screen recording:", (e as Error).message);
      }
    }

    // Finalize screencast video: close page so Playwright flushes the recording
    if (isScreencast) {
      try {
        await page.close();
        const video = page.video();
        if (video) await video.saveAs(rawVideoPath!);
      } catch (e) {
        console.error("  Error saving video:", (e as Error).message);
      }
    }

    // Close browser
    await context.close();
    if (browser) await browser.close();

    // Convert raw WebM to MP4 (screencast path only)
    if (isScreencast && rawVideoPath && videoPath) {
      try {
        console.log("\n  Finalizing MP4...");
        execFileSync(
          resolvedFfmpeg,
          [
          "-y",
          "-i",
          rawVideoPath,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          videoPath,
          ],
          { stdio: "pipe" },
        );
        try { fs.unlinkSync(rawVideoPath); } catch { /* ignore */ }
        console.log(`  Video saved: ${videoPath}`);
      } catch (fixErr) {
        console.warn("  MP4 finalize failed, keeping raw WebM:", (fixErr as Error).message);
      }
    }

    // Mix narration audio into video (if any audio events were recorded)
    const audioEvents = audioDirector.getEvents?.() ?? [];
    if (audioEvents.length > 0 && videoPath && fs.existsSync(videoPath)) {
      mixAudioIntoVideo({
        videoPath,
        events: audioEvents,
        ffmpegPath: resolvedFfmpeg,
      });
    }

    // Generate subtitles
    const vtt = generateWebVTT(steps);
    fs.writeFileSync(subtitlesPath, vtt, "utf-8");
    console.log(`  Subtitles:  ${subtitlesPath}`);

    // Generate metadata
    const metadata = {
      mode,
      baseURL,
      durationMs,
      steps,
      videoPath,
      subtitlesPath,
      recordMode,
      audioEvents: audioEvents.length > 0 ? audioEvents.map((e) => ({
        type: e.type,
        startMs: e.startMs,
        durationMs: e.durationMs,
        label: e.label,
      })) : undefined,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log(`  Metadata:   ${metadataPath}`);
    console.log(`  Duration:   ${(durationMs / 1000).toFixed(1)}s\n`);

    return {
      mode,
      recordMode,
      videoPath,
      subtitlesPath,
      metadataPath,
      steps,
      durationMs,
      audioEvents: audioEvents.length > 0 ? audioEvents : undefined,
    };
  }
}
