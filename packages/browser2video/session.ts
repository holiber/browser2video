/**
 * @description Session-based API for Browser2Video.
 * Provides createSession() — the single entry point for browser/terminal
 * automation with video recording, subtitles, and narration.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "path";
import fs from "fs";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";

import type {
  SessionOptions,
  SessionResult,
  PageOptions,
  TerminalOptions,
  StepRecord,
  TerminalHandle,
  Mode,
  LayoutConfig,
  ActorDelays,
} from "./types.ts";

import { Actor, generateWebVTT, HIDE_CURSOR_INIT_SCRIPT, FAST_MODE_INIT_SCRIPT, pickMs, DEFAULT_DELAYS } from "./actor.ts";
import { composeVideos } from "./video-compositor.ts";
import {
  type AudioDirectorAPI,
  type AudioEvent,
  createAudioDirector,
  mixAudioIntoVideo,
  type NarrationOptions,
} from "./narrator.ts";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isUnderPlaywright(): boolean {
  return process.env.PLAYWRIGHT_TEST_WORKER_INDEX !== undefined;
}

/** Load .env from cwd, setting only vars that are not already defined. */
function loadDotenv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore read errors
  }
}

function resolveCallerFilename(): string {
  const orig = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const stack = new Error().stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = orig;

  for (const frame of stack) {
    const file = frame.getFileName?.() ?? "";
    if (file && !file.includes("/packages/browser2video/") && !file.includes("node_modules")) {
      const name = path.basename(file).replace(/\.(ts|js|mts|mjs)$/, "");
      return name;
    }
  }
  return "session";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ---------------------------------------------------------------------------
//  Terminal pane HTML
// ---------------------------------------------------------------------------

const TERMINAL_PAGE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e1e; color: #d4d4d4; font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 13px; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
  .bar { background: #2d2d2d; color: #cccccc; padding: 4px 12px; font-size: 12px; border-bottom: 1px solid #3e3e3e; flex-shrink: 0; }
  #out { white-space: pre-wrap; word-wrap: break-word; padding: 8px; flex: 1; overflow-y: auto; }
</style></head><body>
  <div class="bar" id="title">Terminal</div>
  <pre id="out"></pre>
  <script>
    window.__b2v_appendOutput = function(text) {
      var el = document.getElementById('out');
      el.textContent += text;
      el.scrollTop = el.scrollHeight;
    };
    window.__b2v_setTitle = function(t) {
      document.getElementById('title').textContent = t;
    };
  </script>
</body></html>`;

// ---------------------------------------------------------------------------
//  Pane state
// ---------------------------------------------------------------------------

interface PaneState {
  id: string;
  type: "browser" | "terminal";
  label: string;
  context: BrowserContext;
  page: Page;
  actor?: Actor;
  terminal?: TerminalHandle;
  rawVideoPath?: string;
  process?: ChildProcess;
  createdAtMs: number;
}

// ---------------------------------------------------------------------------
//  Session class
// ---------------------------------------------------------------------------

export class Session {
  private browser: Browser | null = null;
  private panes: Map<string, PaneState> = new Map();
  private paneOrder: string[] = [];
  private steps: StepRecord[] = [];
  private stepIndex = 0;
  private startTime = 0;
  private finished = false;

  // Resolved options
  readonly mode: Mode;
  readonly record: boolean;
  readonly headed: boolean;
  readonly artifactDir: string;
  readonly layout: LayoutConfig;
  private readonly ffmpeg: string;
  private readonly delays?: Partial<ActorDelays>;
  private narrationOpts?: NarrationOptions;
  private audioDirector!: AudioDirectorAPI & { getEvents?: () => AudioEvent[] };

  constructor(opts: SessionOptions = {}) {
    const underPW = isUnderPlaywright();

    this.mode = opts.mode
      ?? (process.env.B2V_MODE as Mode | undefined)
      ?? (underPW ? "fast" : "human");

    this.record = opts.record
      ?? (process.env.B2V_RECORD !== undefined ? process.env.B2V_RECORD !== "false" : !underPW);

    this.headed = opts.headed ?? (this.mode === "human");

    this.artifactDir = opts.outputDir
      ?? path.resolve("artifacts", `${resolveCallerFilename()}-${timestamp()}`);

    this.layout = opts.layout ?? "row";
    this.ffmpeg = opts.ffmpegPath ?? "ffmpeg";
    this.delays = opts.delays;

    // Store explicit narration opts; auto-enable happens in _init() after .env is loaded
    if (opts.narration) {
      this.narrationOpts = opts.narration;
    }
  }

  /** Launch the browser. Called automatically by createSession(). */
  async _init(): Promise<void> {
    // Lightweight inline .env loader — sets missing env vars from .env file
    loadDotenv();

    // Auto-enable narration when OPENAI_API_KEY is present and not explicitly configured
    if (!this.narrationOpts && process.env.OPENAI_API_KEY) {
      this.narrationOpts = { enabled: true };
    }

    // Apply B2V_* env var overrides for narration settings
    if (this.narrationOpts) {
      if (process.env.B2V_VOICE) this.narrationOpts.voice = process.env.B2V_VOICE;
      if (process.env.B2V_NARRATION_SPEED) this.narrationOpts.speed = parseFloat(process.env.B2V_NARRATION_SPEED);
      if (process.env.B2V_REALTIME_AUDIO) this.narrationOpts.realtime = process.env.B2V_REALTIME_AUDIO === "true";
      if (process.env.B2V_NARRATION_LANGUAGE) this.narrationOpts.language = process.env.B2V_NARRATION_LANGUAGE;
    }

    fs.mkdirSync(this.artifactDir, { recursive: true });

    this.browser = await chromium.launch({
      headless: !this.headed,
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
    });

    this.startTime = Date.now();

    this.audioDirector = createAudioDirector({
      narration: this.narrationOpts,
      videoStartTime: this.startTime,
      ffmpegPath: this.ffmpeg,
    });

    console.log(`\n  Mode:      ${this.mode}`);
    console.log(`  Record:    ${this.record ? "screencast" : "none"}`);
    console.log(`  Headed:    ${this.headed}`);
    console.log(`  Artifacts: ${this.artifactDir}\n`);
  }

  // -----------------------------------------------------------------------
  //  Public: open pages and terminals
  // -----------------------------------------------------------------------

  /**
   * Open a new browser page and return its Playwright Page and Actor.
   * The page is automatically set up for recording and cursor injection.
   */
  async openPage(opts: PageOptions = {}): Promise<{ page: Page; actor: Actor }> {
    if (!this.browser) throw new Error("Session not initialized. Use createSession().");

    const id = `pane-${this.panes.size}`;
    const label = opts.label ?? id;
    const vpW = opts.viewport?.width ?? 1280;
    const vpH = opts.viewport?.height ?? 720;

    const ctxOpts: {
      viewport: { width: number; height: number };
      recordVideo?: { dir: string; size: { width: number; height: number } };
    } = {
      viewport: { width: vpW, height: vpH },
    };

    let rawVideoPath: string | undefined;
    if (this.record) {
      rawVideoPath = path.join(this.artifactDir, `${id}.raw.webm`);
      ctxOpts.recordVideo = {
        dir: path.dirname(rawVideoPath),
        size: { width: vpW, height: vpH },
      };
    }

    const context = await this.browser.newContext(ctxOpts);
    const page = await context.newPage();

    // Set dark background on the blank page immediately to avoid white flash in recordings
    await page.evaluate(() => { document.documentElement.style.background = "#1a1a2e"; });

    // Init scripts
    if (this.mode === "human") await page.addInitScript(HIDE_CURSOR_INIT_SCRIPT);
    if (this.mode === "fast") await page.addInitScript(FAST_MODE_INIT_SCRIPT);

    // Console/error listeners
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`  [${label} Error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.log(`  [${label} Error] ${(err as Error).message}`);
    });

    const actor = new Actor(page, this.mode, { delays: this.delays });

    // Auto-inject cursor overlay after every navigation (human mode)
    if (this.mode === "human") {
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          actor.injectCursor().catch(() => {});
        }
      });
    }

    // Navigate if URL provided
    if (opts.url) {
      await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    const pane: PaneState = { id, type: "browser", label, context, page, actor, rawVideoPath, createdAtMs: Date.now() };
    this.panes.set(id, pane);
    this.paneOrder.push(id);

    if (this.record) {
      console.log(`  Recording started: ${label} (${vpW}x${vpH})`);
    }

    return { page, actor };
  }

  /**
   * Open a terminal pane (rendered in a browser page with terminal styling).
   * Returns a TerminalHandle for sending commands.
   */
  async openTerminal(opts: TerminalOptions = {}): Promise<{ terminal: TerminalHandle; page: Page }> {
    if (!this.browser) throw new Error("Session not initialized. Use createSession().");

    const id = `pane-${this.panes.size}`;
    const label = opts.label ?? id;
    const vpW = opts.viewport?.width ?? 800;
    const vpH = opts.viewport?.height ?? 600;

    const ctxOpts: {
      viewport: { width: number; height: number };
      recordVideo?: { dir: string; size: { width: number; height: number } };
    } = {
      viewport: { width: vpW, height: vpH },
    };

    let rawVideoPath: string | undefined;
    if (this.record) {
      rawVideoPath = path.join(this.artifactDir, `${id}.raw.webm`);
      ctxOpts.recordVideo = {
        dir: path.dirname(rawVideoPath),
        size: { width: vpW, height: vpH },
      };
    }

    const context = await this.browser.newContext(ctxOpts);
    const page = await context.newPage();

    // Dark background to avoid white flash before content loads
    await page.evaluate(() => { document.documentElement.style.background = "#1e1e1e"; });

    // Set terminal page content
    await page.setContent(TERMINAL_PAGE_HTML, { waitUntil: "domcontentloaded" });
    await page.evaluate((t: string) => (window as any).__b2v_setTitle(t), label);

    let termProcess: ChildProcess | undefined;
    let termHandle: TerminalHandle;

    if (opts.command) {
      const logPath = path.join(this.artifactDir, `${id}.log`);
      fs.writeFileSync(logPath, "", "utf-8");

      const proc = spawn("sh", ["-c", opts.command], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      const pushOutput = (data: Buffer) => {
        const text = String(data);
        fs.appendFileSync(logPath, text, "utf-8");
        page.evaluate((t: string) => (window as any).__b2v_appendOutput?.(t), text).catch(() => {});
      };
      proc.stdout?.on("data", pushOutput);
      proc.stderr?.on("data", pushOutput);

      termProcess = proc;
      const mode = this.mode;
      const delays = this.delays;
      termHandle = {
        send: async (text: string) => {
          const line = text.endsWith("\n") ? text : `${text}\n`;

          if (mode === "human") {
            // Type visually character by character on the terminal page
            const keyDelay = delays?.keyDelayMs
              ? pickMs(delays.keyDelayMs as [number, number])
              : pickMs(DEFAULT_DELAYS.human.keyDelayMs);
            for (const ch of text) {
              page.evaluate((c: string) => (window as any).__b2v_appendOutput?.(c), ch).catch(() => {});
              await sleep(keyDelay);
            }
            // Show newline visually
            page.evaluate((c: string) => (window as any).__b2v_appendOutput?.(c), "\n").catch(() => {});
            await sleep(50);
          }

          // Send the full line to the process
          proc.stdin?.write(line);
          await sleep(300);
        },
        page,
      };

      await sleep(300); // let process start
    } else {
      termHandle = { send: async () => {}, page };
    }

    const pane: PaneState = {
      id, type: "terminal", label, context, page,
      terminal: termHandle, rawVideoPath, process: termProcess,
      createdAtMs: Date.now(),
    };
    this.panes.set(id, pane);
    this.paneOrder.push(id);

    return { terminal: termHandle, page };
  }

  // -----------------------------------------------------------------------
  //  Public: step tracking and audio
  // -----------------------------------------------------------------------

  /**
   * Track a named step (shown in subtitles and logs).
   * Arrow function so it can be destructured from the session.
   *
   * Overloaded: pass an optional narration string as the second arg
   * to speak concurrently with the step body.
   *
   * ```ts
   * await step("Do thing", async () => { ... });
   * await step("Do thing", "Narration text", async () => { ... });
   * ```
   */
  step = async (
    caption: string,
    fnOrNarration: string | (() => Promise<void>),
    maybeFn?: () => Promise<void>,
  ): Promise<void> => {
    const narration = typeof fnOrNarration === "string" ? fnOrNarration : undefined;
    const fn = typeof fnOrNarration === "function" ? fnOrNarration : maybeFn!;

    this.stepIndex++;
    const idx = this.stepIndex;
    const startMs = Date.now() - this.startTime;
    console.log(`  [Step ${idx}] ${caption}`);

    // Pre-generate TTS so speak() starts playback instantly
    if (narration) await this.audioDirector.warmup(narration);

    // Run narration and step body concurrently
    const tasks: Promise<void>[] = [fn()];
    if (narration) tasks.push(this.audioDirector.speak(narration));
    await Promise.all(tasks);

    // Breathing pause after each step (human mode)
    const firstActor = [...this.panes.values()].find((p) => p.actor)?.actor;
    if (firstActor) await firstActor.breathe();

    const endMs = Date.now() - this.startTime;
    this.steps.push({ index: idx, caption, startMs, endMs });
  };

  /** Access the audio director for narration/sound effects. */
  get audio(): AudioDirectorAPI {
    return this.audioDirector;
  }

  // -----------------------------------------------------------------------
  //  Public: finish session
  // -----------------------------------------------------------------------

  /** Stop recording, compose video, generate subtitles and metadata. */
  async finish(): Promise<SessionResult> {
    if (this.finished) throw new Error("Session already finished.");
    this.finished = true;

    const durationMs = Date.now() - this.startTime;
    const videoPath = this.record ? path.join(this.artifactDir, "run.mp4") : undefined;
    const subtitlesPath = path.join(this.artifactDir, "captions.vtt");
    const metadataPath = path.join(this.artifactDir, "run.json");

    // Tail capture (human mode)
    if (this.record && this.mode === "human") {
      await sleep(300);
    }

    // Close pages to flush screencast recordings
    if (this.record) {
      for (const pane of this.panes.values()) {
        try {
          await pane.page.close();
          const video = pane.page.video();
          if (video && pane.rawVideoPath) await video.saveAs(pane.rawVideoPath);
        } catch (e) {
          console.error(`  Error saving video for ${pane.label}:`, (e as Error).message);
        }
      }
    }

    // Close all contexts and browser
    for (const pane of this.panes.values()) {
      try { await pane.context.close(); } catch { /* ignore */ }
    }
    if (this.browser) await this.browser.close();

    // Stop terminal processes
    for (const pane of this.panes.values()) {
      if (pane.process) {
        try { pane.process.kill("SIGTERM"); } catch { /* ignore */ }
      }
    }

    // Video composition
    if (this.record && videoPath) {
      const rawPaths = this.paneOrder
        .map((id) => this.panes.get(id)?.rawVideoPath)
        .filter((p): p is string => !!p && fs.existsSync(p));

      if (rawPaths.length > 0) {
        // Compute time offsets relative to the earliest pane for temporal alignment
        const paneCreationTimes = this.paneOrder
          .map((id) => this.panes.get(id))
          .filter((p): p is PaneState => !!p && !!p.rawVideoPath && fs.existsSync(p.rawVideoPath))
          .map((p) => p.createdAtMs);
        const earliestMs = Math.min(...paneCreationTimes);
        const startOffsets = paneCreationTimes.map((t) => t - earliestMs);

        console.log(`  Compositing ${rawPaths.length} pane(s)...`);
        try {
          composeVideos({
            inputs: rawPaths,
            outputPath: videoPath,
            ffmpeg: this.ffmpeg,
            layout: this.layout === "auto" ? "auto" : this.layout,
            targetDurationSec: durationMs / 1000,
            startOffsets,
          });
          console.log(`  Video saved: ${videoPath}`);
        } catch (err) {
          console.warn("  Video composition failed:", (err as Error).message);
          if (rawPaths[0]) {
            try {
              execFileSync(this.ffmpeg, [
                "-y", "-i", rawPaths[0],
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                videoPath,
              ], { stdio: "pipe" });
            } catch { /* ignore */ }
          }
        }
        // Clean up raw files
        for (const raw of rawPaths) {
          try { fs.unlinkSync(raw); } catch { /* ignore */ }
        }
      }
    }

    // Mix narration audio
    const audioEvents = this.audioDirector.getEvents?.() ?? [];
    if (audioEvents.length > 0 && videoPath && fs.existsSync(videoPath)) {
      mixAudioIntoVideo({ videoPath, events: audioEvents, ffmpegPath: this.ffmpeg });
    }

    // Generate subtitles
    const vtt = generateWebVTT(this.steps);
    fs.writeFileSync(subtitlesPath, vtt, "utf-8");
    console.log(`  Subtitles:  ${subtitlesPath}`);

    // Generate metadata
    const metadata = {
      mode: this.mode,
      durationMs,
      steps: this.steps,
      videoPath,
      subtitlesPath,
      recordMode: this.record ? "screencast" : "none",
      panes: [...this.panes.values()].map((p) => ({ id: p.id, type: p.type, label: p.label })),
      audioEvents: audioEvents.length > 0
        ? audioEvents.map((e) => ({ type: e.type, startMs: e.startMs, durationMs: e.durationMs, label: e.label }))
        : undefined,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log(`  Metadata:   ${metadataPath}`);
    console.log(`  Duration:   ${(durationMs / 1000).toFixed(1)}s\n`);

    return {
      video: videoPath,
      subtitles: subtitlesPath,
      metadata: metadataPath,
      artifactDir: this.artifactDir,
      durationMs,
      steps: this.steps,
      audioEvents: audioEvents.length > 0 ? audioEvents : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
//  Factory
// ---------------------------------------------------------------------------

/**
 * Create a new Browser2Video session.
 *
 * ```ts
 * import { createSession } from "browser2video";
 *
 * const session = await createSession();
 * const { step } = session;
 * const { page, actor } = await session.openPage({ url: "https://example.com" });
 * await step("Click button", async () => {
 *   await actor.click("button");
 * });
 * await session.finish();
 * ```
 */
export async function createSession(opts?: SessionOptions): Promise<Session> {
  const session = new Session(opts);
  await session._init();
  return session;
}
