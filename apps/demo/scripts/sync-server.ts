/**
 * @description Automerge sync server management.
 * Used by the collab scenario to start a WebSocket sync server.
 */
import path from "path";
import fs from "fs";
import net from "net";
import { spawn, type ChildProcess } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const activeChildren = new Set<ChildProcess>();

function ensureExitHandler() {
  if ((ensureExitHandler as any)._installed) return;
  (ensureExitHandler as any)._installed = true;
  process.on("exit", () => {
    for (const child of activeChildren) {
      try { child.kill("SIGKILL"); } catch {}
    }
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

async function waitForPort(host: string, port: number, timeoutMs = 8000) {
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
    await sleep(150);
  }
  throw new Error(`sync server did not open port ${host}:${port} within ${timeoutMs}ms`);
}

export async function startSyncServer(opts: {
  artifactDir: string;
}): Promise<{ wsUrl: string; stop: () => Promise<void> }> {
  const port = await getFreePort();
  const dataDir = path.join(opts.artifactDir, "sync-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const bin = (() => {
    const pkgJsonPath = require.resolve("@automerge/automerge-repo-sync-server/package.json");
    const pkgDir = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as any;
    const binRel =
      typeof pkg.bin === "string"
        ? pkg.bin
        : (pkg.bin?.["automerge-repo-sync-server"] ?? Object.values(pkg.bin ?? {})[0]);
    if (!binRel) {
      throw new Error("Failed to resolve @automerge/automerge-repo-sync-server binary path");
    }
    return path.resolve(pkgDir, String(binRel));
  })();

  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir };
  // Use "node" explicitly — process.execPath resolves to Electron when running
  // inside the player, which would spawn the sync server as an Electron app
  // that ignores SIGINT/SIGTERM and leaks.
  const proc = spawn("node", [bin], { env, stdio: ["ignore", "ignore", "pipe"] });
  activeChildren.add(proc);
  ensureExitHandler();
  proc.once("exit", () => activeChildren.delete(proc));

  let stderr = "";
  proc.stderr?.on("data", (c) => {
    stderr += String(c);
    if (stderr.length > 32768) stderr = stderr.slice(-32768);
  });

  await waitForPort("127.0.0.1", port, 8000);
  const wsUrl = `ws://127.0.0.1:${port}`;
  console.log(`  Sync server: ${wsUrl}`);

  const stop = async () => {
    if (proc.exitCode !== null) return;
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (proc.exitCode && proc.exitCode !== 0) {
      console.warn(`  Sync server exited with code ${proc.exitCode}`);
      if (stderr.trim()) console.warn(`  Sync server stderr:\n${stderr.trim()}`);
    }
  };

  return { wsUrl, stop };
}
