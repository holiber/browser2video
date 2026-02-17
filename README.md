# Browser2Video

Record smooth browser automation videos (MP4 @ 60fps) with subtitles, narration, and step metadata.

- **Modes**
  - **human**: cursor overlay + click effects + natural pacing
  - **fast**: no artificial delays, animations reduced where possible
- **Recording**
  - **screencast**: per-page CDP capture
  - **screen**: OS/Xvfb capture (best for multi-window collab)
  - **none**: run without video (still produces `captions.vtt` + `run.json`)
- **Narration**
  - OpenAI TTS with auto-translation to any language
  - Realtime audio playback during scenario execution
  - Cached translations and audio in `.cache/tts/`

## Quick start

```bash
pnpm install
cp .env.example .env  # optional: enables narration if you add OPENAI_API_KEY
node tests/scenarios/basic-ui.test.ts
```

## Install / npx (published package)

Requirements:

- **Node.js** >= 22
- **ffmpeg** in `PATH` (for video composition / audio mixing)

Run commands from your scenario project directory (your current working directory is used to resolve files):

```bash
npx -y b2v doctor
npx -y b2v run tests/scenarios/basic-ui.test.ts --mode human --headed
```

## Video examples

All videos are auto-generated on every push to `main`. Watch them at the [video gallery](https://holiber.github.io/browser2video/videos/).

### Single-actor UI demo

A single browser page with form inputs, scrolling, drag-and-drop, canvas drawing, and React Flow nodes. Shows the basics of `createSession` + `Actor` interactions.

[Scenario source](tests/scenarios/basic-ui.test.ts)

[![Basic UI demo](https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.mp4)

### Narrated Kanban board

AI-narrated walkthrough of a Kanban board lifecycle. The narrator explains each column while the cursor highlights it. Uses `session.step(caption, narration, fn)` for concurrent speech and actions.

[Scenario source](tests/scenarios/kanban.test.ts)

[![Kanban scenario](https://github.com/holiber/browser2video/releases/download/examples-v3/kanban-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/kanban-demo.mp4)

### Multi-window collaboration

Records **two browser windows** side-by-side sharing a real-time synced todo list via Automerge. Demonstrates multi-pane video composition with `session.openPage()` called twice.

[Scenario source](tests/scenarios/collab.test.ts)

[![Collab scenario](https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.mp4)

### Terminal UI (mc, htop, vim)

Interactive TUI apps (Midnight Commander, htop, vim) running in real PTY terminals via `session.createTerminal()`. Each terminal is its own pane with a scoped `TerminalActor`.

[Scenario source](tests/scenarios/tui-terminals.test.ts)

[![TUI terminals](https://github.com/holiber/browser2video/releases/download/examples-v3/tui-terminals-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/tui-terminals-demo.mp4)

### Console logging

In-page console panel showing live log output during CRUD operations on a notes app.

[Scenario source](tests/scenarios/console-logs.test.ts)

[![Console logs](https://github.com/holiber/browser2video/releases/download/examples-v3/console-logs-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/console-logs-demo.mp4)

**[Documentation](https://holiber.github.io/browser2video/)** | **[Auto-generated scenario videos](https://holiber.github.io/browser2video/videos/)**

## CLI

```bash
pnpm b2v run tests/scenarios/basic-ui.test.ts --mode human --headed
pnpm b2v run tests/scenarios/collab.test.ts   --mode human --headed
pnpm b2v run tests/scenarios/kanban.test.ts   --narrate --voice onyx --realtime-audio
```

### Narration options

```bash
pnpm b2v run tests/scenarios/kanban.test.ts \
  --narrate \
  --voice onyx \
  --narrate-speed 1.0 \
  --realtime-audio
```

Narration language can be set via environment variable:

```bash
B2V_NARRATION_LANGUAGE=ru node tests/scenarios/kanban.test.ts
```

## MCP server (for AI agents)

The MCP server lets AI agents (Cursor, Claude, etc.) interactively control a browser and terminals with human-like behavior, recording, narration, and scenario export. It works alongside Playwright MCP, which connects to the same browser via CDP for page inspection.

> For full tool parameters, schemas, and agent workflow details, see [`SKILL.md`](SKILL.md).

### Setup

Add to your `.cursor/mcp.json` (or equivalent MCP config):

```json
{
  "mcpServers": {
    "b2v": {
      "command": "npx",
      "args": ["-y", "b2v-mcp"],
      "env": { "B2V_CDP_PORT": "9222" }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

**b2v** handles human-like interactions, recording, terminals, and narration. **Playwright MCP** connects to the same browser via CDP for page inspection (snapshots, screenshots, evaluate). Both servers share the same browser instance through the CDP port.

### Two modes of use

**Interactive** -- the agent controls the browser in real-time, step by step. Good for exploratory workflows, live demos, and building new scenarios on the fly.

**Batch** -- run a pre-written `.ts` scenario file as a subprocess. Good for repeatable recordings and CI.

### Interactive workflow

```
1. b2v_start          -- launch browser with recording
2. b2v_open_page      -- open a URL (returns pageId)
3. browser_snapshot    -- (Playwright MCP) inspect the page to find selectors
4. b2v_click / b2v_type / b2v_drag  -- human-like interactions
5. b2v_step            -- mark recording step with subtitle and optional narration
6. b2v_save_scenario   -- export steps as a replayable .ts file
7. b2v_finish          -- compose final video, returns artifact paths
```

### Interactive tools

| | |
|---|---|
| **Session** | `b2v_start`, `b2v_finish`, `b2v_status` |
| **Pages / terminals** | `b2v_open_page`, `b2v_open_terminal`, `b2v_terminal_send`, `b2v_terminal_read` |
| **Actor interactions** | `b2v_click`, `b2v_click_at`, `b2v_type`, `b2v_press_key`, `b2v_hover`, `b2v_drag`, `b2v_scroll`, `b2v_select_text` |
| **Recording / narration** | `b2v_step`, `b2v_narrate` |
| **Scenario builder** | `b2v_add_step`, `b2v_save_scenario` |

### Batch tools

| Tool | Description |
|------|-------------|
| `b2v_run` | Run a pre-written scenario file with recording and narration |
| `b2v_list_scenarios` | List available scenario files |
| `b2v_doctor` | Print environment diagnostics |

### Troubleshooting

- **`ffmpeg` not found** -- install ffmpeg and make sure it is in your `PATH`. Run `b2v_doctor` to verify.
- **CDP port conflict** -- if port 9222 is busy, set a different port via `B2V_CDP_PORT` env var in both `b2v` and `playwright` server configs.
- **Session already running** -- call `b2v_finish` (or restart the MCP server) before starting a new session.

## Docker (Linux screen recording)

```bash
pnpm e2e:collab:auto          # Native-first (Docker fallback)
pnpm e2e:collab:docker        # Docker only
B2V_DOCKER_PLATFORM=linux/amd64 pnpm e2e:collab:docker  # Specific platform
```

## CI

GitHub Actions runs two jobs on every PR and push to `main`:
- **test-fast** -- all scenarios headless, no recording
- **test-human** -- all scenarios in human mode with screencast recording

After merge to `main`, a deploy workflow records all scenarios and publishes videos to the [GH Pages video gallery](https://holiber.github.io/browser2video/videos/).

## Repo layout

```
apps/demo/               Vite + React demo app (target under test)
packages/browser2video/  Core library, CLI, MCP server, schemas, terminal bridge
tests/scenarios/         Scenario test files
```

## Architecture

See `docs/ARCHITECTURE.md`.

---

## API Reference

### `createSession(opts?): Promise<Session>`

Create a new recording session. This is the main entry point.

```ts
import { createSession } from "browser2video";

const session = await createSession({
  mode: "human",           // "human" | "fast"
  record: true,            // enable video recording
  narration: {
    enabled: true,
    voice: "onyx",         // OpenAI TTS voice
    language: "ru",        // auto-translate narration
    realtime: true,        // play audio through speakers
  },
});
```

**Options (`SessionOptions`):**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"human"` \| `"fast"` | auto | Execution mode |
| `record` | `boolean` | auto | Enable video recording |
| `outputDir` | `string` | auto | Artifacts output directory |
| `headed` | `boolean` | auto | Show browser window |
| `layout` | `"auto"` \| `"row"` \| `"grid"` | `"row"` | Multi-pane layout |
| `delays` | `Partial<ActorDelays>` | - | Override actor timing |
| `ffmpegPath` | `string` | `"ffmpeg"` | Path to ffmpeg binary |
| `narration` | `NarrationOptions` | - | TTS narration config |

### `session.openPage(opts?): Promise<{ page, actor }>`

Open a new browser page with optional URL and viewport.

```ts
const { page, actor } = await session.openPage({
  url: "http://localhost:5173/kanban",
  viewport: { width: 1280, height: 720 },
});
```

### `session.createTerminal(cmd?, opts?): Promise<TerminalActor>`

Create a terminal pane running a command (or an interactive shell). Auto-starts a PTY server on first call, cleans up on `finish()`.

```ts
const mc = await session.createTerminal("mc");       // run mc
const shell = await session.createTerminal();         // interactive shell

await mc.click(0.25, 0.25);                          // click in mc
await shell.typeAndEnter("ls -la");                   // run a command
await shell.waitForPrompt();                          // wait until idle
const output = await shell.readNew();                 // read new output
```

### `session.step(caption, fn)` / `session.step(caption, narration, fn)`

Track a named step with optional concurrent narration.

```ts
const { step } = session;

// Simple step
await step("Click login", async () => {
  await actor.click('[data-testid="login-btn"]');
});

// Step with narration (speech and action run concurrently)
await step("Explain dashboard",
  "This is the main dashboard where you can see all your projects.",
  async () => {
    await actor.circleAround('[data-testid="dashboard"]');
  },
);
```

### `session.addCleanup(fn)`

Register a cleanup function that runs automatically when `finish()` is called. No more try/finally wrappers.

```ts
const server = await startServer({ type: "vite", root: "apps/demo" });
session.addCleanup(() => server.stop());
```

### `session.finish(): Promise<SessionResult>`

Stop recording, compose video, mix narration audio, generate subtitles, and run cleanup functions.

```ts
const result = await session.finish();
// result.video     — path to MP4
// result.subtitles — path to WebVTT
// result.metadata  — path to JSON
// result.durationMs
```

### Actor methods

The `Actor` provides human-like browser interactions:

| Method | Description |
|--------|-------------|
| `actor.click(selector)` | Click an element with cursor movement and click effect |
| `actor.clickLocator(locator)` | Click a Playwright Locator (moves cursor first) |
| `actor.type(selector, text)` | Type text — auto-detects xterm.js terminals vs DOM inputs |
| `actor.typeAndEnter(selector, text)` | Type text and press Enter |
| `actor.pressKey(key)` | Press a keyboard key (e.g. `"Tab"`, `"ArrowDown"`, `"F3"`) |
| `actor.clickAt(x, y)` | Click at specific page coordinates (for canvas/terminal) |
| `actor.scroll(selector, deltaY)` | Scroll within an element or the page |
| `actor.drag(from, to)` | Drag from one element to another |
| `actor.draw(canvas, points)` | Draw on a canvas (normalized 0-1 coordinates) |
| `actor.circleAround(selector)` | Trace a spiral path around an element (for highlighting) |
| `actor.hover(selector)` | Move the cursor smoothly over an element |
| `actor.selectText(from, to?)` | Select text by dragging between elements |
| `actor.moveCursorTo(x, y)` | Move the cursor overlay to coordinates |
| `actor.goto(url)` | Navigate to a URL (auto-injects cursor) |
| `actor.waitFor(selector)` | Wait for an element to appear |
### TerminalActor methods

`session.createTerminal(cmd?, opts?)` returns a `TerminalActor` scoped to its terminal pane:

| Method | Description |
|--------|-------------|
| `term.click(relX, relY)` | Click at relative position within the terminal |
| `term.type(text)` | Type text into the terminal |
| `term.typeAndEnter(text)` | Type text and press Enter |
| `term.waitForText(includes)` | Wait for text to appear in terminal output |
| `term.waitForPrompt()` | Wait for a shell prompt (`$` or `#`) |
| `term.isBusy()` | Check if terminal is running a command |
| `term.waitUntilIdle()` | Wait until terminal is idle (prompt visible) |
| `term.read()` | Read all visible terminal text |
| `term.readNew()` | Read only new lines since last `read()`/`readNew()` |

### `startServer(config): Promise<ManagedServer>`

Start a dev server (Vite, Next.js, static, or custom command).

```ts
import { startServer } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });
console.log(server.baseURL); // "http://localhost:5173"
```

### `NarrationOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable narration |
| `voice` | `string` | `"ash"` | OpenAI TTS voice |
| `speed` | `number` | `1.0` | Speech speed (0.25-4.0) |
| `model` | `string` | `"tts-1"` | OpenAI TTS model |
| `apiKey` | `string` | env | OpenAI API key |
| `cacheDir` | `string` | `.cache/tts` | Cache directory |
| `realtime` | `boolean` | `false` | Play through speakers |
| `language` | `string` | - | Auto-translate to language code |

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for narration (auto-enables in human mode when present) |
| `B2V_MODE` | Override execution mode (`human` / `fast`) |
| `B2V_RECORD` | Override recording (`true` / `false`) |
| `B2V_VOICE` | Override TTS voice |
| `B2V_NARRATION_SPEED` | Override narration speed |
| `B2V_NARRATION_LANGUAGE` | Override narration language (e.g. `ru`) |
| `B2V_REALTIME_AUDIO` | Enable realtime audio (`true`) |

### Playwright re-exports

For advanced usage, Playwright types and launchers are re-exported:

```ts
import { chromium, type Page, type Locator } from "browser2video";
```
