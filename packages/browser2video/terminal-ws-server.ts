/**
 * @description WebSocket <-> PTY bridge for rendering real terminals inside xterm.js.
 * Generic command support: connect to /term?cmd=<command> to launch any CLI app,
 * or /term (no cmd) for an interactive shell session.
 */
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";

export type TerminalServer = {
  /** Base WebSocket URL (without trailing slash), e.g. ws://127.0.0.1:12345 */
  baseWsUrl: string;
  /** Base HTTP URL (without trailing slash), e.g. http://127.0.0.1:12345 */
  baseHttpUrl: string;
  close: () => Promise<void>;
};

export type GridPaneConfig =
  | { type: "terminal"; cmd?: string; testId: string; title: string; allowAddTab?: boolean }
  | { type: "browser"; url: string; title: string };

function safeLocale(): string {
  return (
    process.env.LC_ALL ??
    process.env.LANG ??
    (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8")
  );
}

function ensureNodePtySpawnHelperExecutable() {
  try {
    const require = createRequire(import.meta.url);
    const unixTerminalPath = require.resolve("node-pty/lib/unixTerminal.js");
    const pkgRoot = path.resolve(path.dirname(unixTerminalPath), "..");
    const helper = path.join(
      pkgRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );

    if (!fs.existsSync(helper)) return;
    const st = fs.statSync(helper);
    const isExecutable = (st.mode & 0o111) !== 0;
    if (isExecutable) return;
    fs.chmodSync(helper, 0o755);
  } catch {
    // ignore
  }
}

function spawnPty(cmd: string | undefined, initialCols: number, initialRows: number) {
  const locale = safeLocale();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: locale,
    LC_ALL: locale,
  };

  if (!cmd) {
    // Interactive shell with a clean prompt and automatic title tracking.
    // Write a tiny init file that:
    //   - sets a minimal PS1
    //   - uses PROMPT_COMMAND to reset title to "Shell" when idle
    //   - uses a DEBUG trap to set title to the running command name
    const initFile = path.join(os.tmpdir(), `b2v-bashrc-${process.pid}-${Date.now()}.sh`);
    fs.writeFileSync(initFile, [
      'PS1="\\$ "',
      'PROMPT_COMMAND=\'printf "\\033]0;Shell\\007"\'',
      'trap \'case "$BASH_COMMAND" in "$PROMPT_COMMAND") ;; *) printf "\\033]0;%s\\007" "$BASH_COMMAND";; esac\' DEBUG',
      // Enable vim syntax highlighting and line numbers by default (better for video)
      'export VIMINIT="syntax on | set number | filetype on | set background=dark"',
    ].join("\n") + "\n", "utf-8");

    const p = pty.spawn("bash", ["--init-file", initFile, "-i"], {
      name: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
      cwd: process.cwd(),
      env,
    });

    // Clean up temp init file once the shell starts (small delay to ensure bash has read it)
    setTimeout(() => { try { fs.unlinkSync(initFile); } catch {} }, 2000);

    return p;
  }

  // Launch any command via bash -lc wrapper
  return pty.spawn("bash", ["-lc", cmd], {
    name: "xterm-256color",
    cols: initialCols,
    rows: initialRows,
    cwd: process.cwd(),
    env,
  });
}

function isResizeMessage(v: unknown): v is { type: "resize"; cols: number; rows: number } {
  const obj = v as any;
  return (
    obj &&
    typeof obj === "object" &&
    obj.type === "resize" &&
    Number.isFinite(obj.cols) &&
    Number.isFinite(obj.rows)
  );
}

export async function startTerminalWsServer(port = 0): Promise<TerminalServer> {
  ensureNodePtySpawnHelperExecutable();

  // Resolve xterm and dockview static file paths once
  const require = createRequire(import.meta.url);
  const xtermStaticPaths: Record<string, { file: string; mime: string }> = {};
  try {
    xtermStaticPaths["/static/xterm.js"] = { file: require.resolve("@xterm/xterm/lib/xterm.js"), mime: "text/javascript" };
    xtermStaticPaths["/static/xterm.css"] = { file: require.resolve("@xterm/xterm/css/xterm.css"), mime: "text/css" };
    xtermStaticPaths["/static/addon-fit.js"] = { file: require.resolve("@xterm/addon-fit/lib/addon-fit.js"), mime: "text/javascript" };
  } catch {
    // xterm packages not installed — terminal page won't work
  }
  try {
    xtermStaticPaths["/static/dockview.js"] = { file: require.resolve("dockview-core/dist/dockview-core.js"), mime: "text/javascript" };
  } catch {
    // dockview-core not installed — grid page will fall back
  }

  let _terminalPageHtml: ((wsUrl: string, testId: string, title: string) => string) | null = null;
  let _terminalGridHtml: ((baseWsUrl: string, panes: GridPaneConfig[], grid?: number[][], viewport?: { width: number; height: number }, mode?: string) => string) | null = null;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");

    // Serve xterm static files from node_modules
    const staticEntry = xtermStaticPaths[u.pathname];
    if (staticEntry) {
      try {
        const content = fs.readFileSync(staticEntry.file, "utf-8");
        res.statusCode = 200;
        res.setHeader("content-type", `${staticEntry.mime}; charset=utf-8`);
        res.setHeader("cache-control", "public, max-age=86400");
        res.end(content);
      } catch {
        res.statusCode = 500;
        res.end("Failed to read static file");
      }
      return;
    }

    if (u.pathname === "/terminal") {
      const cmd = u.searchParams.get("cmd") || undefined;
      const testId = u.searchParams.get("testId") || "xterm-term-0";
      const title = u.searchParams.get("title") || cmd || "Shell";
      const mode = u.searchParams.get("mode") || undefined;
      const baseWsUrl = `ws://localhost:${(server.address() as any)?.port ?? 0}`;

      const wsParams = new URLSearchParams();
      if (mode !== "observe" && cmd) wsParams.set("cmd", cmd);
      if (testId) wsParams.set("testId", testId);
      if (mode) wsParams.set("mode", mode);
      const wsUrl = `${baseWsUrl}/term?${wsParams.toString()}`;

      if (!_terminalPageHtml) {
        _terminalPageHtml = buildXtermPageHtmlFn();
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(_terminalPageHtml(wsUrl, testId, title));
      return;
    }
    if (u.pathname === "/terminal-grid") {
      const configParam = u.searchParams.get("config");
      if (!configParam) {
        res.statusCode = 400;
        res.end("Missing config parameter");
        return;
      }
      let config: { panes: GridPaneConfig[]; grid?: number[][]; viewport?: { width: number; height: number } };
      try {
        config = JSON.parse(decodeURIComponent(configParam));
      } catch {
        res.statusCode = 400;
        res.end("Invalid config JSON");
        return;
      }
      const baseWsUrl = `ws://localhost:${(server.address() as any)?.port ?? 0}`;
      const mode = u.searchParams.get("mode") || undefined;
      if (!_terminalGridHtml) {
        _terminalGridHtml = buildXtermGridPageHtmlFn();
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(_terminalGridHtml(baseWsUrl, config.panes, config.grid, config.viewport, mode));
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  // PTY registry for observer (multiplexed read-only) connections
  interface PtyEntry {
    pty: pty.IPty;
    primaryWs: WebSocket | null;
    clients: Set<WebSocket>;
    outputBuffer: Uint8Array[];
    totalBufferSize: number;
  }
  const ptyRegistry = new Map<string, PtyEntry>();
  const MAX_BUFFER_SIZE = 1024 * 1024;

  function handleTerminalWs(ws: WebSocket, cmd: string | undefined, testId?: string, mode?: string) {
    const isObserver = mode === "observe";

    if (isObserver && testId) {
      const entry = ptyRegistry.get(testId);
      if (!entry) {
        try { ws.send(encoder.encode(`[b2v] PTY not found: ${testId}\r\n`)); } catch {}
        ws.close();
        return;
      }

      for (const chunk of entry.outputBuffer) {
        try { ws.send(chunk); } catch {}
      }
      entry.clients.add(ws);

      ws.on("close", () => {
        entry.clients.delete(ws);
        if (entry.clients.size === 0 && !entry.primaryWs) {
          try { entry.pty.kill(); } catch {}
          ptyRegistry.delete(testId);
        }
      });
      ws.on("error", () => { entry.clients.delete(ws); });
      return;
    }

    // Primary mode — spawn a new PTY
    const label = cmd ?? "shell";
    try { ws.send(encoder.encode(`[b2v] connected: ${label}\r\n`)); } catch {}

    const p = spawnPty(cmd, 80, 24);

    let entry: PtyEntry | undefined;
    if (testId) {
      entry = { pty: p, primaryWs: ws, clients: new Set([ws]), outputBuffer: [], totalBufferSize: 0 };
      ptyRegistry.set(testId, entry);
    }

    p.onData((data: string) => {
      const encoded = encoder.encode(data);
      if (entry) {
        entry.outputBuffer.push(encoded);
        entry.totalBufferSize += encoded.byteLength;
        while (entry.totalBufferSize > MAX_BUFFER_SIZE && entry.outputBuffer.length > 1) {
          entry.totalBufferSize -= entry.outputBuffer.shift()!.byteLength;
        }
        for (const client of entry.clients) {
          try { client.send(encoded); } catch {}
        }
      } else {
        try { ws.send(encoded); } catch {}
      }
    });

    ws.on("message", (msg: any, isBinary?: boolean) => {
      try {
        if (isBinary === false) {
          const text =
            typeof msg === "string"
              ? msg
              : Buffer.isBuffer(msg)
                ? msg.toString("utf8")
                : ArrayBuffer.isView(msg)
                  ? Buffer.from(msg.buffer, msg.byteOffset, msg.byteLength).toString("utf8")
                  : msg instanceof ArrayBuffer
                    ? Buffer.from(msg).toString("utf8")
                    : "";
          if (!text) return;
          const parsed = JSON.parse(text);
          if (isResizeMessage(parsed)) {
            p.resize(parsed.cols, parsed.rows);
          }
          return;
        }

        if (msg instanceof ArrayBuffer) {
          p.write(decoder.decode(new Uint8Array(msg)));
          return;
        }
        if (Buffer.isBuffer(msg)) {
          p.write(decoder.decode(msg));
          return;
        }
        if (ArrayBuffer.isView(msg)) {
          p.write(decoder.decode(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)));
        }
      } catch {}
    });

    ws.on("close", () => {
      if (entry) {
        entry.primaryWs = null;
        entry.clients.delete(ws);
        if (entry.clients.size === 0) {
          try { p.kill(); } catch {}
          if (testId) ptyRegistry.delete(testId);
        }
      } else {
        try { p.kill(); } catch {}
      }
    });

    ws.on("error", () => {
      if (entry) {
        entry.clients.delete(ws);
      }
      try { p.kill(); } catch {}
    });
  }

  server.on("upgrade", (req, socket, head) => {
    try {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== "/term") {
        socket.destroy();
        return;
      }

      const cmd = u.searchParams.get("cmd") || undefined;
      const testId = u.searchParams.get("testId") || undefined;
      const mode = u.searchParams.get("mode") || undefined;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        handleTerminalWs(ws, cmd, testId, mode);
      });
    } catch {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind terminal WS server");
  }

  const baseWsUrl = `ws://localhost:${addr.port}`;
  const baseHttpUrl = `http://localhost:${addr.port}`;

  return {
    baseWsUrl,
    baseHttpUrl,
    close: async () => {
      for (const [, entry] of ptyRegistry) {
        try { entry.pty.kill(); } catch {}
      }
      ptyRegistry.clear();
      for (const client of wss.clients) {
        try { client.close(); } catch {}
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
//  Standalone xterm.js HTML page builder
// ---------------------------------------------------------------------------

function buildXtermPageHtmlFn() {
  return (wsUrl: string, testId: string, title: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/xterm.css">
<script src="/static/xterm.js"><\/script>
<script src="/static/addon-fit.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { height: 100%; }
  body { background: #1e1e1e; color: #d4d4d4; overflow: hidden; height: 100%; display: flex; flex-direction: column; }
  .bar { background: #2d2d2d; color: #cccccc; padding: 4px 12px; font-size: 12px; border-bottom: 1px solid #3e3e3e; flex-shrink: 0; font-family: system-ui, sans-serif; }
  .bar.hidden { display: none; }
  #term { flex: 1; min-height: 0; padding: 4px; }
</style></head><body>
  <div class="bar" id="titlebar">${title}</div>
  <div id="term" data-testid="${testId}" data-b2v-ws-state="connecting"></div>
  <script>
    var inIframe = window !== window.top;
    if (inIframe) document.getElementById('titlebar').classList.add('hidden');

    var observeMode = new URLSearchParams(window.location.search).get('mode') === 'observe';
    var el = document.getElementById('term');
    var term = new Terminal({
      convertEol: false, cursorBlink: !observeMode,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13, lineHeight: 1.15, disableStdin: observeMode,
    });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    window.__b2vFit = fit;
    window.__b2vTerm = term;

    var encoder = new TextEncoder();
    var ws = new WebSocket('${wsUrl}');
    ws.binaryType = 'arraybuffer';

    function sendResize() {
      if (observeMode) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }

    function fitTerminal() {
      try { fit.fit(); sendResize(); return; } catch(e) {}

      var xtermRows = el.querySelector('.xterm-rows');
      var firstRow = xtermRows && xtermRows.children[0];
      if (!firstRow) return;
      var cellH = firstRow.getBoundingClientRect().height;
      if (!cellH) return;

      var s = document.createElement('span');
      s.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      s.style.fontSize = '13px';
      s.style.position = 'absolute';
      s.style.visibility = 'hidden';
      s.textContent = 'W';
      document.body.appendChild(s);
      var cellW = s.getBoundingClientRect().width;
      document.body.removeChild(s);
      if (!cellW) return;

      var style = getComputedStyle(el);
      var padH = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      var padW = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      var cols = Math.max(2, Math.floor((el.offsetWidth - padW) / cellW));
      var rows = Math.max(1, Math.floor((el.offsetHeight - padH) / cellH));
      if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
      }
      sendResize();
    }

    ws.onopen = function() {
      el.dataset.b2vWsState = 'open';
      fitTerminal();
      term.focus();
    };
    var fitted = false;
    ws.onmessage = function(ev) {
      if (ev.data instanceof ArrayBuffer) {
        try { term.write(new Uint8Array(ev.data)); } catch(e) {}
        if (!fitted) {
          fitted = true;
          setTimeout(fitTerminal, 10);
        }
      }
    };
    ws.onerror = function() { el.dataset.b2vWsState = 'error'; };
    ws.onclose = function(e) { el.dataset.b2vWsState = 'closed:' + (e.code || '?'); };

    if (!observeMode) {
      term.onData(function(data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
      });
    }

    term.onTitleChange(function(t) {
      if (!t) return;
      var bar = document.getElementById('titlebar');
      if (bar) bar.textContent = t;
      // Notify parent dockview page to update panel tab title
      if (inIframe) {
        try { parent.postMessage({ type: 'b2v-title', testId: '${testId}', title: t }, '*'); } catch(e) {}
      }
    });

    var ro = new ResizeObserver(function() { fitTerminal(); });
    ro.observe(el);
  <\/script>
</body></html>`;
}

// ---------------------------------------------------------------------------
//  Multi-pane dockview grid page builder (iframes for keyboard isolation)
// ---------------------------------------------------------------------------

/**
 * Convert a grid layout (number[][]) to a sequence of dockview addPanel() calls.
 * Returns an ordered list of { index, position } where position is undefined
 * for the first panel, and { referencePanel, direction } for subsequent ones.
 */
function gridToAddPanelOrder(grid: number[][], paneCount: number, viewportW: number, viewportH: number): Array<{
  index: number;
  position?: { referencePanel: string; direction: string };
  initialWidth?: number;
  initialHeight?: number;
}> {
  const gridRows = grid.length;
  const gridCols = Math.max(...grid.map((r) => r.length));

  // Find bounding box for each unique pane index
  const boxes = new Map<number, { minRow: number; maxRow: number; minCol: number; maxCol: number }>();
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const idx = grid[r][c];
      const box = boxes.get(idx);
      if (!box) {
        boxes.set(idx, { minRow: r, maxRow: r, minCol: c, maxCol: c });
      } else {
        box.minRow = Math.min(box.minRow, r);
        box.maxRow = Math.max(box.maxRow, r);
        box.minCol = Math.min(box.minCol, c);
        box.maxCol = Math.max(box.maxCol, c);
      }
    }
  }

  const cellW = Math.round(viewportW / gridCols);
  const cellH = Math.round(viewportH / gridRows);

  // Sort panes by their top-left position (row-major)
  const indices = [...boxes.keys()].sort((a, b) => {
    const ba = boxes.get(a)!;
    const bb = boxes.get(b)!;
    return ba.minRow !== bb.minRow ? ba.minRow - bb.minRow : ba.minCol - bb.minCol;
  });

  const result: Array<{
    index: number;
    position?: { referencePanel: string; direction: string };
    initialWidth?: number;
    initialHeight?: number;
  }> = [];
  const placed = new Set<number>();

  for (const idx of indices) {
    if (idx >= paneCount) continue;
    const box = boxes.get(idx)!;
    const spanCols = box.maxCol - box.minCol + 1;
    const spanRows = box.maxRow - box.minRow + 1;
    const targetW = spanCols * cellW;
    const targetH = spanRows * cellH;

    if (placed.size === 0) {
      result.push({ index: idx });
      placed.add(idx);
      continue;
    }

    let bestRef: number | undefined;
    let bestDir: string | undefined;
    let bestScore = -1;

    // Find the placed panel with the best edge overlap for adjacency.
    // Score = (edge overlap ratio) * (perpendicular span similarity).
    // The perpendicular similarity breaks ties: e.g. for grid [[0,1],[0,2]],
    // "below Pane 1" (col ranges match exactly) beats "right of Pane 0"
    // (row ranges differ: 1 vs 2 rows).
    for (const placedIdx of placed) {
      const pBox = boxes.get(placedIdx)!;
      const refSpanRows = pBox.maxRow - pBox.minRow + 1;
      const refSpanCols = pBox.maxCol - pBox.minCol + 1;
      const candidates: Array<{ dir: string; score: number }> = [];

      if (box.minCol === pBox.maxCol + 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
        const overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
        const maxOverlap = box.maxRow - box.minRow + 1;
        const perpSim = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
        candidates.push({ dir: "right", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.minRow === pBox.maxRow + 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
        const overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
        const maxOverlap = box.maxCol - box.minCol + 1;
        const perpSim = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
        candidates.push({ dir: "below", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.maxCol === pBox.minCol - 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
        const overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
        const maxOverlap = box.maxRow - box.minRow + 1;
        const perpSim = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
        candidates.push({ dir: "left", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.maxRow === pBox.minRow - 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
        const overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
        const maxOverlap = box.maxCol - box.minCol + 1;
        const perpSim = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
        candidates.push({ dir: "above", score: (overlap / maxOverlap) * perpSim });
      }

      for (const c of candidates) {
        if (c.score > bestScore) {
          bestScore = c.score;
          bestRef = placedIdx;
          bestDir = c.dir;
        }
      }
    }

    const sizeForDirection = (dir: string) =>
      dir === "right" || dir === "left" ? { initialWidth: targetW } : { initialHeight: targetH };

    if (bestRef !== undefined && bestDir) {
      result.push({
        index: idx,
        position: { referencePanel: `panel-${bestRef}`, direction: bestDir },
        ...sizeForDirection(bestDir),
      });
    } else {
      result.push({
        index: idx,
        position: { referencePanel: `panel-${indices[0]}`, direction: "right" },
        initialWidth: targetW,
      });
    }
    placed.add(idx);
  }

  return result;
}

function buildXtermGridPageHtmlFn() {
  return (
    baseWsUrl: string,
    panes: GridPaneConfig[],
    grid?: number[][],
    viewport?: { width: number; height: number },
    mode?: string,
  ) => {
    const vpW = viewport?.width ?? 1280;
    const vpH = viewport?.height ?? 720;
    const isObserve = mode === "observe";

    const paneDataJson = JSON.stringify(panes.map((p, i) => {
      if (p.type === "browser") {
        return { type: "browser", url: p.url, title: p.title, index: i };
      }
      const params: Record<string, string> = { testId: p.testId, title: p.title };
      if (!isObserve && p.cmd) params.cmd = p.cmd;
      if (isObserve) params.mode = "observe";
      const src = `/terminal?${new URLSearchParams(params).toString()}`;
      return { type: "terminal", src, testId: p.testId, title: p.title, index: i, allowAddTab: !isObserve && !!p.allowAddTab };
    }));

    // Compute the addPanel ordering from the grid layout
    const effectiveGrid = grid ?? [panes.map((_, i) => i)];
    const addOrder = gridToAddPanelOrder(effectiveGrid, panes.length, vpW, vpH);
    const addOrderJson = JSON.stringify(addOrder);

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="/static/dockview.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #1e1e1e; }
  #dockview-root { width: 100%; height: 100%; }
  iframe { border: none; width: 100%; height: 100%; }

  /* Dark theme overrides for dockview */
  :root {
    --dv-group-view-background-color: #1e1e1e;
    --dv-tabs-and-actions-container-background-color: #252526;
    --dv-activegroup-visiblepanel-tab-background-color: #1e1e1e;
    --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
    --dv-activegroup-visiblepanel-tab-color: #ffffff;
    --dv-activegroup-hiddenpanel-tab-color: #969696;
    --dv-inactivegroup-visiblepanel-tab-background-color: #2d2d2d;
    --dv-inactivegroup-hiddenpanel-tab-background-color: #2d2d2d;
    --dv-inactivegroup-visiblepanel-tab-color: #cccccc;
    --dv-inactivegroup-hiddenpanel-tab-color: #969696;
    --dv-separator-border: #3e3e3e;
    --dv-paneview-header-border-color: #3e3e3e;
  }
  /* Hide close button on all tabs by default */
  .dv-default-tab .dv-default-tab-action { display: none !important; }
  /* Show close button only on dynamically added (closable) tabs */
  .dv-default-tab.b2v-closable .dv-default-tab-action { display: flex !important; }
  /* "+" button styling */
  .b2v-add-tab-btn {
    background: none; border: 1px solid #555; color: #ccc; cursor: pointer;
    width: 22px; height: 22px; border-radius: 4px; font-size: 16px; line-height: 1;
    display: flex; align-items: center; justify-content: center; margin-right: 4px;
  }
  .b2v-add-tab-btn:hover { background: #3e3e3e; color: #fff; }
</style></head><body>
  <div id="dockview-root"></div>
  <script>
    var dv = window["dockview-core"];
    var paneData = ${paneDataJson};
    var addOrder = ${addOrderJson};
    var panelMap = {};

    var hasAddTabPanes = paneData.some(function(p) { return p.allowAddTab; });

    var component = new dv.DockviewComponent(document.getElementById('dockview-root'), {
      createComponent: function(options) {
        var el = document.createElement('div');
        el.style.height = '100%';
        el.style.width = '100%';
        el.style.overflow = 'hidden';
        return {
          element: el,
          init: function(params) {
            var p = params.params || {};
            var iframe = document.createElement('iframe');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.name = p.iframeName || '';
            if (p.src) iframe.src = p.src;
            el.appendChild(iframe);
          },
        };
      },
      createRightHeaderActionComponent: !hasAddTabPanes ? undefined : function(groupPanel) {
        var el = document.createElement('div');
        return {
          element: el,
          init: function(params) {
            var grp = params.group || groupPanel;
            // Track this group and show/hide "+" after all panels are placed
            var groupId = grp.id;
            if (!window.__b2v_addTabGroups) window.__b2v_addTabGroups = {};
            window.__b2v_addTabGroups[groupId] = { el: el, group: grp };
          },
          dispose: function() { el.innerHTML = ''; },
        };
      },
      defaultRenderer: 'always',
      singleTabMode: 'fullwidth',
      disableFloatingGroups: true,
      locked: true,
      disableDnd: true,
    });

    // Add panels in the computed order
    for (var i = 0; i < addOrder.length; i++) {
      var entry = addOrder[i];
      var pane = paneData[entry.index];
      var panelOpts = {
        id: 'panel-' + entry.index,
        component: 'iframe',
        title: pane.title,
        params: {
          iframeName: 'term-' + entry.index,
          src: pane.type === 'browser' ? pane.url : pane.src,
        },
      };
      if (entry.position) panelOpts.position = entry.position;
      var panel = component.api.addPanel(panelOpts);
      panelMap['panel-' + entry.index] = panel;
    }

    // Resize panels to their target dimensions after all are placed
    for (var i = 0; i < addOrder.length; i++) {
      var entry = addOrder[i];
      var p = panelMap['panel-' + entry.index];
      if (p && (entry.initialWidth || entry.initialHeight)) {
        var sz = {};
        if (entry.initialWidth) sz.width = entry.initialWidth;
        if (entry.initialHeight) sz.height = entry.initialHeight;
        p.api.setSize(sz);
      }
    }

    // Lock all groups to prevent drops
    for (var pid in panelMap) {
      var grp = panelMap[pid].group;
      if (grp && !grp.locked) grp.locked = 'no-drop-target';
    }

    // Create "+" buttons for groups that contain allowAddTab panels
    if (hasAddTabPanes && window.__b2v_addTabGroups) {
      for (var gid in window.__b2v_addTabGroups) {
        var info = window.__b2v_addTabGroups[gid];
        var grp = info.group;
        var panels = grp.panels || [];
        var showAdd = panels.some(function(p) {
          var pd = paneData.find(function(d) { return 'panel-' + d.index === p.id; });
          return pd && pd.allowAddTab;
        });
        if (!showAdd) continue;
        (function(container, group) {
          var btn = document.createElement('button');
          btn.className = 'b2v-add-tab-btn';
          btn.setAttribute('data-testid', 'b2v-add-tab');
          btn.textContent = '+';
          btn.onclick = function() {
            var activePanel = group.activePanel;
            var refId = activePanel ? activePanel.id : null;
            window.__b2v_addTab({ referencePanel: refId });
          };
          container.appendChild(btn);
        })(info.el, grp);
      }
    }

    // Listen for title updates from terminal iframes via postMessage
    window.addEventListener('message', function(ev) {
      if (!ev.data || ev.data.type !== 'b2v-title') return;
      var testId = ev.data.testId;
      var newTitle = ev.data.title;
      // Find the panel whose iframe matches this testId
      for (var pi = 0; pi < paneData.length; pi++) {
        if (paneData[pi].testId === testId) {
          var p = panelMap['panel-' + pi];
          if (p && p.api) p.api.updateParameters({ title: newTitle });
          if (p) p.setTitle(newTitle);
          break;
        }
      }
    });

    // Dynamic tab management API for Playwright
    var tabCounter = paneData.length;

    window.__b2v_addTab = function(config) {
      var idx = tabCounter++;
      var testId = config.testId || ('xterm-dyn-' + idx);
      var title = config.title || 'Shell';
      var src = '/terminal?' + new URLSearchParams(
        Object.assign({ testId: testId, title: title }, config.cmd ? { cmd: config.cmd } : {})
      ).toString();
      var iframeName = 'term-' + idx;
      var refPanel = config.referencePanel || null;
      var panelOpts = {
        id: 'panel-' + idx,
        component: 'iframe',
        title: title,
        params: { iframeName: iframeName, src: src },
      };
      if (refPanel) {
        panelOpts.position = { referencePanel: refPanel, direction: 'within' };
      }
      var panel = component.api.addPanel(panelOpts);
      panelMap['panel-' + idx] = panel;
      paneData.push({ type: 'terminal', src: src, testId: testId, title: title, index: idx });
      // Mark the new tab as closable via the panel's tab DOM element
      try {
        var tabEl = panel.view && panel.view.tab && panel.view.tab.element;
        if (tabEl) tabEl.classList.add('b2v-closable');
      } catch(e) {}
      return { panelId: 'panel-' + idx, iframeName: iframeName, testId: testId };
    };

    window.__b2v_closeTab = function(panelId) {
      var panel = panelMap[panelId];
      if (panel) {
        component.api.removePanel(panel);
        delete panelMap[panelId];
      }
    };

    window.__b2v_dockview = component;
    window.__b2v_paneData = paneData;
  <\/script>
</body></html>`;
  };
}

// ---------------------------------------------------------------------------
//  CLI entry point: `node packages/lib/src/terminal-ws-server.ts [port]`
// ---------------------------------------------------------------------------
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("terminal-ws-server.ts") ||
    process.argv[1].endsWith("terminal-ws-server.js"));

if (isDirectRun) {
  const port = parseInt(process.argv[2] ?? process.env.B2V_TERMINAL_WS_PORT ?? "9800", 10);
  startTerminalWsServer(port).then((s) => {
    console.log(`Terminal WS server listening on ${s.baseWsUrl}`);
    process.on("SIGINT", async () => {
      await s.close();
      process.exit(0);
    });
  });
}
