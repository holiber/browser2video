/**
 * @description Start / stop web servers based on ServerConfig.
 * Supports Vite, custom commands, static file servers, etc.
 */
import type { ServerConfig } from "./types.js";
import { spawn, type ChildProcess } from "child_process";
import { createRequire } from "module";
import net from "net";
import path from "path";

export interface ManagedServer {
  baseURL: string;
  stop: () => Promise<void>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(host: string, port: number, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`Server did not start on ${host}:${port} within ${timeoutMs}ms`);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to get free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start a Vite dev server programmatically.
 * vite is imported dynamically to avoid a hard dependency in the runner package.
 */
async function startViteServer(root: string, preferredPort?: number): Promise<ManagedServer> {
  let createServerFn: any;
  try {
    // Resolve vite from the project root (where it's likely a devDep),
    // not from the runner package.
    const absRoot = path.resolve(root);
    const projectRequire = createRequire(absRoot + "/package.json");
    const vitePath = projectRequire.resolve("vite");
    const vite = await import(vitePath);
    createServerFn = vite.createServer ?? vite.default?.createServer;
  } catch {
    throw new Error(
      "vite is required for server.type='vite' but is not installed. " +
      "Add vite to your project dependencies or use --base-url to skip the server.",
    );
  }
  const server = await createServerFn({
    root,
    server: { port: preferredPort ?? 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const info = server.resolvedUrls!;
  const baseURL = info.local[0]?.replace(/\/$/, "") ?? `http://localhost:${preferredPort ?? 5173}`;
  return {
    baseURL,
    stop: async () => { await server.close(); },
  };
}

/** Start a generic command-based server. */
async function startCommandServer(
  cmd: string,
  port: number,
  readyPattern?: string,
): Promise<ManagedServer> {
  const proc = spawn("sh", ["-c", cmd], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });

  let stderr = "";
  proc.stderr?.on("data", (c) => {
    stderr += String(c);
    if (stderr.length > 32768) stderr = stderr.slice(-32768);
  });

  // Wait for the port to become available
  if (readyPattern) {
    // Wait for the pattern in stdout/stderr
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not output "${readyPattern}" within 30s`)), 30_000);
      const check = (data: Buffer) => {
        if (String(data).includes(readyPattern)) {
          clearTimeout(timeout);
          resolve();
        }
      };
      proc.stdout?.on("data", check);
      proc.stderr?.on("data", check);
    });
  } else {
    await waitForPort("127.0.0.1", port);
  }

  const baseURL = `http://localhost:${port}`;
  return {
    baseURL,
    stop: async () => {
      try { proc.kill("SIGINT"); } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        proc.once("exit", () => resolve());
        setTimeout(resolve, 3000);
      });
    },
  };
}

/** Start a static file server using a simple Node.js HTTP server. */
async function startStaticServer(root: string, preferredPort?: number): Promise<ManagedServer> {
  const http = await import("http");
  const fsPromises = await import("fs/promises");
  const path = await import("path");

  const port = preferredPort ?? await getFreePort();

  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };

  const server = http.createServer(async (req, res) => {
    let filePath = path.join(root, decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname));
    try {
      const stat = await fsPromises.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
      const ext = path.extname(filePath);
      res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
      const data = await fsPromises.readFile(filePath);
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const baseURL = `http://localhost:${port}`;
  return {
    baseURL,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Start a server based on the ServerConfig configuration.
 * Returns null if no server is needed.
 */
export async function startServer(config: ServerConfig | null | undefined): Promise<ManagedServer | null> {
  if (!config) return null;

  switch (config.type) {
    case "vite":
      return startViteServer(config.root, config.port);
    case "next": {
      const port = config.port ?? await getFreePort();
      return startCommandServer(`npx next dev --port ${port}`, port, "Ready");
    }
    case "command":
      return startCommandServer(config.cmd, config.port, config.readyPattern);
    case "static":
      return startStaticServer(config.root, config.port);
    default:
      return null;
  }
}
