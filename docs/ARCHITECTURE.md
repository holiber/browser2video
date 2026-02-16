# Architecture

This repo is a small monorepo for recording repeatable browser automation "proof videos".

## Packages

- `apps/demo/`
  - Vite + React app used as a stable, controllable target for scenarios.
- `packages/runner/`
  - Core library: `createSession()` API, actor interactions, recording backends, narration, video composition.
- `packages/cli/`
  - `b2v` CLI: runs test files as subprocesses with env-based configuration.
- `packages/mcp/`
  - MCP stdio server exposing `b2v_run` and related tools for AI agents.
- `tests/scenarios/`
  - Standalone `*.test.ts` files using `createSession()` for each scenario.

## Session API

The primary entry point is `createSession()` which returns a `Session` object:

- `session.openPage(opts)` — open a browser page with optional URL and viewport
- `session.openTerminal(opts)` — open an in-browser terminal (xterm.js)
- `session.step(caption, fn)` — track a named step with subtitles
- `session.step(caption, narration, fn)` — step with concurrent TTS narration
- `session.finish()` — stop recording, compose video, mix audio, generate subtitles

## Modes

The `Actor` class wraps Playwright interactions and applies a **delay profile**:

- **human**
  - Smooth cursor motion + cursor overlay
  - Natural pauses around clicks and typing
  - "Breathing" pauses between steps
- **fast**
  - No artificial delays
  - CSS injected on new documents to reduce animations (best-effort)

Delay values are configurable per-session via `SessionOptions.delays`.

## Recording backends

Recording is configured via `SessionOptions.record`:

- `true` (default in human mode)
  - Uses Playwright `recordVideo` context option to capture raw WebM per pane
  - Composes multi-pane video using ffmpeg (`hstack`/`xstack`)
  - Finalizes to `run.mp4` with ffmpeg (`libx264`, `yuv420p`, `+faststart`)
- `false`
  - No video
  - Still writes `captions.vtt` + `run.json` for step timing/proofs

## Narration

When `OPENAI_API_KEY` is set (or `narration.enabled: true`):

- TTS audio is generated via OpenAI TTS API
- Audio clips are cached in `.cache/tts/` (keyed by text + voice + speed + language)
- `narration.language` auto-translates text via OpenAI Chat API before TTS
- `narration.realtime` plays audio through speakers during execution
- Audio events are mixed into the final video via ffmpeg

## Artifacts

Each run writes into one directory:

- `run.mp4` (when recording enabled)
- `captions.vtt`
- `run.json`

## MCP server

`packages/mcp` implements a stdio MCP server using the TypeScript MCP SDK.
It exposes tools for AI agents:

- `b2v_list_scenarios` — list available test files
- `b2v_doctor` — environment diagnostics
- `b2v_run` — run a scenario with narration, voice, language options
