/**
 * @description Resolves the base cache / working directory for browser2video.
 *
 * Priority:
 *   1. `B2V_CACHE_DIR` env variable (explicit override)
 *   2. `.cache` relative to the nearest project root (when running from a cloned repo)
 *   3. `<os.tmpdir()>/browser2video` (when running via npx or outside a project)
 *
 * The resolved directory is created lazily on first use.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

let _resolved: string | null = null;

function isProjectRoot(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git")) ||
           fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
  } catch { return false; }
}

function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (isProjectRoot(dir)) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Resolve the cache directory for browser2video.
 *
 * - When `B2V_CACHE_DIR` is set, returns that path (absolute or resolved from cwd).
 * - When running inside a git/pnpm project, returns `<project-root>/.cache`.
 * - Otherwise returns `<os.tmpdir()>/browser2video`.
 *
 * The directory is created automatically.
 *
 * @param subdir  Optional subdirectory within the cache root (e.g. `"tts"`, `"player"`).
 */
export function resolveCacheDir(subdir?: string): string {
  if (!_resolved) {
    const env = process.env.B2V_CACHE_DIR;
    if (env) {
      _resolved = path.resolve(env);
    } else {
      const projectRoot = findProjectRoot(process.cwd());
      _resolved = projectRoot
        ? path.join(projectRoot, ".cache")
        : path.join(os.tmpdir(), "browser2video");
    }
  }

  const dir = subdir ? path.join(_resolved, subdir) : _resolved;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
