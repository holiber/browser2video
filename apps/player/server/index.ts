/**
 * Player backend server.
 * - Serves the Vite React UI via proxy in dev mode
 * - Opens a WebSocket for step execution control
 * - Loads scenario files dynamically
 *
 * Designed to run inside the Electron main process (via electron/main.ts).
 * The Electron app provides CDP so Playwright can interact with embedded
 * WebContentsView pages directly.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import {
  isScenarioDescriptor,
  type ReplayEvent,
  startTerminalWsServer,
  type TerminalServer,
} from "browser2video";
import { Executor, type ViewMode, type PaneLayoutInfo } from "./executor.ts";
import { PlayerCache, type StepMeta } from "./cache.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.error(`[server] Module loaded at ${new Date().toISOString()}`);

/** Load .env from a directory, setting only vars that are not already defined. */
function loadDotenv(dir: string): void {
  const envPath = path.join(dir, ".env");
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
  } catch { /* silently ignore */ }
}

let PORT = parseInt(process.env.PORT ?? "9521", 10);
let VITE_PORT = PORT + 1;

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) || fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

// ---------------------------------------------------------------------------
//  Message types
// ---------------------------------------------------------------------------

type ClientMsg =
  | { type: "load"; file: string }
  | { type: "runStep"; index: number }
  | { type: "runAll" }
  | { type: "reset" }
  | { type: "cancel" }
  | { type: "listScenarios" }
  | { type: "clearCache" }
  | { type: "setViewMode"; mode: ViewMode }
  | { type: "importArtifacts"; dir: string }
  | { type: "downloadArtifacts"; runId?: string; artifactName?: string };

type ServerMsg =
  | { type: "scenario"; name: string; steps: Array<{ caption: string; narration?: string }> }
  | { type: "studioReady"; terminalServerUrl: string; terminalWsUrl: string }
  | { type: "stepStart"; index: number; fastForward: boolean }
  | { type: "stepComplete"; index: number; screenshot: string; mode: "human" | "fast"; durationMs: number }
  | { type: "finished"; videoPath?: string }
  | { type: "error"; message: string }
  | { type: "status"; loaded: boolean; executedUpTo: number }
  | { type: "scenarioFiles"; files: string[] }
  | { type: "liveFrame"; data: string; paneId?: string }
  | { type: "paneLayout"; layout: PaneLayoutInfo }
  | { type: "cachedData"; screenshots: (string | null)[]; stepDurations: (number | null)[]; stepHasAudio: boolean[]; videoPath?: string | null }
  | { type: "cacheCleared"; cacheSize?: number }
  | { type: "cancelled" }
  | { type: "viewMode"; mode: ViewMode }
  | { type: "replayEvent"; event: ReplayEvent }
  | { type: "artifactsImported"; count: number; scenarios: string[] };

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function persistStepCache(index: number, screenshot: string, durationMs: number, exec: Executor) {
  if (!currentCacheDir || !currentContentHash || !currentScenarioFile) return;
  try {
    if (screenshot) cache.saveScreenshot(currentCacheDir, index, screenshot);
    const hasAudio = !!exec.steps[index]?.narration;
    currentStepMetas = currentStepMetas.filter((m) => m.index !== index);
    currentStepMetas.push({ index, durationMs, hasAudio });
    cache.saveMeta(currentCacheDir, {
      scenarioFile: currentScenarioFile,
      contentHash: currentContentHash,
      steps: currentStepMetas,
    });
  } catch (err) {
    console.error("[player] Cache write error:", err);
  }
}

// ---------------------------------------------------------------------------
//  Dynamic scenario import
// ---------------------------------------------------------------------------

async function loadScenarioDescriptor(filePath: string) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const mod = await import(abs);
  const desc = mod.default ?? mod;
  if (!isScenarioDescriptor(desc)) {
    throw new Error(
      `File does not export a ScenarioDescriptor. ` +
      `Use defineScenario() to create a player-compatible scenario.`
    );
  }
  return desc;
}

// ---------------------------------------------------------------------------
//  Scan for .scenario.ts files
// ---------------------------------------------------------------------------

function findScenarioFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      results.push(...findScenarioFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".scenario.ts")) {
      results.push(path.relative(base, full));
    }
  }
  return results.sort();
}

// ---------------------------------------------------------------------------
//  Vite dev proxy
// ---------------------------------------------------------------------------

let viteRequestCount = 0;

function proxyToVite(req: http.IncomingMessage, res: http.ServerResponse) {
  const reqId = ++viteRequestCount;
  const reqStart = performance.now();
  const url = req.url ?? "/";
  const proxyReq = http.request(
    { hostname: "localhost", port: VITE_PORT, path: url, method: req.method, headers: req.headers },
    (proxyRes) => {
      const ms = (performance.now() - reqStart).toFixed(0);
      if (reqId <= 10 || parseInt(ms) > 500) {
        console.error(`[vite-proxy] #${reqId} ${req.method} ${url.split('?')[0]} → ${proxyRes.statusCode} (${ms}ms)`);
      }
      proxyRes.on("error", () => { try { res.end(); } catch { } });
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  proxyReq.on("error", () => {
    const ms = (performance.now() - reqStart).toFixed(0);
    console.error(`[vite-proxy] #${reqId} ${req.method} ${url.split('?')[0]} → 502 ERROR (${ms}ms)`);
    try { res.writeHead(502); res.end("Vite dev server not ready"); } catch { }
  });
  res.on("close", () => { proxyReq.destroy(); });
  req.pipe(proxyReq, { end: true });
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

let executor: Executor | null = null;
let viteProcess: ChildProcess | null = null;
let terminalServer: TerminalServer | null = null;
let currentViewMode: ViewMode = "live";

// Electron mode: when B2V_CDP_PORT is set, Playwright connects via CDP
const electronCdpPort = process.env.B2V_CDP_PORT ? parseInt(process.env.B2V_CDP_PORT, 10) : 0;
const electronCdpEndpoint = electronCdpPort > 0 ? `http://localhost:${electronCdpPort}` : null;

let electronMain: {
  createScenarioView: (url: string, viewport: { width: number; height: number }) => Promise<void>;
  destroyScenarioView: () => void;
} | null = null;
if (electronCdpEndpoint) {
  try {
    electronMain = await import("../electron/main.ts");
  } catch (err) {
    console.error("[player] Could not import Electron main:", err);
  }
}

const cache = new PlayerCache(PROJECT_ROOT);
let currentScenarioFile: string | null = null;
let currentCacheDir: string | null = null;
let currentContentHash: string | null = null;
let currentStepMetas: StepMeta[] = [];
let TERMINAL_PORT = PORT + 2;

function startVite(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const vite = spawn("npx", ["vite", "--port", String(VITE_PORT)], {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true,
      env: { ...process.env, PLAYER_PORT: String(PORT) },
    });
    viteProcess = vite;
    const killViteOnExit = () => {
      try { if (vite.pid) process.kill(-vite.pid, "SIGKILL"); } catch { }
    };
    process.on("exit", killViteOnExit);
    vite.once("exit", () => process.removeListener("exit", killViteOnExit));

    let resolved = false;
    function parseVitePort(text: string) {
      const m = text.match(/Local:\s+https?:\/\/localhost:(\d+)/);
      if (m) {
        const actual = parseInt(m[1], 10);
        if (actual !== VITE_PORT) {
          console.warn(`[player] Vite is on port ${actual} (expected ${VITE_PORT}), updating proxy target`);
          VITE_PORT = actual;
        }
      }
    }
    const onData = (d: Buffer) => {
      const text = d.toString();
      process.stdout.write(d);
      parseVitePort(text);
      if (!resolved && text.includes("Local:")) {
        resolved = true;
        resolve(vite);
      }
    };
    vite.stdout?.on("data", onData);
    vite.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      process.stderr.write(d);
      parseVitePort(text);
      if (!resolved && text.includes("Local:")) {
        resolved = true;
        resolve(vite);
      }
    });
    vite.on("error", (err) => { if (!resolved) { resolved = true; reject(err); } });
    vite.on("exit", (code) => {
      if (!resolved) { resolved = true; reject(new Error(`Vite exited with code ${code}`)); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; resolve(vite); }
    }, 15_000);
  });
}

// ---------------------------------------------------------------------------
//  Terminal page generator — self-contained HTML for terminal iframes
// ---------------------------------------------------------------------------

function generateTerminalPage(wsUrl: string, testId: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.min.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
    #terminal { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="terminal" data-testid="jabterm-container"></div>
  <script type="module">
    import { Terminal } from "https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/+esm";
    import { FitAddon } from "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/+esm";

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#1e1e1e" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById("terminal"));
    fitAddon.fit();

    const ws = new WebSocket("${wsUrl}");
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      sendResize();
    };

    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else term.write(new Uint8Array(e.data));
    };

    ws.onclose = (e) => {
      term.write("\\r\\n\\x1b[31mConnection closed (code " + e.code + ")\\x1b[0m\\r\\n");
    };

    const encoder = new TextEncoder();
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    });

    let lastCols = 0, lastRows = 0;
    let resizeTimer = null;

    function sendResize() {
      fitAddon.fit();
      const cols = Math.max(term.cols || 80, 80);
      const rows = Math.max(term.rows || 24, 24);
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    }

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendResize, 150);
    });

    document.getElementById("terminal").addEventListener("mousedown", () => term.focus());
  </script>
</body>
</html>`;
}

const httpServer = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");

  if (u.pathname === "/api/video") {
    const videoPath = u.searchParams.get("path");
    if (!videoPath || !fs.existsSync(videoPath)) {
      res.writeHead(404);
      res.end("Video not found");
      return;
    }
    const stat = fs.statSync(videoPath);
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": stat.size,
      "cache-control": "no-cache",
    });
    const stream = fs.createReadStream(videoPath);
    stream.on("error", () => { try { res.end(); } catch { } });
    res.on("close", () => { stream.destroy(); });
    stream.pipe(res);
    return;
  }

  // Serve terminal HTML page — renders an xterm.js terminal connecting to jabterm WS
  if (u.pathname === "/terminal") {
    const testId = u.searchParams.get("testId") ?? "term-0";
    const title = u.searchParams.get("title") ?? "Shell";
    const wsUrl = terminalServer?.baseWsUrl ?? `ws://127.0.0.1:${TERMINAL_PORT}`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(generateTerminalPage(wsUrl, testId, title));
    return;
  }

  proxyToVite(req, res);
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    const proxyReq = http.request({
      hostname: "localhost",
      port: VITE_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    });
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      proxySocket.on("error", () => { socket.destroy(); });
      socket.on("error", () => { proxySocket.destroy(); });
      try {
        socket.write(
          `HTTP/1.1 101 ${proxyRes.statusMessage}\r\n` +
          Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
          "\r\n\r\n",
        );
        if (proxyHead.length) socket.write(proxyHead);
      } catch { socket.destroy(); proxySocket.destroy(); return; }
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on("error", () => socket.destroy());
    proxyReq.end();
  }
});

wss.on("connection", (ws) => {
  console.error("[player] Client connected");

  const files = findScenarioFiles(PROJECT_ROOT, PROJECT_ROOT);
  send(ws, { type: "scenarioFiles", files });
  send(ws, { type: "viewMode", mode: currentViewMode });
  if (terminalServer) {
    // Send the player's own /terminal URL as the base for terminal iframes
    const terminalPageUrl = `http://localhost:${PORT}`;
    send(ws, { type: "studioReady", terminalServerUrl: terminalPageUrl, terminalWsUrl: terminalServer.baseWsUrl });
  }

  if (executor) {
    send(ws, { type: "status", loaded: true, executedUpTo: -1 });
  }

  // Serialize message processing: async handlers fired by WebSocket
  // events are NOT queued, so back-to-back "load" + "runAll" messages
  // would run concurrently. A simple queue ensures each finishes before
  // the next one starts.
  let msgQueue: Promise<void> = Promise.resolve();
  ws.on("message", (raw) => {
    msgQueue = msgQueue.then(() => handleMessage(raw)).catch(() => { });
  });

  async function handleMessage(raw: import("ws").RawData) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      switch (msg.type) {
        case "load": {
          if (executor) await executor.dispose();
          if (electronMain) electronMain.destroyScenarioView();

          currentScenarioFile = msg.file;
          currentStepMetas = [];
          const descriptor = await loadScenarioDescriptor(msg.file);
          executor = new Executor(descriptor, {
            projectRoot: PROJECT_ROOT,
            cdpEndpoint: electronCdpEndpoint,
            onRequestPage: electronMain
              ? (url: string, viewport: { width: number; height: number }) => electronMain!.createScenarioView(url, viewport)
              : null,
          });
          executor.viewMode = currentViewMode;
          executor.onLiveFrame = (data, paneId) => send(ws, { type: "liveFrame", data, paneId });
          executor.onPaneLayout = (layout) => send(ws, { type: "paneLayout", layout });
          executor.onReplayEvent = (event) => send(ws, { type: "replayEvent", event });

          const absPath = path.isAbsolute(msg.file) ? msg.file : path.resolve(PROJECT_ROOT, msg.file);
          const { dir, hash } = cache.getDir(absPath, msg.file);
          currentCacheDir = dir;
          currentContentHash = hash;

          send(ws, {
            type: "scenario",
            name: descriptor.name,
            steps: executor.steps,
          });

          const cached = cache.loadCachedData(absPath, msg.file, executor.stepCount);
          if (cached) {
            send(ws, {
              type: "cachedData",
              screenshots: cached.screenshots,
              stepDurations: cached.stepDurations,
              stepHasAudio: cached.stepHasAudio,
              videoPath: cached.videoPath,
            });
          } else {
            const hasAudio = executor.steps.map((s) => !!s.narration);
            send(ws, {
              type: "cachedData",
              screenshots: executor.steps.map(() => null),
              stepDurations: executor.steps.map(() => null),
              stepHasAudio: hasAudio,
            });
          }
          break;
        }

        case "runStep": {
          if (!executor) {
            send(ws, { type: "error", message: "No scenario loaded" });
            break;
          }
          if (msg.index <= executor.lastExecutedIndex) {
            await executor.reset();
            executor.viewMode = currentViewMode;
            executor.onLiveFrame = (data, paneId) => send(ws, { type: "liveFrame", data, paneId });
            executor.onPaneLayout = (layout) => send(ws, { type: "paneLayout", layout });
            executor.onReplayEvent = (event) => send(ws, { type: "replayEvent", event });
            currentStepMetas = [];
          }
          await executor.runTo(
            msg.index,
            "human",
            (index, fastForward) => send(ws, { type: "stepStart", index, fastForward }),
            (result) => {
              send(ws, { type: "stepComplete", ...result });
              persistStepCache(result.index, result.screenshot, result.durationMs, executor!);
            },
          );
          break;
        }

        case "runAll": {
          if (!executor) {
            send(ws, { type: "error", message: "No scenario loaded" });
            break;
          }
          try {
            for (let i = 0; i < executor.stepCount; i++) {
              await executor.runTo(
                i,
                "human",
                (index, fastForward) => send(ws, { type: "stepStart", index, fastForward }),
                (result) => {
                  send(ws, { type: "stepComplete", ...result });
                  persistStepCache(result.index, result.screenshot, result.durationMs, executor!);
                },
              );
            }
            await executor.reset();
            const videoPath = executor.videoPath ?? undefined;
            if (videoPath && currentCacheDir) {
              try {
                if (fs.existsSync(videoPath)) {
                  cache.saveVideo(currentCacheDir, videoPath);
                }
                const subtitlesDir = path.dirname(videoPath);
                const vttPath = path.join(subtitlesDir, "captions.vtt");
                if (fs.existsSync(vttPath)) cache.saveSubtitles(currentCacheDir, vttPath);
              } catch (err) {
                console.error("[player] Failed to save video to cache:", err);
              }
            }
            send(ws, { type: "finished", videoPath: videoPath ?? (currentCacheDir ? cache.getVideoPath(currentCacheDir) : null) ?? undefined });
          } catch (err) {
            if ((err as Error).message?.includes("aborted")) {
              console.error("[player] Execution aborted by user");
              send(ws, { type: "cancelled" });
            } else {
              console.error("[player] runAll error:", err);
              send(ws, { type: "error", message: (err as Error).message ?? "Unknown error" });
            }
          }
          break;
        }
        case "reset": {
          if (executor) await executor.reset();
          if (electronMain) electronMain.destroyScenarioView();
          send(ws, { type: "status", loaded: !!executor, executedUpTo: -1 });
          break;
        }

        case "listScenarios": {
          send(ws, { type: "scenarioFiles", files: findScenarioFiles(PROJECT_ROOT, PROJECT_ROOT) });
          break;
        }

        case "clearCache": {
          if (currentScenarioFile) {
            const absPath = path.isAbsolute(currentScenarioFile) ? currentScenarioFile : path.resolve(PROJECT_ROOT, currentScenarioFile);
            cache.clearForScenario(absPath, currentScenarioFile);
            currentStepMetas = [];
          } else {
            cache.clearAll();
          }
          send(ws, { type: "cacheCleared", cacheSize: cache.getCacheSize() });
          break;
        }

        case "cancel": {
          if (executor) {
            console.error("[player] Cancelling current execution...");
            await executor.reset();
          }
          send(ws, { type: "cancelled" });
          break;
        }

        case "setViewMode": {
          currentViewMode = msg.mode;
          if (executor) {
            await executor.reset();
            executor.viewMode = currentViewMode;
            executor.onLiveFrame = (data, paneId) => send(ws, { type: "liveFrame", data, paneId });
            executor.onPaneLayout = (layout) => send(ws, { type: "paneLayout", layout });
            executor.onReplayEvent = (event) => send(ws, { type: "replayEvent", event });
            currentStepMetas = [];
          }
          send(ws, { type: "viewMode", mode: currentViewMode });
          send(ws, { type: "status", loaded: !!executor, executedUpTo: -1 });
          break;
        }

        case "importArtifacts": {
          const artifactsDir = path.isAbsolute(msg.dir) ? msg.dir : path.resolve(PROJECT_ROOT, msg.dir);
          const scenarioFiles = findScenarioFiles(PROJECT_ROOT, PROJECT_ROOT);
          const imported = cache.importAllFromDir(artifactsDir, scenarioFiles);
          const scenarios = [...imported.keys()];
          console.error(`[player] Imported artifacts for ${imported.size} scenario(s): ${scenarios.join(", ")}`);
          send(ws, { type: "artifactsImported", count: imported.size, scenarios });

          if (currentScenarioFile && imported.has(currentScenarioFile) && executor) {
            const absPath = path.isAbsolute(currentScenarioFile) ? currentScenarioFile : path.resolve(PROJECT_ROOT, currentScenarioFile);
            const cached = cache.loadCachedData(absPath, currentScenarioFile, executor.stepCount);
            if (cached) {
              send(ws, {
                type: "cachedData",
                screenshots: cached.screenshots,
                stepDurations: cached.stepDurations,
                stepHasAudio: cached.stepHasAudio,
                videoPath: cached.videoPath,
              });
            }
          }
          break;
        }

        case "downloadArtifacts": {
          const scenarioFiles = findScenarioFiles(PROJECT_ROOT, PROJECT_ROOT);
          console.error(`[player] Downloading CI artifacts from GitHub...`);
          send(ws, { type: "status", loaded: !!executor, executedUpTo: executor?.lastExecutedIndex ?? -1 });
          try {
            const { imported } = await cache.downloadFromGitHub(scenarioFiles, {
              runId: msg.runId,
              artifactName: msg.artifactName,
            });
            const scenarios = [...imported.keys()];
            console.error(`[player] Downloaded and imported artifacts for ${imported.size} scenario(s)`);
            send(ws, { type: "artifactsImported", count: imported.size, scenarios });

            if (currentScenarioFile && imported.has(currentScenarioFile) && executor) {
              const absPath = path.isAbsolute(currentScenarioFile) ? currentScenarioFile : path.resolve(PROJECT_ROOT, currentScenarioFile);
              const cached = cache.loadCachedData(absPath, currentScenarioFile, executor.stepCount);
              if (cached) {
                send(ws, {
                  type: "cachedData",
                  screenshots: cached.screenshots,
                  stepDurations: cached.stepDurations,
                  stepHasAudio: cached.stepHasAudio,
                  videoPath: cached.videoPath,
                });
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[player] Download failed:", message);
            send(ws, { type: "error", message: `Download failed: ${message}` });
          }
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[player] Error:", message);
      send(ws, { type: "error", message });
    }
  }

  ws.on("close", async () => {
    console.error("[player] Client disconnected");
    if (executor) {
      try {
        await executor.dispose();
      } catch (err) {
        console.error("[player] Error disposing executor on disconnect:", err);
      }
    }
  });
});

async function killPortHolder(port: number): Promise<void> {
  try {
    const { execSync } = await import("node:child_process");
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    if (pids) {
      const myPid = String(process.pid);
      for (const pid of pids.split("\n").map((p) => p.trim()).filter(Boolean)) {
        if (pid === myPid) continue;
        try {
          execSync(`kill -9 ${pid} 2>/dev/null`);
          console.warn(`[player] Killed stale process ${pid} on port ${port}`);
        } catch { }
      }
    }
  } catch { }
}

async function findFreePort(preferred: number, label: string): Promise<number> {
  const net = await import("node:net");
  const check = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port);
    });

  let port = preferred;
  while (!(await check(port))) {
    console.warn(`[player] WARNING: ${label} port ${port} is already in use, trying ${port + 1}…`);
    port++;
    if (port > preferred + 20) {
      console.error(`[player] Could not find a free port for ${label} after 20 attempts.`);
      process.exit(1);
    }
  }
  return port;
}

loadDotenv(PROJECT_ROOT);

const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

console.error(`[startup ${elapsed()}] Killing stale port holders...`);
// Kill stale port holders in parallel
await Promise.all([
  killPortHolder(PORT),
  killPortHolder(PORT + 1),
  killPortHolder(PORT + 2),
]);
console.error(`[startup ${elapsed()}] Port holders killed`);

// Find free ports in parallel (they probe different ports so no conflict)
console.error(`[startup ${elapsed()}] Finding free ports...`);
[PORT, VITE_PORT, TERMINAL_PORT] = await Promise.all([
  findFreePort(PORT, "Player"),
  findFreePort(PORT + 1, "Vite"),
  findFreePort(PORT + 2, "Terminal WS"),
]);
console.error(`[startup ${elapsed()}] Ports: player=${PORT} vite=${VITE_PORT} terminal=${TERMINAL_PORT}`);

// Start Vite, terminal server, and HTTP server in parallel.
console.error(`[startup ${elapsed()}] Starting Vite + Terminal + HTTP in parallel...`);
const [, termSrv] = await Promise.all([
  startVite().then(() => console.error(`[startup ${elapsed()}] ✓ Vite ready`)),
  startTerminalWsServer(TERMINAL_PORT).then((s) => { console.error(`[startup ${elapsed()}] ✓ Terminal WS ready`); return s; }),
  new Promise<void>((resolve) => httpServer.listen(PORT, () => {
    console.error(`[startup ${elapsed()}] ✓ HTTP server ready at http://localhost:${PORT}`);
    resolve();
  })),
]);
terminalServer = termSrv;
console.error(`[startup ${elapsed()}] All servers ready.\n`);

export async function gracefulShutdown() {
  const deadline = new Promise<void>((r) => setTimeout(r, 8_000));
  const cleanup = async () => {
    if (executor) { try { await executor.dispose(); } catch { } }
    if (terminalServer) { try { await terminalServer.close(); } catch { } }
    if (viteProcess?.pid) {
      try { process.kill(-viteProcess.pid, "SIGTERM"); } catch { }
      try { viteProcess.kill(); } catch { }
    }
    httpServer.close();
  };
  await Promise.race([cleanup(), deadline]);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await gracefulShutdown();
    process.exit(0);
  });
}

process.on("uncaughtException", (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_WRITE_AFTER_END") {
    console.error("[player] Socket error (ignored):", err.message);
    return;
  }
  console.error("[player] Uncaught exception:", err);
  // Inside Electron the main process handler absorbs the error;
  // calling process.exit(1) here would kill the entire app and
  // any connected Playwright sessions (test runner reports SIGKILL).
  if (!process.versions.electron) {
    process.exit(1);
  }
});
