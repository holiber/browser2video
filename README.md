# Browser2Video

A dual-mode Puppeteer scenario runner that records smooth browser automation videos with cursor overlay, click effects, and WebVTT subtitles — built on top of a Vite + React demo app.

## Quick Start

```bash
pnpm install
pnpm e2e:human   # record a realistic human-paced video
pnpm e2e:fast    # run the same scenario as fast as possible
```

Artifacts are saved to `artifacts/<timestamp>/`:
- `run.mp4` — recorded video (60 fps)
- `captions.vtt` — WebVTT subtitles aligned to video timeline
- `run.json` — structured step timing metadata

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the Vite dev server for the demo app |
| `pnpm build` | Production build |
| `pnpm e2e:human` | Run scenario in **human** mode (smooth cursor, typing delays, click effects) |
| `pnpm e2e:fast` | Run scenario in **fast** mode (no artificial delays, stability waits only) |

### CLI Options

```bash
tsx e2e/run.ts --mode human          # default: headed
tsx e2e/run.ts --mode fast           # default: headless
tsx e2e/run.ts --mode human --headless  # force headless
tsx e2e/run.ts --mode fast --headed     # force headed (for debugging)
```

## Architecture

```
src/                    React demo app (Vite + Tailwind + shadcn/ui + Framer Motion)
├── App.tsx             Router, sidebar layout, auth guard
├── pages/login.tsx     Login page with validation
├── pages/app.tsx       Dashboard with form, scroll, drag & drop, drawing canvas
├── components/ui/      shadcn/ui components (auto-generated)
└── lib/utils.ts        Tailwind merge utility

e2e/                    Puppeteer scenario runner
├── run.ts              CLI entry — starts Vite, launches browser, runs scenario
├── scenario.ts         Single scenario shared by both modes
└── runner.ts           Actor (mode-aware), video recorder, cursor overlay, subtitles
```

### Two Modes, Same Scenario

The `Actor` class wraps Puppeteer page methods and adapts behavior based on the mode:

- **Human mode**: smooth Bezier mouse paths, per-character typing with jitter, breathing pauses between steps, custom cursor overlay with click ripple effects
- **Fast mode**: direct Puppeteer calls, no artificial delays, robust waits for stability only

### Video Recording

Uses Puppeteer's built-in `page.screencast()` API (CDP-based) at 60 fps, recorded as WebM then converted to MP4 via ffmpeg. The `@ffmpeg-installer/ffmpeg` package bundles ffmpeg — no system installation needed.

### Cursor & Click Effects

An HTML overlay is injected into every page with:
- A custom SVG cursor that follows mouse coordinates
- CSS ripple animations at click locations

Both are captured by the CDP screencast since they're part of the rendered page.

### Subtitles

Each `step("caption", fn)` call records start/end timestamps relative to the video start, then exports to WebVTT format.

## Demo App

The demo app provides interactive UI for realistic E2E automation:

| Route | Content |
|-------|---------|
| `/login` | Email/password login with client-side validation |
| `/app` | Dashboard with sidebar, form section, scrollable list, drag-and-drop reorder, drawing canvas |

All interactive elements have `data-testid` attributes for reliable targeting.

## Scenario Coverage

The included scenario exercises:
1. Login (type credentials, submit)
2. Form filling (text inputs, selects, checkboxes, switch)
3. Page + inner container scrolling
4. Drag-and-drop reorder
5. Drawing (rectangle, freehand stroke, circle)

## CI

Works on macOS and Linux. For CI environments:

```yaml
- run: pnpm install
- run: pnpm e2e:fast
```

The runner starts its own Vite dev server on a random port — no pre-started server needed. Chrome and ffmpeg are bundled via npm packages.

## Tech Stack

- **Frontend**: React 19, Vite 6, Tailwind CSS 4, shadcn/ui, Framer Motion
- **Runner**: Puppeteer 24, tsx
- **Video**: CDP screencast + ffmpeg (via `@ffmpeg-installer/ffmpeg`)
