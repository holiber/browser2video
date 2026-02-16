#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 * Runs *.test.ts scenario files as subprocesses via `node` (native TS),
 * passing narration config through B2V_* environment variables.
 * Tool names and descriptions come from the operation registry (single source of truth).
 */
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RunInputSchema, runTool, listTool, doctorTool } from "./ops/tools.ts";
import { defaultScenariosDir, listScenarioFiles, runScenarioAsNodeTs } from "./runner.ts";

const cwd = process.cwd();
const defaultDir = defaultScenariosDir(cwd);

function tryGetFfmpegVersion(): string | null {
  try {
    const ver = execFileSync("ffmpeg", ["-version"], { stdio: "pipe" })
      .toString("utf-8")
      .split("\n")[0]
      ?.trim();
    return ver || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
//  MCP Server — tool names/descriptions from the operation registry
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "browser2video", version: "0.0.0" },
  { capabilities: { logging: {} } as any },
);

// b2v_list_scenarios
server.registerTool(
  listTool.name,
  {
    title: listTool.summary,
    description: listTool.description,
    inputSchema: {
      dir: z.string().optional().describe("Directory to scan (default: tests/scenarios)."),
    },
  },
  async (input?: { dir?: string }) => {
    const dirRaw = String(input?.dir ?? "").trim();
    const dir = dirRaw
      ? (path.isAbsolute(dirRaw) ? dirRaw : path.resolve(cwd, dirRaw))
      : defaultDir;
    const files = listScenarioFiles(dir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ scenarios: files }) }],
    };
  },
);

// b2v_doctor
server.registerTool(
  doctorTool.name,
  {
    title: doctorTool.summary,
    description: doctorTool.description,
  },
  async () => {
    const out = {
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ffmpeg: tryGetFfmpegVersion() ?? "not found in PATH",
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(out) }],
    };
  },
);

// b2v_run — input schema uses same field names and descriptions as lib's RunInputSchema
server.registerTool(
  runTool.name,
  {
    title: runTool.summary,
    description: runTool.description,
    inputSchema: RunInputSchema.shape,
  },
  async (input: {
    scenarioFile: string;
    mode?: string;
    voice?: string;
    language?: string;
    realtimeAudio?: boolean;
    narrationSpeed?: number;
  }) => {
    const env: Record<string, string | undefined> = {
      B2V_MODE: input.mode,
      B2V_VOICE: input.voice,
      B2V_NARRATION_LANGUAGE: input.language,
      B2V_NARRATION_SPEED: input.narrationSpeed !== undefined ? String(input.narrationSpeed) : undefined,
      B2V_REALTIME_AUDIO: input.realtimeAudio ? "true" : undefined,
    };

    const result = await runScenarioAsNodeTs({
      scenarioFile: input.scenarioFile,
      cwd,
      env,
      streamOutput: false,
    });

    if (result.code !== 0) {
      throw new Error(`Scenario process exited with code ${result.code}:\n${result.stderr}\n${result.stdout}`);
    }

    const output = result.stdout.toString();

    // Parse artifacts dir from output: "  Artifacts: <path>"
    const artifactMatch = output.match(/Artifacts:\s+(.+)/);
    const artifactsDir = artifactMatch?.[1]?.trim();

    // Parse video path from output: "  Video saved: <path>"
    const videoMatch = output.match(/Video saved:\s+(.+)/);
    const videoPath = videoMatch?.[1]?.trim();

    // Look for common output files in the artifacts dir
    let subtitlesPath: string | undefined;
    let metadataPath: string | undefined;
    let durationMs: number | undefined;

    if (artifactsDir && fs.existsSync(artifactsDir)) {
      const files = fs.readdirSync(artifactsDir);
      const vttFile = files.find((f) => f.endsWith(".vtt"));
      const jsonFile = files.find((f) => f.endsWith(".json"));

      subtitlesPath = vttFile ? path.join(artifactsDir, vttFile) : undefined;
      metadataPath = jsonFile ? path.join(artifactsDir, jsonFile) : undefined;

      if (metadataPath && fs.existsSync(metadataPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
          durationMs = meta.durationMs;
        } catch {}
      }
    }

    const out = {
      artifactsDir,
      videoPath,
      subtitlesPath,
      metadataPath,
      durationMs,
      stdout: output,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(out) }],
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
