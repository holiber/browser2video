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
npx tsx tests/scenarios/basic-ui.test.ts
```

## Video examples

### Kanban board with narration

A narrated walkthrough of a Kanban board task lifecycle. The narrator explains each column while the cursor highlights it.

[![Kanban scenario](https://github.com/holiber/browser2video/releases/download/examples-v3/kanban-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/kanban-demo.mp4)

### Collaborative todo list

Two browser windows sharing a real-time synced todo list, with a terminal reviewer approving items.

[![Collab scenario](https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/collab-demo.mp4)

### Basic UI interactions

Scrolling, drag-and-drop, canvas drawing, form inputs, and React Flow nodes.

[![Basic UI demo](https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/basic-ui-demo.mp4)

### GitHub browsing

Navigating a public GitHub repo, clicking through folders and files.

[![GitHub scenario](https://github.com/holiber/browser2video/releases/download/examples-v3/github-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/github-demo.mp4)

### Console logging CRUD

In-page console panel showing live log output during form interactions.

[![Console logs](https://github.com/holiber/browser2video/releases/download/examples-v3/console-logs-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/console-logs-demo.mp4)

### Terminal UI

Interactive shell terminals running inside the browser.

[![TUI terminals](https://github.com/holiber/browser2video/releases/download/examples-v3/tui-terminals-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v3/tui-terminals-demo.mp4)

**[Documentation](https://holiber.github.io/browser2video/)** | **[Auto-generated scenario videos](https://holiber.github.io/browser2video/videos/)**

## CLI

```bash
pnpm b2v run tests/scenarios/basic-ui.test.ts --mode human --record screencast --headed
pnpm b2v run tests/scenarios/collab.test.ts   --mode human --record screen --headed --display-size 2560x720
pnpm b2v run tests/scenarios/kanban.test.ts   --narrate --voice onyx --realtime-audio
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
B2V_NARRATION_LANGUAGE=ru npx tsx tests/scenarios/kanban.test.ts
```

## MCP server (for AI agents)

The MCP server lets AI agents (Cursor, Claude, etc.) run scenarios programmatically.

### Setup

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "browser2video": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/server.ts"],
      "env": {}
    }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `b2v_list_scenarios` | List available `*.test.ts` and `*.scenario.ts` files |
| `b2v_doctor` | Print environment diagnostics |
| `b2v_run` | Run a scenario with recording, narration, and language options |

**`b2v_run` parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scenarioFile` | string | required | Path to test file |
| `mode` | `"human"` \| `"fast"` | `"human"` | Execution speed |
| `record` | `"screencast"` \| `"screen"` \| `"none"` | `"screencast"` | Recording mode |
| `voice` | string | `"nova"` | TTS voice (alloy, echo, fable, onyx, nova, shimmer) |
| `language` | string | - | Auto-translate narration (e.g. `"ru"`, `"es"`, `"de"`) |
| `realtimeAudio` | boolean | `false` | Play audio through speakers during execution |
| `narrationSpeed` | number | `1.0` | Speech speed (0.25-4.0) |

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
apps/demo/            Vite + React demo app (target under test)
packages/runner/      Core library (@browser2video/runner)
packages/cli/         CLI tool (b2v)
packages/mcp/         MCP server (stdio, for AI agents)
tests/scenarios/      Scenario test files
```

## Architecture

See `docs/ARCHITECTURE.md`.

---

## API Reference

### `createSession(opts?): Promise<Session>`

Create a new recording session. This is the main entry point.

```ts
import { createSession } from "@browser2video/runner";

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

### `session.openTerminal(opts?): Promise<{ terminal, page }>`

Open an in-browser terminal (xterm.js) running a shell command.

```ts
const { terminal } = await session.openTerminal({
  command: "node scripts/approve.js",
  viewport: { width: 500, height: 400 },
});
await terminal.send("approve 1");
```

In human mode, `terminal.send()` simulates character-by-character typing.

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

### `session.finish(): Promise<SessionResult>`

Stop recording, compose video, mix narration audio, and generate subtitles.

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
| `actor.type(selector, text)` | Type text with per-character delays |
| `actor.scroll(selector, deltaY)` | Scroll within an element or the page |
| `actor.drag(from, to)` | Drag from one element to another |
| `actor.draw(canvas, points)` | Draw on a canvas (normalized 0-1 coordinates) |
| `actor.circleAround(selector)` | Trace a spiral path around an element (for highlighting) |
| `actor.moveCursorTo(x, y)` | Move the cursor overlay to coordinates |
| `actor.goto(url)` | Navigate to a URL (auto-injects cursor) |
| `actor.waitFor(selector)` | Wait for an element to appear |
| `actor.breathe()` | Breathing pause between steps (human mode only) |

### `startServer(config): Promise<ManagedServer>`

Start a dev server (Vite, Next.js, static, or custom command).

```ts
import { startServer } from "@browser2video/runner";

const server = await startServer({ type: "vite", root: "apps/demo" });
console.log(server.baseURL); // "http://localhost:5173"
```

### `NarrationOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable narration |
| `voice` | `string` | `"nova"` | OpenAI TTS voice |
| `speed` | `number` | `1.0` | Speech speed (0.25-4.0) |
| `model` | `string` | `"tts-1"` | OpenAI TTS model |
| `apiKey` | `string` | env | OpenAI API key |
| `cacheDir` | `string` | `.cache/tts` | Cache directory |
| `realtime` | `boolean` | `false` | Play through speakers |
| `language` | `string` | - | Auto-translate to language code |

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for narration (auto-enables narration when present) |
| `B2V_MODE` | Override execution mode (`human` / `fast`) |
| `B2V_RECORD` | Override recording (`true` / `false`) |
| `B2V_VOICE` | Override TTS voice |
| `B2V_NARRATION_SPEED` | Override narration speed |
| `B2V_NARRATION_LANGUAGE` | Override narration language (e.g. `ru`) |
| `B2V_REALTIME_AUDIO` | Enable realtime audio (`true`) |

### Playwright re-exports

For advanced usage, Playwright types and launchers are re-exported:

```ts
import { chromium, type Page, type Locator } from "@browser2video/runner";
```
