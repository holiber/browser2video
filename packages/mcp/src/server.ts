#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 * Supports both legacy *.scenario.ts files (via unified runner)
 * and standalone *.test.ts files (via subprocess execution).
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { createServer, type ViteDevServer } from "vite";
import { run, type Mode, type RecordMode, type ScenarioConfig, type ScenarioContext } from "@browser2video/runner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const demoRoot = path.join(repoRoot, "apps", "demo");
const defaultScenariosDir = path.join(repoRoot, "tests", "scenarios");

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function getFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = await import("@ffmpeg-installer/ffmpeg");
    return (mod as any).default?.path ?? (mod as any).path;
  } catch {
    return undefined;
  }
}

async function withViteIfNeeded(
  viteRoot: string | null,
  baseUrlFromArgs: string | undefined,
  fn: (baseURL: string | undefined) => Promise<void>,
) {
  if (!viteRoot || baseUrlFromArgs) {
    await fn(baseUrlFromArgs);
    return;
  }

  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root: viteRoot,
      server: { port: 0, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const info = server.resolvedUrls!;
    const baseURL = info.local[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
    await fn(baseURL);
  } finally {
    await server?.close();
  }
}

/**
 * Dynamically import a scenario file and extract config + default exports.
 */
async function loadScenarioFile(filePath: string): Promise<{
  config: ScenarioConfig;
  scenarioFn: (ctx: ScenarioContext) => Promise<void>;
}> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(abs)) {
    throw new Error(`Scenario file not found: ${abs}`);
  }

  const mod: any = await import(pathToFileURL(abs).href);

  const scenarioFn =
    typeof mod.default === "function" ? mod.default :
    typeof mod.scenario === "function" ? mod.scenario : undefined;

  if (!scenarioFn) {
    throw new Error(`Scenario file does not export a default or "scenario" function: ${abs}`);
  }

  const config: ScenarioConfig = mod.config ?? {
    server: { type: "vite" as const, root: demoRoot },
    panes: [{ id: "main", type: "browser" as const, path: "/" }],
  };

  return { config, scenarioFn };
}

/**
 * Run a *.test.ts file as a subprocess via `npx tsx`.
 * Passes narration and other config via B2V_* environment variables.
 * Parses artifact directory and video path from stdout.
 */
function runTestFile(
  filePath: string,
  opts: {
    mode?: string;
    voice?: string;
    language?: string;
    realtimeAudio?: boolean;
    narrationSpeed?: number;
  },
): Promise<{ stdout: string; stderr: string; artifactsDir?: string; videoPath?: string }> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(repoRoot, filePath);

  if (!fs.existsSync(abs)) {
    throw new Error(`Test file not found: ${abs}`);
  }

  const env: Record<string, string> = { ...process.env as Record<string, string> };

  if (opts.mode) env.B2V_MODE = opts.mode;
  if (opts.voice) env.B2V_VOICE = opts.voice;
  if (opts.language) env.B2V_NARRATION_LANGUAGE = opts.language;
  if (opts.narrationSpeed) env.B2V_NARRATION_SPEED = String(opts.narrationSpeed);
  if (opts.realtimeAudio) env.B2V_REALTIME_AUDIO = "true";

  return new Promise((resolve, reject) => {
    const proc = execFile("npx", ["tsx", abs], { cwd: repoRoot, env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Test process exited with code ${err.code}:\n${stderr}\n${stdout}`));
        return;
      }

      const output = stdout.toString();

      // Parse artifacts dir from output: "  Artifacts: <path>"
      const artifactMatch = output.match(/Artifacts:\s+(.+)/);
      const artifactsDir = artifactMatch?.[1]?.trim();

      // Parse video path from output: "  Video saved: <path>"
      const videoMatch = output.match(/Video saved:\s+(.+)/);
      const videoPath = videoMatch?.[1]?.trim();

      resolve({ stdout: output, stderr: stderr.toString(), artifactsDir, videoPath });
    });

    // Forward subprocess stderr to MCP server stderr for live logging
    proc.stderr?.pipe(process.stderr);
  });
}

// ---------------------------------------------------------------------------
//  MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "browser2video", version: "0.0.0" },
  { capabilities: { logging: {} } as any },
);

server.registerTool(
  "b2v_list_scenarios",
  {
    title: "List scenarios",
    description: "List available scenario files (*.test.ts and *.scenario.ts) in the scenarios directory.",
    outputSchema: z.object({
      scenarios: z.array(z.string()),
    }),
  },
  async () => {
    const files = fs.existsSync(defaultScenariosDir)
      ? fs.readdirSync(defaultScenariosDir)
          .filter((f) => f.endsWith(".test.ts") || f.endsWith(".scenario.ts"))
          .sort()
      : [];
    const out = { scenarios: files };
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out,
    };
  },
);

server.registerTool(
  "b2v_doctor",
  {
    title: "Doctor",
    description: "Print environment diagnostics and common fixes.",
    outputSchema: z.object({
      platform: z.string(),
      node: z.string(),
      ffmpeg: z.string(),
    }),
  },
  async () => {
    const ffmpeg = await getFfmpegPath();
    const out = {
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ffmpeg: ffmpeg ?? "(not found via @ffmpeg-installer/ffmpeg; will use PATH)",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out,
    };
  },
);

server.registerTool(
  "b2v_run",
  {
    title: "Run scenario",
    description:
      "Run a scenario file (*.test.ts or *.scenario.ts) in human/fast mode with video recording and optional narration. " +
      "Supports auto-translation of narration to any language.",
    inputSchema: z.object({
      scenarioFile: z.string().describe("Path to a *.test.ts or *.scenario.ts file (relative to repo root or absolute)"),
      mode: z.enum(["human", "fast"]).default("human").describe("Execution speed"),
      record: z.enum(["none", "screencast", "screen"]).default("screencast").describe("Recording mode"),
      artifactsDir: z.string().optional().describe("Custom artifacts output directory"),
      baseUrl: z.string().optional().describe("Override base URL for dev server"),
      headed: z.boolean().optional().describe("Show browser window"),
      headless: z.boolean().optional().describe("Run headless"),
      voice: z.string().optional().describe("TTS voice: alloy | echo | fable | onyx | nova | shimmer"),
      language: z.string().optional().describe("Auto-translate narration to this language (e.g. 'ru', 'es', 'de', 'fr')"),
      realtimeAudio: z.boolean().optional().describe("Play narration through speakers in realtime"),
      narrationSpeed: z.number().optional().describe("Narration speed 0.25-4.0"),
      displaySize: z.string().optional(),
      display: z.string().optional(),
      screenIndex: z.number().optional(),
      debugOverlay: z.boolean().optional(),
    }),
    outputSchema: z.object({
      artifactsDir: z.string(),
      videoPath: z.string().optional(),
      subtitlesPath: z.string().optional(),
      metadataPath: z.string().optional(),
      durationMs: z.number().optional(),
      stdout: z.string().optional(),
    }),
  },
  async (input) => {
    const filePath = input.scenarioFile;
    const isTestFile = filePath.endsWith(".test.ts");

    // *.test.ts files use createSession directly — run as subprocess
    if (isTestFile) {
      const result = await runTestFile(filePath, {
        mode: input.mode,
        voice: input.voice,
        language: input.language,
        realtimeAudio: input.realtimeAudio,
        narrationSpeed: input.narrationSpeed,
      });

      const artifactsDir = result.artifactsDir ?? "unknown";

      // Look for common output files in the artifacts dir
      let subtitlesPath: string | undefined;
      let metadataPath: string | undefined;
      let durationMs: number | undefined;

      if (result.artifactsDir && fs.existsSync(result.artifactsDir)) {
        const files = fs.readdirSync(result.artifactsDir);
        subtitlesPath = files.find((f) => f.endsWith(".vtt"))
          ? path.join(result.artifactsDir, files.find((f) => f.endsWith(".vtt"))!)
          : undefined;
        metadataPath = files.find((f) => f.endsWith(".json"))
          ? path.join(result.artifactsDir, files.find((f) => f.endsWith(".json"))!)
          : undefined;

        // Parse duration from metadata if available
        if (metadataPath && fs.existsSync(metadataPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            durationMs = meta.durationMs;
          } catch {}
        }
      }

      const out = {
        artifactsDir,
        videoPath: result.videoPath,
        subtitlesPath,
        metadataPath,
        durationMs,
        stdout: result.stdout,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(out) }],
        structuredContent: out,
      };
    }

    // Legacy *.scenario.ts files — use the unified runner API
    const { config, scenarioFn } = await loadScenarioFile(filePath);

    const scenarioLabel = path
      .basename(filePath)
      .replace(/\.scenario\.(ts|js|mts|mjs)$/, "");

    const artifactsDir =
      input.artifactsDir ?? path.join(repoRoot, "artifacts", `${scenarioLabel}-${isoStamp()}`);

    const headless =
      typeof input.headless === "boolean"
        ? input.headless
        : (typeof input.headed === "boolean" ? !input.headed : undefined);

    const ffmpegPath = await getFfmpegPath();

    const viteRoot = config.server?.type === "vite" ? config.server.root : null;

    let result:
      | { videoPath?: string; subtitlesPath: string; metadataPath: string; durationMs: number }
      | undefined;

    await withViteIfNeeded(viteRoot, input.baseUrl, async (baseURL) => {
      const r = await run(config, scenarioFn, {
        mode: input.mode as Mode,
        baseURL,
        artifactDir: artifactsDir,
        recordMode: input.record as RecordMode,
        ffmpegPath,
        headless,
        display: input.display,
        displaySize: input.displaySize,
        screenIndex: input.screenIndex,
        debugOverlay: Boolean(input.debugOverlay),
      });
      result = {
        videoPath: r.videoPath,
        subtitlesPath: r.subtitlesPath,
        metadataPath: r.metadataPath,
        durationMs: r.durationMs,
      };
    });

    if (!result) {
      throw new Error("internal: run did not produce a result");
    }

    const out = { artifactsDir, ...result };
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
