/**
 * @description Shared helpers for CLI and MCP to list and run scenario files.
 * These helpers must not assume a monorepo layout: they run relative to the
 * caller's current working directory.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type RunScenarioResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export function defaultScenariosDir(cwd: string): string {
  return path.resolve(cwd, "tests", "scenarios");
}

export function resolveScenarioPath(scenarioFile: string, cwd: string): string {
  const abs = path.isAbsolute(scenarioFile)
    ? scenarioFile
    : path.resolve(cwd, scenarioFile);

  if (!fs.existsSync(abs)) {
    throw new Error(`Scenario file not found: ${abs}`);
  }

  return abs;
}

export function listScenarioFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  if (!fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(test|scenario)\.(ts|js)$/.test(f))
    .sort();
}

function nodeTypeStripArgs(): string[] {
  return ["--experimental-strip-types", "--no-warnings"];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_MODULE_PATH = path.resolve(__dirname, "scenario.ts");

/**
 * Build a wrapper script that imports the scenario file,
 * detects whether it exports a ScenarioDescriptor (from defineScenario),
 * and runs it via runScenario() if so — otherwise the file self-executes.
 */
function buildWrapperScript(absPath: string): string {
  const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
    const mod = await import('${esc(absPath)}');
    const def = mod.default ?? mod;
    if (def && typeof def === 'object' && typeof def.setupFn === 'function' && Array.isArray(def.steps)) {
      const { runScenario } = await import('${esc(SCENARIO_MODULE_PATH)}');
      await runScenario(def);
    }
  `;
}

export async function runScenarioAsNodeTs(opts: {
  scenarioFile: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  streamOutput?: boolean;
  maxOutputBytes?: number;
}): Promise<RunScenarioResult> {
  const abs = resolveScenarioPath(opts.scenarioFile, opts.cwd);
  const maxBytes = opts.maxOutputBytes ?? 10 * 1024 * 1024;

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) continue;
    env[k] = String(v);
  }

  const wrapper = buildWrapperScript(abs);

  return await new Promise<RunScenarioResult>((resolve) => {
    const child = spawn(
      process.execPath,
      [...nodeTypeStripArgs(), "--input-type=module", "-e", wrapper],
      {
        cwd: opts.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;

    const push = (
      target: Buffer[],
      chunk: Buffer,
      which: "stdout" | "stderr",
      alsoStream?: NodeJS.WritableStream,
    ) => {
      if (alsoStream) alsoStream.write(chunk);
      const curSize = which === "stdout" ? outSize : errSize;
      if (curSize >= maxBytes) return;
      const remaining = maxBytes - curSize;
      const sliced = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      target.push(sliced);
      if (which === "stdout") outSize += sliced.length;
      else errSize += sliced.length;
    };

    child.stdout?.on("data", (c: Buffer) =>
      push(outChunks, c, "stdout", opts.streamOutput ? process.stdout : undefined),
    );
    child.stderr?.on("data", (c: Buffer) =>
      push(errChunks, c, "stderr", opts.streamOutput ? process.stderr : undefined),
    );

    child.on("close", (code) => {
      const stdout = Buffer.concat(outChunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

