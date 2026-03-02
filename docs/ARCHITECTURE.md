# Architecture

This repo is a small monorepo for recording repeatable browser automation "proof videos".

## Packages

- `packages/browser2video/`
  - Core library: `createSession()` API, actor interactions, recording backends, narration, video composition,
    Zod schemas/operation registry, CLI (`b2v`), MCP server (`b2v-mcp`), and terminal WebSocket bridge.
- `apps/demo/`
  - Vite + React app used as a stable, controllable target for scenarios.
- `apps/studio-player/`
  - Electron + Vite + React app for recording and replaying scenarios. Uses MobX for state management (`src/stores/player-store.ts`).
- `tests/scenarios/`
  - Standalone scenario files (`.ts` / `.js`) using `createSession()` for each scenario.

## Session API

The primary entry point is `createSession()` which returns a `Session` object:

- `session.openPage(opts)` — open a browser page with optional URL and viewport
- `session.createTerminal(cmd?, opts?)` — open an in-browser terminal (xterm.js, high-level API)
- `session.openTerminal(opts)` — low-level terminal creation
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
  - All paths use `CdpScreencastRecorder` — CDP `Page.startScreencast` sends JPEG frames at the compositor's native rate (~30fps). Frames are queued with backpressure handling so the CDP ack loop is never blocked.
  - On **macOS**: real-time encoding uses hardware-accelerated `h264_videotoolbox` (Apple VideoToolbox GPU encoder).
  - On **other platforms**: uses `libx264` software encoder with `ultrafast` preset.
  - Composes multi-pane video using ffmpeg (`hstack`/`xstack`), upsampled to constant 60fps CFR.
  - Output: `run.mp4` (`yuv420p`, `+faststart`).
- `false`
  - No video
  - Still writes `captions.vtt` + `run.json` for step timing/proofs

## Cursor overlay & laser pointer

The cursor overlay is injected via `CURSOR_OVERLAY_SCRIPT` (in `actor.ts`) into every recorded page:

- **Cursor**: single `<div>` + `<svg>` per actor, reused across moves (no DOM churn).
- **Laser trail**: full-viewport `<canvas>` with a single batched path per RAF frame. Points closer than 3px apart are deduplicated. Trail fades over 250ms with a single stroke + `shadowBlur` glow (no double-stroke). Canvas is created on `laserOn` and removed on `laserOff`.
- **Click effects**: CSS-animated ripple ring (removed after 700ms) + hold-dot pulse.

## Narration

TTS narration is resolved via `resolveNarrator()` which picks the best available provider:

1. **Google Cloud TTS** — if `GOOGLE_TTS_API_KEY` is set
2. **OpenAI TTS** — if `OPENAI_API_KEY` is set (uses `tts-1-hd` model with classic voices)
3. **System TTS** — macOS `say`, Windows SAPI, or Linux `espeak-ng`
4. **Piper TTS** — open-source fallback

The provider can be forced via `B2V_TTS_PROVIDER` environment variable.

- Audio clips are cached in `.cache/tts/` (keyed by provider + text + voice + speed + language)
- `narration.language` auto-translates text via OpenAI Chat API before TTS
- `narration.realtime` plays audio through speakers during execution (browser-based `HTMLAudioElement` in Electron, `afplay`/`ffplay` fallback otherwise)
- Audio events are mixed into the final video via ffmpeg

## Artifacts

Each run writes into one directory:

- `run.mp4` (when recording enabled)
- `captions.vtt`
- `run.json`

## MCP server

`packages/browser2video/mcp-server.ts` implements a stdio MCP server using the TypeScript MCP SDK.
It exposes 20+ tools for AI agents in two categories:

- **Batch tools** — run pre-written scenario files as subprocesses (`b2v_run`, `b2v_list_scenarios`, `b2v_doctor`).
- **Interactive tools** — real-time browser/terminal control with human-like interactions, recording, narration, and scenario export (`b2v_start`, `b2v_open_page`, `b2v_click`, `b2v_type`, `b2v_step`, `b2v_finish`, etc.).

The MCP server is designed to work alongside Playwright MCP. Both connect to the same browser via CDP: b2v handles interactions and recording, Playwright MCP handles page inspection (snapshots, screenshots, evaluate).

For the complete tool reference and agent workflow, see [`SKILL.md`](../SKILL.md).
