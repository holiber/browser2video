/**
 * Electron main process for the b2v Player.
 *
 * - Creates the main BrowserWindow with the player React UI
 * - Manages a WebContentsView for embedding scenario pages directly
 * - Runs the HTTP+WS server in-process (for direct onRequestPage callbacks)
 * - Exposes CDP port so Playwright (in the session) can connect to
 *   the scenario WebContentsView and interact with it
 */
import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = parseInt(process.env.B2V_CDP_PORT ?? "9334", 10);

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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    if (scenarioView) {
      try { scenarioView.webContents.close(); } catch {}
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
    } catch {}
    scenarioView = null;
  }

  scenarioView = new WebContentsView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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

  // Position the view over the preview area (initially full content area)
  const bounds = mainWindow.getContentBounds();
  scenarioView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
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
  } catch {}
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
  createMainWindow();

  // Set env vars for the in-process server
  process.env.PORT = String(SERVER_PORT);
  process.env.B2V_AUTO_OPEN_BROWSER = "0";
  process.env.B2V_CDP_PORT = String(CDP_PORT);

  // Import and start the server in-process
  console.error("[electron] Starting server in-process...");
  try {
    await import("../server/index.ts");
    console.error(`[electron] Server started on port ${SERVER_PORT}`);
  } catch (err) {
    console.error("[electron] Failed to start server:", err);
  }

  // Load the player UI
  const playerUrl = `http://localhost:${SERVER_PORT}`;
  mainWindow!.loadURL(playerUrl);
  console.error(`[electron] Player UI loaded: ${playerUrl}`);
  console.error(`[electron] CDP available at http://localhost:${CDP_PORT}`);
});

app.on("window-all-closed", () => {
  app.quit();
});
