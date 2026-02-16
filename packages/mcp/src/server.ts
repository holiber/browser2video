#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 * Runs *.test.ts scenario files as subprocesses via `node` (native TS),
 * passing narration config through B2V_* environment variables.
 * Tool names and descriptions come from @browser2video/lib (single source of truth).
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runTool, listTool, doctorTool } from "@browser2video/lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const defaultScenariosDir = path.join(repoRoot, "tests", "scenarios");

/**
 * Run a test file as a subprocess via `node` (native TS support).
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
    const proc = execFile(process.execPath, [abs], { cwd: repoRoot, env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
//  MCP Server — tool names/descriptions from @browser2video/lib
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
  async () => {
    const files = fs.existsSync(defaultScenariosDir)
      ? fs.readdirSync(defaultScenariosDir)
          .filter((f) => f.endsWith(".test.ts"))
          .sort()
      : [];
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
    inputSchema: {
      scenarioFile: z.string().describe("Path to a *.test.ts scenario file."),
      mode: z.enum(["human", "fast"]).default("human").describe("Execution speed mode."),
      voice: z.string().optional().describe("OpenAI TTS voice."),
      language: z.string().optional().describe("Auto-translate narration language."),
      realtimeAudio: z.boolean().optional().describe("Play narration in realtime."),
      narrationSpeed: z.number().min(0.25).max(4).optional().describe("Narration speed 0.25-4.0."),
    },
  },
  async (input: {
    scenarioFile: string;
    mode?: string;
    voice?: string;
    language?: string;
    realtimeAudio?: boolean;
    narrationSpeed?: number;
  }) => {
    const result = await runTestFile(input.scenarioFile, {
      mode: input.mode,
      voice: input.voice,
      language: input.language,
      realtimeAudio: input.realtimeAudio,
      narrationSpeed: input.narrationSpeed,
    });

    const artifactsDir = result.artifactsDir;

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
      videoPath: result.videoPath,
      subtitlesPath,
      metadataPath,
      durationMs,
      stdout: result.stdout,
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
