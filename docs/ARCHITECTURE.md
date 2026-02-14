# Architecture

This repo is a small monorepo for recording repeatable browser automation “proof videos”.

## Packages

- `apps/demo/`
  - Vite + React app used as a stable, controllable target for scenarios.
- `packages/runner/`
  - Core library: modes (`human` / `fast`), actor interactions, recording backends, artifacts.
- `packages/cli/`
  - `b2v` CLI: starts Vite when needed and runs scenarios with the runner.
- `packages/mcp/`
  - MCP stdio server exposing `b2v_run` and related tools for agents.
- `tests/scenarios/`
  - Scenario functions consumed by the CLI and MCP server.

## Modes

The `Actor` class wraps Puppeteer interactions and applies a **delay profile**:

- **human**
  - Smooth cursor motion + cursor overlay
  - Natural pauses around clicks and typing
  - “Breathing” pauses between steps
- **fast**
  - No artificial delays
  - CSS injected on new documents to reduce animations (best-effort)

Delay values are configurable per-run via `RunnerOptions.delays` (deterministic by default).

## Recording backends

Recording is selected via `recordMode`:

- `none`
  - No video
  - Still writes `captions.vtt` + `run.json` for step timing/proofs
- `screencast`
  - Uses Puppeteer CDP screencast (`page.screencast`) to a raw WebM
  - Finalizes to `run.mp4` with ffmpeg (`libx264`, `yuv420p`, `+faststart`)
- `screen` (collab)
  - Uses ffmpeg screen grab for a single clock (reduces drift)
  - macOS: `avfoundation`
  - Linux: `x11grab` (typically under Xvfb in CI/Docker)
  - Windows: `gdigrab` (best-effort)

## Artifacts

Each run writes into one directory (passed as `artifactDir` / `--artifacts`):

- `run.mp4` (when recording enabled)
- `captions.vtt`
- `run.json`
- Collab-only extras: `<actorId>-captions.vtt` (per actor), `reviewer.log`, `sync-data/`

## Window layout (best-effort)

For headed runs, the runner attempts to tile windows using CDP:

- `packages/runner/src/window-layout.ts`
  - `trySetWindowRect(...)`
  - `tryTileHorizontally(...)`

If CDP window management is unavailable, layout operations become no-ops.

## MCP server

`packages/mcp` implements a stdio MCP server using the TypeScript MCP SDK.
It exposes a small tool surface intended for agents:

- `b2v_list_scenarios`
- `b2v_doctor`
- `b2v_run`

