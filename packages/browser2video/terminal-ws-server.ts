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

  // Resolve xterm static file paths once
  const require = createRequire(import.meta.url);
  const xtermStaticPaths: Record<string, { file: string; mime: string }> = {};
  try {
    xtermStaticPaths["/static/xterm.js"] = { file: require.resolve("@xterm/xterm/lib/xterm.js"), mime: "text/javascript" };
    xtermStaticPaths["/static/xterm.css"] = { file: require.resolve("@xterm/xterm/css/xterm.css"), mime: "text/css" };
    xtermStaticPaths["/static/addon-fit.js"] = { file: require.resolve("@xterm/addon-fit/lib/addon-fit.js"), mime: "text/javascript" };
  } catch {
    // xterm packages not installed — terminal page won't work
  }

  let _terminalPageHtml: ((wsUrl: string, testId: string, title: string) => string) | null = null;
  let _terminalGridHtml: ((baseWsUrl: string, terminals: Array<{ cmd?: string; testId: string; title: string }>, grid?: number[][]) => string) | null = null;

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
      // Serve standalone xterm.js terminal page
      const cmd = u.searchParams.get("cmd") || undefined;
      const testId = u.searchParams.get("testId") || "xterm-term-0";
      const title = u.searchParams.get("title") || cmd || "Shell";
      const baseWsUrl = `ws://localhost:${(server.address() as any)?.port ?? 0}`;
      const wsUrl = cmd
        ? `${baseWsUrl}/term?cmd=${encodeURIComponent(cmd)}`
        : `${baseWsUrl}/term`;

      if (!_terminalPageHtml) {
        _terminalPageHtml = buildXtermPageHtmlFn();
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(_terminalPageHtml(wsUrl, testId, title));
      return;
    }
    if (u.pathname === "/terminal-grid") {
      // Serve multi-terminal page with CSS grid layout
      const configParam = u.searchParams.get("config");
      if (!configParam) {
        res.statusCode = 400;
        res.end("Missing config parameter");
        return;
      }
      let config: { terminals: Array<{ cmd?: string; testId: string; title: string }>; grid?: number[][] };
      try {
        config = JSON.parse(decodeURIComponent(configParam));
      } catch {
        res.statusCode = 400;
        res.end("Invalid config JSON");
        return;
      }
      const baseWsUrl = `ws://localhost:${(server.address() as any)?.port ?? 0}`;
      if (!_terminalGridHtml) {
        _terminalGridHtml = buildXtermGridPageHtmlFn();
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(_terminalGridHtml(baseWsUrl, config.terminals, config.grid));
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  function handleTerminalWs(ws: WebSocket, cmd: string | undefined) {
    const label = cmd ?? "shell";
    try {
      ws.send(encoder.encode(`[b2v] connected: ${label}\r\n`));
    } catch {
      // ignore
    }

    // Start at 80x24 (matching xterm.js defaults) to avoid garbled initial
    // output. The browser-side fitTerminal() will resize to the actual
    // grid cell dimensions once the WebSocket is established.
    const p = spawnPty(cmd, 80, 24);

    p.onData((data: string) => {
      try {
        ws.send(encoder.encode(data));
      } catch {
        // ignore send errors during teardown
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
      } catch {
        // ignore malformed input
      }
    });

    ws.on("close", () => {
      try {
        p.kill();
      } catch {
        // ignore
      }
    });

    ws.on("error", () => {
      try {
        p.kill();
      } catch {
        // ignore
      }
    });
  }

  server.on("upgrade", (req, socket, head) => {
    try {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== "/term") {
        socket.destroy();
        return;
      }

      // Extract the command from the ?cmd= query parameter.
      // No cmd means interactive shell.
      const cmd = u.searchParams.get("cmd") || undefined;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        handleTerminalWs(ws, cmd);
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
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {
          // ignore
        }
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
  #term { flex: 1; min-height: 0; padding: 4px; }
</style></head><body>
  <div class="bar">${title}</div>
  <div id="term" data-testid="${testId}" data-b2v-ws-state="connecting"></div>
  <script>
    var el = document.getElementById('term');
    var term = new Terminal({
      convertEol: false, cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13, lineHeight: 1.15, disableStdin: false,
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
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }

    function fitTerminal() {
      // Try FitAddon first (works when xterm render service is initialized)
      try { fit.fit(); sendResize(); return; } catch(e) {}

      // Fallback: manual measurement for headless Chromium where the
      // render service never initializes (no paint cycles in headless mode).
      // Use the actual rendered xterm row height (includes internal line spacing)
      // and a test span for character width.
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
      // Fit AFTER the WebSocket is open so the PTY resize is sent
      // in sync with the xterm.js resize (avoids garbled initial display).
      fitTerminal();
      term.focus();
    };
    var fitted = false;
    ws.onmessage = function(ev) {
      if (ev.data instanceof ArrayBuffer) {
        try { term.write(new Uint8Array(ev.data)); } catch(e) {}
        // After the first data write, xterm.js has rendered content and
        // the cell dimensions are established. Re-fit to ensure accuracy.
        if (!fitted) {
          fitted = true;
          setTimeout(fitTerminal, 10);
        }
      }
    };
    ws.onerror = function() { el.dataset.b2vWsState = 'error'; };
    ws.onclose = function(e) { el.dataset.b2vWsState = 'closed:' + (e.code || '?'); };

    term.onData(function(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    });

    term.onTitleChange(function(t) {
      if (t) document.querySelector('.bar').textContent = t;
    });

    var ro = new ResizeObserver(function() { fitTerminal(); });
    ro.observe(el);
  <\/script>
</body></html>`;
}

// ---------------------------------------------------------------------------
//  Multi-terminal CSS grid page builder (iframes for keyboard isolation)
// ---------------------------------------------------------------------------

function buildXtermGridPageHtmlFn() {
  return (
    baseWsUrl: string,
    terminals: Array<{ cmd?: string; testId: string; title: string }>,
    grid?: number[][],
  ) => {
    // Build CSS grid template from the layout array
    const gridRows = grid ? grid.length : 1;
    const gridCols = grid ? Math.max(...grid.map((r) => r.length)) : terminals.length;

    // Generate grid-template-areas from the number[][] layout
    let gridTemplateAreas = "";
    if (grid) {
      gridTemplateAreas = grid
        .map((row) => `"${row.map((idx) => `p${idx}`).join(" ")}"`)
        .join(" ");
    } else {
      // Default: all in a single row
      gridTemplateAreas = `"${terminals.map((_, i) => `p${i}`).join(" ")}"`;
    }

    const gridTemplateRows = `repeat(${gridRows}, 1fr)`;
    const gridTemplateCols = `repeat(${gridCols}, 1fr)`;

    // Build iframes
    const iframes = terminals
      .map((t, i) => {
        const wsUrl = t.cmd
          ? `${baseWsUrl}/term?cmd=${encodeURIComponent(t.cmd)}`
          : `${baseWsUrl}/term`;
        const src = `/terminal?${new URLSearchParams({
          ...(t.cmd ? { cmd: t.cmd } : {}),
          testId: t.testId,
          title: t.title,
        }).toString()}`;
        return `<iframe name="term-${i}" data-pane-index="${i}" src="${src}" style="grid-area: p${i}; border: none; width: 100%; height: 100%; min-height: 0; min-width: 0;"></iframe>`;
      })
      .join("\n  ");

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1e1e1e;
    overflow: hidden;
    height: 100vh;
    display: grid;
    grid-template-areas: ${gridTemplateAreas};
    grid-template-rows: ${gridTemplateRows};
    grid-template-columns: ${gridTemplateCols};
    align-items: stretch;
    justify-items: stretch;
    gap: 1px;
  }
  iframe { border: none; width: 100%; height: 100%; min-height: 0; min-width: 0; }
</style></head><body>
  ${iframes}
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
