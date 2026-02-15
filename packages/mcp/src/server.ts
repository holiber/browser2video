#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 * Uses the unified runner API — scenarios are loaded dynamically from files.
 */
import path from "node:path";
import fs from "node:fs";
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

const server = new McpServer(
  { name: "browser2video", version: "0.0.0" },
  { capabilities: { logging: {} } as any },
);

server.registerTool(
  "b2v_list_scenarios",
  {
    title: "List scenarios",
    description: "List *.scenario.ts files in the default scenarios directory.",
    outputSchema: z.object({
      scenarios: z.array(z.string()),
    }),
  },
  async () => {
    const files = fs.existsSync(defaultScenariosDir)
      ? fs.readdirSync(defaultScenariosDir)
          .filter((f) => f.endsWith(".scenario.ts"))
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
    description: "Run a scenario file in human/fast mode and optionally record an MP4 proof.",
    inputSchema: z.object({
      scenarioFile: z.string().describe("Path to a *.scenario.ts file"),
      mode: z.enum(["human", "fast"]).default("human"),
      record: z.enum(["none", "screencast", "screen"]).default("screencast"),
      artifactsDir: z.string().optional(),
      baseUrl: z.string().optional(),
      headed: z.boolean().optional(),
      headless: z.boolean().optional(),
      displaySize: z.string().optional(),
      display: z.string().optional(),
      screenIndex: z.number().optional(),
      debugOverlay: z.boolean().optional(),
    }),
    outputSchema: z.object({
      artifactsDir: z.string(),
      videoPath: z.string().optional(),
      subtitlesPath: z.string(),
      metadataPath: z.string(),
      durationMs: z.number(),
    }),
  },
  async (input) => {
    const { config, scenarioFn } = await loadScenarioFile(input.scenarioFile);

    const scenarioLabel = path
      .basename(input.scenarioFile)
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
