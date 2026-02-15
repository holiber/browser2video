/**
 * @description Automerge sync server management.
 * Extracted from the former collab-runner for reuse by the unified runner.
 */
import path from "path";
import fs from "fs";
import net from "net";
import { spawn } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

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
  const proc = spawn(process.execPath, [bin], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (c) => {
    stderr += String(c);
    if (stderr.length > 32768) stderr = stderr.slice(-32768);
  });

  await waitForPort("127.0.0.1", port, 8000);
  const wsUrl = `ws://127.0.0.1:${port}`;
  console.log(`  Sync server: ${wsUrl}`);

  const stop = async () => {
    try { proc.kill("SIGINT"); } catch { /* ignore */ }
    await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    if (proc.exitCode && proc.exitCode !== 0) {
      console.warn(`  Sync server exited with code ${proc.exitCode}`);
      if (stderr.trim()) console.warn(`  Sync server stderr:\n${stderr.trim()}`);
    }
  };

  return { wsUrl, stop };
}
