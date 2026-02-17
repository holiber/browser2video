---
name: browser2video
description: Record browser and terminal automation as narrated videos. Interactive browser/terminal control with human-like Actor, video recording, narration, and scenario export. Works alongside Playwright MCP via CDP.
metadata: { "openclaw": { "requires": { "bins": ["node", "ffmpeg"], "env": ["OPENAI_API_KEY"] }, "homepage": "https://github.com/holiber/browser2video" } }
---

# Browser2Video

Record browser and terminal automation as production-quality narrated videos.
Two usage modes: **batch** (run pre-written scenario files) and **interactive** (control browser/terminal in real-time through MCP tools).

## Setup

Configure both b2v and Playwright MCP in your `mcp.json`. b2v handles human-like interactions, recording, terminals, and narration. Playwright MCP connects to the same browser for page inspection (snapshots, screenshots, evaluate).

```json
{
  "mcpServers": {
    "b2v": {
      "command": "npx",
      "args": ["-y", "b2v-mcp"],
      "env": { "B2V_CDP_PORT": "9222" }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

## Interactive tools

### b2v_start

Start an interactive session. Launches a browser with video recording and CDP endpoint.

**Parameters:**

- `mode` (string, optional) — `"human"` (default) or `"fast"`.
- `record` (boolean, optional) — Enable video recording. Default: true.
- `headed` (boolean, optional) — Force headed/headless browser.
- `cdpPort` (number, optional) — CDP port for Playwright MCP. Default: 9222.
- `voice` (string, optional) — OpenAI TTS voice.
- `language` (string, optional) — Narration language.

**Returns:** `cdpEndpoint`, `wsEndpoint`, `artifactDir`, `mode`, `record`.

### b2v_open_page

Open a new browser page. Returns `pageId`.

- `url` (string, optional) — URL to navigate to.
- `viewport` (object, optional) — `{ width, height }`.
- `label` (string, optional) — Label for logs/subtitles.

### b2v_open_terminal

Open a terminal pane running a shell command. Returns `terminalId`.

- `command` (string, optional) — Shell command (e.g. `"bash"`, `"htop"`).
- `viewport` (object, optional) — `{ width, height }`.
- `label` (string, optional) — Label.

### b2v_click

Human-like click with smooth cursor movement (WindMouse), click effect, and breathing pause.

- `selector` (string, required) — CSS selector.
- `pageId` (string, optional) — Target page.

### b2v_click_at

Human-like click at x,y coordinates. For canvas or terminal interactions.

- `x`, `y` (number, required) — Coordinates.
- `pageId` (string, optional).

### b2v_type

Human-like typing with per-character delays.

- `selector` (string, required) — CSS selector of the input.
- `text` (string, required) — Text to type.
- `pageId` (string, optional).

### b2v_press_key

Press a keyboard key with a breathing pause.

- `key` (string, required) — Key name (e.g. `"Enter"`, `"Tab"`).
- `pageId` (string, optional).

### b2v_hover

Human-like cursor hover over an element.

- `selector` (string, required).
- `pageId` (string, optional).

### b2v_drag

Human-like drag from one element to another.

- `from` (string, required) — Source selector.
- `to` (string, required) — Target selector.
- `pageId` (string, optional).

### b2v_scroll

Scroll a page or element.

- `selector` (string, optional) — Scrollable element (null for page).
- `deltaY` (number, required) — Scroll amount (positive = down).
- `pageId` (string, optional).

### b2v_select_text

Human-like text selection by dragging from one element to another. Produces a visible browser text highlight.

- `fromSelector` (string, required) — CSS selector for the start of selection.
- `toSelector` (string, optional) — CSS selector for the end of selection (defaults to `fromSelector`).
- `pageId` (string, optional).

### b2v_terminal_send

Send text/command to terminal stdin.

- `text` (string, required).
- `terminalId` (string, optional).

### b2v_terminal_read

Read current terminal output.

- `terminalId` (string, optional).

### b2v_step

Mark a named step in the recording (shown as subtitle).

- `caption` (string, required) — Step description.
- `narration` (string, optional) — TTS narration text.

### b2v_narrate

Speak narration text via TTS.

- `text` (string, required).

### b2v_add_step

Add a step with executable code. The code runs immediately AND is recorded for export.

- `caption` (string, required) — Step description.
- `narration` (string, optional) — TTS text.
- `code` (string, required) — JS/TS code with `actor`, `page`, `session` in scope.
- `pageId` (string, optional).

**Example:**
```json
{
  "caption": "Fill login form",
  "narration": "Now we enter the credentials",
  "code": "await actor.type('#email', 'user@example.com');\nawait actor.click('button[type=submit]');"
}
```

### b2v_save_scenario

Export accumulated steps as a standalone `.ts` scenario file.

- `filePath` (string, required) — Output file path.
- `url` (string, optional) — URL for the scenario.

### b2v_finish

End session, compose video, return artifact paths.

**Returns:** `videoPath`, `thumbnailPath`, `subtitlesPath`, `metadataPath`, `artifactDir`, `durationMs`.

### b2v_status

Return current session state. No parameters.

**Returns:**
- `active` (boolean) — Whether a session is running.
- `mode` — `"human"` or `"fast"`.
- `record` — Whether recording is enabled.
- `headed` — Whether the browser is visible.
- `artifactDir` — Path to the artifacts directory.
- `panes` — Summary of open pages and terminals (IDs, URLs, viewports).
- `steps` — Array of recorded steps so far.
- `wsEndpoint` — WebSocket endpoint for the browser.

## Batch tools

### b2v_run

Run a pre-written scenario file as a subprocess.

- `scenarioFile` (string, required) — Path to a scenario `.ts` or `.js` file.
- `mode` (string, optional) — `"human"` or `"fast"`.
- `voice`, `language`, `realtimeAudio`, `narrationSpeed` — Narration options.

### b2v_list_scenarios

List scenario files in a directory.

- `dir` (string, optional) — Directory to scan.

### b2v_doctor

Print environment diagnostics: Node.js, ffmpeg, platform.

## Interactive workflow example

1. Call `b2v_start` to launch a browser with recording
2. Call `b2v_open_page` with a URL
3. Use Playwright MCP's `browser_snapshot` to inspect the page
4. Use `b2v_click`, `b2v_type` for human-like interactions (or `b2v_add_step` with code)
5. Use `b2v_step` to mark recording segments with subtitles/narration
6. Call `b2v_save_scenario` to export as a replayable `.ts` file
7. Call `b2v_finish` to compose the final video

## Actor API (for b2v_add_step code)

| Method | Description |
|---|---|
| `actor.goto(url)` | Navigate to a URL |
| `actor.click(selector)` | Move cursor to element, show click effect, click |
| `actor.clickAt(x, y)` | Click at coordinates |
| `actor.type(selector, text)` | Type text — auto-detects xterm.js terminals vs DOM inputs |
| `actor.typeAndEnter(selector, text)` | Type text and press Enter |
| `actor.pressKey(key)` | Press a keyboard key with a breathing pause |
| `actor.select(selector, value)` | Open a `<select>` and pick an option |
| `actor.hover(selector)` | Move cursor to element |
| `actor.selectText(from, to?)` | Select text by dragging between elements |
| `actor.moveCursorTo(x, y)` | Smooth cursor move to coordinates |
| `actor.drag(from, to)` | Drag from one selector to another |
| `actor.waitFor(selector)` | Wait for an element to appear |
| `session.createTerminal(cmd?, opts?)` | Create a terminal pane — returns a `TerminalActor` |

**TerminalActor** (returned by `createTerminal`):

| Method | Description |
|--------|-------------|
| `term.click(relX, relY)` | Click at relative position in the terminal |
| `term.type(text)` | Type text into the terminal |
| `term.typeAndEnter(text)` | Type text and press Enter |
| `term.waitForText(includes)` | Wait for text to appear |
| `term.waitForPrompt()` | Wait for a shell prompt (`$`/`#`) |
| `term.isBusy()` | Check if terminal is running a command |
| `term.waitUntilIdle()` | Wait until terminal is idle |
| `term.read()` | Read all visible terminal text |
| `term.readNew()` | Read only new lines since last read |

## When to use `b2v_click` vs `b2v_add_step`

**Individual tools** (`b2v_click`, `b2v_type`, `b2v_drag`, etc.) give you per-action control. Use them when:
- You need to inspect the page between actions (via Playwright MCP `browser_snapshot`).
- The workflow is exploratory and you are deciding what to do next based on page state.
- You want fine-grained control over pacing and narration timing.

**`b2v_add_step`** executes a code block with `actor`, `page`, and `session` in scope. Use it when:
- You want to perform a multi-action sequence as a single unit.
- You want to export the steps as a replayable `.ts` scenario file via `b2v_save_scenario`.
- The actions are straightforward and don't need intermediate inspection.

You can mix both approaches in the same session.

## Multi-page and multi-terminal workflows

When you open multiple pages or terminals, each returns an ID (`pageId` / `terminalId`). Pass these IDs to interaction tools to target a specific pane.

**Example: two browser pages side by side**

```
b2v_start { "mode": "human" }
b2v_open_page { "url": "https://app.example.com/editor", "label": "Editor" }
  -> returns { "pageId": "page-0" }
b2v_open_page { "url": "https://app.example.com/preview", "label": "Preview" }
  -> returns { "pageId": "page-1" }

b2v_click { "selector": "#save-btn", "pageId": "page-0" }
b2v_step { "caption": "Preview updates automatically" }
```

If you omit `pageId`, b2v uses the first (or only) page. Same for `terminalId`.

## Error handling

- If a `b2v_click` or `b2v_type` fails (element not found), the MCP tool returns an error. Use Playwright MCP's `browser_snapshot` to re-inspect the page and find the correct selector.
- Call `b2v_status` to check if a session is already active before calling `b2v_start`.
- If `b2v_start` fails due to a port conflict, try a different `cdpPort` value.
- When using `b2v_add_step`, wrap risky code in try/catch so a single failure doesn't abort the session:

```json
{
  "caption": "Accept cookies if present",
  "code": "try { await actor.click('button:has-text(\"Accept\")'); } catch {}"
}
```

## Tips

- **Always inspect before interacting.** Use Playwright MCP's `browser_snapshot` to find CSS selectors before calling `b2v_click` or `b2v_type`.
- **Use `b2v_step` before major actions** to produce meaningful subtitles in the final video.
- **Use `b2v_narrate` for voiceover** that plays concurrently with the next actions. `b2v_step` with a `narration` field does the same but also marks a subtitle.
- **Run `b2v_doctor` first** if you are unsure whether Node.js and ffmpeg are available.
- **Check session state with `b2v_status`** to see open panes, recorded steps, and artifact directory.

## Requirements

- **Node.js** >= 22 (with native TypeScript support)
- **ffmpeg** in PATH (for video composition and audio mixing)
- **OPENAI_API_KEY** env var (for TTS narration; optional if narration disabled)
