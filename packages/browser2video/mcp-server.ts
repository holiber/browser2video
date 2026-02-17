#!/usr/bin/env node
/**
 * @description Browser2Video MCP server (stdio).
 *
 * Batch tools: b2v_run, b2v_list_scenarios, b2v_doctor — run pre-written scenario files.
 *
 * Interactive tools: b2v_start … b2v_finish — long-lived session where AI agents
 * control the browser and terminals in real-time with human-like Actor interactions,
 * recording, narration, and scenario export.
 *
 * Playwright MCP can connect to the same browser via the CDP endpoint returned by
 * b2v_start, providing snapshots, screenshots, and raw page inspection alongside
 * b2v's Actor interactions.
 */
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createSession, Session } from "./session.ts";
import type { SessionResult } from "./types.ts";
import { RunInputSchema, runTool, listTool, doctorTool } from "./ops/tools.ts";
import { defaultScenariosDir, listScenarioFiles, runScenarioAsNodeTs } from "./runner.ts";

const cwd = process.cwd();
const defaultDir = defaultScenariosDir(cwd);

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

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

function jsonReply(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

// Dual logging: stderr for terminal visibility + MCP notification for agents.
// Declared as var so it can reference `server` after it's created below.
var log: (level: "info" | "warning" | "error", message: string, data?: unknown) => void;

function sendProgress(extra: any, progress: number, total: number, message: string) {
  const token = extra?._meta?.progressToken;
  if (!token) return;
  extra.sendNotification?.({
    method: "notifications/progress",
    params: { progressToken: token, progress, total, message },
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
//  Interactive session state
// ---------------------------------------------------------------------------

let activeSession: Session | null = null;
let lastResult: SessionResult | null = null;

interface RecordedStep {
  caption: string;
  narration?: string;
  code: string;
}
const recordedSteps: RecordedStep[] = [];
let openPageUrl: string | undefined;

function requireSession(): Session {
  if (!activeSession) throw new Error("No active session. Call b2v_start first.");
  return activeSession;
}

// ---------------------------------------------------------------------------
//  MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "browser2video", version: "0.1.0" },
  { capabilities: { logging: {} } as any },
);

log = (level, message, data) => {
  const text = data !== undefined ? `${message} ${JSON.stringify(data)}` : message;
  console.error(`[b2v] ${text}`);
  server.server.sendLoggingMessage({ level, data: text }).catch(() => {});
};

// =========================================================================
//  BATCH TOOLS (existing)
// =========================================================================

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
    log("info", "b2v_list_scenarios", { dir: input?.dir });
    const dirRaw = String(input?.dir ?? "").trim();
    const dir = dirRaw
      ? (path.isAbsolute(dirRaw) ? dirRaw : path.resolve(cwd, dirRaw))
      : defaultDir;
    const files = listScenarioFiles(dir);
    return jsonReply({ scenarios: files });
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
    log("info", "b2v_doctor");
    return jsonReply({
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ffmpeg: tryGetFfmpegVersion() ?? "not found in PATH",
    });
  },
);

// b2v_run
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
  }, extra: any) => {
    log("info", "b2v_run", { file: input.scenarioFile, mode: input.mode });
    sendProgress(extra, 0, 3, "Starting scenario");
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

    sendProgress(extra, 1, 3, "Scenario process finished");

    if (result.code !== 0) {
      throw new Error(`Scenario process exited with code ${result.code}:\n${result.stderr}\n${result.stdout}`);
    }

    const output = result.stdout.toString();
    const artifactMatch = output.match(/Artifacts:\s+(.+)/);
    const artifactsDir = artifactMatch?.[1]?.trim();
    const videoMatch = output.match(/Video saved:\s+(.+)/);
    const videoPath = videoMatch?.[1]?.trim();

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

    sendProgress(extra, 3, 3, "Done");
    log("info", "b2v_run complete", { videoPath });
    return jsonReply({ artifactsDir, videoPath, subtitlesPath, metadataPath, durationMs, stdout: output });
  },
);

// =========================================================================
//  INTERACTIVE TOOLS — session lifecycle
// =========================================================================

server.registerTool(
  "b2v_start",
  {
    title: "Start interactive session",
    description:
      "Launch a browser with video recording and optional narration. " +
      "Returns a CDP endpoint URL so Playwright MCP can connect to the same browser " +
      "for page inspection (snapshots, screenshots, evaluate). " +
      "Use b2v tools for human-like interactions, terminals, and recording.",
    inputSchema: {
      mode: z.enum(["human", "fast"]).default("human").describe("Execution speed mode."),
      record: z.boolean().default(true).describe("Enable video recording."),
      headed: z.boolean().optional().describe("Force headed/headless browser."),
      cdpPort: z.number().int().default(9222).describe("CDP port for Playwright MCP connection. Default: 9222."),
      voice: z.string().optional().describe("OpenAI TTS voice (requires OPENAI_API_KEY)."),
      language: z.string().optional().describe("Auto-translate narration language."),
    },
  },
  async (input: {
    mode?: string;
    record?: boolean;
    headed?: boolean;
    cdpPort?: number;
    voice?: string;
    language?: string;
  }) => {
    log("info", "b2v_start", { mode: input.mode, record: input.record, cdpPort: input.cdpPort });
    if (activeSession) {
      throw new Error("A session is already active. Call b2v_finish first.");
    }

    recordedSteps.length = 0;
    openPageUrl = undefined;
    lastResult = null;

    const narration = input.voice || input.language
      ? { enabled: true, voice: input.voice, language: input.language }
      : undefined;

    activeSession = await createSession({
      mode: (input.mode as "human" | "fast") ?? "human",
      record: input.record ?? true,
      headed: input.headed,
      cdpPort: input.cdpPort ?? 9222,
      narration: narration as any,
    });

    return jsonReply({
      status: "started",
      mode: activeSession.mode,
      record: activeSession.record,
      headed: activeSession.headed,
      artifactDir: activeSession.artifactDir,
      wsEndpoint: activeSession.wsEndpoint,
      cdpEndpoint: `http://localhost:${input.cdpPort ?? 9222}`,
      hint: "Connect Playwright MCP with --cdp-endpoint to inspect pages. Use b2v tools for human-like interactions.",
    });
  },
);

server.registerTool(
  "b2v_finish",
  {
    title: "Finish session and compose video",
    description:
      "End the active session. Composes recorded panes into a single video, " +
      "generates subtitles and metadata. Returns artifact paths.",
  },
  async (extra: any) => {
    log("info", "b2v_finish — composing video");
    sendProgress(extra, 0, 3, "Closing browser contexts");
    const session = requireSession();
    sendProgress(extra, 1, 3, "Composing video");
    lastResult = await session.finish();
    activeSession = null;
    sendProgress(extra, 3, 3, "Done");
    log("info", "b2v_finish complete", { video: lastResult.video });

    return jsonReply({
      status: "finished",
      videoPath: lastResult.video,
      subtitlesPath: lastResult.subtitles,
      metadataPath: lastResult.metadata,
      artifactDir: lastResult.artifactDir,
      durationMs: lastResult.durationMs,
      steps: lastResult.steps.length,
    });
  },
);

server.registerTool(
  "b2v_status",
  {
    title: "Session status",
    description: "Return current session state: open panes, steps, mode, recording status.",
  },
  async () => {
    log("info", "b2v_status");
    if (!activeSession) {
      return jsonReply({ active: false });
    }
    return jsonReply({
      active: true,
      mode: activeSession.mode,
      record: activeSession.record,
      headed: activeSession.headed,
      artifactDir: activeSession.artifactDir,
      panes: activeSession.getPanesSummary(),
      steps: activeSession.getSteps(),
      wsEndpoint: activeSession.wsEndpoint,
    });
  },
);

// =========================================================================
//  INTERACTIVE TOOLS — pages and terminals
// =========================================================================

server.registerTool(
  "b2v_open_page",
  {
    title: "Open browser page",
    description:
      "Open a new browser page with b2v setup (cursor injection, recording). " +
      "Returns a pageId for targeting subsequent interactions.",
    inputSchema: {
      url: z.string().optional().describe("URL to navigate to."),
      viewport: z.object({
        width: z.number().int().default(1280),
        height: z.number().int().default(720),
      }).optional().describe("Viewport dimensions."),
      label: z.string().optional().describe("Label for logs/subtitles."),
    },
  },
  async (input: { url?: string; viewport?: { width: number; height: number }; label?: string }) => {
    log("info", "b2v_open_page", { url: input.url });
    const session = requireSession();
    const { page, actor } = await session.openPage(input);
    const pageId = session.getPanesSummary().at(-1)!.id;
    if (input.url) openPageUrl = input.url;
    return jsonReply({ pageId, url: input.url ?? "about:blank" });
  },
);

server.registerTool(
  "b2v_open_terminal",
  {
    title: "Open terminal pane",
    description:
      "Open a terminal pane that runs a shell command. The terminal is rendered " +
      "in a browser page for recording. Returns a terminalId.",
    inputSchema: {
      command: z.string().optional().describe("Shell command to run (e.g. 'bash', 'htop')."),
      viewport: z.object({
        width: z.number().int().default(800),
        height: z.number().int().default(600),
      }).optional().describe("Viewport dimensions."),
      label: z.string().optional().describe("Label for logs/subtitles."),
    },
  },
  async (input: { command?: string; viewport?: { width: number; height: number }; label?: string }) => {
    log("info", "b2v_open_terminal", { command: input.command });
    const session = requireSession();
    await session.openTerminal(input);
    const terminalId = session.getPanesSummary().at(-1)!.id;
    return jsonReply({ terminalId, command: input.command ?? "(none)" });
  },
);

server.registerTool(
  "b2v_terminal_send",
  {
    title: "Send command to terminal",
    description: "Send text or a command to the terminal stdin. In human mode, characters are typed visually.",
    inputSchema: {
      text: z.string().describe("Text to send to the terminal."),
      terminalId: z.string().optional().describe("Target terminal pane ID (optional if only one terminal)."),
    },
  },
  async (input: { text: string; terminalId?: string }) => {
    log("info", "b2v_terminal_send", { text: input.text });
    const session = requireSession();
    const terminal = session.getTerminal(input.terminalId);
    await terminal.send(input.text);
    return jsonReply({ sent: input.text });
  },
);

server.registerTool(
  "b2v_terminal_read",
  {
    title: "Read terminal output",
    description: "Read the current terminal output log.",
    inputSchema: {
      terminalId: z.string().optional().describe("Target terminal pane ID (optional if only one terminal)."),
    },
  },
  async (input: { terminalId?: string }) => {
    log("info", "b2v_terminal_read");
    const session = requireSession();
    const output = session.getTerminalOutput(input.terminalId);
    return jsonReply({ output });
  },
);

// =========================================================================
//  INTERACTIVE TOOLS — human-like Actor interactions
// =========================================================================

server.registerTool(
  "b2v_click",
  {
    title: "Human-like click",
    description:
      "Click an element with human-like cursor movement (WindMouse algorithm), " +
      "click effect animation, and breathing pause. This is the key difference " +
      "from Playwright MCP's browser_click — it produces natural-looking recordings.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the element to click."),
      pageId: z.string().optional().describe("Target page ID (optional if only one page)."),
    },
  },
  async (input: { selector: string; pageId?: string }) => {
    log("info", "b2v_click", { selector: input.selector });
    const actor = requireSession().getActor(input.pageId);
    await actor.click(input.selector);
    return jsonReply({ clicked: input.selector });
  },
);

server.registerTool(
  "b2v_click_at",
  {
    title: "Click at coordinates",
    description: "Human-like click at specific x,y coordinates. Useful for canvas or terminal interactions.",
    inputSchema: {
      x: z.number().describe("X coordinate."),
      y: z.number().describe("Y coordinate."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { x: number; y: number; pageId?: string }) => {
    log("info", "b2v_click_at", { x: input.x, y: input.y });
    const actor = requireSession().getActor(input.pageId);
    await actor.clickAt(input.x, input.y);
    return jsonReply({ clicked: { x: input.x, y: input.y } });
  },
);

server.registerTool(
  "b2v_type",
  {
    title: "Human-like typing",
    description:
      "Type text into an element with per-character delays, producing " +
      "realistic typing in recordings. Clicks the element first.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the input element."),
      text: z.string().describe("Text to type."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { selector: string; text: string; pageId?: string }) => {
    log("info", "b2v_type", { selector: input.selector, text: input.text });
    const actor = requireSession().getActor(input.pageId);
    await actor.type(input.selector, input.text);
    return jsonReply({ typed: input.text, into: input.selector });
  },
);

server.registerTool(
  "b2v_press_key",
  {
    title: "Press keyboard key",
    description: "Press a keyboard key with a breathing pause. Accepts Playwright key names (Enter, Tab, etc.).",
    inputSchema: {
      key: z.string().describe("Key to press (e.g. 'Enter', 'Tab', 'ArrowDown', 'a')."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { key: string; pageId?: string }) => {
    log("info", "b2v_press_key", { key: input.key });
    const actor = requireSession().getActor(input.pageId);
    await actor.pressKey(input.key);
    return jsonReply({ pressed: input.key });
  },
);

server.registerTool(
  "b2v_hover",
  {
    title: "Human-like hover",
    description: "Move the cursor to an element with smooth, human-like motion.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the element to hover."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { selector: string; pageId?: string }) => {
    log("info", "b2v_hover", { selector: input.selector });
    const actor = requireSession().getActor(input.pageId);
    await actor.hover(input.selector);
    return jsonReply({ hovered: input.selector });
  },
);

server.registerTool(
  "b2v_drag",
  {
    title: "Human-like drag",
    description: "Drag from one element to another with smooth cursor movement.",
    inputSchema: {
      from: z.string().describe("CSS selector of the source element."),
      to: z.string().describe("CSS selector of the target element."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { from: string; to: string; pageId?: string }) => {
    log("info", "b2v_drag", { from: input.from, to: input.to });
    const actor = requireSession().getActor(input.pageId);
    await actor.drag(input.from, input.to);
    return jsonReply({ dragged: { from: input.from, to: input.to } });
  },
);

server.registerTool(
  "b2v_scroll",
  {
    title: "Scroll page or element",
    description: "Scroll a page or specific element by a delta amount.",
    inputSchema: {
      selector: z.string().nullable().optional().describe("CSS selector of the scrollable element (null for page)."),
      deltaY: z.number().describe("Vertical scroll amount in pixels (positive = down)."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { selector?: string | null; deltaY: number; pageId?: string }) => {
    log("info", "b2v_scroll", { selector: input.selector, deltaY: input.deltaY });
    const actor = requireSession().getActor(input.pageId);
    await actor.scroll(input.selector ?? null, input.deltaY);
    return jsonReply({ scrolled: input.deltaY });
  },
);

server.registerTool(
  "b2v_select_text",
  {
    title: "Select text with mouse",
    description:
      "Human-like text selection by dragging from the top-left of the start element " +
      "to the bottom-right of the end element. Produces a visible browser text highlight. " +
      "If only fromSelector is given, selects all text within that single element.",
    inputSchema: {
      fromSelector: z.string().describe("CSS selector for the start of selection."),
      toSelector: z.string().optional().describe("CSS selector for the end of selection (defaults to fromSelector)."),
      pageId: z.string().optional().describe("Target page ID."),
    },
  },
  async (input: { fromSelector: string; toSelector?: string; pageId?: string }) => {
    log("info", "b2v_select_text", { from: input.fromSelector, to: input.toSelector });
    const actor = requireSession().getActor(input.pageId);
    await actor.selectText(input.fromSelector, input.toSelector);
    return jsonReply({ selected: { from: input.fromSelector, to: input.toSelector ?? input.fromSelector } });
  },
);

// =========================================================================
//  INTERACTIVE TOOLS — recording and narration
// =========================================================================

server.registerTool(
  "b2v_step",
  {
    title: "Mark a recording step",
    description:
      "Mark a named step in the recording. Steps appear as subtitles in the final video. " +
      "Optional narration text is spoken via TTS concurrently.",
    inputSchema: {
      caption: z.string().describe("Step description (shown as subtitle)."),
      narration: z.string().optional().describe("Text to speak via TTS (requires OPENAI_API_KEY)."),
    },
  },
  async (input: { caption: string; narration?: string }) => {
    log("info", "b2v_step", { caption: input.caption, narration: !!input.narration });
    const session = requireSession();
    if (input.narration) {
      await session.step(input.caption, input.narration, async () => {});
    } else {
      await session.step(input.caption, async () => {});
    }
    return jsonReply({ step: input.caption });
  },
);

server.registerTool(
  "b2v_narrate",
  {
    title: "Speak narration",
    description: "Speak text via TTS. Requires OPENAI_API_KEY. Non-blocking — continues while speech plays.",
    inputSchema: {
      text: z.string().describe("Text to speak."),
    },
  },
  async (input: { text: string }) => {
    log("info", "b2v_narrate", { text: input.text.slice(0, 60) });
    const session = requireSession();
    await session.audio.speak(input.text);
    return jsonReply({ narrated: input.text });
  },
);

// =========================================================================
//  INTERACTIVE TOOLS — scenario builder
// =========================================================================

server.registerTool(
  "b2v_add_step",
  {
    title: "Add step to scenario",
    description:
      "Add a step to the scenario being built. The 'code' string is executed immediately " +
      "with `actor`, `page`, and `session` in scope, and also recorded for export via b2v_save_scenario. " +
      "Use Actor methods (actor.click, actor.type, etc.) for human-like interactions, " +
      "or raw Playwright Page methods (page.goto, page.waitForSelector, etc.).",
    inputSchema: {
      caption: z.string().describe("Step description (shown as subtitle)."),
      narration: z.string().optional().describe("Narration text for TTS."),
      code: z.string().describe(
        "JS/TS code string to execute. Available variables: actor, page, session. " +
        "Example: \"await actor.click('#submit');\"",
      ),
      pageId: z.string().optional().describe("Target page ID for actor/page resolution."),
    },
  },
  async (input: { caption: string; narration?: string; code: string; pageId?: string }) => {
    log("info", "b2v_add_step", { caption: input.caption, narration: !!input.narration, codeLen: input.code.length });
    const session = requireSession();
    const actor = session.getActor(input.pageId);
    const page = session.getPage(input.pageId);

    // Build the async function from the code string
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("actor", "page", "session", input.code) as
      (actor: unknown, page: unknown, session: unknown) => Promise<void>;

    // Execute within a step (with optional narration)
    if (input.narration) {
      await session.step(input.caption, input.narration, async () => {
        await fn(actor, page, session);
      });
    } else {
      await session.step(input.caption, async () => {
        await fn(actor, page, session);
      });
    }

    // Record for scenario export
    recordedSteps.push({
      caption: input.caption,
      narration: input.narration,
      code: input.code,
    });

    return jsonReply({ stepAdded: input.caption, totalSteps: recordedSteps.length });
  },
);

server.registerTool(
  "b2v_save_scenario",
  {
    title: "Export scenario file",
    description:
      "Export all accumulated steps (from b2v_add_step calls) as a standalone .ts scenario file. " +
      "The generated file imports from 'browser2video' and replays all steps.",
    inputSchema: {
      filePath: z.string().describe("Output file path for the scenario (e.g. 'my-scenario.ts')."),
      url: z.string().optional().describe("The URL the scenario should open. Defaults to the URL from b2v_open_page."),
    },
  },
  async (input: { filePath: string; url?: string }) => {
    log("info", "b2v_save_scenario", { filePath: input.filePath, steps: recordedSteps.length });
    if (recordedSteps.length === 0) {
      throw new Error("No steps recorded. Use b2v_add_step to add steps before saving.");
    }

    const url = input.url ?? openPageUrl ?? "https://example.com";

    const lines: string[] = [
      `import { createSession } from "browser2video";`,
      ``,
      `const session = await createSession({ record: true, mode: "human" });`,
      `const { step } = session;`,
      `const { page, actor } = await session.openPage({ url: ${JSON.stringify(url)} });`,
      ``,
    ];

    for (const s of recordedSteps) {
      const indent = "  ";
      const codeLines = s.code.split("\n").map((l) => `${indent}${l}`).join("\n");

      if (s.narration) {
        lines.push(`await step(${JSON.stringify(s.caption)}, ${JSON.stringify(s.narration)}, async () => {`);
      } else {
        lines.push(`await step(${JSON.stringify(s.caption)}, async () => {`);
      }
      lines.push(codeLines);
      lines.push(`});`);
      lines.push(``);
    }

    lines.push(`const result = await session.finish();`);
    lines.push(`console.log("Video:", result.video);`);
    lines.push(``);

    const content = lines.join("\n");
    const absPath = path.isAbsolute(input.filePath)
      ? input.filePath
      : path.resolve(cwd, input.filePath);

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");

    return jsonReply({
      saved: absPath,
      steps: recordedSteps.length,
      hint: `Run with: b2v run ${input.filePath}`,
    });
  },
);

// =========================================================================
//  Start server
// =========================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
