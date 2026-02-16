---
name: browser2video
description: Record browser automation scenarios as narrated videos with AI narration. Run test scenarios, list available tests, and check environment diagnostics.
metadata: { "openclaw": { "requires": { "bins": ["node", "ffmpeg"], "env": ["OPENAI_API_KEY"] }, "homepage": "https://github.com/holiber/browser2video" } }
---

# Browser2Video

Record browser automation scenarios as production-quality narrated videos.

## Tools

### b2v_run

Run a `*.test.ts` / `*.scenario.ts` scenario file with optional TTS narration.
Video recording is controlled by the scenario code (via `createSession({ record: ... })`) and/or `B2V_RECORD`.

**Parameters:**

- `scenarioFile` (string, required) — Path to a `*.test.ts` / `*.scenario.ts` file (relative to current working directory or absolute).
- `mode` (string, optional) — Execution speed mode: `"human"` (default, with realistic delays) or `"fast"` (instant).
- `voice` (string, optional) — OpenAI TTS voice: alloy, ash (default), coral, echo, fable, nova, onyx, sage, shimmer.
- `language` (string, optional) — Auto-translate narration to this language (e.g. `"ru"`, `"es"`, `"de"`, `"fr"`).
- `realtimeAudio` (boolean, optional) — Play narration through speakers in realtime.
- `narrationSpeed` (number, optional) — Narration speed 0.25–4.0 (default: 1.0).

**Returns:** `artifactsDir`, `videoPath`, `subtitlesPath`, `metadataPath`, `durationMs`, `stdout`.

**Example:**

```bash
npx -y browser2video run tests/scenarios/basic-ui.test.ts
npx -y browser2video run tests/scenarios/kanban.test.ts --language ru --voice ash
```

### b2v_list_scenarios

List available `*.test.ts` scenario files in the scenarios directory.

**Parameters:**

- `dir` (string, optional) — Directory to scan (default: `tests/scenarios`).

**Returns:** `scenarios` — array of scenario file names.

### b2v_doctor

Print environment diagnostics: Node.js version, ffmpeg availability, and platform-specific notes.

**Returns:** `platform`, `node`, `ffmpeg`.

## Scenario authoring

Scenarios are TypeScript files that use `browser2video`:

```ts
import { createSession, startServer } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });
const session = await createSession();
const { step } = session;
const { page, actor } = await session.openPage({ url: server.baseURL });

await step("Fill the form", "Now we type the user name", async () => {
  await actor.type("#name", "Alice");
  await actor.click("button.submit");
});

const result = await session.finish();
await server.stop();
```

### Actor API

The `actor` wraps Playwright's `Page` with human-like delays in `"human"` mode (cursor movement via WindMouse, click effects, typing delays, breathing pauses). In `"fast"` mode all delays are zero.

| Method | Description |
|---|---|
| `actor.goto(url)` | Navigate to a URL |
| `actor.click(selector)` | Move cursor to element, show click effect, click |
| `actor.clickAt(x, y)` | Move cursor to coordinates, show click effect, click (for canvas/terminals) |
| `actor.type(selector, text)` | Click element then type text character-by-character |
| `actor.pressKey(key)` | Press a keyboard key with a breathing pause |
| `actor.select(selector, value)` | Open a `<select>` and pick an option |
| `actor.hover(selector)` | Move cursor to element |
| `actor.moveCursorTo(x, y)` | Smooth cursor move to coordinates (no click) |
| `actor.drag(from, to)` | Drag from one selector/coords to another |
| `actor.waitFor(selector)` | Wait for an element to appear |
| `actor.breathe()` | Pause between major actions (human mode only) |

All methods include automatic human-like delays — no manual `sleep()` calls needed between steps.

## Requirements

- **Node.js** >= 22 (with native TypeScript support)
- **ffmpeg** in PATH (for video composition and audio mixing)
- **OPENAI_API_KEY** env var (for TTS narration; optional if narration disabled)
