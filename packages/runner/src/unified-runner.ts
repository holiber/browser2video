/**
 * @description Unified scenario runner — single entry point that handles
 * any number of browser and terminal panes, recording, video composition,
 * subtitles, and narration.  Replaces the former run() and runCollab().
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "path";
import fs from "fs";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "child_process";

import type {
  ScenarioConfig,
  ScenarioContext,
  RunOptions,
  RunResult,
  StepRecord,
  TerminalHandle,
  BrowserPaneConfig,
  TerminalPaneConfig,
  PaneConfig,
  Mode,
  RecordMode,
} from "./types.js";

import { Actor, generateWebVTT, HIDE_CURSOR_INIT_SCRIPT, FAST_MODE_INIT_SCRIPT } from "./actor.js";
import { startServer, type ManagedServer } from "./server-manager.js";
import { startSyncServer } from "./sync-server.js";
import { tryTileHorizontally } from "./window-layout.js";
import { startScreenCapture, tryParseDisplaySize, tryGetMacMainDisplayPixels } from "./screen-capture.js";
import { composeVideos } from "./video-compositor.js";
import {
  type AudioDirectorAPI,
  createAudioDirector,
  mixAudioIntoVideo,
} from "./narrator.js";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function roundEven(n: number) {
  return Math.round(n / 2) * 2;
}

function tryGetMacDesktopBounds():
  | { left: number; top: number; right: number; bottom: number; width: number; height: number }
  | null {
  if (process.platform !== "darwin") return null;
  try {
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

function tryGetMacMenuBarHeightPts(): number {
  if (process.platform !== "darwin") return 0;
  try {
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

// ---------------------------------------------------------------------------
//  Terminal pane HTML (embedded)
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
//  Unified run()
// ---------------------------------------------------------------------------

export async function run(
  config: ScenarioConfig,
  scenario: (ctx: ScenarioContext) => Promise<void>,
  opts: RunOptions,
): Promise<RunResult> {
  const { mode, artifactDir } = opts;
  const wantsDevtools = opts.devtools ?? false;

  fs.mkdirSync(artifactDir, { recursive: true });

  // Determine record mode
  const requestedHeadless = opts.headless ?? (mode === "fast");
  let recordMode: RecordMode = opts.recordMode ?? "screencast";
  if (requestedHeadless && recordMode === "screen") recordMode = "screencast";
  const headless = wantsDevtools ? false : (recordMode === "screen" ? false : requestedHeadless);

  const resolvedFfmpeg = opts.ffmpegPath ?? "ffmpeg";

  // Pane configs
  const browserPanes = config.panes.filter((p): p is BrowserPaneConfig => p.type === "browser");
  const terminalPanes = config.panes.filter((p): p is TerminalPaneConfig => p.type === "terminal");
  const allPaneIds = config.panes.map((p) => p.id);
  const isMultiPane = config.panes.length > 1;
  const isScreencast = recordMode === "screencast";
  const isScreenRecording = recordMode === "screen";
  const hasSync = !!config.sync;

  // Paths
  const videoPath = recordMode === "none" ? undefined : path.join(artifactDir, "run.mp4");
  const subtitlesPath = path.join(artifactDir, "captions.vtt");
  const metadataPath = path.join(artifactDir, "run.json");

  console.log(`\n  Mode:      ${mode}`);
  console.log(`  Headless:  ${headless}`);
  console.log(`  Record:    ${recordMode}`);
  console.log(`  Panes:     ${config.panes.map((p) => `${p.id}(${p.type})`).join(", ")}`);
  console.log(`  Artifacts: ${artifactDir}\n`);

  // ------------------------------------------------------------------
  //  1. Start server
  // ------------------------------------------------------------------

  let managedServer: ManagedServer | null = null;
  let baseURL: string | undefined = opts.baseURL;

  if (!baseURL && config.server) {
    managedServer = await startServer(config.server);
    if (managedServer) {
      baseURL = managedServer.baseURL;
      console.log(`  Server:    ${baseURL}`);
    }
  }

  // ------------------------------------------------------------------
  //  2. Start sync server (if needed)
  // ------------------------------------------------------------------

  let syncWsUrl: string | undefined;
  let stopSyncServer: (() => Promise<void>) | undefined;

  if (hasSync) {
    if (config.sync!.wsUrl) {
      syncWsUrl = config.sync!.wsUrl;
    } else {
      const started = await startSyncServer({ artifactDir });
      syncWsUrl = started.wsUrl;
      stopSyncServer = started.stop;
    }
  }

  // ------------------------------------------------------------------
  //  3. Screen bounds (for tiling & screen recording)
  // ------------------------------------------------------------------

  const macBounds = isScreenRecording ? tryGetMacDesktopBounds() : null;
  const macMenuBarPts = isScreenRecording ? tryGetMacMenuBarHeightPts() : 0;
  const linuxDisplaySize =
    isScreenRecording && process.platform !== "darwin"
      ? (tryParseDisplaySize(opts.displaySize) ?? { w: 2560, h: 720 })
      : null;

  const totalPanes = config.panes.length;
  const tileW =
    isScreenRecording
      ? Math.max(520, Math.floor((macBounds?.width ?? linuxDisplaySize?.w ?? 2880) / totalPanes))
      : 960;
  const tileH =
    isScreenRecording
      ? (process.platform === "darwin"
        ? Math.min(900, Math.max(480, (macBounds?.height ?? 900) - macMenuBarPts))
        : (linuxDisplaySize?.h ?? 800))
      : 800;

  // ------------------------------------------------------------------
  //  4. Launch browser & create pane contexts
  // ------------------------------------------------------------------

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

  const browser: Browser = await chromium.launch({
    headless,
    args: launchArgs,
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
  });

  // Per-pane state
  const paneContexts: Map<string, BrowserContext> = new Map();
  const panePages: Map<string, Page> = new Map();
  const paneActors: Map<string, Actor> = new Map();
  const paneRawVideos: Map<string, string> = new Map();
  const terminalProcesses: Map<string, ChildProcess> = new Map();
  const terminalHandles: Map<string, TerminalHandle> = new Map();

  // Create browser contexts & pages for each pane
  for (const pane of config.panes) {
    const isBrowser = pane.type === "browser";
    const vp = pane.viewport ?? {};
    const vpW = vp.width ?? (isScreenRecording ? Math.min(960, tileW) : 1280);
    const vpH = vp.height ?? 720;

    const rawVideoPath = isScreencast ? path.join(artifactDir, `${pane.id}.raw.webm`) : undefined;
    if (rawVideoPath) paneRawVideos.set(pane.id, rawVideoPath);

    const ctxOpts: {
      viewport: { width: number; height: number };
      recordVideo?: { dir: string; size: { width: number; height: number } };
    } = {
      viewport: { width: vpW, height: vpH },
    };
    if (isScreencast && rawVideoPath) {
      ctxOpts.recordVideo = {
        dir: path.dirname(rawVideoPath),
        size: { width: vpW, height: vpH },
      };
    }

    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();

    paneContexts.set(pane.id, context);
    panePages.set(pane.id, page);

    // Init scripts
    if (mode === "human") await page.addInitScript(HIDE_CURSOR_INIT_SCRIPT);
    if (mode === "fast") await page.addInitScript(FAST_MODE_INIT_SCRIPT);

    // Console & error listeners
    const label = pane.label ?? pane.id;
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`  [${label} Error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.log(`  [${label} Error] ${(err as Error).message}`);
    });

    if (isBrowser) {
      const actor = new Actor(page, mode, { delays: opts.delays });
      paneActors.set(pane.id, actor);
    }
  }

  // ------------------------------------------------------------------
  //  5. Tile windows (headed mode)
  // ------------------------------------------------------------------

  if (!headless) {
    const baseLeft = macBounds?.left ?? 0;
    const baseTop = macBounds?.top ?? 0;
    const safeTop = process.platform === "darwin" ? baseTop + macMenuBarPts : baseTop;
    const allPages = config.panes.map((p) => panePages.get(p.id)!);
    await tryTileHorizontally(allPages, {
      left: baseLeft,
      top: safeTop,
      tileWidth: tileW,
      tileHeight: tileH,
    });
  }

  // ------------------------------------------------------------------
  //  6. Navigate browser panes & handle sync
  // ------------------------------------------------------------------

  let docUrl: string | undefined;

  if (hasSync && browserPanes.length >= 2) {
    // Automerge flow: first browser creates doc, rest join via hash
    const firstPane = browserPanes[0];
    const firstPage = panePages.get(firstPane.id)!;
    const firstActor = paneActors.get(firstPane.id)!;

    const firstURL = (() => {
      const u = new URL(`${baseURL}${firstPane.path ?? "/"}`);
      if (syncWsUrl) u.searchParams.set("ws", syncWsUrl);
      return u.toString();
    })();

    await firstPage.goto(firstURL, { waitUntil: "domcontentloaded" });
    await firstActor.injectCursor();

    // Wait for document hash
    await firstPage.waitForFunction(
      () => (globalThis as any).document.location.hash.length > 1,
      undefined,
      { timeout: 10000 },
    );
    const hash = await firstPage.evaluate(() => (globalThis as any).document.location.hash);
    docUrl = hash.startsWith("#") ? hash.slice(1) : hash;
    console.log(`  Doc hash: ${hash}`);

    // Start terminal pane processes (now that we have sync info)
    for (const tPane of terminalPanes) {
      await setupTerminalPane(tPane, panePages.get(tPane.id)!, {
        syncWsUrl, baseURL, docUrl, artifactDir,
      });
    }

    // Navigate remaining browser panes
    for (let i = 1; i < browserPanes.length; i++) {
      const pane = browserPanes[i];
      const page = panePages.get(pane.id)!;
      const actor = paneActors.get(pane.id)!;

      const paneURL = (() => {
        const u = new URL(`${baseURL}${pane.path ?? "/"}`);
        if (syncWsUrl) u.searchParams.set("ws", syncWsUrl);
        u.hash = hash;
        return u.toString();
      })();

      await page.goto(paneURL, { waitUntil: "domcontentloaded" });
      await actor.injectCursor();
    }

    // Wait for Automerge sync
    await sleep(800);

    // Re-inject cursors after React render
    for (const pane of browserPanes) {
      await paneActors.get(pane.id)!.injectCursor();
    }
  } else {
    // No sync: navigate all browser panes in parallel
    for (const pane of browserPanes) {
      const page = panePages.get(pane.id)!;
      const actor = paneActors.get(pane.id)!;

      if (pane.url) {
        // External URL (no server)
        await page.goto(pane.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await actor.injectCursor();
      } else if (baseURL) {
        await page.goto(`${baseURL}${pane.path ?? "/"}`, { waitUntil: "domcontentloaded" });
        await actor.injectCursor();
      }
    }

    // Start terminal panes (no sync info needed)
    for (const tPane of terminalPanes) {
      await setupTerminalPane(tPane, panePages.get(tPane.id)!, {
        syncWsUrl, baseURL, docUrl, artifactDir,
      });
    }
  }

  // Helper: set up a terminal pane's page content & process
  async function setupTerminalPane(
    tPane: TerminalPaneConfig,
    page: Page,
    info: { syncWsUrl?: string; baseURL?: string; docUrl?: string; artifactDir: string },
  ) {
    // Set terminal page content
    await page.setContent(TERMINAL_PAGE_HTML, { waitUntil: "domcontentloaded" });
    const label = tPane.label ?? tPane.id;
    await page.evaluate((t: string) => (window as any).__b2v_setTitle(t), label);

    // Resolve command
    const cmd = typeof tPane.command === "function"
      ? tPane.command({ syncWsUrl: info.syncWsUrl, baseURL: info.baseURL, docUrl: info.docUrl })
      : tPane.command;

    if (cmd) {
      const logPath = path.join(info.artifactDir, `${tPane.id}.log`);
      fs.writeFileSync(logPath, "", "utf-8");

      const proc = spawn("sh", ["-c", cmd], {
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

      terminalProcesses.set(tPane.id, proc);
      terminalHandles.set(tPane.id, {
        send: async (text: string) => {
          proc.stdin?.write(text.endsWith("\n") ? text : `${text}\n`);
          await sleep(300);
        },
        page,
      });

      await sleep(300); // let process start
    } else {
      terminalHandles.set(tPane.id, {
        send: async () => {},
        page,
      });
    }
  }

  // ------------------------------------------------------------------
  //  7. Start recording
  // ------------------------------------------------------------------

  let screenRecorder: { stop: () => Promise<void> } | undefined;

  if (isScreenRecording && videoPath) {
    const baseLeft = macBounds?.left ?? 0;
    const baseTop = macBounds?.top ?? 0;
    const crop3 = (() => {
      if (process.platform !== "darwin") return undefined;
      const px = tryGetMacMainDisplayPixels();
      const dpr = px && macBounds?.width ? px.width / macBounds.width : 1;
      const safeTop = baseTop + macMenuBarPts;
      return {
        x: roundEven(baseLeft * dpr),
        y: roundEven(safeTop * dpr),
        w: roundEven(tileW * totalPanes * dpr),
        h: roundEven(tileH * dpr),
      };
    })();

    screenRecorder = await startScreenCapture({
      ffmpeg: resolvedFfmpeg,
      outputPath: videoPath,
      fps: 60,
      screenIndex: opts.screenIndex,
      display: opts.display,
      displaySize: opts.displaySize,
      crop: crop3,
    });
    console.log("  Recording started: Screen (FFmpeg)");
  } else if (isScreencast) {
    console.log("  Recording started: Screencast (per-pane)");
  } else {
    console.log("  Recording disabled");
  }

  // ------------------------------------------------------------------
  //  8. Run scenario
  // ------------------------------------------------------------------

  const videoStartTime = Date.now();
  const steps: StepRecord[] = [];
  let stepIndex = 0;

  const audioDirector = createAudioDirector({
    narration: opts.narration,
    videoStartTime,
    ffmpegPath: resolvedFfmpeg,
  });

  async function step(paneId: string | "all", caption: string, fn: () => Promise<void>) {
    stepIndex++;
    const idx = stepIndex;
    const startMs = Date.now() - videoStartTime;
    console.log(`  [Step ${idx}] ${caption}`);

    await fn();

    // Breathing pause (use first browser actor)
    const firstActor = paneActors.values().next().value;
    if (firstActor) await firstActor.breathe();

    const endMs = Date.now() - videoStartTime;
    steps.push({ index: idx, caption, startMs, endMs, paneId });
  }

  const ctx: ScenarioContext = {
    actor: (id: string) => {
      const a = paneActors.get(id);
      if (!a) throw new Error(`No browser actor for pane "${id}". Browser panes: ${browserPanes.map((p) => p.id).join(", ")}`);
      return a;
    },
    page: (id: string) => {
      const p = panePages.get(id);
      if (!p) throw new Error(`No page for pane "${id}". Panes: ${allPaneIds.join(", ")}`);
      return p;
    },
    terminal: (id: string) => {
      const h = terminalHandles.get(id);
      if (!h) throw new Error(`No terminal handle for pane "${id}". Terminal panes: ${terminalPanes.map((p) => p.id).join(", ")}`);
      return h;
    },
    step,
    audio: audioDirector,
    baseURL,
    paneIds: allPaneIds,
    syncWsUrl,
    docUrl,
  };

  const scenarioStart = Date.now();
  try {
    await scenario(ctx);
  } catch (err) {
    console.error("\n  Scenario failed:", (err as Error).message);
    // Take failure screenshots
    for (const [id, page] of panePages) {
      try {
        await page.screenshot({ path: path.join(artifactDir, `${id}-failure.png`) });
      } catch { /* ignore */ }
    }
    console.log("  Failure screenshots saved.");
    throw err;
  } finally {
    const durationMs = Date.now() - scenarioStart;

    // Tail capture
    const tailCaptureMs = mode === "human" ? 300 : 0;
    if ((isScreencast || isScreenRecording) && tailCaptureMs > 0) {
      try { await sleep(tailCaptureMs); } catch { /* ignore */ }
    }

    // Show processing overlay (screen recording only — screencast would
    // capture the overlay as the last frames of the video)
    if (isScreenRecording) {
      for (const page of panePages.values()) {
        try {
          await page.evaluate(`(() => {
            const o = document.createElement('div');
            o.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
            o.innerHTML = '<div style="color:#fff;font-size:1.5rem;font-family:system-ui">Finishing\\u2026</div>';
            document.body.appendChild(o);
          })()`);
        } catch { /* page may be gone */ }
      }
    }

    // Stop screen recorder
    if (screenRecorder) {
      try {
        await screenRecorder.stop();
        if (videoPath) console.log(`  Video saved: ${videoPath}`);
      } catch (e) {
        console.error("  Error stopping screen recording:", (e as Error).message);
      }
    }

    // Finalize screencast: close pages to flush recordings
    if (isScreencast) {
      for (const [id, page] of panePages) {
        try {
          await page.close();
          const video = page.video();
          const rawPath = paneRawVideos.get(id);
          if (video && rawPath) await video.saveAs(rawPath);
        } catch (e) {
          console.error(`  Error saving video for ${id}:`, (e as Error).message);
        }
      }
    }

    // Close all contexts & browser
    for (const ctx of paneContexts.values()) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
    await browser.close();

    // Stop terminal processes
    for (const proc of terminalProcesses.values()) {
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    }

    // Stop sync server
    if (stopSyncServer) await stopSyncServer();

    // Stop managed server
    if (managedServer) await managedServer.stop();

    // ------------------------------------------------------------------
    //  9. Video post-processing
    // ------------------------------------------------------------------

    if (isScreencast && videoPath) {
      const rawPaths = config.panes
        .map((p) => paneRawVideos.get(p.id))
        .filter((p): p is string => !!p && fs.existsSync(p));

      if (rawPaths.length > 0) {
        console.log(`  Compositing ${rawPaths.length} pane(s)...`);
        try {
          const layout = config.layout ?? "auto";
          composeVideos({
            inputs: rawPaths,
            outputPath: videoPath,
            ffmpeg: resolvedFfmpeg,
            layout: layout === "auto" ? "auto" : layout,
            targetDurationSec: durationMs / 1000,
          });
          console.log(`  Video saved: ${videoPath}`);
        } catch (err) {
          console.warn("  Video composition failed:", (err as Error).message);
          // Fallback: copy first raw video
          if (rawPaths[0]) {
            try {
              execFileSync(resolvedFfmpeg, [
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
    const audioEvents = audioDirector.getEvents?.() ?? [];
    if (audioEvents.length > 0 && videoPath && fs.existsSync(videoPath)) {
      mixAudioIntoVideo({ videoPath, events: audioEvents, ffmpegPath: resolvedFfmpeg });
    }

    // Generate subtitles (combined + per-pane)
    const vtt = generateWebVTT(steps);
    fs.writeFileSync(subtitlesPath, vtt, "utf-8");
    console.log(`  Subtitles:  ${subtitlesPath}`);

    if (isMultiPane) {
      for (const pane of config.panes) {
        const paneSteps = steps.filter((s) => s.paneId === pane.id || s.paneId === "all");
        const paneSubs = path.join(artifactDir, `${pane.id}-captions.vtt`);
        fs.writeFileSync(paneSubs, generateWebVTT(paneSteps), "utf-8");
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
      panes: config.panes.map((p) => ({ id: p.id, type: p.type, label: p.label })),
      audioEvents: audioEvents.length > 0
        ? audioEvents.map((e) => ({ type: e.type, startMs: e.startMs, durationMs: e.durationMs, label: e.label }))
        : undefined,
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
