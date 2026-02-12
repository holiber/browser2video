## 📌 Task: Dual-Mode Puppeteer Scenario Runner + Vite Demo App (with Video + Cursor + Subtitles)

### Goal

Build a **single repo** that contains:

1. A **Vite + React** demo web app (UI built with **Tailwind + shadcn/ui + Framer Motion**) that exposes enough interactive elements for realistic E2E automation.
2. A **Puppeteer-based scenario test runner** that can execute the **same scenario** in **two modes**:

   * **Human mode**: simulates a real user (mouse movement, cursor visible, click effects, realistic typing with small pauses, scrolling, drag interactions), and **records a smooth video (no dropped frames)** + **writes subtitles** (step captions).
   * **Fast mode**: runs the same scenario **as fast as possible**, avoiding artificial delays except where needed for stability (e.g., waiting for navigation/animations to settle, element visibility, etc.).

Minimize files. Prefer “few files, clear structure” over many small modules.

---

## Constraints & Tech Choices

* **Frontend**: Vite + React (TypeScript preferred), Tailwind, shadcn/ui, Framer Motion.
* **Runner**: Node.js script using **Puppeteer**.
* **Video**: must be **smooth (no frame skips)**. Prefer a **frame-by-frame** approach via Chrome DevTools Protocol.
* **Cursor visibility**: must be visible in the recorded video, including **click effects** (e.g., ripple/highlight ring).
* **Subtitles**: generate a **.vtt** (or .srt) file with step captions aligned to the video timeline (we will add voiceover later).

---

## Deliverables

1. **Demo app** with routes and UI:

   * `/login` – login screen
   * `/app` – authenticated area with interactive UI to test
2. **Scenario runner** that:

   * starts the Vite dev server (or assumes it’s running; either is fine but document it)
   * runs scenario in `human` and `fast` modes
   * outputs:

     * `artifacts/<timestamp>/run.mp4`
     * `artifacts/<timestamp>/captions.vtt` (or `.srt`)
     * optional `run.json` with structured step timing metadata
3. A **single scenario** that covers:

   * login (type username/password, submit)
   * fill a form containing:

     * text inputs (with typing)
     * checkboxes
     * selects / combobox
     * toggles/switches
     * date picker (optional but nice)
   * scrolling (page area + inner scroll container)
   * drag interaction (drag an item / reorder / drag handle)
   * “simple drawing”: draw at least one shape (rectangle/circle/freehand) in a lightweight drawing area
4. **README** with setup + commands + how to run both modes locally and in CI.

---

## Demo App Requirements (React + Tailwind + shadcn + Motion)

### Layout

* Mobile-friendly overlay layout with sidebar:

  * On desktop: sidebar visible
  * On mobile: sidebar becomes a **sheet / drawer overlay** (shadcn `Sheet`)
* Main content should contain distinct “sections” with headings so the automation can target them reliably.

### Suggested Pages / Components

**Login page (`/login`)**

* shadcn `Card`, `Input`, `Button`
* validation message (simple, client-side)
* successful login stores a flag/token in memory or localStorage and redirects to `/app`

**App page (`/app`)**

* A “Demo Form” section:

  * `Input` fields (name, email)
  * `Select` (country, role)
  * `Checkbox` group (preferences)
  * `Switch` (enable notifications)
  * Optional: `Slider` or `RadioGroup`
* A “Scrollable Area” section:

  * long list in a container with its own scrollbar (shadcn `ScrollArea`)
* A “Drag & Drop” section:

  * simplest acceptable: use **Framer Motion drag** on a card/item and drop into a target
  * bonus: reorder list
* A “Drawing” section:

  * simplest acceptable: an SVG or canvas area where pointer actions create shapes
  * must support drawing at least one rectangle/circle/freehand stroke
* Use **Framer Motion** animations lightly (e.g., animate section entry, button press, subtle transitions) so the runner must handle animations.

### Data / State

* No backend needed. Use in-memory state + optional localStorage.
* Keep selectors stable: add `data-testid` attributes on key elements.

---

## Scenario Runner Requirements (Puppeteer)

### Two Modes (same scenario file)

* `human` mode:

  * visible cursor (overlay cursor if needed)
  * smooth mouse movement paths (not teleport)
  * click effect ripple/highlight at click location
  * typing:

    * per-character delay with small randomized jitter
    * occasional micro-pauses between words
  * short “breathing” pauses between major steps
  * record video **without dropped frames**
  * generate subtitles for each step (and optionally substeps)

* `fast` mode:

  * no artificial delays
  * direct `page.type` without per-char delay (or minimal)
  * still uses robust waits for correctness (navigation, element ready)
  * may still record video + subtitles (preferred), but speed is priority

### Video Recording (No Frame Drops)

* Prefer a recorder that uses **CDP screencast / frame pipeline** rather than OS screen capture.
* Output MP4 (preferred) or WebM.
* Target 60 make it consistent

### Cursor + Click Effects

* Cursor must be visible in the final video:

  * Either as an injected page overlay (recommended for CI parity), or OS cursor capture if truly consistent.
* Click effects:

  * At click time, show a brief ripple or ring animation at the cursor location.
  * Keep it simple: CSS animation in an overlay layer.

### Subtitles

* Provide an API like:

  * `step("Open login page", async () => { ... })`
* The runner records `step start/end` timestamps relative to video start.
* Export to **WebVTT**:

  * each step becomes a caption block
  * example caption text: “Step 3: Fill Profile Form”

---

## Suggested Minimal File Structure

Keep it small—something like:

* `src/App.tsx` (router + layout)
* `src/pages/login.tsx`
* `src/pages/app.tsx` (all demo sections can live here)
* `src/main.tsx`
* `e2e/run.ts` (CLI entry)
* `e2e/scenario.ts` (single scenario shared by both modes)
* `README.md`

If you can keep it even smaller without making it messy, do it.

---

## CLI / DX Requirements

Provide a CLI like:

* `pnpm dev` / `npm run dev` — runs Vite app
* `pnpm e2e:human` — runs scenario in human mode and outputs artifacts
* `pnpm e2e:fast` — runs scenario in fast mode and outputs artifacts

Runner should print:

* mode, baseURL, artifact paths, and whether video/subtitles were produced.

---

## Acceptance Criteria

* Works on macOS locally and Linux CI.
* Human mode video:

  * cursor visible
  * click effects visible
  * motion looks smooth
  * subtitles file is generated and matches step ordering/timing
* Fast mode:

  * completes the scenario quickly
  * remains stable (no flaky “sleep-only” logic; uses waits)
* Scenario demonstrates:

  * typing
  * scrolling
  * drag interaction
  * drawing shapes
* Minimal file count and clear architecture.

---

## Bonus (Nice to Have)

* Save a `run.json` containing:

  * steps, timestamps, selector targets, screenshots on failure
* Failure artifacts:

  * last screenshot
  * console logs
  * network failures summary
* Optional: configurable viewport presets (desktop/mobile) and run both.
