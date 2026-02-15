/**
 * @description Multi-page scenario runner for collaborative (two-window) demos.
 * Launches one Playwright browser with two contexts, records each via Playwright video,
 * then composites them side-by-side into a single video using ffmpeg hstack.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "path";
import fs from "fs";
import { execFileSync, spawn, spawnSync } from "child_process";
import net from "net";
import { createRequire } from "module";
import {
  Actor,
  generateWebVTT,
  type Mode,
  type RecordMode,
  type ActorDelays,
  type StepRecord,
  type RunResult,
} from "./runner.js";
import { tryTileHorizontally } from "./window-layout.js";
import {
  tryParseDisplaySize as _tryParseDisplaySize,
  tryGetMacMainDisplayPixels as _tryGetMacMainDisplayPixels,
  probeDurationSeconds as _probeDurationSeconds,
  probeFrameCount as _probeFrameCount,
  startScreenCapture,
} from "./screen-capture.js";
import {
  type NarrationOptions,
  type AudioDirectorAPI,
  createAudioDirector,
  mixAudioIntoVideo,
} from "./narrator.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type ActorId = string;

export interface CollabActorSpec {
  /** Stable identifier used in `step(role, ...)` and per-actor artifacts. */
  id: ActorId;
  /** Human-friendly label shown in overlays/logs (e.g. "Alice"). */
  name: string;
  /** Initial path for this actor page (appended to baseURL). */
  path?: string;
}

export type StepRole = ActorId | "both";

export interface CollabScenarioContext {
  step: (role: StepRole, caption: string, fn: () => Promise<void>) => Promise<void>;
  /** Actor ids in display order (left → right). */
  actorIds: readonly [ActorId, ActorId];
  /** Actor display names by id. */
  actorNames: Record<ActorId, string>;
  /** Actors by id. */
  actors: Record<ActorId, Actor>;
  /** Pages by id. */
  pages: Record<ActorId, Page>;
  baseURL: string | undefined;
  setOverlaySeq: (actorId: ActorId, seq: number, title: string) => Promise<void>;
  setOverlayApplied: (actorId: ActorId, seq: number, title: string) => Promise<void>;
  reviewerCmd: (cmd: string) => Promise<void>;
  /** Audio director for narration and sound effects (no-op when narration is disabled) */
  audio: AudioDirectorAPI;
}

export interface CollabRunnerOptions {
  mode: Mode;
  baseURL?: string;
  artifactDir: string;
  scenario: (ctx: CollabScenarioContext) => Promise<void>;
  ffmpegPath?: string;
  headless?: boolean;
  delays?: Partial<ActorDelays>;
  /**
   * Show the sync debug overlay (small text box in the top-left corner).
   * Defaults to false.
   */
  debugOverlay?: boolean;
  /**
   * Actor definitions (exactly 2).
   * If omitted, defaults to:
   * - { id: "boss", name: "Boss", path: bossPath }
   * - { id: "worker", name: "Worker", path: workerPath }
   */
  actors?: readonly [CollabActorSpec, CollabActorSpec];
  /**
   * Recording mode:
   * - "screencast": per-page CDP screencasts composed side-by-side
   * - "screen": single FFmpeg screen capture (one clock, no drift)
   * - "none": no recording (run scenario only)
   *
   * If `headless === true`, "screen" is not possible and we fall back to "screencast".
   */
  recordMode?: RecordMode;
  /** macOS only (avfoundation): capture screen index, e.g. 1 for "Capture screen 0" */
  screenIndex?: number;
  /** Linux only (x11grab): X11 DISPLAY, e.g. ":99" (defaults to process.env.DISPLAY) */
  display?: string;
  /** Linux only (x11grab): capture size, e.g. "1920x1080" */
  displaySize?: string;
  /** Optional WebSocket sync URL (if provided, no local sync-server is started). */
  wsUrl?: string;
  /** @deprecated Use `actors[0].path` */
  bossPath?: string;
  /** @deprecated Use `actors[1].path` */
  workerPath?: string;
  /**
   * CSS selector of the element to capture.  When set, each video stream is
   * cropped to the element's bounding box (+ padding) before compositing.
   * This eliminates empty space around the component in the final video.
   */
  captureSelector?: string;
  /** Extra pixels around the captured element (default 16). */
  capturePadding?: number;
  /** Narration options (TTS voice-over + sound effects) */
  narration?: NarrationOptions;
}

/** Crop rectangle (in pixels, even-aligned for codec compatibility). */
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function tryGetMacDesktopBounds():
  | { left: number; top: number; right: number; bottom: number; width: number; height: number }
  | null {
  if (process.platform !== "darwin") return null;
  try {
    // Finder desktop bounds (in screen coordinates): {left, top, right, bottom}
    // Example output: "0, 0, 3456, 2234"
    const out = execFileSync(
      "osascript",
      ["-e", 'tell application "Finder" to get bounds of window of desktop'],
      { stdio: "pipe" },
    )
      .toString("utf-8")
      .trim();
    const parts = out.split(",").map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [left, top, right, bottom] = parts;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    return { left, top, right, bottom, width, height };
  } catch {
    return null;
  }
}

const tryGetMacMainDisplayPixels = _tryGetMacMainDisplayPixels;

function tryGetMacMenuBarHeightPts(): number {
  if (process.platform !== "darwin") return 0;
  try {
    // Returns something like: "1440, 28"
    const out = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to tell process "SystemUIServer" to get size of menu bar 1',
      ],
      { stdio: "pipe" },
    )
      .toString("utf-8")
      .trim();
    const parts = out.split(",").map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2) return 0;
    const h = parts[1];
    return Number.isFinite(h) && h > 0 ? h : 0;
  } catch {
    return 0;
  }
}

function roundEven(n: number) {
  return Math.round(n / 2) * 2;
}

const tryParseDisplaySize = _tryParseDisplaySize;

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to get free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPort(host: string, port: number, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(`sync server did not open port ${host}:${port} within ${timeoutMs}ms`);
}

async function startSyncServer(opts: { artifactDir: string }): Promise<{ wsUrl: string; stop: () => Promise<void> }> {
  const port = await getFreePort();
  const dataDir = path.join(opts.artifactDir, "sync-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const bin = (() => {
    // Works in pnpm workspaces (binary might not exist in root node_modules/.bin)
    const pkgJsonPath = require.resolve("@automerge/automerge-repo-sync-server/package.json");
    const pkgDir = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as any;
    const binRel =
      typeof pkg.bin === "string"
        ? pkg.bin
        : (pkg.bin?.["automerge-repo-sync-server"] ?? Object.values(pkg.bin ?? {})[0]);
    if (!binRel) {
      throw new Error("Failed to resolve @automerge/automerge-repo-sync-server binary path");
    }
    return path.resolve(pkgDir, String(binRel));
  })();
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
  };

  const proc = spawn(process.execPath, [bin], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (c) => {
    stderr += String(c);
    if (stderr.length > 32768) stderr = stderr.slice(-32768);
  });

  await waitForPort("127.0.0.1", port, 8000);
  const wsUrl = `ws://127.0.0.1:${port}`;
  console.log(`  Sync server: ${wsUrl}`);

  const stop = async () => {
    try { proc.kill("SIGINT"); } catch { /* ignore */ }
    await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    if (proc.exitCode && proc.exitCode !== 0) {
      console.warn(`  Sync server exited with code ${proc.exitCode}`);
      if (stderr.trim()) console.warn(`  Sync server stderr:\n${stderr.trim()}`);
    }
  };

  return { wsUrl, stop };
}

async function installSyncOverlay(page: Page, roleLabel: string) {
  await page.addInitScript((role: string) => {
    (function () {
      const w: any = globalThis as any;
      w.__b2v_role = role;
      if (w.__b2v_sync_overlay_installed) return;
      w.__b2v_sync_overlay_installed = true;

      const createOverlay = () => {
        const doc = w.document;
        if (!doc) return null;

        let el = doc.getElementById("__b2v_sync_overlay");
        if (!el) {
          el = doc.createElement("div");
          el.id = "__b2v_sync_overlay";
          el.style.cssText = [
            "position:absolute",
            "top:8px",
            "left:8px",
            "z-index:999999",
            "font:12px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            "color:#fff",
            "background:rgba(0,0,0,0.6)",
            "border:1px solid rgba(255,255,255,0.25)",
            "border-radius:6px",
            "padding:6px 8px",
            "max-width:320px",
            "white-space:pre",
          ].join(";");
        }
        return el;
      };

      const mount = (overlay: any) => {
        const doc = w.document;
        const host = doc.querySelector('[data-testid="notes-page"]') ?? doc.body;
        if (!host) return;
        const hostEl: any = host;
        const cs = w.getComputedStyle(hostEl);
        if (cs.position === "static") hostEl.style.position = "relative";
        if (overlay.parentElement !== hostEl) hostEl.appendChild(overlay);
      };

      const tick = () => {
        const overlay: any = createOverlay();
        if (!overlay) return;
        mount(overlay);

        const epoch = (w.__b2v_epochMs as number | undefined) ?? Date.now();
        const t = Date.now() - epoch;
        const seq = w.__b2v_seq ?? "-";
        const seqTitle = w.__b2v_seqTitle ?? "";
        const applied = w.__b2v_appliedSeq ?? "-";
        const appliedTitle = w.__b2v_appliedTitle ?? "";

        const roleTxt = w.__b2v_role ?? "ROLE";
        const lines: string[] = [];
        lines.push(`${roleTxt} t=${t}ms`);
        lines.push(`seq=${seq} ${seqTitle ? `"${seqTitle}"` : ""}`);
        lines.push(`applied=${applied} ${appliedTitle ? `"${appliedTitle}"` : ""}`);
        overlay.textContent = lines.join("\n");
      };

      w.addEventListener("DOMContentLoaded", () => {
        tick();
        w.setInterval(tick, 100);
      });
    })();
  }, roleLabel);
}

async function setOverlayEpochAndRole(page: Page, epochMs: number, roleLabel: string) {
  await page.evaluate(([epoch, role]: [number, string]) => {
    const w = globalThis as any;
    w.__b2v_epochMs = epoch;
    w.__b2v_role = role;
  }, [epochMs, roleLabel] as [number, string]);
}

async function setOverlaySeq(page: Page, seq: number, title: string) {
  await page.evaluate(([s, t]: [number, string]) => {
    const w = globalThis as any;
    w.__b2v_seq = s;
    w.__b2v_seqTitle = t;
  }, [seq, title] as [number, string]);
}

async function setOverlayApplied(page: Page, seq: number, title: string) {
  await page.evaluate(([s, t]: [number, string]) => {
    const w = globalThis as any;
    w.__b2v_appliedSeq = s;
    w.__b2v_appliedTitle = t;
  }, [seq, title] as [number, string]);
}

/**
 * Single-pass: normalise framerates + composite side-by-side.
 *
 * Uses `setpts=N/60/TB` to assign deterministic PTS by frame index (Playwright
 * screencast PTS values are unreliable), `fps=60` to regularise the framerate,
 * and `hstack` with `shortest=1` so neither stream outruns the other.
 *
 * Both screencasts are started simultaneously via `Promise.all`, so both
 * streams receive frames at the same rate over the same wall-clock interval
 * and `N/60/TB` keeps them in sync.
 */
/**
 * Probe a video file's width using ffmpeg (ffprobe may not be available).
 * Parses the "Stream ... Video: ... 2560x1440" line from ffmpeg stderr.
 * Returns 0 if probing fails.
 */
function probeWidth(videoPath: string, ffmpeg: string): number {
  const res = spawnSync(ffmpeg, ["-i", videoPath], { encoding: "utf-8" });
  const text = String(res.stderr ?? "") + String(res.stdout ?? "");
  const match = text.match(/Stream.*Video:.* (\d{3,5})x(\d{3,5})/);
  return match ? parseInt(match[1], 10) : 0;
}

const probeDurationSeconds = _probeDurationSeconds;
const probeFrameCount = _probeFrameCount;

function composeSideBySide(
  leftPath: string,
  rightPath: string,
  outputPath: string,
  ffmpeg: string,
  cssCrop?: CropRect,
  cssViewportW = 1280,
  targetDurationSec?: number,
): void {
  // If crop is requested, scale CSS pixels to actual video pixels by probing
  // the raw video dimensions.  On Retina Macs the screencast captures at 2x
  // even when Playwright sets deviceScaleFactor to 1.
  let cropFilter = "";
  if (cssCrop) {
    const actualW = probeWidth(leftPath, ffmpeg);
    const scale = actualW > 0 ? Math.round(actualW / cssViewportW) : 1;
    const c = {
      x: cssCrop.x * scale,
      y: cssCrop.y * scale,
      w: cssCrop.w * scale,
      h: cssCrop.h * scale,
    };
    cropFilter = `,crop=${c.w}:${c.h}:${c.x}:${c.y}`;
    if (scale !== 1) console.log(`  Video scale: ${scale}x (${actualW}px actual vs ${cssViewportW}px CSS)`);
  }

  const leftDur = probeDurationSeconds(leftPath, ffmpeg);
  const rightDur = probeDurationSeconds(rightPath, ffmpeg);
  if (leftDur > 0 || rightDur > 0) {
    console.log(`  Raw durations: left=${leftDur.toFixed(2)}s, right=${rightDur.toFixed(2)}s`);
  }

  // If raw WebM timestamps are odd, PTS-STARTPTS can make the output feel
  // slowed/fast. We can time-warp each stream to match the wall-clock scenario
  // duration so playback pace matches subtitles/steps.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const target = targetDurationSec && targetDurationSec > 0 ? targetDurationSec : 0;
  const leftFactor = leftDur > 0.1 && target > 0 ? clamp(target / leftDur, 0.25, 4) : 1;
  const rightFactor = rightDur > 0.1 && target > 0 ? clamp(target / rightDur, 0.25, 4) : 1;
  if (target > 0) {
    console.log(`  Target duration: ${target.toFixed(2)}s`);
    console.log(`  PTS warp factors: left=${leftFactor.toFixed(4)}, right=${rightFactor.toFixed(4)}`);
  }

  // Prefer N-based setpts if we can probe frame counts. This ignores broken input PTS
  // and maps both streams onto the same wall-clock timeline.
  let leftSetpts: string;
  let rightSetpts: string;
  const leftFrames = target > 0 ? probeFrameCount(leftPath, ffmpeg) : 0;
  const rightFrames = target > 0 ? probeFrameCount(rightPath, ffmpeg) : 0;
  if (target > 0 && leftFrames > 0 && rightFrames > 0) {
    const leftSpf = target / leftFrames;
    const rightSpf = target / rightFrames;
    leftSetpts = `N*${leftSpf.toFixed(9)}/TB`;
    rightSetpts = `N*${rightSpf.toFixed(9)}/TB`;
    console.log(`  Raw frames: left=${leftFrames}, right=${rightFrames}`);
    console.log(`  Sec/frame:  left=${leftSpf.toFixed(6)}s, right=${rightSpf.toFixed(6)}s`);
  } else {
    leftSetpts = leftFactor !== 1 ? `(PTS-STARTPTS)*${leftFactor.toFixed(6)}` : "PTS-STARTPTS";
    rightSetpts = rightFactor !== 1 ? `(PTS-STARTPTS)*${rightFactor.toFixed(6)}` : "PTS-STARTPTS";
  }

  // Use timestamps (avoids long-run drift if streams drop frames differently),
  // then resample to 60fps for smooth playback.
  const leftFilter  = `[0:v]setpts=${leftSetpts},fps=60${cropFilter}[left]`;
  const rightFilter = `[1:v]setpts=${rightSetpts},fps=60${cropFilter}[right]`;
  const filterComplex = `${leftFilter};${rightFilter};[left][right]hstack=inputs=2:shortest=1[v]`;

  const args = [
    "-y",
    "-i", leftPath,
    "-i", rightPath,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    // Force a constant 60fps output stream
    "-r", "60",
    "-fps_mode", "cfr",
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
    outputPath,
  ];

  try {
    execFileSync(ffmpeg, args, { stdio: "pipe" });
  } catch (err: any) {
    const stderr: string = err?.stderr ?? "";
    // Some ffmpeg builds don't support -fps_mode; fall back to -vsync cfr.
    if (stderr.includes("fps_mode") && (stderr.includes("Unrecognized option") || stderr.includes("Option not found"))) {
      const fallbackArgs = args
        .filter((a) => a !== "-fps_mode" && a !== "cfr")
        .flatMap((a) => [a]);
      // Insert -vsync cfr after -r 60
      const rIdx = fallbackArgs.findIndex((a) => a === "-r");
      if (rIdx >= 0) {
        fallbackArgs.splice(rIdx + 2, 0, "-vsync", "cfr");
      }
      execFileSync(ffmpeg, fallbackArgs, { stdio: "pipe" });
    } else {
      throw err;
    }
  }

  const outDur = probeDurationSeconds(outputPath, ffmpeg);
  if (outDur > 0) console.log(`  Output duration: ${outDur.toFixed(2)}s`);
}

/** @deprecated Use startScreenCapture from screen-capture.ts — this is a thin wrapper for backward compat */
const runFfmpegScreenRecording = (opts: {
  ffmpeg: string;
  outputPath: string;
  fps: number;
  recordMode: RecordMode;
  screenIndex?: number;
  display?: string;
  displaySize?: string;
  crop?: { x: number; y: number; w: number; h: number };
}) => startScreenCapture(opts);

// ---------------------------------------------------------------------------
//  Runner
// ---------------------------------------------------------------------------

export async function runCollab(opts: CollabRunnerOptions): Promise<RunResult> {
  const { mode, baseURL, artifactDir, scenario, ffmpegPath } = opts;
  const debugOverlay = opts.debugOverlay ?? false;

  fs.mkdirSync(artifactDir, { recursive: true });

  const actorSpecs: readonly [CollabActorSpec, CollabActorSpec] =
    opts.actors ??
    ([
      { id: "boss", name: "Boss", path: opts.bossPath ?? "/notes?role=boss" },
      { id: "worker", name: "Worker", path: opts.workerPath ?? "/notes?role=worker" },
    ] as const);

  const [a0, a1] = actorSpecs;
  if (!a0?.id || !a1?.id) {
    throw new Error("collab runner requires exactly 2 actors with stable ids");
  }
  if (a0.id === a1.id) {
    throw new Error(`collab runner requires 2 distinct actor ids (got "${a0.id}")`);
  }

  const actorIds = [a0.id, a1.id] as const;
  const actorNames: Record<ActorId, string> = { [a0.id]: a0.name, [a1.id]: a1.name };

  const a0VideoRaw = path.join(artifactDir, `${a0.id}.raw.webm`);
  const a1VideoRaw = path.join(artifactDir, `${a1.id}.raw.webm`);
  const screencastVideoPath = path.join(artifactDir, "run.mp4");
  const screenVideoPath = path.join(artifactDir, "run.mp4");
  const subtitlesPath = path.join(artifactDir, "captions.vtt");
  const a0SubtitlesPath = path.join(artifactDir, `${a0.id}-captions.vtt`);
  const a1SubtitlesPath = path.join(artifactDir, `${a1.id}-captions.vtt`);
  const metadataPath = path.join(artifactDir, "run.json");

  const requestedHeadless = opts.headless ?? (mode === "fast");
  const resolvedFfmpeg = ffmpegPath ?? "ffmpeg";

  // Recording mode selection:
  // - In headless runs, screen capture isn't possible.
  // - On Linux CI with DISPLAY (Xvfb), screen capture is the most reliable (one clock).
  const autoRecordMode: RecordMode =
    !requestedHeadless && process.platform !== "darwin" && !!process.env.DISPLAY
      ? "screen"
      : "screencast";
  let recordMode: RecordMode = opts.recordMode ?? autoRecordMode;
  if (requestedHeadless && recordMode === "screen") recordMode = "screencast";
  const headless = recordMode === "screen" ? false : requestedHeadless;

  const videoPath =
    recordMode === "none"
      ? undefined
      : (recordMode === "screen" ? screenVideoPath : screencastVideoPath);

  console.log(`\n  Mode:      ${mode}`);
  console.log(`  Headless:  ${headless}`);
  console.log(`  Record:    ${recordMode}`);
  console.log(`  Base URL:  ${baseURL ?? "(external)"}`);
  console.log(`  Artifacts: ${artifactDir}`);
  console.log(`  Layout:    tiles (${a0.name} | ${a1.name} | Reviewer)\n`);

  const macBounds = recordMode === "screen" ? tryGetMacDesktopBounds() : null;
  const macMenuBarPts = recordMode === "screen" ? tryGetMacMenuBarHeightPts() : 0;
  const linuxDisplaySize =
    recordMode === "screen" && process.platform !== "darwin"
      ? (tryParseDisplaySize(opts.displaySize) ?? { w: 2560, h: 720 })
      : null;
  const tileW =
    recordMode === "screen"
      ? Math.max(520, Math.floor(((macBounds?.width ?? linuxDisplaySize?.w ?? 2880)) / 3))
      : 960;
  const tileH =
    recordMode === "screen"
      ? (process.platform === "darwin"
        ? Math.min(900, Math.max(480, (macBounds?.height ?? 900) - macMenuBarPts))
        : (linuxDisplaySize?.h ?? 800))
      : 800;

  const viewportW = recordMode === "screen" ? Math.min(960, tileW) : 1280;
  const viewportH = 720;

  // Start a local WebSocket sync server if needed (for Node reviewer / cross-process sync).
  // If a wsUrl is provided, we use it as-is.
  let wsUrl: string | undefined = opts.wsUrl;
  let stopSyncServer: (() => Promise<void>) | undefined;
  if (!wsUrl) {
    const started = await startSyncServer({ artifactDir });
    wsUrl = started.wsUrl;
    stopSyncServer = started.stop;
  }

  // Reviewer processes (Linux screen recording path)
  let reviewerProc: ReturnType<typeof spawn> | undefined;
  let reviewerTerminalProc: ReturnType<typeof spawn> | undefined;
  const reviewerLogPath = path.join(artifactDir, "reviewer.log");
  const reviewerPidPath = path.join(artifactDir, "reviewer.pid");
  const isMacScreen = recordMode === "screen" && process.platform === "darwin";
  let macReviewerWindowId: number | null = null;
  const reviewerCmd = async (cmd: string) => {
    if (isMacScreen) {
      const typeScript = (wid: number | null) => `
        set cmdText to ${JSON.stringify(cmd)}
        tell application "Terminal"
          activate
          try
            ${wid ? `set front window to (first window whose id is ${wid})` : ""}
          end try
        end tell
        delay 0.05
        tell application "System Events"
          tell process "Terminal"
            set frontmost to true
            repeat with i from 1 to (count of cmdText)
              keystroke (character i of cmdText)
              delay 0.02
            end repeat
            delay 0.18
            key code 36
          end tell
        end tell
      `;
      spawnSync("osascript", ["-e", typeScript(macReviewerWindowId)], { stdio: "ignore" });
      await sleep(300);
      return;
    }

    if (!reviewerProc?.stdin) throw new Error("reviewer process is not running");
    reviewerProc.stdin.write(cmd.endsWith("\n") ? cmd : `${cmd}\n`);
  };

  // Launch browser
  const isScreencast = recordMode === "screencast";
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--disable-background-networking",
  ];

  const browser: Browser = await chromium.launch({
    headless,
    args: launchArgs,
  });

  // Create two separate browser contexts (each opens its own window)
  const a0ContextOpts: {
    viewport: { width: number; height: number };
    recordVideo?: { dir: string; size: { width: number; height: number } };
  } = {
    viewport: { width: viewportW, height: viewportH },
  };
  const a1ContextOpts = { ...a0ContextOpts };

  if (isScreencast) {
    a0ContextOpts.recordVideo = {
      dir: path.dirname(a0VideoRaw),
      size: { width: viewportW, height: viewportH },
    };
    a1ContextOpts.recordVideo = {
      dir: path.dirname(a1VideoRaw),
      size: { width: viewportW, height: viewportH },
    };
  }

  const a0Context: BrowserContext = await browser.newContext(a0ContextOpts);
  const a0Page: Page = await a0Context.newPage();
  const a1Context: BrowserContext = await browser.newContext(a1ContextOpts);
  const a1Page: Page = await a1Context.newPage();

  // Tile the browser windows so all panes fit on screen.
  if (!headless) {
    const baseLeft = macBounds?.left ?? 0;
    const baseTop = macBounds?.top ?? 0;
    const safeTop = process.platform === "darwin" ? baseTop + macMenuBarPts : baseTop;
    await tryTileHorizontally([a0Page, a1Page], {
      left: baseLeft,
      top: safeTop,
      tileWidth: tileW,
      tileHeight: tileH,
    });
  }

  // Hide default cursor on both pages (human mode)
  const hideCursorScript = `
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '* { cursor: none !important; }';
      document.head.appendChild(s);
    });
  `;
  if (mode === "human") {
    await a0Page.addInitScript(hideCursorScript);
    await a1Page.addInitScript(hideCursorScript);
  }

  // Optional: install a small in-page overlay used to debug sync (must be inside the
  // captured component crop, so it mounts into [data-testid="notes-page"]).
  if (debugOverlay) {
    await installSyncOverlay(a0Page, a0.name);
    await installSyncOverlay(a1Page, a1.name);
  }

  // Fast mode: reduce UI animations for determinism and speed.
  if (mode === "fast") {
    const css = `
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
    `;
    await a0Page.addInitScript(css);
    await a1Page.addInitScript(css);
  }

  const a0Actor = new Actor(a0Page, mode, { delays: opts.delays });
  const a1Actor = new Actor(a1Page, mode, { delays: opts.delays });
  const actors: Record<ActorId, Actor> = { [a0.id]: a0Actor, [a1.id]: a1Actor };
  const pages: Record<ActorId, Page> = { [a0.id]: a0Page, [a1.id]: a1Page };

  // Navigate pages to their starting URLs before recording begins.
  // Boss goes first so it creates the Automerge document; we then read
  // the hash (#automerge:...) and pass it to Worker so both share one doc.
  //
  // We use "domcontentloaded" instead of "networkidle0" because Automerge's
  // IndexedDB storage adapter keeps background activity that prevents
  // networkidle0 from ever resolving.
  if (baseURL) {
    const a0URL = (() => {
      const u = new URL(`${baseURL}${a0.path ?? "/"}`);
      if (wsUrl) u.searchParams.set("ws", wsUrl);
      return u.toString();
    })();
    await a0Page.goto(a0URL, { waitUntil: "domcontentloaded" });
    await a0Actor.injectCursor();

    // Wait for the Boss page to create the doc and set the location hash
    await a0Page.waitForFunction(
      () => (globalThis as any).document.location.hash.length > 1,
      undefined,
      { timeout: 10000 },
    );
    const hash = await a0Page.evaluate(() => (globalThis as any).document.location.hash);
    console.log(`  Boss doc hash: ${hash}`);

    // Start Reviewer. On macOS screen recording we run the CLI *inside Terminal.app*
    // and send commands by typing; on Linux/other we keep an in-process CLI and (on
    // Linux screen mode) show the log in xterm.
    fs.writeFileSync(reviewerLogPath, "", "utf-8");
    const docUrl = hash.startsWith("#") ? hash.slice(1) : hash;

    if (isMacScreen) {
      const baseLeft = macBounds?.left ?? 0;
      const baseTop = macBounds?.top ?? 0;
      const x = baseLeft + tileW * 2;
      const y = baseTop + macMenuBarPts;
      const w = tileW;
      const h = tileH;

      const repoDir = process.cwd();
      const logPath = reviewerLogPath;
      const ws = wsUrl ?? "";
      const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
      const pidPath = reviewerPidPath;
      const cmd = `cd ${JSON.stringify(repoDir)} && ${JSON.stringify(tsxPath)} packages/runner/src/reviewer-cli.ts --ws ${JSON.stringify(ws)} --doc ${JSON.stringify(docUrl)} --log ${JSON.stringify(logPath)} --pidfile ${JSON.stringify(pidPath)}`;
      const cmdAs = JSON.stringify(cmd);

      const script = `
        tell application "Terminal"
          activate
          set t to do script ""
          delay 0.15
          do script ${cmdAs} in t
          set wid to id of front window
        end tell
        delay 0.2
        tell application "System Events"
          tell process "Terminal"
            set frontmost to true
            try
              set position of front window to {${x}, ${y}}
              set size of front window to {${w}, ${h}}
            end try
          end tell
        end tell
        return wid
      `;
      const res = spawnSync("osascript", ["-e", script], { encoding: "utf-8" as any });
      const wid = parseInt(String((res as any).stdout ?? "").trim(), 10);
      if (Number.isFinite(wid)) macReviewerWindowId = wid;
      await sleep(400);
    } else {
      const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
      reviewerProc = spawn(
        tsxBin,
        [
          path.join(process.cwd(), "packages", "runner", "src", "reviewer-cli.ts"),
          "--ws",
          wsUrl ?? "",
          "--doc",
          docUrl,
          "--log",
          reviewerLogPath,
        ],
        { stdio: ["pipe", "ignore", "pipe"], env: process.env },
      );
      let reviewerStderr = "";
      reviewerProc.stderr?.on("data", (c) => {
        reviewerStderr += String(c);
        if (reviewerStderr.length > 32768) reviewerStderr = reviewerStderr.slice(-32768);
      });
      reviewerProc.once("exit", (code) => {
        if (code && code !== 0) {
          console.warn(`  Reviewer CLI exited with code ${code}`);
          if (reviewerStderr.trim()) console.warn(`  Reviewer stderr:\n${reviewerStderr.trim()}`);
        }
      });

      // Give the CLI a moment to connect and start logging.
      await sleep(300);

      if (recordMode === "screen") {
        // Linux: xterm
        reviewerTerminalProc = spawn(
          "xterm",
          [
            "-geometry",
            `96x40+${tileW * 2}+0`,
            "-fa",
            "Monospace",
            "-fs",
            "11",
            "-T",
            "Reviewer",
            "-e",
            "bash",
            "-lc",
            `tail -n +1 -f "${reviewerLogPath}"`,
          ],
          { stdio: "ignore", env: process.env },
        );
      }
    }

    // Second actor joins the same document by navigating with the first actor's hash
    const a1URL = (() => {
      const u = new URL(`${baseURL}${a1.path ?? "/"}`);
      if (wsUrl) u.searchParams.set("ws", wsUrl);
      // Preserve the shared document hash
      u.hash = hash;
      return u.toString();
    })();
    await a1Page.goto(a1URL, { waitUntil: "domcontentloaded" });
    await a1Actor.injectCursor();

    // Let Automerge Repo sync the document between windows
    await sleep(800);

    // Re-inject cursors after React has fully rendered
    await a0Actor.injectCursor();
    await a1Actor.injectCursor();
  }

  // Resolve capture crop region (if captureSelector is set)
  let crop: CropRect | undefined;
  if (recordMode === "screencast" && opts.captureSelector) {
    const padding = opts.capturePadding ?? 16;

    // Measure on the Boss page (layout is identical on both)
    const box = await a0Page.evaluate((sel: string) => {
      const doc = (globalThis as any).document;
      const el = doc.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, opts.captureSelector);

    if (box) {
      // Store crop in CSS pixels; the actual DPR multiplier is determined
      // during post-processing by probing the raw video dimensions (the
      // screencast may capture at 2x on Retina Macs even though Playwright
      // sets deviceScaleFactor to 1).
      const even = (n: number) => Math.round(n / 2) * 2;
      const cssX = even(Math.max(0, Math.floor(box.x - padding)));
      const cssW = even(Math.min(viewportW - cssX, Math.ceil(box.width + padding * 2)));
      crop = { x: cssX, y: 0, w: cssW, h: viewportH };
      console.log(`  Capture crop (CSS): ${cssW}×${viewportH} @ (${cssX},0)  [${opts.captureSelector}]`);
    } else {
      console.warn(`  Warning: captureSelector "${opts.captureSelector}" not found, recording full viewport`);
    }
  }

  // Start recording:
  // - screencast: Playwright's recordVideo per context (composed later)
  // - screen: single FFmpeg screen capture (one clock, no drift)
  let screenRecorder: { stop: () => Promise<void> } | undefined;

  try {
    if (recordMode === "none") {
      console.log("  Recording disabled");
    } else if (recordMode === "screen") {
      if (!videoPath) throw new Error("internal: videoPath missing for screen recording");
      const baseLeft = macBounds?.left ?? 0;
      const baseTop = macBounds?.top ?? 0;
      const crop3 = (() => {
        if (process.platform !== "darwin") return undefined;
        // macBounds are in points; avfoundation crop expects pixels on Retina.
        const px = tryGetMacMainDisplayPixels();
        const dpr =
          px && macBounds?.width
            ? px.width / macBounds.width
            : 1;
        const safeTop = baseTop + macMenuBarPts;
        return {
          x: roundEven(baseLeft * dpr),
          y: roundEven(safeTop * dpr),
          w: roundEven(tileW * 3 * dpr),
          h: roundEven(tileH * dpr),
        };
      })();
      screenRecorder = await runFfmpegScreenRecording({
        ffmpeg: resolvedFfmpeg,
        outputPath: videoPath,
        fps: 60,
        recordMode,
        screenIndex: opts.screenIndex,
        display: opts.display,
        displaySize: opts.displaySize,
        crop: crop3,
      });
      console.log("  Recording started: Screen (FFmpeg @ 60fps)");
    } else {
      // Screencast mode: recording is handled by Playwright's recordVideo context option
      console.log("  Recording started: Boss + Worker (video)");
    }
  } catch (err) {
    console.error("  Error: recording start failed:", (err as Error).message);
  }

  const videoStartTime = Date.now();
  // Establish a shared epoch for the on-video overlay timestamps.
  await setOverlayEpochAndRole(a0Page, videoStartTime, a0.name);
  await setOverlayEpochAndRole(a1Page, videoStartTime, a1.name);
  const steps: (StepRecord & { role: StepRole })[] = [];
  let stepIndex = 0;

  // Create audio director (real or no-op depending on narration config)
  const audioDirector = createAudioDirector({
    narration: opts.narration,
    videoStartTime,
    ffmpegPath: resolvedFfmpeg,
  });

  // Capture console errors from both pages
  for (const [label, pg] of [[a0.name, a0Page], [a1.name, a1Page]] as const) {
    pg.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`  [${label} Error] ${msg.text()}`);
      }
    });
    pg.on("pageerror", (err) => {
      console.log(`  [${label} Error] ${(err as Error).message}`);
    });
  }

  async function step(role: StepRole, caption: string, fn: () => Promise<void>) {
    stepIndex++;
    const idx = stepIndex;
    const startMs = Date.now() - videoStartTime;
    console.log(`  [Step ${idx}] ${caption}`);

    await fn();

    // Breathing pause (human mode)
    await a0Actor.breathe();

    const endMs = Date.now() - videoStartTime;
    steps.push({ index: idx, caption, startMs, endMs, role });
  }

  // Run scenario
  const scenarioStart = Date.now();
  try {
    await scenario({
      step,
      actorIds,
      actorNames,
      actors,
      pages,
      baseURL,
      setOverlaySeq: (actorId: ActorId, seq: number, title: string) => setOverlaySeq(pages[actorId], seq, title),
      setOverlayApplied: (actorId: ActorId, seq: number, title: string) => setOverlayApplied(pages[actorId], seq, title),
      reviewerCmd,
      audio: audioDirector,
    });
  } catch (err) {
    console.error("\n  Scenario failed:", (err as Error).message);
    try {
      await a0Page.screenshot({ path: path.join(artifactDir, `${a0.id}-failure.png`) });
      await a1Page.screenshot({ path: path.join(artifactDir, `${a1.id}-failure.png`) });
      console.log("  Failure screenshots saved.");
    } catch { /* ignore */ }
    throw err;
  } finally {
    const durationMs = Date.now() - scenarioStart;

    // Stop recorders
    let t0 = Date.now();
    if (screenRecorder) await screenRecorder.stop();
    console.log(`\n  Recorders stopped      (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    // Show processing overlay
    for (const pg of [a0Page, a1Page]) {
      try {
        await pg.evaluate(`(() => {
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
          overlay.innerHTML = '<div style="color:#fff;font-size:1.5rem;font-family:system-ui">Saving video\\u2026</div>';
          document.body.appendChild(overlay);
        })()`);
      } catch { /* ignore */ }
    }

    // Finalize video recordings by closing pages/contexts
    if (isScreencast) {
      try {
        await a0Page.close();
        await a1Page.close();
        const a0Video = a0Page.video();
        const a1Video = a1Page.video();
        if (a0Video) await a0Video.saveAs(a0VideoRaw);
        if (a1Video) await a1Video.saveAs(a1VideoRaw);
      } catch (e) {
        console.error("  Error saving video:", (e as Error).message);
      }
    }

    t0 = Date.now();
    await a0Context.close();
    await a1Context.close();
    await browser.close();
    console.log(`  Browser closed         (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    // Stop/close reviewer UI + process.
    if (isMacScreen) {
      try {
        const pid = parseInt(fs.readFileSync(reviewerPidPath, "utf-8").trim(), 10);
        if (Number.isFinite(pid)) {
          try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (macReviewerWindowId) {
        try {
          spawnSync(
            "osascript",
            ["-e", `tell application "Terminal" to close (every window whose id is ${macReviewerWindowId})`],
            { stdio: "ignore" },
          );
        } catch { /* ignore */ }
      }
    } else {
      try { reviewerTerminalProc?.kill("SIGTERM"); } catch { /* ignore */ }
      try { reviewerProc?.kill("SIGTERM"); } catch { /* ignore */ }
    }
    if (stopSyncServer) {
      await stopSyncServer();
    }

    // Post-process: single-pass hstack compose
    if (isScreencast && fs.existsSync(a0VideoRaw) && fs.existsSync(a1VideoRaw)) {
      console.log("  Compositing side-by-side (single pass)...");
      try {
        t0 = Date.now();
        composeSideBySide(
          a0VideoRaw,
          a1VideoRaw,
          screencastVideoPath,
          resolvedFfmpeg,
          crop,
          viewportW,
          durationMs / 1000,
        );
        console.log(`  Composition done       (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        console.log(`  Video saved: ${screencastVideoPath}`);
      } catch (err) {
        console.warn("  Side-by-side composition failed:", (err as Error).message);
        // Fallback: just copy the left stream
        fs.copyFileSync(a0VideoRaw, screencastVideoPath);
      }

      // Clean up raw screencast files
      t0 = Date.now();
      for (const f of [a0VideoRaw, a1VideoRaw]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      console.log(`  Raw files cleaned up   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } else if (recordMode === "screen") {
      console.log(`  Video saved: ${screenVideoPath}`);
    }

    // Sanity check: detect time compression / excessive frame loss.
    // This is especially important for X11 capture, where dropped frames can yield choppy playback.
    try {
      if (videoPath) {
        const outDur = probeDurationSeconds(videoPath, resolvedFfmpeg);
        const frames = probeFrameCount(videoPath, resolvedFfmpeg);
        if (outDur > 0 && frames > 0) {
          const expected = durationMs / 1000;
          const fromFrames = frames / 60;
          const driftA = Math.abs(outDur - expected);
          const driftB = Math.abs(fromFrames - expected);
          const worst = Math.max(driftA, driftB);
          if (worst > 0.75) {
            const msg =
              `  Video timing warning: expected=${expected.toFixed(2)}s, ` +
              `ffprobe=${outDur.toFixed(2)}s, frames/60=${fromFrames.toFixed(2)}s (frames=${frames}).`;
            if (process.env.CI) {
              throw new Error(msg);
            } else {
              console.warn(msg);
            }
          }
        }
      }
    } catch (err) {
      // Fail only in CI; locally this should be a warning.
      if (process.env.CI) throw err;
      console.warn("  Video timing check failed:", (err as Error).message);
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

    // Generate subtitles (combined + per-role)
    t0 = Date.now();
    const vtt = generateWebVTT(steps);
    fs.writeFileSync(subtitlesPath, vtt, "utf-8");

    const a0Steps = steps.filter((s) => s.role === a0.id || s.role === "both");
    const a1Steps = steps.filter((s) => s.role === a1.id || s.role === "both");
    fs.writeFileSync(a0SubtitlesPath, generateWebVTT(a0Steps), "utf-8");
    fs.writeFileSync(a1SubtitlesPath, generateWebVTT(a1Steps), "utf-8");
    console.log(`  Subtitles generated    (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`  Subtitles:  ${subtitlesPath}`);
    console.log(`  ${a0.name} subs:  ${a0SubtitlesPath}`);
    console.log(`  ${a1.name} subs:  ${a1SubtitlesPath}`);

    // Sync verification: for each task, compare when Boss created it vs
    // when Worker saw it.  Extracts the task name from step captions like
    // 'Boss adds task: "create schemas"' and 'Worker sees "create schemas" appear'.
    const bossAdds = steps.filter((s) => s.role === a0.id && s.caption.includes("adds task:"));
    const workerSees = steps.filter((s) => s.role === a1.id && s.caption.includes("sees"));
    if (bossAdds.length > 0) {
      console.log("\n  Sync check:");
      const deltas: number[] = [];
      for (const bStep of bossAdds) {
        const nameMatch = bStep.caption.match(/"([^"]+)"/);
        if (!nameMatch) continue;
        const taskName = nameMatch[1];
        const wStep = workerSees.find((w) => w.caption.includes(`"${taskName}"`));
        if (wStep) {
          const bossTime = bStep.endMs / 1000;
          const workerTime = wStep.endMs / 1000;
          const delta = workerTime - bossTime;
          deltas.push(delta);
          const ok = delta > 0 ? "OK" : "FAIL";
          console.log(`    "${taskName}": Boss added @ ${bossTime.toFixed(1)}s, Worker saw @ ${workerTime.toFixed(1)}s  (+${delta.toFixed(1)}s) ${ok}`);
        }
      }

      if (deltas.length > 0) {
        const min = Math.min(...deltas);
        const max = Math.max(...deltas);
        const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const negatives = deltas.filter((d) => d <= 0).length;
        const tail = deltas.slice(Math.max(0, deltas.length - 5));
        const tailAvg = tail.reduce((a, b) => a + b, 0) / tail.length;
        const head = deltas.slice(0, Math.min(5, deltas.length));
        const headAvg = head.reduce((a, b) => a + b, 0) / head.length;
        const trend = tailAvg - headAvg;

        console.log(
          `  Sync summary: n=${deltas.length}, min=${min.toFixed(2)}s, avg=${avg.toFixed(2)}s, max=${max.toFixed(2)}s` +
          (negatives > 0 ? `, negatives=${negatives} (FAIL)` : ""),
        );
        console.log(
          `  Sync drift (last5 - first5): ${(trend >= 0 ? "+" : "")}${trend.toFixed(2)}s (first5=${headAvg.toFixed(2)}s, last5=${tailAvg.toFixed(2)}s)`,
        );
      }
    }

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
