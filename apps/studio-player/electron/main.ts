/**
 * Electron main process for Studio Player.
 *
 * - Creates the main BrowserWindow with the Studio Player React UI
 * - Manages a WebContentsView for embedding scenario pages directly
 * - Runs the HTTP+WS server in-process (for direct onRequestPage callbacks)
 * - Exposes CDP port so Playwright (in the session) can connect to
 *   the scenario WebContentsView and interact with it
 */
const ELECTRON_EPOCH = performance.now();
const elt = () => `${((performance.now() - ELECTRON_EPOCH) / 1000).toFixed(1)}s`;
console.error(`[electron ${elt()}] Process starting (module eval begins)`);

import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
console.error(`[electron ${elt()}] Electron imports loaded`);
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.error(`[electron ${elt()}] All imports done`);
const PREFERRED_CDP_PORT = parseInt(process.env.B2V_CDP_PORT ?? "9334", 10);

// Probe if the preferred port is available; if not, find a free one
function isPortFree(port: number): boolean {
  try {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => { });
    // Listen synchronously by using a blocking flag trick
    let free = true;
    try {
      execSync(
        `node -e "const s=require('net').createServer();s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)});s.on('error',()=>process.exit(1))"`,
        { timeout: 2000, stdio: "ignore" },
      );
    } catch { free = false; }
    return free;
  } catch { return false; }
}

function findFreePort(preferred: number): number {
  if (isPortFree(preferred)) return preferred;
  for (let port = preferred + 1; port < preferred + 65; port++) {
    if (isPortFree(port)) return port;
  }
  return 0; // let OS pick
}

let CDP_PORT = PREFERRED_CDP_PORT;

// Kill any stale process holding the CDP port from a previous run
try {
  const pids = execSync(`lsof -ti :${CDP_PORT} 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
  for (const pid of pids.split("\n").filter(Boolean)) {
    if (pid.trim() === String(process.pid)) continue;
    try { execSync(`kill -9 ${pid.trim()} 2>/dev/null`, { timeout: 2000 }); } catch { }
    console.error(`[electron] Killed stale process ${pid.trim()} on CDP port ${CDP_PORT}`);
  }
} catch { }

// Check if port is actually available now; if not, find a free one
{
  const actualPort = findFreePort(CDP_PORT);
  if (actualPort !== CDP_PORT) {
    console.error(`[electron] CDP port ${CDP_PORT} is busy, using ${actualPort} instead`);
    CDP_PORT = actualPort;
  }
}

// Enable CDP so Playwright can connect to WebContentsView pages
app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT));
// Disable site isolation so nested iframes (terminal panes) are accessible via CDP
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("disable-features", "IsolateOrigins,site-per-process");

let mainWindow: BrowserWindow | null = null;
let scenarioView: WebContentsView | null = null;

const SERVER_PORT = parseInt(process.env.PORT ?? "9521", 10);

const isEmbedded = process.env.B2V_EMBEDDED === "1";

function parseAutoScenarioFromCli(argv: string[]): { file: string | null; autoplay: boolean } {
  // Electron argv usually looks like:
  //   [electronExe, appPath, ...userArgs]
  // We support both explicit `--scenario` and positional `*.scenario.ts`.
  let file: string | null = null;
  let autoplay = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-play" || a === "--no-autoplay") autoplay = false;
    if (a === "--play" || a === "--autoplay") autoplay = true;

    if (a === "--scenario" && argv[i + 1]) {
      file = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--scenario=")) {
      file = a.slice("--scenario=".length);
      continue;
    }

    if (a.endsWith(".scenario.ts") || a.endsWith(".scenario.js") || a.endsWith(".scenario.mjs")) {
      file = a;
      // If a scenario is provided positionally, default to autoplay unless explicitly disabled.
      if (!argv.includes("--no-play") && !argv.includes("--no-autoplay")) autoplay = true;
    }
  }

  return { file, autoplay };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    // When running embedded inside another player (self-test), hide the window
    // completely. The UI is served via HTTP and rendered in the parent player's
    // scenario WebContentsView. On macOS, show:false alone can still flash;
    // we also use off-screen position and minimal size.
    // Embedded instances need a real surface for CDP capture/screencast.
    // Keep the window off-screen and transparent instead of tiny/minimized.
    width: isEmbedded ? 1280 : 1440,
    height: isEmbedded ? 720 : 900,
    x: isEmbedded ? -10000 : undefined,
    y: isEmbedded ? -10000 : undefined,
    show: !isEmbedded,
    skipTaskbar: isEmbedded,
    // Prevent embedded window from appearing in Mission Control / Expose
    ...(isEmbedded ? { type: "toolbar" as any, focusable: false, hasShadow: false } : {}),
    title: "Studio Player",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Nested StudioPlayer runs hidden/offscreen; keep timers/rendering alive
      // so CDP screencasts still produce frames.
      backgroundThrottling: !isEmbedded,
    },
  });

  // For embedded instances: aggressively hide the window.
  // macOS can show windows during loadURL or other async operations.
  if (isEmbedded) {
    // Keep it effectively invisible, but still "shown" so Chromium paints frames.
    try { mainWindow.setOpacity(0); } catch { }
    try { mainWindow.setIgnoreMouseEvents(true); } catch { }
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.showInactive();
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" as const }));

  mainWindow.on("closed", () => {
    if (scenarioView) {
      try { scenarioView.webContents.close(); } catch { }
      scenarioView = null;
    }
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
//  Scenario WebContentsView management
// ---------------------------------------------------------------------------

ipcMain.handle("scenario:createView", async (_event, url: string, bounds: { x: number; y: number; width: number; height: number }) => {
  await createScenarioView(url, bounds);
  return { cdpPort: CDP_PORT };
});

ipcMain.handle("scenario:destroyView", async () => {
  destroyScenarioView();
});

ipcMain.handle("scenario:resizeView", async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
  resizeScenarioView(bounds);
});

ipcMain.handle("scenario:openDevTools", async () => {
  if (!scenarioView) return;
  scenarioView.webContents.openDevTools({ mode: "detach" });
});

// ---------------------------------------------------------------------------
//  Exported API for in-process server usage
// ---------------------------------------------------------------------------

/**
 * Create a WebContentsView for a scenario page and position it in the main window.
 * Called by the Executor (via onRequestPage callback) when a scenario needs a page.
 */
export async function createScenarioView(
  url: string,
  viewport: { width: number; height: number },
): Promise<void> {
  if (!mainWindow) throw new Error("No main window");

  if (scenarioView) {
    try {
      mainWindow.contentView.removeChildView(scenarioView);
      scenarioView.webContents.close();
    } catch { }
    scenarioView = null;
  }

  scenarioView = new WebContentsView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  if (isEmbedded) {
    try { scenarioView.webContents.setBackgroundThrottling(false); } catch { }
  }

  scenarioView.webContents.setWindowOpenHandler(() => ({ action: "deny" as const }));

  // Bypass X-Frame-Options / CSP for nested content
  scenarioView.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers["x-frame-options"];
    delete headers["X-Frame-Options"];
    const csp = headers["content-security-policy"];
    if (csp) {
      headers["content-security-policy"] = csp.map((v: string) =>
        v.split(";").filter((d: string) => !/frame-ancestors/i.test(d.trim())).join("; ")
      );
    }
    callback({ responseHeaders: headers });
  });

  // Default bounds:
  // - Normal mode: start hidden (0×0). The React ElectronScenarioView component
  //   will send the correct bounds via IPC once it mounts.
  // - Embedded mode (nested StudioPlayer): ElectronScenarioView is NOT mounted,
  //   so the view would stay 0×0 forever and CDP screencasts would produce
  //   no frames. In that case, size it immediately to the requested viewport.
  const initialBounds = isEmbedded
    ? { x: 0, y: 0, width: Math.max(1, viewport.width), height: Math.max(1, viewport.height) }
    : { x: 0, y: 0, width: 0, height: 0 };
  scenarioView.setBounds(initialBounds);
  mainWindow.contentView.addChildView(scenarioView);

  await scenarioView.webContents.loadURL(url);

  console.error(`[electron] Scenario view created: url=${url} viewport=${viewport.width}x${viewport.height}`);

  // Notify the renderer that the view is ready
  mainWindow.webContents.send("scenario:viewReady");
}

/** Destroy the current scenario view. */
export function destroyScenarioView(): void {
  if (!mainWindow || !scenarioView) return;
  try {
    mainWindow.contentView.removeChildView(scenarioView);
    scenarioView.webContents.close();
  } catch { }
  scenarioView = null;
  console.error("[electron] Scenario view destroyed");
}

/** Resize/reposition the scenario view. */
export function resizeScenarioView(bounds: { x: number; y: number; width: number; height: number }): void {
  if (!scenarioView) return;
  scenarioView.setBounds(bounds);
}

// ---------------------------------------------------------------------------
//  App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  console.error(`[electron ${elt()}] app.whenReady() fired`);

  const iconPath = path.join(__dirname, "..", "assets", "icon.png");
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconPath);
  }

  console.error(`[electron ${elt()}] Creating main window...`);
  createMainWindow();
  console.error(`[electron ${elt()}] Main window created`);

  process.env.PORT = String(SERVER_PORT);
  process.env.B2V_CDP_PORT = String(CDP_PORT);

  // Load a minimal splash page immediately. This unblocks Playwright's
  // firstWindow() which otherwise waits ~15s for the first navigation.
  mainWindow!.loadURL("data:text/html,<html><body style='background:%230d1117;color:%23888;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><div>Starting…</div></body></html>");
  // Re-hide after loadURL for embedded instances (macOS can show the window)
  if (isEmbedded) mainWindow!.hide();

  // Import and start the server in-process (~0.5s)
  console.error(`[electron ${elt()}] Importing server module...`);
  try {
    await import("../server/index.ts");
    console.error(`[electron ${elt()}] Server started on port ${SERVER_PORT}`);
  } catch (err) {
    console.error("[electron] Failed to start server:", err);
  }

  // Now navigate to the real player URL
  const { file: autoScenarioFile, autoplay } = parseAutoScenarioFromCli(process.argv);
  const params = new URLSearchParams();
  if (autoScenarioFile) {
    params.set("scenario", autoScenarioFile);
    if (autoplay) params.set("autoplay", "1");
  }
  const playerUrl = `http://localhost:${SERVER_PORT}${params.size ? `/?${params.toString()}` : ""}`;
  console.error(`[electron ${elt()}] Loading player UI: ${playerUrl}`);
  mainWindow!.loadURL(playerUrl);
  // Re-hide after loadURL for embedded instances
  if (isEmbedded) mainWindow!.hide();

  // Verify CDP port is actually listening
  const http = await import("node:http");
  const cdpOk = await new Promise<boolean>((resolve) => {
    const req = http.get(`http://localhost:${CDP_PORT}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
  if (cdpOk) {
    console.error(`[electron ${elt()}] CDP available at http://localhost:${CDP_PORT}`);
  } else {
    console.error(`[electron ${elt()}] WARNING: CDP port ${CDP_PORT} is NOT responding`);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  import("../server/index.ts")
    .then((m) => m.gracefulShutdown())
    .catch(() => { })
    .finally(() => app.exit(0));
  setTimeout(() => app.exit(0), 5_000);
});

// Prevent uncaught exceptions from killing the Electron process.
// The server runs in-process, so process.exit() or re-throw here
// would destroy the entire app (including Playwright test connections).
process.on("uncaughtException", (err) => {
  const msg = err?.message ?? String(err);
  const isNative = msg.includes("Napi::") || msg.includes("node-pty") || msg.includes("spawn");
  console.error(`[electron] uncaughtException (${isNative ? "native" : "js"}):`, msg);
  if (!isNative) {
    console.error("[electron] Stack:", err?.stack);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[electron] unhandledRejection:", reason);
});
