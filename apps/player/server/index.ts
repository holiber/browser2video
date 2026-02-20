/**
 * Player backend server.
 * - Serves the Vite React UI via proxy in dev mode
 * - Opens a WebSocket for step execution control
 * - Loads scenario files dynamically
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  isScenarioDescriptor,
  type ReplayEvent,
  startTerminalWsServer,
  type TerminalServer,
} from "browser2video";
import { Executor, type ViewMode, type PaneLayoutInfo } from "./executor.ts";
import { PlayerCache, type StepMeta, type CacheMeta } from "./cache.ts";
import { StudioBrowserManager } from "./studio-browser.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  | { type: "listScenarios" }
  | { type: "clearCache" }
  | { type: "setViewMode"; mode: ViewMode }
  | { type: "importArtifacts"; dir: string }
  | { type: "downloadArtifacts"; runId?: string; artifactName?: string }
  | { type: "studioOpenBrowser"; paneId: string; url: string }
  | { type: "studioCloseBrowser"; paneId: string }
  | { type: "studioMouseEvent"; paneId: string; action: string; x: number; y: number; button?: "left" | "right" | "middle"; deltaX?: number; deltaY?: number }
  | { type: "studioKeyEvent"; paneId: string; action: string; key: string };

type ServerMsg =
  | { type: "scenario"; name: string; steps: Array<{ caption: string; narration?: string }> }
  | { type: "studioReady"; terminalServerUrl: string }
  | { type: "stepStart"; index: number; fastForward: boolean }
  | { type: "stepComplete"; index: number; screenshot: string; mode: "human" | "fast"; durationMs: number }
  | { type: "finished"; videoPath?: string }
  | { type: "error"; message: string }
  | { type: "status"; loaded: boolean; executedUpTo: number }
  | { type: "scenarioFiles"; files: string[] }
  | { type: "liveFrame"; data: string; paneId?: string }
  | { type: "paneLayout"; layout: PaneLayoutInfo }
  | { type: "cachedData"; screenshots: (string | null)[]; stepDurations: (number | null)[]; stepHasAudio: boolean[]; videoPath?: string | null }
  | { type: "cacheCleared" }
  | { type: "viewMode"; mode: ViewMode }
  | { type: "replayEvent"; event: ReplayEvent }
  | { type: "artifactsImported"; count: number; scenarios: string[] }
  | { type: "studioFrame"; paneId: string; data: string };

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

function proxyToVite(req: http.IncomingMessage, res: http.ServerResponse) {
  const proxyReq = http.request(
    { hostname: "localhost", port: VITE_PORT, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      proxyRes.on("error", () => { try { res.end(); } catch {} });
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  proxyReq.on("error", () => {
    try { res.writeHead(502); res.end("Vite dev server not ready"); } catch {}
  });
  res.on("close", () => { proxyReq.destroy(); });
  req.pipe(proxyReq, { end: true });
}

function stripFrameAncestorsFromCsp(csp: string): string {
  return csp
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^frame-ancestors(\s|$)/i.test(part))
    .join("; ");
}

function sanitizeProxyResponseHeaders(source: Headers, isHtml = false): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of source.entries()) {
    const lower = key.toLowerCase();
    if (lower === "x-frame-options") continue;
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      const cleaned = stripFrameAncestorsFromCsp(value);
      if (cleaned) headers[key] = cleaned;
      continue;
    }
    if (isHtml && (lower === "content-length" || lower === "content-encoding")) continue;
    headers[key] = value;
  }
  return headers;
}

function injectBaseHref(html: string, pageUrl: string): string {
  if (/<base\s[^>]*href=/i.test(html)) return html;
  const escapedUrl = pageUrl.replace(/"/g, "&quot;");
  const baseTag = `<base href="${escapedUrl}">`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }
  return `<head>${baseTag}</head>${html}`;
}

async function enableFrameHeaderBypass(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    try {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];

      const csp = headers["content-security-policy"];
      if (csp) {
        headers["content-security-policy"] = stripFrameAncestorsFromCsp(csp);
      }
      const cspReportOnly = headers["content-security-policy-report-only"];
      if (cspReportOnly) {
        headers["content-security-policy-report-only"] = stripFrameAncestorsFromCsp(cspReportOnly);
      }

      await route.fulfill({ response, headers });
    } catch {
      await route.continue().catch(() => {});
    }
  });
}

async function proxyExternalPage(req: http.IncomingMessage, res: http.ServerResponse, u: URL): Promise<void> {
  if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const target = u.searchParams.get("url");
  if (!target) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Missing url query param");
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Invalid target url");
    return;
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Only http(s) urls are supported");
    return;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: req.method ?? "GET",
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    const isHtml = /text\/html/i.test(contentType);

    if (isHtml) {
      const html = await upstream.text();
      const htmlWithBase = injectBaseHref(html, upstream.url || targetUrl.toString());
      const headers = sanitizeProxyResponseHeaders(upstream.headers, true);
      headers["content-type"] = contentType || "text/html; charset=utf-8";
      headers["cache-control"] = "no-cache";
      headers["content-length"] = Buffer.byteLength(htmlWithBase, "utf-8");
      res.writeHead(upstream.status, headers);
      res.end(htmlWithBase);
      return;
    }

    const headers = sanitizeProxyResponseHeaders(upstream.headers, false);
    headers["cache-control"] = headers["cache-control"] ?? "no-cache";
    res.writeHead(upstream.status, headers);

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body as any);
    stream.on("error", () => {
      try { res.end(); } catch {}
    });
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Failed to proxy url: ${message}`);
  }
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

let executor: Executor | null = null;
let viteProcess: ChildProcess | null = null;
let terminalServer: TerminalServer | null = null;
let studioBrowserManager: StudioBrowserManager | null = null;
let playerBrowser: Browser | null = null;
let playerPage: Page | null = null;
let currentViewMode: ViewMode = "live";
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
      env: { ...process.env, PLAYER_PORT: String(PORT) },
    });
    viteProcess = vite;

    let resolved = false;
    const onData = (d: Buffer) => {
      process.stdout.write(d);
      if (!resolved && d.toString().includes("Local:")) {
        resolved = true;
        resolve(vite);
      }
    };
    vite.stdout?.on("data", onData);
    vite.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(d);
      if (!resolved && d.toString().includes("Local:")) {
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

const httpServer = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");

  if (u.pathname === "/api/proxy") {
    void proxyExternalPage(req, res, u);
    return;
  }

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
    stream.on("error", () => { try { res.end(); } catch {} });
    res.on("close", () => { stream.destroy(); });
    stream.pipe(res);
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
    // Forward Vite HMR and other WebSocket upgrades
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
    send(ws, { type: "studioReady", terminalServerUrl: terminalServer.baseHttpUrl });
  }

  if (executor) {
    send(ws, { type: "status", loaded: true, executedUpTo: -1 });
  }

  ws.on("message", async (raw) => {
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

          currentScenarioFile = msg.file;
          currentStepMetas = [];
          const descriptor = await loadScenarioDescriptor(msg.file);
          executor = new Executor(descriptor, {
            projectRoot: PROJECT_ROOT,
            playerBrowser,
            playerPage,
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
              cache.saveVideo(currentCacheDir, videoPath);
              const subtitlesDir = path.dirname(videoPath);
              const vttPath = path.join(subtitlesDir, "captions.vtt");
              if (fs.existsSync(vttPath)) cache.saveSubtitles(currentCacheDir, vttPath);
            } catch (err) {
              console.error("[player] Failed to save video to cache:", err);
            }
          }
          send(ws, { type: "finished", videoPath: videoPath ?? (currentCacheDir ? cache.getVideoPath(currentCacheDir) : null) ?? undefined });
          break;
        }

        case "reset": {
          if (executor) await executor.reset();
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
          send(ws, { type: "cacheCleared" } as any);
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

        case "studioOpenBrowser": {
          if (!studioBrowserManager) {
            studioBrowserManager = new StudioBrowserManager();
            studioBrowserManager.onFrame = (paneId, data) => send(ws, { type: "studioFrame", paneId, data });
            studioBrowserManager.onReplayEvent = (paneId, event) => send(ws, { type: "replayEvent", event });
          }
          console.error(`[player] Studio: opening browser pane "${msg.paneId}" → ${msg.url}`);
          await studioBrowserManager.openPane(msg.paneId, msg.url);
          break;
        }

        case "studioCloseBrowser": {
          if (studioBrowserManager) {
            console.error(`[player] Studio: closing browser pane "${msg.paneId}"`);
            await studioBrowserManager.closePane(msg.paneId);
          }
          break;
        }

        case "studioMouseEvent": {
          if (studioBrowserManager) {
            await studioBrowserManager.forwardMouseEvent(msg.paneId, msg.action, msg.x, msg.y, {
              button: msg.button,
              deltaX: msg.deltaX,
              deltaY: msg.deltaY,
            });
          }
          break;
        }

        case "studioKeyEvent": {
          if (studioBrowserManager) {
            await studioBrowserManager.forwardKeyboardEvent(msg.paneId, msg.action, msg.key);
          }
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[player] Error:", message);
      send(ws, { type: "error", message });
    }
  });

  ws.on("close", async () => {
    console.error("[player] Client disconnected");
    if (executor) {
      try {
        await executor.dispose();
      } catch (err) {
        console.error("[player] Error disposing executor on disconnect:", err);
      }
    }
    if (studioBrowserManager) {
      try {
        await studioBrowserManager.dispose();
        studioBrowserManager = null;
      } catch (err) {
        console.error("[player] Error disposing studio browser on disconnect:", err);
      }
    }
  });
});

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

// Load .env from project root so OPENAI_API_KEY and other vars are available
loadDotenv(PROJECT_ROOT);

// Start — bind player first so VITE_PORT check doesn't collide
PORT = await findFreePort(PORT, "Player");
VITE_PORT = await findFreePort(PORT + 1, "Vite");
TERMINAL_PORT = await findFreePort(PORT + 2, "Terminal WS");
terminalServer = await startTerminalWsServer(TERMINAL_PORT);
console.error(`  Terminal WS server running at ${terminalServer.baseHttpUrl}`);
await new Promise<void>((resolve) => httpServer.listen(PORT, () => {
  console.error(`\n  b2v Player running at http://localhost:${PORT}\n`);
  resolve();
}));
await startVite();

const url = `http://localhost:${PORT}`;
const shouldAutoOpenBrowser = process.env.B2V_AUTO_OPEN_BROWSER !== "0";
if (shouldAutoOpenBrowser) {
  console.error("  Vite ready, launching Chromium…\n");
  playerBrowser = await chromium.launch({
    headless: false,
    args: [
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const context = await playerBrowser.newContext({ viewport: null });
  await enableFrameHeaderBypass(context);
  playerPage = await context.newPage();
  await playerPage.goto(url);
} else {
  console.error("  Vite ready (auto-open disabled).\n");
}

process.on("SIGINT", async () => {
  if (executor) await executor.dispose();
  if (studioBrowserManager) await studioBrowserManager.dispose();
  if (playerBrowser) await playerBrowser.close();
  if (terminalServer) await terminalServer.close();
  if (viteProcess) viteProcess.kill();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_WRITE_AFTER_END") {
    console.error("[player] Socket error (ignored):", err.message);
    return;
  }
  console.error("[player] Uncaught exception:", err);
  process.exit(1);
});
