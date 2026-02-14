#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { createServer, type ViteDevServer } from "vite";
import { run, runCollab, type Mode, type RecordMode } from "@browser2video/runner";
import { basicUiScenario, collabScenario, githubScenario } from "@browser2video/scenarios";

type ScenarioName = "basic-ui" | "collab" | "github";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const demoRoot = path.join(repoRoot, "apps", "demo");

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
  scenario: ScenarioName,
  baseUrlFromArgs: string | undefined,
  fn: (baseURL: string | undefined) => Promise<void>,
) {
  const needsDemoServer = scenario === "basic-ui" || scenario === "collab";
  if (!needsDemoServer) {
    await fn(baseUrlFromArgs);
    return;
  }
  if (baseUrlFromArgs) {
    await fn(baseUrlFromArgs);
    return;
  }

  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root: demoRoot,
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

const server = new McpServer(
  { name: "browser2video", version: "0.0.0" },
  { capabilities: { logging: {} } as any },
);

server.registerTool(
  "b2v_list_scenarios",
  {
    title: "List scenarios",
    description: "List built-in Browser2Video scenarios.",
    outputSchema: z.object({
      scenarios: z.array(z.string()),
    }),
  },
  async () => {
    const out = { scenarios: ["basic-ui", "collab", "github"] };
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
    description: "Run a scenario in human/fast mode and optionally record an MP4 proof.",
    inputSchema: z.object({
      scenario: z.enum(["basic-ui", "collab", "github"]),
      mode: z.enum(["human", "fast"]).default("human"),
      record: z.enum(["none", "screencast", "screen"]).default("screencast"),
      artifactsDir: z.string().optional(),
      baseUrl: z.string().optional(),
      headed: z.boolean().optional(),
      headless: z.boolean().optional(),
      displaySize: z.string().optional(),
      display: z.string().optional(),
      screenIndex: z.number().optional(),
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
    const scenario = input.scenario as ScenarioName;
    const mode = input.mode as Mode;
    const recordMode = input.record as RecordMode;
    const artifactsDir =
      input.artifactsDir ?? path.join(repoRoot, "artifacts", `${scenario}-${isoStamp()}`);

    const headless =
      typeof input.headless === "boolean"
        ? input.headless
        : (typeof input.headed === "boolean" ? !input.headed : undefined);

    const ffmpegPath = await getFfmpegPath();

    let result:
      | { videoPath?: string; subtitlesPath: string; metadataPath: string; durationMs: number }
      | undefined;

    await withViteIfNeeded(scenario, input.baseUrl, async (baseURL) => {
      if (scenario === "collab") {
        const r = await runCollab({
          mode,
          baseURL,
          artifactDir: artifactsDir,
          scenario: collabScenario,
          ffmpegPath,
          headless,
          recordMode,
          display: input.display,
          displaySize: input.displaySize,
          screenIndex: input.screenIndex,
          bossPath: "/notes?role=boss",
          workerPath: "/notes?role=worker",
          captureSelector: '[data-testid="notes-page"]',
          capturePadding: 24,
        });
        result = {
          videoPath: r.videoPath,
          subtitlesPath: r.subtitlesPath,
          metadataPath: r.metadataPath,
          durationMs: r.durationMs,
        };
        return;
      }

      const scenarioFn = scenario === "github" ? githubScenario : basicUiScenario;
      const r = await run({
        mode,
        baseURL,
        artifactDir: artifactsDir,
        scenario: scenarioFn,
        ffmpegPath,
        headless,
        recordMode,
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

