---
name: browser2video
description: Record browser automation scenarios as narrated videos with AI narration. Run test scenarios, list available tests, and check environment diagnostics.
metadata: { "openclaw": { "requires": { "bins": ["node", "ffmpeg"], "env": ["OPENAI_API_KEY"] }, "homepage": "https://github.com/holiber/browser2video" } }
---

# Browser2Video

Record browser automation scenarios as production-quality narrated videos.

## Tools

### b2v_run

Run a `*.test.ts` scenario file with video recording and optional TTS narration.

**Parameters:**

- `scenarioFile` (string, required) — Path to a `*.test.ts` scenario file (relative to repo root or absolute).
- `mode` (string, optional) — Execution speed mode: `"human"` (default, with realistic delays) or `"fast"` (instant).
- `voice` (string, optional) — OpenAI TTS voice: alloy, ash (default), coral, echo, fable, nova, onyx, sage, shimmer.
- `language` (string, optional) — Auto-translate narration to this language (e.g. `"ru"`, `"es"`, `"de"`, `"fr"`).
- `realtimeAudio` (boolean, optional) — Play narration through speakers in realtime.
- `narrationSpeed` (number, optional) — Narration speed 0.25–4.0 (default: 1.0).

**Returns:** `artifactsDir`, `videoPath`, `subtitlesPath`, `metadataPath`, `durationMs`, `stdout`.

**Example:**

```bash
b2v run tests/scenarios/basic-ui.test.ts
b2v run tests/scenarios/kanban.test.ts --language ru --voice cedar
```

### b2v_list_scenarios

List available `*.test.ts` scenario files in the scenarios directory.

**Parameters:**

- `dir` (string, optional) — Directory to scan (default: `tests/scenarios`).

**Returns:** `scenarios` — array of scenario file names.

### b2v_doctor

Print environment diagnostics: Node.js version, ffmpeg availability, and platform-specific notes.

**Returns:** `platform`, `node`.

## Scenario authoring

Scenarios are TypeScript files that use `@browser2video/runner`:

```ts
import { createSession, startServer } from "@browser2video/runner";

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

## Requirements

- **Node.js** >= 22 (with native TypeScript support)
- **ffmpeg** in PATH (for video composition and audio mixing)
- **OPENAI_API_KEY** env var (for TTS narration; optional if narration disabled)
