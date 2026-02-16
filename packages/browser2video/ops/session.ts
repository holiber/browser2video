/**
 * @description Session lifecycle operations.
 */
import { z } from "zod";
import { defineOp } from "../define-op.ts";
import { SessionOptionsSchema, SessionResultSchema, PageOptionsSchema, TerminalOptionsSchema } from "../schemas/session.ts";

export const createSessionOp = defineOp({
  name: "session.createSession",
  category: "session",
  summary: "Create a new recording session.",
  description:
    "Launches a Chromium browser, initialises the artifact directory, and returns a `Session` " +
    "instance. This is the main entry point for every Browser2Video scenario.",
  input: SessionOptionsSchema.optional().default({}),
  output: z.object({ session: z.any().describe("Session instance") }),
  examples: [
    {
      title: "Minimal session",
      code: `const session = await createSession();\nconst { step } = session;`,
    },
    {
      title: "With options",
      code: `const session = await createSession({\n  mode: "human",\n  layout: "row",\n  narration: { enabled: true, voice: "ash" },\n});`,
    },
  ],
  tags: ["lifecycle"],
});

export const openPageOp = defineOp({
  name: "session.openPage",
  category: "session",
  summary: "Open a browser page.",
  description:
    "Creates a new browser context with an optional URL and viewport size. " +
    "Returns the Playwright `Page` and an `Actor` for human-like interactions. " +
    "Video recording starts automatically if enabled.",
  input: PageOptionsSchema.optional().default({}),
  output: z.object({
    page: z.any().describe("Playwright Page instance"),
    actor: z.any().describe("Actor instance for browser interactions"),
  }),
  examples: [
    {
      title: "Open a page",
      code: `const { page, actor } = await session.openPage({\n  url: "http://localhost:5173",\n  viewport: { width: 1280, height: 720 },\n  label: "Main",\n});`,
    },
  ],
  tags: ["lifecycle"],
});

export const openTerminalOp = defineOp({
  name: "session.openTerminal",
  category: "session",
  summary: "Open a terminal pane.",
  description:
    "Opens a terminal rendered in a browser page with dark terminal styling. " +
    "Runs an optional shell command and captures output. Returns a `TerminalHandle` " +
    "for sending stdin commands and a `Page` for visual assertions.",
  input: TerminalOptionsSchema.optional().default({}),
  output: z.object({
    terminal: z.any().describe("TerminalHandle for sending commands"),
    page: z.any().describe("Playwright Page rendering the terminal"),
  }),
  examples: [
    {
      title: "Open a terminal running htop",
      code: `const { terminal } = await session.openTerminal({\n  command: "htop",\n  viewport: { width: 800, height: 600 },\n  label: "System Monitor",\n});`,
    },
  ],
  tags: ["lifecycle"],
});

export const stepOp = defineOp({
  name: "session.step",
  category: "session",
  summary: "Execute a named step.",
  description:
    "Tracks a named step shown in subtitles and logs. Accepts an optional narration " +
    "string that speaks concurrently with the step body. After the step completes, " +
    "a breathing pause is added in human mode.",
  input: z.object({
    caption: z.string().describe("Step description text (shown in subtitles)."),
    narration: z.string().optional().describe("Optional TTS narration spoken concurrently with the step."),
  }),
  output: z.void(),
  examples: [
    {
      title: "Simple step",
      code: `await step("Fill the form", async () => {\n  await actor.type("#name", "Alice");\n});`,
    },
    {
      title: "Step with narration",
      code: `await step("Fill the form", "Now we fill in the user's name", async () => {\n  await actor.type("#name", "Alice");\n});`,
    },
  ],
  tags: ["lifecycle"],
});

export const finishOp = defineOp({
  name: "session.finish",
  category: "session",
  summary: "Finish recording and compose the video.",
  description:
    "Stops all recordings, composes pane videos into a single MP4, " +
    "mixes in narration audio, generates WebVTT subtitles and JSON metadata. " +
    "Returns a `SessionResult` with paths to all output files.",
  input: z.void(),
  output: SessionResultSchema,
  examples: [
    {
      title: "Finish and get result",
      code: `const result = await session.finish();\nconsole.log("Video:", result.video);`,
    },
  ],
  tags: ["lifecycle"],
});

export const sessionOps = [createSessionOp, openPageOp, openTerminalOp, stepOp, finishOp] as const;
