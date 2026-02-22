/**
 * Electron main process for the b2v Player.
 *
 * - Creates the main BrowserWindow with the player React UI
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.error(`[electron ${elt()}] All imports done`);
const CDP_PORT = parseInt(process.env.B2V_CDP_PORT ?? "9334", 10);

// Kill any stale process holding the CDP port from a previous run
try {
  const pids = execSync(`lsof -ti :${CDP_PORT} 2>/dev/null`, { encoding: "utf8" }).trim();
  for (const pid of pids.split("\n").filter(Boolean)) {
    if (pid.trim() === String(process.pid)) continue;
    try { execSync(`kill -9 ${pid.trim()} 2>/dev/null`); } catch { }
    console.error(`[electron] Killed stale process ${pid.trim()} on CDP port ${CDP_PORT}`);
  }
} catch { }

// Enable CDP so Playwright can connect to WebContentsView pages
app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT));
// Disable site isolation so nested iframes (terminal panes) are accessible via CDP
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("disable-features", "IsolateOrigins,site-per-process");

let mainWindow: BrowserWindow | null = null;
let scenarioView: WebContentsView | null = null;

const SERVER_PORT = parseInt(process.env.PORT ?? "9521", 10);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "b2v Player",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
    },
  });

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

  // Start hidden (zero-size). The React ElectronScenarioView component
  // will send the correct bounds via IPC once it mounts.
  scenarioView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
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

  // Import and start the server in-process (~0.5s)
  console.error(`[electron ${elt()}] Importing server module...`);
  try {
    await import("../server/index.ts");
    console.error(`[electron ${elt()}] Server started on port ${SERVER_PORT}`);
  } catch (err) {
    console.error("[electron] Failed to start server:", err);
  }

  // Now navigate to the real player URL
  const playerUrl = `http://localhost:${SERVER_PORT}`;
  console.error(`[electron ${elt()}] Loading player UI: ${playerUrl}`);
  mainWindow!.loadURL(playerUrl);

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
