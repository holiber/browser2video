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
  if (paneCount <= 0) return [];
  const gridRows = grid.length;
  if (gridRows === 0) return [];
  const gridCols = Math.max(...grid.map((r) => r.length));
  if (!Number.isFinite(gridCols) || gridCols <= 0) return [];

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

    // Compute the addPanel ordering from the grid layout.
    // If there are fewer pane configs than grid slots, placeholders are created on the client.
    const effectiveGrid = grid ?? (panes.length > 0 ? [panes.map((_, i) => i)] : [[0]]);
    const paneSlots = new Set(effectiveGrid.flat()).size;
    const addOrder = gridToAddPanelOrder(effectiveGrid, Math.max(panes.length, paneSlots), vpW, vpH);
    const addOrderJson = JSON.stringify(addOrder);

    const layoutPresetsJson = JSON.stringify([
      { id: "1x1", label: "Single", grid: [[0]] },
      { id: "side-by-side", label: "Side by Side", grid: [[0, 1]] },
      { id: "top-bottom", label: "Top + Bottom", grid: [[0], [1]] },
      { id: "1-left-2-right", label: "1 Left + 2 Right", grid: [[0, 1], [0, 2]] },
      { id: "3-cols", label: "3 Columns", grid: [[0, 1, 2]] },
      { id: "2x2", label: "2×2 Quad", grid: [[0, 1], [2, 3]] },
    ]);

    const effectiveGridForMatch = effectiveGrid;
    const effectiveGridJson = JSON.stringify(effectiveGridForMatch);

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="/static/dockview.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #1e1e1e; }
  #b2v-toolbar { width: 100%; height: 36px; background: #252526; border-bottom: 1px solid #3e3e3e; display: flex; align-items: center; padding: 0 8px; gap: 8px; flex-shrink: 0; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; color: #ccc; }
  #dockview-root { width: 100%; height: calc(100% - 36px); }
  iframe { border: none; width: 100%; height: 100%; }

  /* Layout dropdown */
  #b2v-layout-select {
    background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 4px;
    padding: 2px 6px; font-size: 12px; height: 26px; cursor: pointer; outline: none;
    font-family: monospace;
  }
  #b2v-layout-select:hover { border-color: #777; }
  #b2v-layout-select:focus { border-color: #007acc; }

  /* "+" add pane button */
  .b2v-toolbar-add-btn {
    background: none; border: 1px solid #555; color: #ccc; cursor: pointer;
    width: 26px; height: 26px; border-radius: 4px; font-size: 18px; line-height: 1;
    display: flex; align-items: center; justify-content: center; margin-left: auto;
  }
  .b2v-toolbar-add-btn:hover { background: #3e3e3e; color: #fff; border-color: #777; }

  /* Add-pane popup overlay */
  #b2v-add-pane-overlay {
    position: fixed; inset: 0; z-index: 1000; display: none;
    align-items: center; justify-content: center; background: rgba(0,0,0,0.5);
  }
  #b2v-add-pane-overlay.visible { display: flex; }
  #b2v-add-pane-popup {
    background: #2d2d2d; border: 1px solid #555; border-radius: 12px;
    padding: 24px; display: flex; gap: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .b2v-pane-tile {
    width: 120px; height: 120px; border-radius: 12px; border: 1px solid #555;
    background: #383838; cursor: pointer; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 8px; color: #ccc;
    font-family: system-ui, sans-serif; font-size: 13px; transition: all 0.2s ease;
    transform: scale(0.8); opacity: 0;
  }
  #b2v-add-pane-overlay.visible .b2v-pane-tile {
    transform: scale(1); opacity: 1;
  }
  .b2v-pane-tile:nth-child(2) { transition-delay: 0.05s; }
  .b2v-pane-tile:hover { background: #444; border-color: #007acc; color: #fff; transform: scale(1.05); }
  .b2v-pane-tile svg { width: 40px; height: 40px; stroke: currentColor; fill: none; stroke-width: 1.5; }

  /* Browser URL prompt */
  #b2v-url-prompt-overlay {
    position: fixed; inset: 0; z-index: 1100; display: none;
    align-items: center; justify-content: center; background: rgba(0,0,0,0.56);
  }
  #b2v-url-prompt-overlay.visible { display: flex; }
  #b2v-url-prompt {
    width: min(560px, calc(100vw - 32px));
    background: #2d2d2d;
    border: 1px solid #555;
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.6);
    padding: 16px;
    font-family: system-ui, -apple-system, sans-serif;
    color: #ddd;
  }
  #b2v-url-prompt h3 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
  }
  #b2v-url-prompt label {
    display: block;
    font-size: 12px;
    margin-bottom: 6px;
    color: #bbb;
  }
  #b2v-browser-url-input {
    width: 100%;
    height: 32px;
    border-radius: 6px;
    border: 1px solid #555;
    background: #1f1f1f;
    color: #eee;
    padding: 0 10px;
    outline: none;
    font-size: 12px;
    margin-bottom: 10px;
  }
  #b2v-browser-url-input:focus { border-color: #007acc; }
  #b2v-dedicated-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #aaa;
    margin-bottom: 12px;
  }
  #b2v-url-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .b2v-btn {
    border: 1px solid #555;
    background: #3a3a3a;
    color: #ddd;
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .b2v-btn:hover { border-color: #777; background: #434343; }
  .b2v-btn-primary {
    border-color: #007acc;
    background: #005f9e;
    color: #fff;
  }
  .b2v-btn-primary:hover { background: #0b70b4; border-color: #1b8ddb; }

  /* Placeholder pane */
  .b2v-placeholder-pane {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1e1e1e;
  }
  .b2v-placeholder-add {
    width: 88px;
    height: 88px;
    border-radius: 14px;
    border: 1px dashed #666;
    background: #2b2b2b;
    color: #ddd;
    font-size: 38px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.16s ease;
  }
  .b2v-placeholder-add:hover {
    border-color: #007acc;
    color: #fff;
    background: #333;
    transform: scale(1.03);
  }

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
  <div id="b2v-toolbar">
    <select id="b2v-layout-select" data-testid="b2v-layout-picker"></select>
    <button class="b2v-toolbar-add-btn" data-testid="b2v-add-pane" title="Add pane">+</button>
  </div>
  <div id="b2v-add-pane-overlay" data-testid="b2v-add-pane-popup">
    <div id="b2v-add-pane-popup">
      <div class="b2v-pane-tile" data-testid="b2v-add-browser" data-pane-type="browser">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2"/></svg>
        <span>Browser</span>
      </div>
      <div class="b2v-pane-tile" data-testid="b2v-add-terminal" data-pane-type="terminal">
        <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span>Terminal</span>
      </div>
    </div>
  </div>
  <div id="b2v-url-prompt-overlay" data-testid="b2v-browser-url-dialog">
    <div id="b2v-url-prompt">
      <h3>Open browser pane</h3>
      <label for="b2v-browser-url-input">URL</label>
      <input
        id="b2v-browser-url-input"
        data-testid="b2v-browser-url-input"
        type="url"
        value="https://github.com/nicedoc/browser2video"
      />
      <div id="b2v-dedicated-row">
        <input id="b2v-open-dedicated-checkbox" data-testid="b2v-open-dedicated-checkbox" type="checkbox" disabled />
        <label for="b2v-open-dedicated-checkbox">Open in dedicated browser window instead iframe (TODO)</label>
      </div>
      <div id="b2v-url-prompt-actions">
        <button class="b2v-btn" data-testid="b2v-browser-url-cancel">Cancel</button>
        <button class="b2v-btn b2v-btn-primary" data-testid="b2v-browser-url-confirm">Open</button>
      </div>
    </div>
  </div>
  <div id="dockview-root"></div>
  <script>
    var dv = window["dockview-core"];
    var paneData = ${paneDataJson};
    var addOrder = ${addOrderJson};
    var panelMap = {};
    var currentGrid = ${effectiveGridJson};
    var vpW = ${vpW}, vpH = ${vpH};
    var baseWsUrl = ${JSON.stringify(baseWsUrl)};
    var DEFAULT_BROWSER_URL = 'https://github.com/nicedoc/browser2video';
    var pendingAddContext = { replacePanelId: null };

    // ---- Layout presets & picker ----
    var LAYOUT_PRESETS = ${layoutPresetsJson};
    var layoutSelect = document.getElementById('b2v-layout-select');

    function gridEquals(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function detectPresetId(grid) {
      for (var i = 0; i < LAYOUT_PRESETS.length; i++) {
        if (gridEquals(LAYOUT_PRESETS[i].grid, grid)) return LAYOUT_PRESETS[i].id;
      }
      return 'custom';
    }

    // SVG thumbnail for a grid layout (tiny inline icon)
    function gridSvgLabel(preset) {
      var symbols = { '1x1': '[■]', 'side-by-side': '[■|■]', 'top-bottom': '[■/■]', '1-left-2-right': '[■|■/■]', '3-cols': '[■|■|■]', '2x2': '[■■/■■]' };
      return (symbols[preset.id] || '[?]') + ' ' + preset.label;
    }

    // Populate dropdown
    for (var i = 0; i < LAYOUT_PRESETS.length; i++) {
      var opt = document.createElement('option');
      opt.value = LAYOUT_PRESETS[i].id;
      opt.textContent = gridSvgLabel(LAYOUT_PRESETS[i]);
      layoutSelect.appendChild(opt);
    }
    var selectedPreset = detectPresetId(currentGrid);
    if (selectedPreset === 'custom') {
      var customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = '[~] Custom';
      layoutSelect.appendChild(customOpt);
    }
    layoutSelect.value = selectedPreset;

    layoutSelect.addEventListener('change', function() {
      var id = layoutSelect.value;
      if (id === 'custom') return;
      window.__b2v_switchLayout(id);
    });

    function buildTerminalSrc(testId, title, cmd, observe) {
      var params = { testId: testId, title: title };
      if (cmd) params.cmd = cmd;
      if (observe) params.mode = 'observe';
      return '/terminal?' + new URLSearchParams(params).toString();
    }

    function getGridSlots(grid) {
      var slots = [];
      var seen = {};
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < grid[r].length; c++) {
          var idx = grid[r][c];
          if (!seen[idx]) {
            seen[idx] = true;
            slots.push(idx);
          }
        }
      }
      return slots.sort(function(a, b) { return a - b; });
    }

    function ensurePaneDataForGrid() {
      var slots = getGridSlots(currentGrid);
      for (var i = 0; i < slots.length; i++) {
        var idx = slots[i];
        var exists = paneData.some(function(p) { return p.index === idx; });
        if (!exists) {
          paneData.push({
            type: 'placeholder',
            title: 'Add pane',
            index: idx,
            allowAddTab: false,
            placeholder: true,
          });
        }
      }
      paneData.sort(function(a, b) { return a.index - b.index; });
      window.__b2v_paneData = paneData;
    }

    function paneByPanelId(panelId) {
      for (var i = 0; i < paneData.length; i++) {
        if ('panel-' + paneData[i].index === panelId) return paneData[i];
      }
      return null;
    }

    function removePaneByPanelId(panelId) {
      paneData = paneData.filter(function(p) { return ('panel-' + p.index) !== panelId; });
      window.__b2v_paneData = paneData;
    }

    function lockGroups() {
      for (var pid in panelMap) {
        var grp = panelMap[pid].group;
        if (grp && !grp.locked) grp.locked = 'no-drop-target';
      }
    }

    ensurePaneDataForGrid();

    // ---- Add-pane popup ----
    var overlay = document.getElementById('b2v-add-pane-overlay');
    var urlOverlay = document.getElementById('b2v-url-prompt-overlay');
    var browserUrlInput = document.getElementById('b2v-browser-url-input');
    var browserUrlCancelBtn = document.querySelector('[data-testid="b2v-browser-url-cancel"]');
    var browserUrlConfirmBtn = document.querySelector('[data-testid="b2v-browser-url-confirm"]');
    var addPaneBtn = document.querySelector('[data-testid="b2v-add-pane"]');

    function openAddPanePopup(replacePanelId) {
      pendingAddContext = { replacePanelId: replacePanelId || null };
      overlay.classList.add('visible');
    }
    function closeAddPanePopup() {
      overlay.classList.remove('visible');
    }
    function openBrowserUrlPrompt() {
      closeAddPanePopup();
      browserUrlInput.value = DEFAULT_BROWSER_URL;
      urlOverlay.classList.add('visible');
      setTimeout(function() { browserUrlInput.focus(); browserUrlInput.select(); }, 0);
    }
    function closeBrowserUrlPrompt() {
      urlOverlay.classList.remove('visible');
    }

    addPaneBtn.addEventListener('click', function() {
      openAddPanePopup(null);
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeAddPanePopup();
    });
    urlOverlay.addEventListener('click', function(e) {
      if (e.target === urlOverlay) closeBrowserUrlPrompt();
    });

    var tiles = document.querySelectorAll('.b2v-pane-tile');
    for (var ti = 0; ti < tiles.length; ti++) {
      tiles[ti].addEventListener('click', function() {
        var paneType = this.getAttribute('data-pane-type');
        if (paneType === 'browser') {
          openBrowserUrlPrompt();
          return;
        }
        closeAddPanePopup();
        window.__b2v_addPane('terminal', { replacePanelId: pendingAddContext.replacePanelId });
      });
    }

    browserUrlCancelBtn.addEventListener('click', function() {
      closeBrowserUrlPrompt();
    });
    browserUrlConfirmBtn.addEventListener('click', function() {
      var rawUrl = (browserUrlInput.value || '').trim();
      var chosenUrl = rawUrl || DEFAULT_BROWSER_URL;
      closeBrowserUrlPrompt();
      window.__b2v_addPane('browser', {
        replacePanelId: pendingAddContext.replacePanelId,
        url: chosenUrl,
      });
    });
    browserUrlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        browserUrlConfirmBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeBrowserUrlPrompt();
      }
    });

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
            if (p.placeholder) {
              var holder = document.createElement('div');
              holder.className = 'b2v-placeholder-pane';
              var btn = document.createElement('button');
              btn.className = 'b2v-placeholder-add';
              btn.setAttribute('data-testid', 'b2v-placeholder-add');
              btn.textContent = '+';
              btn.onclick = function() {
                openAddPanePopup(p.panelId || null);
              };
              holder.appendChild(btn);
              el.appendChild(holder);
              return;
            }

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
      createRightHeaderActionComponent: function(groupPanel) {
        var el = document.createElement('div');
        var mountedGroupId = null;
        return {
          element: el,
          init: function(params) {
            var grp = params.group || groupPanel;
            // Track this group and show/hide "+" after all panels are placed
            var groupId = grp.id;
            mountedGroupId = groupId;
            if (!window.__b2v_addTabGroups) window.__b2v_addTabGroups = {};
            window.__b2v_addTabGroups[groupId] = { el: el, group: grp };
          },
          dispose: function() {
            el.innerHTML = '';
            if (mountedGroupId && window.__b2v_addTabGroups) {
              delete window.__b2v_addTabGroups[mountedGroupId];
            }
          },
        };
      },
      defaultRenderer: 'always',
      singleTabMode: 'fullwidth',
      disableFloatingGroups: true,
      locked: true,
      disableDnd: true,
    });

    function panelForIndex(index) {
      for (var i = 0; i < paneData.length; i++) {
        if (paneData[i].index === index) return paneData[i];
      }
      return null;
    }

    function buildPanelOptions(entry, pane) {
      var panelId = 'panel-' + entry.index;
      if (pane.type === 'placeholder') {
        return {
          id: panelId,
          component: 'iframe',
          title: pane.title || 'Add pane',
          params: { placeholder: true, panelId: panelId },
        };
      }
      return {
        id: panelId,
        component: 'iframe',
        title: pane.title,
        params: {
          iframeName: 'term-' + entry.index,
          src: pane.type === 'browser' ? (pane.url || pane.src || DEFAULT_BROWSER_URL) : pane.src,
        },
      };
    }

    // Add panels in the computed order
    for (var i = 0; i < addOrder.length; i++) {
      var entry = addOrder[i];
      var pane = panelForIndex(entry.index);
      if (!pane) continue;
      var panelOpts = buildPanelOptions(entry, pane);
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

    function refreshAddTabButtons() {
      if (!window.__b2v_addTabGroups) return;
      for (var gid in window.__b2v_addTabGroups) {
        var info = window.__b2v_addTabGroups[gid];
        var grp = info.group;
        var panels = grp.panels || [];
        var showAdd = panels.some(function(p) {
          var pd = paneByPanelId(p.id);
          return pd && pd.allowAddTab;
        });
        info.el.innerHTML = '';
        if (!showAdd) continue;
        (function(container, group, groupId) {
          var btn = document.createElement('button');
          btn.className = 'b2v-add-tab-btn';
          btn.setAttribute('data-testid', 'b2v-add-tab');
          btn.setAttribute('data-group-id', groupId);
          btn.textContent = '+';
          btn.onclick = function() {
            var activePanel = group.activePanel;
            var refId = activePanel ? activePanel.id : null;
            window.__b2v_addTab({ referencePanel: refId });
          };
          container.appendChild(btn);
        })(info.el, grp, gid);
      }
    }

    // Lock all groups to prevent drops and refresh tab "+" actions
    lockGroups();
    refreshAddTabButtons();

    // Listen for title updates from terminal iframes via postMessage
    window.addEventListener('message', function(ev) {
      if (!ev.data || ev.data.type !== 'b2v-title') return;
      var testId = ev.data.testId;
      var newTitle = ev.data.title;
      // Find the panel whose iframe matches this testId
      for (var pi = 0; pi < paneData.length; pi++) {
        var pane = paneData[pi];
        if (pane.testId === testId) {
          var p = panelMap['panel-' + pane.index];
          if (p && p.api) p.api.updateParameters({ title: newTitle });
          if (p) p.setTitle(newTitle);
          break;
        }
      }
    });

    // Dynamic tab management API for Playwright
    var tabCounter = paneData.length;

    window.__b2v_addTab = function(config) {
      config = config || {};
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
      paneData.push({ type: 'terminal', src: src, testId: testId, title: title, index: idx, allowAddTab: true });
      window.__b2v_paneData = paneData;
      // Mark the new tab as closable via the panel's tab DOM element
      try {
        var tabEl = panel.view && panel.view.tab && panel.view.tab.element;
        if (tabEl) tabEl.classList.add('b2v-closable');
      } catch(e) {}
      lockGroups();
      refreshAddTabButtons();
      return { panelId: 'panel-' + idx, iframeName: iframeName, testId: testId };
    };

    window.__b2v_closeTab = function(panelId) {
      var panel = panelMap[panelId];
      if (panel) {
        component.api.removePanel(panel);
        delete panelMap[panelId];
        removePaneByPanelId(panelId);
        lockGroups();
        refreshAddTabButtons();
      }
    };

    window.__b2v_dockview = component;
    window.__b2v_paneData = paneData;

    // ---- Switch layout: destroy all panels, rebuild with new grid ----
    // paneConfigs (optional): [{ type:"browser"|"terminal", url?, cmd?, title? }, ...]
    window.__b2v_switchLayout = function(layoutId, paneConfigs) {
      var preset = LAYOUT_PRESETS.find(function(p) { return p.id === layoutId; });
      if (!preset) return { error: 'Unknown layout: ' + layoutId };

      var previousPanes = paneData.slice();
      var panelIds = Object.keys(panelMap);
      for (var pi = 0; pi < panelIds.length; pi++) {
        try { component.api.removePanel(panelMap[panelIds[pi]]); } catch(e) {}
      }
      panelMap = {};
      paneData = [];
      window.__b2v_paneData = paneData;
      tabCounter = 0;
      currentGrid = preset.grid;

      var slots = getGridSlots(preset.grid);
      var maxSlot = 0;
      for (var ni = 0; ni < slots.length; ni++) {
        var slot = slots[ni];
        if (slot > maxSlot) maxSlot = slot;
        var cfg = paneConfigs && paneConfigs[ni] ? paneConfigs[ni] : null;
        if (cfg) {
          var cfgType = cfg.type || 'terminal';
          var cfgTitle = cfg.title || (cfgType === 'browser' ? 'Browser' : 'Shell');
          var cfgTestId = 'xterm-dyn-' + slot;
          if (cfgType === 'browser') {
            paneData.push({
              type: 'browser',
              url: cfg.url || DEFAULT_BROWSER_URL,
              title: cfgTitle,
              index: slot,
              allowAddTab: false,
            });
          } else {
            paneData.push({
              type: 'terminal',
              src: buildTerminalSrc(cfgTestId, cfgTitle, cfg.cmd, false),
              testId: cfgTestId,
              title: cfgTitle,
              index: slot,
              allowAddTab: true,
            });
          }
          continue;
        }

        var existing = previousPanes.find(function(p) {
          return p.index === slot && p.type !== 'placeholder';
        });
        if (existing) {
          paneData.push(Object.assign({}, existing, { index: slot }));
        } else {
          paneData.push({
            type: 'placeholder',
            title: 'Add pane',
            index: slot,
            allowAddTab: false,
            placeholder: true,
          });
        }
      }
      tabCounter = maxSlot + 1;
      window.__b2v_paneData = paneData;

      // Recompute add order
      var paneCountForOrder = maxSlot + 1;
      var newAddOrder = __b2v_computeAddOrder(preset.grid, paneCountForOrder, vpW, vpH - 36);
      for (var ai = 0; ai < newAddOrder.length; ai++) {
        var entry = newAddOrder[ai];
        var pane = panelForIndex(entry.index);
        if (!pane) continue;
        var panelOpts = buildPanelOptions(entry, pane);
        if (entry.position) panelOpts.position = entry.position;
        var panel = component.api.addPanel(panelOpts);
        panelMap['panel-' + entry.index] = panel;
      }

      // Resize panels
      for (var si = 0; si < newAddOrder.length; si++) {
        var se = newAddOrder[si];
        var sp = panelMap['panel-' + se.index];
        if (sp && (se.initialWidth || se.initialHeight)) {
          var sz = {};
          if (se.initialWidth) sz.width = se.initialWidth;
          if (se.initialHeight) sz.height = se.initialHeight;
          sp.api.setSize(sz);
        }
      }

      lockGroups();
      refreshAddTabButtons();

      // Update dropdown
      layoutSelect.value = layoutId;
      if (layoutSelect.querySelector('[value="custom"]')) {
        layoutSelect.querySelector('[value="custom"]').remove();
      }

      return { paneCount: slots.length, grid: preset.grid };
    };

    function markClosable(panel) {
      try {
        var tabEl = panel.view && panel.view.tab && panel.view.tab.element;
        if (tabEl) tabEl.classList.add('b2v-closable');
      } catch(e) {}
    }

    function dropPlaceholderPanel(replacePanelId) {
      if (!replacePanelId) return;
      var placeholderPane = paneByPanelId(replacePanelId);
      if (!placeholderPane || placeholderPane.type !== 'placeholder') return;
      var oldPanel = panelMap[replacePanelId];
      if (oldPanel) {
        try { component.api.removePanel(oldPanel); } catch(e) {}
        delete panelMap[replacePanelId];
      }
      removePaneByPanelId(replacePanelId);
    }

    // ---- Add pane via popup tile ----
    window.__b2v_addPane = function(paneType, opts) {
      opts = opts || {};
      var replacePanelId = opts.replacePanelId || null;
      var idx = tabCounter++;
      var testId = 'xterm-dyn-' + idx;
      var title = paneType === 'browser' ? 'Browser' : 'Shell';
      var src;
      var url = null;
      if (paneType === 'browser') {
        var rawUrl = (opts.url || DEFAULT_BROWSER_URL).trim();
        if (rawUrl && !/^https?:\\/\\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
        url = rawUrl || DEFAULT_BROWSER_URL;
        src = url;
      } else {
        src = buildTerminalSrc(testId, title, null, false);
      }
      var iframeName = 'term-' + idx;
      var panelOpts = {
        id: 'panel-' + idx,
        component: 'iframe',
        title: title,
        params: { iframeName: iframeName, src: src },
      };
      if (replacePanelId && panelMap[replacePanelId]) {
        panelOpts.position = { referencePanel: replacePanelId, direction: 'within' };
      }
      var panel = component.api.addPanel(panelOpts);
      panelMap['panel-' + idx] = panel;

      if (paneType === 'browser') {
        paneData.push({
          type: 'browser',
          url: url,
          title: title,
          index: idx,
          allowAddTab: false,
        });
      } else {
        paneData.push({
          type: 'terminal',
          src: src,
          testId: testId,
          title: title,
          index: idx,
          allowAddTab: true,
        });
        markClosable(panel);
      }
      window.__b2v_paneData = paneData;

      dropPlaceholderPanel(replacePanelId);
      lockGroups();
      refreshAddTabButtons();

      return { panelId: 'panel-' + idx, iframeName: iframeName, testId: testId, paneType: paneType };
    };

    // Expose the add-order computation for layout switching
    function __b2v_computeAddOrder(grid, paneCount, w, h) {
      if (!paneCount || paneCount <= 0) return [];
      var gridRows = grid.length;
      if (!gridRows) return [];
      var gridCols = Math.max.apply(null, grid.map(function(r) { return r.length; }));
      if (!isFinite(gridCols) || gridCols <= 0) return [];
      var boxes = {};
      for (var r = 0; r < gridRows; r++) {
        for (var c = 0; c < grid[r].length; c++) {
          var idx = grid[r][c];
          if (!boxes[idx]) {
            boxes[idx] = { minRow: r, maxRow: r, minCol: c, maxCol: c };
          } else {
            boxes[idx].minRow = Math.min(boxes[idx].minRow, r);
            boxes[idx].maxRow = Math.max(boxes[idx].maxRow, r);
            boxes[idx].minCol = Math.min(boxes[idx].minCol, c);
            boxes[idx].maxCol = Math.max(boxes[idx].maxCol, c);
          }
        }
      }
      var cellW = Math.round(w / gridCols);
      var cellH = Math.round(h / gridRows);
      var indices = Object.keys(boxes).map(Number).sort(function(a, b) {
        return boxes[a].minRow !== boxes[b].minRow ? boxes[a].minRow - boxes[b].minRow : boxes[a].minCol - boxes[b].minCol;
      });
      var result = [];
      var placed = {};
      var placedCount = 0;
      for (var ii = 0; ii < indices.length; ii++) {
        var idx = indices[ii];
        if (idx >= paneCount) continue;
        var box = boxes[idx];
        var spanCols = box.maxCol - box.minCol + 1;
        var spanRows = box.maxRow - box.minRow + 1;
        var targetW = spanCols * cellW;
        var targetH = spanRows * cellH;
        if (placedCount === 0) {
          result.push({ index: idx });
          placed[idx] = true;
          placedCount++;
          continue;
        }
        var bestRef, bestDir, bestScore = -1;
        for (var pIdx in placed) {
          var pi = Number(pIdx);
          var pBox = boxes[pi];
          var refSpanRows = pBox.maxRow - pBox.minRow + 1;
          var refSpanCols = pBox.maxCol - pBox.minCol + 1;
          var candidates = [];
          if (box.minCol === pBox.maxCol + 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
            var overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
            var mo = box.maxRow - box.minRow + 1;
            var ps = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
            candidates.push({ dir: 'right', score: (overlap / mo) * ps });
          }
          if (box.minRow === pBox.maxRow + 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
            var overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
            var mo = box.maxCol - box.minCol + 1;
            var ps = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
            candidates.push({ dir: 'below', score: (overlap / mo) * ps });
          }
          if (box.maxCol === pBox.minCol - 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
            var overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
            var mo = box.maxRow - box.minRow + 1;
            var ps = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
            candidates.push({ dir: 'left', score: (overlap / mo) * ps });
          }
          if (box.maxRow === pBox.minRow - 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
            var overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
            var mo = box.maxCol - box.minCol + 1;
            var ps = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
            candidates.push({ dir: 'above', score: (overlap / mo) * ps });
          }
          for (var ci = 0; ci < candidates.length; ci++) {
            if (candidates[ci].score > bestScore) {
              bestScore = candidates[ci].score;
              bestRef = pi;
              bestDir = candidates[ci].dir;
            }
          }
        }
        if (bestRef !== undefined && bestDir) {
          var sizeProps = {};
          if (bestDir === 'right' || bestDir === 'left') sizeProps.initialWidth = targetW;
          else sizeProps.initialHeight = targetH;
          result.push(Object.assign({ index: idx, position: { referencePanel: 'panel-' + bestRef, direction: bestDir } }, sizeProps));
        } else {
          result.push({ index: idx, position: { referencePanel: 'panel-' + indices[0], direction: 'right' }, initialWidth: targetW });
        }
        placed[idx] = true;
        placedCount++;
      }
      return result;
    }
    window.__b2v_computeAddOrder = __b2v_computeAddOrder;
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
