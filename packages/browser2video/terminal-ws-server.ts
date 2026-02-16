/**
 * @description WebSocket <-> PTY bridge for rendering real terminals inside xterm.js.
 * Generic command support: connect to /term?cmd=<command> to launch any CLI app,
 * or /term (no cmd) for an interactive shell session.
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
    // Interactive shell with a clean prompt for reliable detection
    env.PS1 = "\\$ ";
    return pty.spawn("bash", ["--norc", "--noprofile", "-i"], {
      name: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
      cwd: process.cwd(),
      env,
    });
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

  const server = http.createServer((_req, res) => {
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

    const p = spawnPty(cmd, 120, 30);

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
