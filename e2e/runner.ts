/**
 * @description Core scenario runner engine with Actor (human/fast modes),
 * cursor overlay injection, video recorder, and WebVTT subtitle generator.
 */
import puppeteer, {
  type Browser,
  type Page,
  type ScreenRecorder,
  type ElementHandle,
} from "puppeteer";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type Mode = "human" | "fast";

export interface StepRecord {
  index: number;
  caption: string;
  startMs: number;
  endMs: number;
}

export interface RunResult {
  mode: Mode;
  videoPath: string;
  subtitlesPath: string;
  metadataPath: string;
  steps: StepRecord[];
  durationMs: number;
}

export interface ScenarioContext {
  step: (caption: string, fn: () => Promise<void>) => Promise<void>;
  actor: Actor;
  page: Page;
  baseURL: string | undefined;
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
    transition: none;
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
      border: 2px solid rgba(96, 165, 250, 0.7);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: __b2v_ripple 0.4s ease-out forwards;
    \`;
    rippleContainer.appendChild(ring);
    setTimeout(() => ring.remove(), 500);
  };

  if (!document.getElementById('__b2v_style')) {
    const style = document.createElement('style');
    style.id = '__b2v_style';
    style.textContent = \`
      @keyframes __b2v_ripple {
        0%   { width: 0;   height: 0;   opacity: 1; }
        100% { width: 40px; height: 40px; opacity: 0; }
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

  constructor(
    public page: Page,
    public mode: Mode,
  ) {}

  /** Inject cursor overlay into the page (human mode only) */
  async injectCursor() {
    if (this.mode !== "human") return;
    await this.page.evaluate(CURSOR_OVERLAY_SCRIPT);
  }

  /** Navigate and re-inject cursor overlay */
  async goto(url: string) {
    await this.page.goto(url, { waitUntil: "networkidle0" });
    await this.injectCursor();
  }

  /** Wait for an element to appear */
  async waitFor(selector: string, timeout = 3000) {
    await this.page.waitForSelector(selector, { visible: true, timeout });
  }

  /** Move cursor smoothly to an element center (human) or no-op (fast) */
  private async moveTo(
    selector: string,
  ): Promise<{ x: number; y: number; el: ElementHandle }> {
    const el = (await this.page.waitForSelector(selector, {
      visible: true,
      timeout: 3000,
    }))!;
    // Scroll element into view (smooth in human mode so it looks natural on video)
    const scrollBehavior = this.mode === "human" ? "smooth" : "instant";
    await el.evaluate((e, b) => e.scrollIntoView({ block: "center", behavior: b }), scrollBehavior);
    await sleep(this.mode === "human" ? 400 : 30);
    const box = (await el.boundingBox())!;
    const target = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };

    if (this.mode === "human") {
      const from = { x: this.cursorX, y: this.cursorY };
      const points = windMouse(from, target);

      for (const p of points) {
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(
          `window.__b2v_moveCursor?.(${p.x}, ${p.y})`,
        );
        await sleep(randBetween(2, 5));
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
      await sleep(randBetween(15, 35));
    }

    await this.page.mouse.click(x, y);

    if (this.mode === "human") {
      await sleep(randBetween(50, 100));
    }
  }

  /** Type text into a focused element */
  async type(selector: string, text: string) {
    await this.click(selector);
    await sleep(this.mode === "human" ? randBetween(40, 80) : 10);

    if (this.mode === "fast") {
      await this.page.type(selector, text, { delay: 0 });
      return;
    }

    // Human mode: character-by-character with jitter
    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i], {
        delay: randBetween(25, 70),
      });
      // Micro-pause at word boundaries
      if (text[i] === " " || text[i] === "@" || text[i] === ".") {
        await sleep(randBetween(20, 60));
      }
    }
  }

  /** Open a select dropdown and pick a value */
  async selectOption(triggerSelector: string, valueText: string) {
    await this.click(triggerSelector);
    await sleep(this.mode === "human" ? randBetween(80, 180) : 50);

    // Wait for the popover/content to appear and find the option
    const optionSelector = `[role="option"]`;
    await this.page.waitForSelector(optionSelector, { visible: true, timeout: 3000 });
    await sleep(this.mode === "human" ? randBetween(40, 100) : 20);

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
          for (const p of points) {
            await this.page.mouse.move(p.x, p.y);
            await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
            await sleep(randBetween(2, 5));
          }
          await this.page.evaluate(`window.__b2v_clickEffect?.(${target.x}, ${target.y})`);
          await sleep(randBetween(15, 35));
        }

        this.cursorX = target.x;
        this.cursorY = target.y;
        await option.click();
        await sleep(this.mode === "human" ? randBetween(40, 100) : 10);
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

    if (this.mode === "human") {
      // Use smooth scrollBy — the injected CSS scroll-behavior:smooth
      // makes this animate natively in the browser.
      if (selector) {
        await this.page.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.scrollBy({ top: ${deltaY}, behavior: 'smooth' })`,
        );
      } else {
        await this.page.evaluate(
          `window.scrollBy({ top: ${deltaY}, behavior: 'smooth' })`,
        );
      }
      // Wait for the smooth scroll animation to finish (~400-600ms)
      await sleep(600);
    } else {
      await this.page.mouse.wheel({ deltaY });
      await sleep(50);
    }
  }

  /** Drag from one position to another */
  async drag(
    fromSelector: string,
    toSelector: string,
  ) {
    const fromEl = (await this.page.waitForSelector(fromSelector, { visible: true, timeout: 3000 }))!;
    const fromBox = (await fromEl.boundingBox())!;
    const from = {
      x: Math.round(fromBox.x + fromBox.width / 2),
      y: Math.round(fromBox.y + fromBox.height / 2),
    };

    const toEl = (await this.page.waitForSelector(toSelector, { visible: true, timeout: 3000 }))!;
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
      for (const p of movePoints) {
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(randBetween(2, 5));
      }
    }

    // Press, drag, release
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await sleep(this.mode === "human" ? randBetween(50, 100) : 10);

    const dragSteps = this.mode === "human" ? 25 : 5;
    const dragPoints = linearPath(from, to, dragSteps);
    for (const p of dragPoints) {
      await this.page.mouse.move(p.x, p.y);
      if (this.mode === "human") {
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(randBetween(5, 10));
      }
    }

    await sleep(this.mode === "human" ? randBetween(30, 60) : 10);
    await this.page.mouse.up();

    this.cursorX = to.x;
    this.cursorY = to.y;
    await sleep(this.mode === "human" ? randBetween(80, 180) : 20);
  }

  /** Drag an element by a pixel offset (useful for repositioning nodes) */
  async dragByOffset(selector: string, dx: number, dy: number) {
    const el = (await this.page.waitForSelector(selector, { visible: true, timeout: 3000 }))!;
    const scrollBehavior = this.mode === "human" ? "smooth" : "instant";
    await el.evaluate((e, b) => e.scrollIntoView({ block: "center", behavior: b }), scrollBehavior);
    await sleep(this.mode === "human" ? 400 : 30);
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
      for (const p of movePoints) {
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(randBetween(2, 5));
      }
    }

    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await sleep(this.mode === "human" ? randBetween(50, 100) : 10);

    const dragSteps = this.mode === "human" ? 25 : 5;
    const dragPoints = linearPath(from, to, dragSteps);
    for (const p of dragPoints) {
      await this.page.mouse.move(p.x, p.y);
      if (this.mode === "human") {
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(randBetween(5, 10));
      }
    }

    await sleep(this.mode === "human" ? randBetween(30, 60) : 10);
    await this.page.mouse.up();

    this.cursorX = to.x;
    this.cursorY = to.y;
    await sleep(this.mode === "human" ? randBetween(80, 180) : 20);
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
      visible: true,
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
      for (const p of movePoints) {
        await this.page.mouse.move(p.x, p.y);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
        await sleep(randBetween(2, 5));
      }
    }

    await this.page.mouse.move(absPoints[0].x, absPoints[0].y);
    await this.page.mouse.down();

    for (let i = 1; i < absPoints.length; i++) {
      const segSteps = this.mode === "human" ? 5 : 1;
      const segPoints = linearPath(absPoints[i - 1], absPoints[i], segSteps);
      for (const p of segPoints) {
        await this.page.mouse.move(p.x, p.y);
        if (this.mode === "human") {
          await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y})`);
          await sleep(randBetween(3, 8));
        }
      }
    }

    await this.page.mouse.up();
    this.cursorX = absPoints[absPoints.length - 1].x;
    this.cursorY = absPoints[absPoints.length - 1].y;
    await sleep(this.mode === "human" ? randBetween(80, 150) : 10);
  }

  /** Add a breathing pause between major steps (human mode only) */
  async breathe() {
    if (this.mode === "human") {
      await sleep(randBetween(200, 500));
    }
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
  /** Path to a Chrome user-data directory to reuse cookies/sessions */
  userDataDir?: string;
  /** Path to a specific Chrome/Chromium binary (e.g. system Chrome for cookie access) */
  executablePath?: string;
}

export async function run(opts: RunnerOptions): Promise<RunResult> {
  const { mode, baseURL, artifactDir, scenario, ffmpegPath } = opts;

  fs.mkdirSync(artifactDir, { recursive: true });

  const videoPath = path.join(artifactDir, "run.webm");
  const subtitlesPath = path.join(artifactDir, "captions.vtt");
  const metadataPath = path.join(artifactDir, "run.json");

  // Determine headless mode
  const headless = opts.headless ?? (mode === "fast");

  console.log(`\n  Mode:      ${mode}`);
  console.log(`  Headless:  ${headless}`);
  console.log(`  Base URL:  ${baseURL ?? "(external)"}`);
  console.log(`  Artifacts: ${artifactDir}\n`);

  // Launch browser
  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      "--disable-background-networking",
    ],
    defaultViewport: { width: 1280, height: 720 },
  };
  if (opts.userDataDir) {
    launchOptions.userDataDir = opts.userDataDir;
  }
  if (opts.executablePath) {
    launchOptions.executablePath = opts.executablePath;
  }
  const browser: Browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();

  // Hide default cursor so our overlay is the only one visible
  if (mode === "human") {
    await page.evaluateOnNewDocument(`
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '* { cursor: none !important; }';
        document.head.appendChild(s);
      });
    `);
  }

  const actor = new Actor(page, mode);

  // Navigate to initial page (skip for external-site scenarios without baseURL)
  if (baseURL) {
    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  }

  // Start video recording (WebM first, convert to MP4 after)
  const resolvedFfmpeg = ffmpegPath ?? "ffmpeg";
  let recorder: ScreenRecorder | undefined;
  try {
    recorder = await page.screencast({
      path: videoPath,
      fps: 60,
      speed: 1,
      quality: 20,
      ffmpegPath: resolvedFfmpeg,
    } as any);
    console.log("  Recording started (WebM @ 60fps)");
  } catch (err) {
    console.error("  Error: screencast failed. Ensure ffmpeg is installed.");
    console.error("  ", (err as Error).message);
  }

  const videoStartTime = Date.now();
  const steps: StepRecord[] = [];
  let stepIndex = 0;

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
    await scenario({ step, actor, page, baseURL });
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

    // Stop screencast capture so the overlay below is NOT recorded in the video
    try {
      await page.mainFrame().client.send('Page.stopScreencast');
    } catch { /* ignore */ }

    // Show processing overlay so the user sees feedback instead of a frozen page
    try {
      await page.evaluate(`(() => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
        overlay.innerHTML = '<div style="color:#fff;font-size:1.5rem;font-family:system-ui">Saving video\\u2026</div>';
        document.body.appendChild(overlay);
      })()`);
    } catch { /* page may already be gone on error path */ }

    // Stop recording (flushes remaining frames and waits for ffmpeg)
    if (recorder) {
      await recorder.stop();
    }

    // Close browser immediately after recording stops
    await browser.close();

    // Fix video framerate: Puppeteer's ScreenRecorder has a bug where
    // `-framerate N` is placed AFTER `-i pipe:0` in the ffmpeg command.
    // For image2pipe, -framerate is an input option and must come BEFORE -i.
    // Because of this, ffmpeg defaults to 25fps input, making the video
    // ~2.4x slower than real-time when 60fps is requested.
    // Re-encode with correct 60fps timestamps using setpts filter.
    if (recorder) {
      const rawPath = videoPath.replace(".webm", ".raw.webm");
      fs.renameSync(videoPath, rawPath);
      try {
        console.log("\n  Fixing video framerate to 60fps...");
        execFileSync(resolvedFfmpeg, [
          "-y",
          "-i", rawPath,
          "-vf", "setpts=N/60/TB",
          "-r", "60",
          "-c:v", "libvpx-vp9",
          "-crf", "30",
          "-deadline", "realtime",
          "-cpu-used", "8",
          "-b:v", "0",
          "-f", "webm",
          videoPath,
        ], { stdio: "pipe" });
        fs.unlinkSync(rawPath);
        console.log(`  Video saved: ${videoPath} (60fps)`);
      } catch (fixErr) {
        console.warn("  Framerate fix failed, keeping raw file:", (fixErr as Error).message);
        if (fs.existsSync(rawPath)) {
          fs.renameSync(rawPath, videoPath);
        }
      }
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
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log(`  Metadata:   ${metadataPath}`);
    console.log(`  Duration:   ${(durationMs / 1000).toFixed(1)}s\n`);

    return {
      mode,
      videoPath,
      subtitlesPath,
      metadataPath,
      steps,
      durationMs,
    };
  }
}
