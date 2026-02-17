/**
 * @description CLI / MCP tool operations.
 * These ops have mcp: true and/or cli: true, so they are
 * automatically registered as MCP tools and CLI commands.
 */
import { z } from "zod";
import { defineOp } from "../define-op.ts";
import { ModeSchema } from "../schemas/common.ts";

// Shared input schema for the "run" tool — the single source of truth
// for CLI flags, MCP inputSchema, and docs parameter tables.
export const RunInputSchema = z.object({
  scenarioFile: z.string().describe("Path to a scenario .ts or .js file (relative to current working directory or absolute)."),
  mode: ModeSchema.default("human").describe("Execution speed mode."),
  voice: z.string().optional().describe("OpenAI TTS voice: alloy | ash | coral | echo | fable | nova | onyx | sage | shimmer."),
  language: z.string().optional().describe("Auto-translate narration to this language (e.g. 'ru', 'es', 'de', 'fr')."),
  realtimeAudio: z.boolean().optional().describe("Play narration through speakers in realtime."),
  narrationSpeed: z.number().min(0.25).max(4).optional().describe("Narration speed 0.25–4.0."),
});

export type RunInput = z.infer<typeof RunInputSchema>;

export const RunOutputSchema = z.object({
  artifactsDir: z.string().optional().describe("Directory containing recorded artifacts."),
  videoPath: z.string().optional().describe("Path to the final composed video."),
  subtitlesPath: z.string().optional().describe("Path to the WebVTT subtitles."),
  metadataPath: z.string().optional().describe("Path to the JSON metadata."),
  durationMs: z.number().optional().describe("Total scenario duration in ms."),
  stdout: z.string().optional().describe("Process stdout output."),
});

export type RunOutput = z.infer<typeof RunOutputSchema>;

export const runTool = defineOp({
  name: "b2v_run",
  category: "tool",
  summary: "Run a scenario with video recording.",
  description:
    "Execute a scenario file (.ts or .js) as a subprocess with video recording " +
    "and optional TTS narration. Supports auto-translation of narration to any language.",
  input: RunInputSchema,
  output: RunOutputSchema,
  examples: [
    {
      title: "Run basic-ui scenario",
      code: "b2v run tests/scenarios/basic-ui.test.ts",
    },
    {
      title: "Run with Russian narration",
      code: "b2v run tests/scenarios/kanban.test.ts --language ru --voice ash",
    },
  ],
  tags: ["cli", "mcp"],
  mcp: true,
  cli: true,
});

export const listTool = defineOp({
  name: "b2v_list_scenarios",
  category: "tool",
  summary: "List available scenario files.",
  description: "List scenario files in the scenarios directory.",
  input: z.object({
    dir: z.string().optional().describe("Directory to scan (default: tests/scenarios)."),
  }),
  output: z.object({
    scenarios: z.array(z.string()).describe("List of scenario file names."),
  }),
  tags: ["cli", "mcp"],
  mcp: true,
  cli: true,
});

export const doctorTool = defineOp({
  name: "b2v_doctor",
  category: "tool",
  summary: "Print environment diagnostics.",
  description: "Check the runtime environment: Node.js version, ffmpeg availability, and platform-specific notes.",
  input: z.void(),
  output: z.object({
    platform: z.string().describe("OS platform and architecture."),
    node: z.string().describe("Node.js version."),
  }),
  tags: ["cli", "mcp"],
  mcp: true,
  cli: true,
});

export const toolOps = [runTool, listTool, doctorTool] as const;
