# Browser2Video

Record smooth browser automation videos (MP4 @ 60fps) with subtitles and step metadata.

- **Modes**
  - **human**: cursor overlay + click effects + natural pacing
  - **fast**: no artificial delays, animations reduced where possible
- **Recording**
  - **screencast**: per-page CDP capture → `run.mp4`
  - **screen**: OS/Xvfb capture (best for multi-window collab)
  - **none**: run without video (still produces `captions.vtt` + `run.json`)

## Quick start

```bash
pnpm install
pnpm b2v list-scenarios
pnpm b2v run --scenario basic-ui --mode human --record screencast --headed
```

## Video example

Collab scenario demo (**human mode**, screen recording; includes cursor + reviewer terminal):

[![Collab scenario demo](https://github.com/holiber/browser2video/releases/download/examples-v2/collab-demo.gif)](https://github.com/holiber/browser2video/releases/download/examples-v2/collab-demo.mp4)

Docs site: `https://holiber.github.io/browser2video/`

Artifacts are saved to `artifacts/<scenario>-<timestamp>/`:
- `run.mp4` (when recording enabled)
- `captions.vtt`
- `run.json`

## CLI

```bash
pnpm b2v run --scenario basic-ui --mode human --record screencast --headed
pnpm b2v run --scenario basic-ui --mode fast  --record screencast --headless
pnpm b2v run --scenario collab   --mode human --record screen     --headed --display-size 2560x720
pnpm b2v run --scenario github   --mode human --record screencast --headed
```

## Docker (Linux screen recording)

Native-first (Docker fallback):

```bash
pnpm e2e:collab:auto
```

Docker only:

```bash
pnpm e2e:collab:docker
```

Optional: build/run a specific platform (e.g. `linux/amd64` on Apple Silicon):

```bash
B2V_DOCKER_PLATFORM=linux/amd64 pnpm e2e:collab:docker
```

## CI

GitHub Actions runs a \(3 scenarios × 2 modes\) matrix on Ubuntu and uploads artifacts:
- `.github/workflows/ci.yml`

## MCP server (for agents)

Build and run the stdio server:

```bash
pnpm -C packages/mcp build
node packages/mcp/dist/server.js
```

Tools:
- `b2v_list_scenarios`
- `b2v_doctor`
- `b2v_run`

## Repo layout

```
apps/demo/            Vite + React demo app (target under test)
packages/runner/      Runner library (modes, recording backends, window layout)
packages/cli/         `b2v` CLI
packages/mcp/         MCP server (stdio)
tests/scenarios/      Scenario definitions (basic-ui, collab, github)
```

## Architecture

See `docs/ARCHITECTURE.md`.
