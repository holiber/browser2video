/**
 * @description WebSocket <-> PTY bridge for rendering real terminals inside xterm.js.
 * Supports general-purpose shell sessions (/term/shell) and direct TUI launches (/term/mc, /term/htop, /term/opencode).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";

export type TerminalServer = {
  /** Base URL (without trailing slash), e.g. ws://127.0.0.1:12345 */
  baseWsUrl: string;
  close: () => Promise<void>;
};

type AppKind = "shell" | "mc" | "htop" | "opencode";

function safeLocale(): string {
  return (
    process.env.LC_ALL ??
    process.env.LANG ??
    (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8")
  );
}

function ensureNodePtySpawnHelperExecutable() {
  // node-pty prebuilds ship spawn-helper without +x sometimes (macOS),
  // which causes "posix_spawnp failed" at runtime.
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

function spawnPty(app: AppKind, initialCols: number, initialRows: number) {
  const locale = safeLocale();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: locale,
    LC_ALL: locale,
  };

  if (app === "shell") {
    // General-purpose interactive shell with a clean prompt for reliable detection
    env.PS1 = "\\$ ";
    return pty.spawn("bash", ["--norc", "--noprofile", "-i"], {
      name: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
      cwd: process.cwd(),
      env,
    });
  }

  // Direct TUI launch (mc / htop / opencode)
  let script: string;
  if (app === "mc") {
    script = "command -v mc >/dev/null 2>&1 || { echo __B2V_MISSING_MC__; exit 127; }; mc; echo __B2V_MC_EXITED__";
  } else if (app === "htop") {
    script = "command -v htop >/dev/null 2>&1 || { echo 'htop not found, falling back to top'; top; exit 0; }; htop; echo __B2V_HTOP_EXITED__";
  } else {
    // opencode
    script = "command -v opencode >/dev/null 2>&1 || { echo __B2V_MISSING_OPENCODE__; echo 'opencode is not installed. Install it from https://github.com/opencode-ai/opencode'; exit 127; }; opencode; echo __B2V_OPENCODE_EXITED__";
  }

  return pty.spawn("bash", ["-lc", script], {
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

  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  function handleTerminalWs(ws: WebSocket, app: AppKind) {
    try {
      ws.send(encoder.encode(`[b2v] connected: ${app}\r\n`));
    } catch {
      // ignore
    }

    // Default size; client will immediately send resize after fit.
    const p = spawnPty(app, 120, 30);

    p.onData((data: string) => {
      try {
        ws.send(encoder.encode(data));
      } catch {
        // ignore send errors during teardown
      }
    });

    ws.on("message", (msg: any, isBinary?: boolean) => {
      try {
        // In Node/ws, string messages often arrive as Buffer with isBinary=false.
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

        // Binary stdin (xterm onData)
        if (msg instanceof ArrayBuffer) {
          p.write(decoder.decode(new Uint8Array(msg)));
          return;
        }

        // ws on Node typically delivers Buffer
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
      const pathname = u.pathname;

      let app: AppKind | null = null;
      if (pathname === "/term/shell") app = "shell";
      if (pathname === "/term/mc") app = "mc";
      if (pathname === "/term/htop") app = "htop";
      if (pathname === "/term/opencode") app = "opencode";
      if (!app) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        handleTerminalWs(ws, app);
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

  return {
    baseWsUrl,
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
//  CLI entry point: `tsx tests/scenarios/terminal/terminal-ws-server.ts [port]`
// ---------------------------------------------------------------------------
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("terminal-ws-server.ts") ||
    process.argv[1].endsWith("terminal-ws-server.js"));

if (isDirectRun) {
  const port = parseInt(process.argv[2] ?? "9800", 10);
  startTerminalWsServer(port).then((s) => {
    console.log(`Terminal WS server listening on ${s.baseWsUrl}`);
    process.on("SIGINT", async () => {
      await s.close();
      process.exit(0);
    });
  });
}
