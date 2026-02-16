---
title: "Tools (CLI / MCP) API"
sidebar_position: 5
---

# Tools (CLI / MCP) API

## `b2v_run`

**MCP** · **CLI**

> Run a scenario with video recording.

Execute a *.test.ts scenario file as a subprocess with video recording and optional TTS narration. Supports auto-translation of narration to any language.

### Parameters

- `scenarioFile` (`string`, **required**) — Path to a *.test.ts scenario file (relative to repo root or absolute).
- `mode` (`"human" | "fast"`, optional) — Execution speed mode.
- `voice` (`string`, optional) — OpenAI TTS voice: alloy | ash | coral | echo | fable | nova | onyx | sage | shimmer.
- `language` (`string`, optional) — Auto-translate narration to this language (e.g. 'ru', 'es', 'de', 'fr').
- `realtimeAudio` (`boolean`, optional) — Play narration through speakers in realtime.
- `narrationSpeed` (`number`, optional) — Narration speed 0.25–4.0.

### Examples

**Run basic-ui scenario**

```ts
b2v run tests/scenarios/basic-ui.test.ts
```

**Run with Russian narration**

```ts
b2v run tests/scenarios/kanban.test.ts --language ru --voice ash
```

---

## `b2v_list_scenarios`

**MCP** · **CLI**

> List available scenario files.

List *.test.ts scenario files in the scenarios directory.

### Parameters

- `dir` (`string`, optional) — Directory to scan (default: tests/scenarios).

---

## `b2v_doctor`

**MCP** · **CLI**

> Print environment diagnostics.

Check the runtime environment: Node.js version, ffmpeg availability, and platform-specific notes.

---
