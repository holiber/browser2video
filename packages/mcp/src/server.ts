#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 * Runs *.test.ts scenario files as subprocesses via `npx tsx`,
 * passing narration config through B2V_* environment variables.
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const defaultScenariosDir = path.join(repoRoot, "tests", "scenarios");

/**
 * Run a test file as a subprocess via `npx tsx`.
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
    description: "List available *.test.ts scenario files in the scenarios directory.",
    outputSchema: z.object({
      scenarios: z.array(z.string()),
    }),
  },
  async () => {
    const files = fs.existsSync(defaultScenariosDir)
      ? fs.readdirSync(defaultScenariosDir)
          .filter((f) => f.endsWith(".test.ts"))
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
    }),
  },
  async () => {
    const out = {
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
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
      "Run a *.test.ts scenario file with video recording and optional narration. " +
      "Supports auto-translation of narration to any language.",
    inputSchema: z.object({
      scenarioFile: z.string().describe("Path to a *.test.ts file (relative to repo root or absolute)"),
      mode: z.enum(["human", "fast"]).default("human").describe("Execution speed"),
      voice: z.string().optional().describe("TTS voice: alloy | ash | ballad | cedar | coral | echo | fable | onyx | nova | sage | shimmer"),
      language: z.string().optional().describe("Auto-translate narration to this language (e.g. 'ru', 'es', 'de', 'fr')"),
      realtimeAudio: z.boolean().optional().describe("Play narration through speakers in realtime"),
      narrationSpeed: z.number().optional().describe("Narration speed 0.25-4.0"),
    }),
    outputSchema: z.object({
      artifactsDir: z.string().optional(),
      videoPath: z.string().optional(),
      subtitlesPath: z.string().optional(),
      metadataPath: z.string().optional(),
      durationMs: z.number().optional(),
      stdout: z.string().optional(),
    }),
  },
  async (input) => {
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
