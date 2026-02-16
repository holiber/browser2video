---
title: "Session API"
sidebar_position: 1
---

# Session API

## `createSession`

> Create a new recording session.

Launches a Chromium browser, initialises the artifact directory, and returns a `Session` instance. This is the main entry point for every Browser2Video scenario.

### Parameters

- `mode` (`"human" | "fast"`, optional) — Execution mode. Default: B2V_MODE env, or 'fast' under Playwright, or 'human'.
- `record` (`boolean`, optional) — Enable video recording. Default: false under Playwright, true otherwise.
- `outputDir` (`string`, optional) — Output directory for video/subtitles/metadata. Default: auto-generated.
- `headed` (`boolean`, optional) — Force headed/headless browser. Default: headed in human, headless in fast.
- `layout` (`"auto" | "row" | "grid" | object`, optional) — Layout for multi-pane video composition. Default: 'row'.
- `delays` (`object`, optional) — Override actor timing delays.
- `ffmpegPath` (`string`, optional) — Path to ffmpeg binary. Default: 'ffmpeg'.
- `screenIndex` (`number`, optional) — macOS screen index for screen recording.
- `display` (`string`, optional) — Linux DISPLAY for screen recording.
- `displaySize` (`string`, optional) — Linux display size, e.g. '2560x720'.
- `narration` (`object`, optional) — TTS narration options.

### Examples

**Minimal session**

```ts
const session = await createSession();
const { step } = session;
```

**With options**

```ts
const session = await createSession({
  mode: "human",
  layout: "row",
  narration: { enabled: true, voice: "ash" },
});
```

---

## `openPage`

> Open a browser page.

Creates a new browser context with an optional URL and viewport size. Returns the Playwright `Page` and an `Actor` for human-like interactions. Video recording starts automatically if enabled.

### Parameters

- `url` (`string`, optional) — URL to navigate to (external or local).
- `viewport` (`object`, optional) — Viewport dimensions. Default: 1280x720.
- `label` (`string`, optional) — Label shown in logs and subtitles.

### Examples

**Open a page**

```ts
const { page, actor } = await session.openPage({
  url: "http://localhost:5173",
  viewport: { width: 1280, height: 720 },
  label: "Main",
});
```

---

## `openTerminal`

> Open a terminal pane.

Opens a terminal rendered in a browser page with dark terminal styling. Runs an optional shell command and captures output. Returns a `TerminalHandle` for sending stdin commands and a `Page` for visual assertions.

### Parameters

- `command` (`string`, optional) — Shell command to run.
- `viewport` (`object`, optional) — Viewport dimensions. Default: 800x600.
- `label` (`string`, optional) — Label shown in logs and subtitles.

### Examples

**Open a terminal running htop**

```ts
const { terminal } = await session.openTerminal({
  command: "htop",
  viewport: { width: 800, height: 600 },
  label: "System Monitor",
});
```

---

## `step`

> Execute a named step.

Tracks a named step shown in subtitles and logs. Accepts an optional narration string that speaks concurrently with the step body. After the step completes, a breathing pause is added in human mode.

### Parameters

- `caption` (`string`, **required**) — Step description text (shown in subtitles).
- `narration` (`string`, optional) — Optional TTS narration spoken concurrently with the step.

### Examples

**Simple step**

```ts
await step("Fill the form", async () => {
  await actor.type("#name", "Alice");
});
```

**Step with narration**

```ts
await step("Fill the form", "Now we fill in the user's name", async () => {
  await actor.type("#name", "Alice");
});
```

---

## `finish`

> Finish recording and compose the video.

Stops all recordings, composes pane videos into a single MP4, mixes in narration audio, generates WebVTT subtitles and JSON metadata. Returns a `SessionResult` with paths to all output files.

### Examples

**Finish and get result**

```ts
const result = await session.finish();
console.log("Video:", result.video);
```

---
