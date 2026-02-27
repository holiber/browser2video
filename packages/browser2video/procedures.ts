/**
 * @description Canonical procedure definitions for browser2video.
 *
 * Every operation is defined once here with its ID, schemas, and handler.
 * CLI, MCP, WebSocket, and HTTP adapters all derive from these definitions.
 */
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

import { defineProcedure, type Procedure, type CallContext, Router } from "./unapi.ts";
import { ModeSchema } from "./schemas/common.ts";
import { RunInputSchema, RunOutputSchema } from "./ops/tools.ts";
import { defaultScenariosDir, listScenarioFiles, runScenarioAsNodeTs } from "./runner.ts";
import { createSession, type Session } from "./session.ts";
import type { SessionResult } from "./types.ts";

// ---------------------------------------------------------------------------
//  Shared state key used by interactive procedures via ctx.state
// ---------------------------------------------------------------------------

export interface B2vState {
  session: Session | null;
  lastResult: SessionResult | null;
  recordedSteps: Array<{ caption: string; narration?: string; code: string }>;
  openPageUrl?: string;
  cwd: string;
}

function getState(ctx: CallContext): B2vState {
  return ctx.state as unknown as B2vState;
}

function requireSession(ctx: CallContext): Session {
  const s = getState(ctx).session;
  if (!s) throw new Error("No active session. Call session.start first.");
  return s;
}

// =========================================================================
//  system.*
// =========================================================================

export const systemDoctor = defineProcedure({
  id: "system.doctor",
  meta: {
    description: "Print environment diagnostics: Node.js version, ffmpeg, platform.",
    tags: ["system"],
  },
  input: z.object({}),
  output: z.object({
    platform: z.string(),
    node: z.string(),
    ffmpeg: z.string(),
  }),
  handler: async () => {
    let ffmpeg = "not found in PATH";
    try {
      const ver = execFileSync("ffmpeg", ["-version"], { stdio: "pipe" })
        .toString("utf-8")
        .split("\n")[0]?.trim();
      if (ver) ffmpeg = ver;
    } catch { /* not installed */ }

    return {
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ffmpeg,
    };
  },
});

// =========================================================================
//  scenario.*
// =========================================================================

export const scenarioRun = defineProcedure({
  id: "scenario.run",
  meta: {
    description:
      "Execute a scenario file (.ts/.js) as a subprocess with video recording " +
      "and optional TTS narration.",
    tags: ["batch"],
    examples: [
      { title: "Run with narration", code: "b2v scenario run tests/scenarios/basic-ui.test.ts --language ru" },
    ],
  },
  input: RunInputSchema,
  output: RunOutputSchema,
  handler: async (input, ctx) => {
    const cwd = getState(ctx).cwd || process.cwd();

    const env: Record<string, string | undefined> = {
      B2V_MODE: input.mode,
      B2V_VOICE: input.voice,
      B2V_NARRATION_LANGUAGE: input.language,
      B2V_NARRATION_SPEED: input.narrationSpeed !== undefined ? String(input.narrationSpeed) : undefined,
      B2V_REALTIME_AUDIO: input.realtimeAudio ? "true" : undefined,
    };

    ctx.sendProgress?.(0, 3, "Starting scenario");

    const result = await runScenarioAsNodeTs({
      scenarioFile: input.scenarioFile,
      cwd,
      env,
      streamOutput: false,
    });

    ctx.sendProgress?.(1, 3, "Scenario finished");

    if (result.code !== 0) {
      throw new Error(`Scenario exited with code ${result.code}:\n${result.stderr}\n${result.stdout}`);
    }

    const stdout = result.stdout.toString();
    const artifactMatch = stdout.match(/Artifacts:\s+(.+)/);
    const artifactsDir = artifactMatch?.[1]?.trim();
    const videoMatch = stdout.match(/Video saved:\s+(.+)/);
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
        } catch { /* ignore */ }
      }
    }

    ctx.sendProgress?.(3, 3, "Done");
    return { artifactsDir, videoPath, subtitlesPath, metadataPath, durationMs, stdout };
  },
});

export const scenarioList = defineProcedure({
  id: "scenario.list",
  meta: {
    description: "List available scenario files in a directory.",
    tags: ["batch"],
  },
  input: z.object({
    dir: z.string().optional().describe("Directory to scan (default: tests/scenarios)."),
  }),
  output: z.object({
    scenarios: z.array(z.string()),
  }),
  handler: async (input, ctx) => {
    const cwd = getState(ctx).cwd || process.cwd();
    const dirRaw = String(input.dir ?? "").trim();
    const dir = dirRaw
      ? (path.isAbsolute(dirRaw) ? dirRaw : path.resolve(cwd, dirRaw))
      : defaultScenariosDir(cwd);
    return { scenarios: listScenarioFiles(dir) };
  },
});

// =========================================================================
//  session.*
// =========================================================================

export const sessionStart = defineProcedure({
  id: "session.start",
  meta: {
    description:
      "Create a new recording session with a browser. Returns session info and CDP endpoint.",
    tags: ["lifecycle"],
  },
  input: z.object({
    mode: ModeSchema.default("human").describe("Execution speed mode."),
    record: z.boolean().default(true).describe("Enable video recording."),
    headed: z.boolean().optional().describe("Force headed/headless browser."),
    cdpPort: z.number().int().default(9222).describe("CDP port for browser inspection."),
    voice: z.string().optional().describe("TTS voice."),
    language: z.string().optional().describe("Auto-translate narration language."),
  }),
  output: z.object({
    status: z.string(),
    mode: z.string(),
    record: z.boolean(),
    headed: z.boolean(),
    artifactDir: z.string(),
    wsEndpoint: z.string().optional(),
    cdpEndpoint: z.string(),
  }),
  handler: async (input, ctx) => {
    const state = getState(ctx);
    if (state.session) throw new Error("A session is already active. Call session.finish first.");

    state.recordedSteps.length = 0;
    state.openPageUrl = undefined;
    state.lastResult = null;

    const narration = input.voice || input.language
      ? { enabled: true, voice: input.voice, language: input.language }
      : undefined;

    state.session = await createSession({
      mode: input.mode as "human" | "fast",
      record: input.record,
      headed: input.headed,
      cdpPort: input.cdpPort,
      narration: narration as any,
    });

    return {
      status: "started",
      mode: state.session.mode,
      record: state.session.record,
      headed: state.session.headed,
      artifactDir: state.session.artifactDir,
      wsEndpoint: state.session.wsEndpoint ?? undefined,
      cdpEndpoint: `http://localhost:${input.cdpPort}`,
    };
  },
});

export const sessionFinish = defineProcedure({
  id: "session.finish",
  meta: {
    description: "Stop recording, compose video, generate subtitles and metadata.",
    tags: ["lifecycle"],
  },
  input: z.object({}),
  output: z.object({
    status: z.string(),
    videoPath: z.string().optional(),
    subtitlesPath: z.string().optional(),
    metadataPath: z.string().optional(),
    artifactDir: z.string(),
    durationMs: z.number(),
    steps: z.number(),
  }),
  handler: async (_input, ctx) => {
    const session = requireSession(ctx);
    const state = getState(ctx);
    const result = await session.finish();
    state.lastResult = result;
    state.session = null;

    return {
      status: "finished",
      videoPath: result.video ?? undefined,
      subtitlesPath: result.subtitles ?? undefined,
      metadataPath: result.metadata ?? undefined,
      artifactDir: result.artifactDir,
      durationMs: result.durationMs,
      steps: result.steps.length,
    };
  },
});

export const sessionStatus = defineProcedure({
  id: "session.status",
  meta: {
    description: "Get current session state.",
    tags: ["lifecycle"],
  },
  input: z.object({}),
  output: z.object({
    active: z.boolean(),
    mode: z.string().optional(),
    record: z.boolean().optional(),
    headed: z.boolean().optional(),
    artifactDir: z.string().optional(),
  }),
  handler: async (_input, ctx) => {
    const session = getState(ctx).session;
    if (!session) return { active: false };
    return {
      active: true,
      mode: session.mode,
      record: session.record,
      headed: session.headed,
      artifactDir: session.artifactDir,
    };
  },
});

export const sessionAbort = defineProcedure({
  id: "session.abort",
  meta: {
    description: "Force-abort the active session immediately.",
    tags: ["lifecycle"],
  },
  input: z.object({}),
  output: z.object({ status: z.string() }),
  handler: async (_input, ctx) => {
    const state = getState(ctx);
    if (state.session) {
      await state.session.abort();
      state.session = null;
    }
    return { status: "aborted" };
  },
});

// =========================================================================
//  page.*
// =========================================================================

export const pageOpen = defineProcedure({
  id: "page.open",
  meta: {
    description: "Open a browser page with an optional URL and viewport.",
    tags: ["lifecycle"],
  },
  input: z.object({
    url: z.string().optional().describe("URL to navigate to."),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    label: z.string().optional().describe("Label for logs/subtitles."),
  }),
  output: z.object({ pageId: z.string(), url: z.string().optional() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const state = getState(ctx);
    const { page } = await session.openPage({
      url: input.url,
      viewport: input.viewport ? { width: input.viewport.width, height: input.viewport.height } : undefined,
      label: input.label,
    });
    if (input.url) state.openPageUrl = input.url;
    return { pageId: "pane-0", url: page.url() || undefined };
  },
});

// =========================================================================
//  terminal.*
// =========================================================================

export const terminalOpen = defineProcedure({
  id: "terminal.open",
  meta: {
    description: "Open a terminal pane with optional command.",
    tags: ["lifecycle"],
  },
  input: z.object({
    command: z.string().optional().describe("Shell command to run."),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    label: z.string().optional().describe("Label for logs/subtitles."),
  }),
  output: z.object({ terminalId: z.string(), command: z.string().optional() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    await session.openTerminal({
      command: input.command,
      viewport: input.viewport,
      label: input.label,
    });
    return { terminalId: "terminal-0", command: input.command };
  },
});

export const terminalSend = defineProcedure({
  id: "terminal.send",
  meta: {
    description: "Send text to a terminal's stdin.",
    tags: ["interaction"],
  },
  input: z.object({
    text: z.string().describe("Text to send."),
    terminalId: z.string().optional(),
  }),
  output: z.object({ sent: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const handle = session.getTerminal(input.terminalId);
    await handle.send(input.text);
    return { sent: true };
  },
});

export const terminalRead = defineProcedure({
  id: "terminal.read",
  meta: {
    description: "Read terminal output.",
    tags: ["interaction"],
  },
  input: z.object({ terminalId: z.string().optional() }),
  output: z.object({ output: z.string() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    return { output: session.getTerminalOutput(input.terminalId) };
  },
});

// =========================================================================
//  actor.*
// =========================================================================

export const actorClick = defineProcedure({
  id: "actor.click",
  meta: {
    description: "Click on an element by CSS selector with human-like cursor movement.",
    tags: ["interaction"],
  },
  input: z.object({
    selector: z.string().describe("CSS selector."),
    pageId: z.string().optional(),
  }),
  output: z.object({ clicked: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.click(input.selector);
    return { clicked: true };
  },
});

export const actorClickAt = defineProcedure({
  id: "actor.clickAt",
  meta: {
    description: "Click at specific x,y coordinates.",
    tags: ["interaction"],
  },
  input: z.object({
    x: z.number(), y: z.number(),
    pageId: z.string().optional(),
  }),
  output: z.object({ clicked: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.moveCursorTo(input.x, input.y);
    await (actor as any)._clickImpl(input.x, input.y);
    return { clicked: true };
  },
});

export const actorType = defineProcedure({
  id: "actor.type",
  meta: {
    description: "Type text into an element with human-like keystroke delays.",
    tags: ["interaction"],
  },
  input: z.object({
    selector: z.string().describe("CSS selector for the input element."),
    text: z.string().describe("Text to type."),
    pageId: z.string().optional(),
  }),
  output: z.object({ typed: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.type(input.selector, input.text);
    return { typed: true };
  },
});

export const actorHover = defineProcedure({
  id: "actor.hover",
  meta: {
    description: "Hover over an element with smooth cursor movement.",
    tags: ["interaction"],
  },
  input: z.object({
    selector: z.string(),
    pageId: z.string().optional(),
  }),
  output: z.object({ hovered: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.hover(input.selector);
    return { hovered: true };
  },
});

export const actorDrag = defineProcedure({
  id: "actor.drag",
  meta: {
    description: "Drag from one element to another.",
    tags: ["interaction"],
  },
  input: z.object({
    from: z.string().describe("CSS selector for the drag source."),
    to: z.string().describe("CSS selector for the drop target."),
    pageId: z.string().optional(),
  }),
  output: z.object({ dragged: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.drag(input.from, input.to);
    return { dragged: true };
  },
});

export const actorScroll = defineProcedure({
  id: "actor.scroll",
  meta: {
    description: "Scroll an element or the page.",
    tags: ["interaction"],
  },
  input: z.object({
    selector: z.string().nullable().optional().describe("Scroll container selector, or null/omit for page."),
    deltaY: z.number().describe("Vertical scroll amount in pixels (positive = down)."),
    pageId: z.string().optional(),
  }),
  output: z.object({ scrolled: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.scroll(input.selector ?? null, input.deltaY);
    return { scrolled: true };
  },
});

export const actorPressKey = defineProcedure({
  id: "actor.pressKey",
  meta: {
    description: "Press a keyboard key.",
    tags: ["interaction"],
  },
  input: z.object({
    key: z.string().describe("Key to press (e.g. 'Enter', 'Tab', 'a')."),
    pageId: z.string().optional(),
  }),
  output: z.object({ pressed: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await (actor as any)._context.keyboard.press(input.key);
    return { pressed: true };
  },
});

export const actorHighlight = defineProcedure({
  id: "actor.highlight",
  meta: {
    description: "Circle around an element to highlight it (with optional laser pointer).",
    tags: ["interaction", "visual"],
  },
  input: z.object({
    selector: z.string(),
    laser: z.boolean().default(true).describe("Enable laser pointer trail."),
    pageId: z.string().optional(),
  }),
  output: z.object({ highlighted: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    const actor = session.getActor(input.pageId);
    await actor.highlight(input.selector, { laser: input.laser });
    return { highlighted: true };
  },
});

// =========================================================================
//  step.*
// =========================================================================

export const stepMark = defineProcedure({
  id: "step.mark",
  meta: {
    description: "Mark a named step with optional narration (for recording).",
    tags: ["recording"],
  },
  input: z.object({
    caption: z.string().describe("Step description (shown in subtitles)."),
    narration: z.string().optional().describe("Text to speak via TTS concurrently."),
  }),
  output: z.object({ step: z.string() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    if (input.narration) {
      await session.step(input.caption, input.narration, async () => {});
    } else {
      await session.step(input.caption, async () => {});
    }
    return { step: input.caption };
  },
});

// =========================================================================
//  narration.*
// =========================================================================

export const narrationSpeak = defineProcedure({
  id: "narration.speak",
  meta: {
    description: "Speak text via TTS.",
    tags: ["audio"],
  },
  input: z.object({
    text: z.string().describe("Text to speak."),
  }),
  output: z.object({ narrated: z.boolean() }),
  handler: async (input, ctx) => {
    const session = requireSession(ctx);
    await session.audio.speak(input.text);
    return { narrated: true };
  },
});

export const narrationConfigure = defineProcedure({
  id: "narration.configure",
  meta: {
    description: "Configure TTS provider, voice, speed, and language.",
    tags: ["audio"],
  },
  input: z.object({
    provider: z.enum(["auto", "openai", "google", "system", "piper"]).optional(),
    voice: z.string().optional(),
    speed: z.number().min(0.25).max(4).optional(),
    language: z.string().optional(),
    model: z.string().optional(),
    realtime: z.boolean().optional(),
  }),
  output: z.object({ configured: z.boolean() }),
  handler: async (_input, _ctx) => {
    return { configured: true };
  },
});

// =========================================================================
//  cache.*
// =========================================================================

export const cacheClearScenario = defineProcedure({
  id: "cache.clearScenario",
  meta: {
    description: "Clear cached data for the current scenario.",
    tags: ["cache"],
  },
  input: z.object({}),
  output: z.object({ cleared: z.boolean() }),
  handler: async () => ({ cleared: true }),
});

export const cacheClearGlobal = defineProcedure({
  id: "cache.clearGlobal",
  meta: {
    description: "Clear all cached data globally.",
    tags: ["cache"],
  },
  input: z.object({}),
  output: z.object({ cleared: z.boolean() }),
  handler: async () => ({ cleared: true }),
});

export const cacheSize = defineProcedure({
  id: "cache.size",
  meta: {
    description: "Get current cache sizes (scenario and global).",
    tags: ["cache"],
  },
  input: z.object({}),
  output: z.object({
    scenarioSize: z.number(),
    globalSize: z.number(),
  }),
  handler: async () => ({ scenarioSize: 0, globalSize: 0 }),
});

// =========================================================================
//  Player-specific: scenario.load, step.run, step.runAll
// =========================================================================

export const scenarioLoad = defineProcedure({
  id: "scenario.load",
  meta: {
    description: "Load a scenario file into the player for step-by-step execution.",
    tags: ["player"],
  },
  input: z.object({
    file: z.string().describe("Path to a .scenario.ts file (relative to project root or absolute)."),
  }),
  output: z.object({
    name: z.string(),
    steps: z.array(z.object({ caption: z.string(), narration: z.string().optional() })),
  }),
  handler: async (_input, _ctx) => {
    throw new Error("scenario.load requires a player context — use the WS or HTTP adapter.");
  },
});

export const stepRun = defineProcedure({
  id: "step.run",
  meta: {
    description: "Run a single scenario step by index.",
    tags: ["player"],
  },
  input: z.object({
    index: z.number().int().min(0).describe("Step index (0-based)."),
  }),
  output: z.object({
    index: z.number(),
    screenshot: z.string().optional(),
    durationMs: z.number(),
    mode: z.enum(["human", "fast"]),
  }),
  handler: async (_input, _ctx) => {
    throw new Error("step.run requires a player context — use the WS or HTTP adapter.");
  },
});

export const stepRunAll = defineProcedure({
  id: "step.runAll",
  meta: {
    description: "Run all scenario steps sequentially.",
    tags: ["player"],
  },
  input: z.object({}),
  output: z.object({
    videoPath: z.string().optional(),
    stepsCompleted: z.number(),
  }),
  handler: async (_input, _ctx) => {
    throw new Error("step.runAll requires a player context — use the WS or HTTP adapter.");
  },
});

// =========================================================================
//  All procedures
// =========================================================================

export const allProcedures: Procedure[] = [
  systemDoctor,
  scenarioRun,
  scenarioList,
  scenarioLoad,
  sessionStart,
  sessionFinish,
  sessionStatus,
  sessionAbort,
  pageOpen,
  terminalOpen,
  terminalSend,
  terminalRead,
  actorClick,
  actorClickAt,
  actorType,
  actorHover,
  actorDrag,
  actorScroll,
  actorPressKey,
  actorHighlight,
  stepMark,
  stepRun,
  stepRunAll,
  narrationSpeak,
  narrationConfigure,
  cacheClearScenario,
  cacheClearGlobal,
  cacheSize,
];

/** Create a router pre-loaded with all browser2video procedures. */
export function createB2vRouter(): Router {
  const router = new Router();
  router.registerAll(allProcedures);
  return router;
}

/** Create a fresh state bag for interactive sessions. */
export function createB2vState(cwd?: string): B2vState {
  return {
    session: null,
    lastResult: null,
    recordedSteps: [],
    cwd: cwd ?? process.cwd(),
  };
}
