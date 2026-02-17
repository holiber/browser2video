---
title: "Tools (CLI / MCP) API"
sidebar_position: 5
---

# Tools (CLI / MCP) API

## Interactive tools

These tools provide real-time browser and terminal control through the MCP server. They work alongside Playwright MCP, which connects to the same browser via CDP for page inspection.

### `b2v_start`

**MCP**

> Start an interactive session.

Launch a browser with video recording and CDP endpoint. Returns connection info for Playwright MCP.

#### Parameters

- `mode` (`"human" | "fast"`, optional) — Execution speed mode. Default: `"human"`.
- `record` (`boolean`, optional) — Enable video recording. Default: `true`.
- `headed` (`boolean`, optional) — Force headed/headless browser.
- `cdpPort` (`number`, optional) — CDP port for Playwright MCP connection. Default: `9222`.
- `voice` (`string`, optional) — OpenAI TTS voice.
- `language` (`string`, optional) — Narration language.

---

### `b2v_finish`

**MCP**

> Finish session and compose video.

End the active session. Composes recorded panes into a single video with subtitles and metadata.

---

### `b2v_status`

**MCP**

> Session status.

Return current session state: open panes, steps, mode, recording status.

---

### `b2v_open_page`

**MCP**

> Open a browser page.

Open a new browser page with cursor injection and recording setup. Returns a `pageId`.

#### Parameters

- `url` (`string`, optional) — URL to navigate to.
- `viewport` (`{ width, height }`, optional) — Viewport dimensions. Default: 1280x720.
- `label` (`string`, optional) — Label for logs/subtitles.

---

### `b2v_open_terminal`

**MCP**

> Open a terminal pane.

Open a terminal pane running a shell command, rendered in a browser page for recording.

#### Parameters

- `command` (`string`, optional) — Shell command to run.
- `viewport` (`{ width, height }`, optional) — Viewport dimensions. Default: 800x600.
- `label` (`string`, optional) — Label.

---

### `b2v_click`

**MCP**

> Human-like click.

Click an element with smooth cursor movement (WindMouse), click effect, and breathing pause.

#### Parameters

- `selector` (`string`, **required**) — CSS selector.
- `pageId` (`string`, optional) — Target page ID.

---

### `b2v_click_at`

**MCP**

> Click at coordinates.

Human-like click at specific x,y coordinates. Useful for canvas or terminal interactions.

#### Parameters

- `x` (`number`, **required**), `y` (`number`, **required**) — Coordinates.
- `pageId` (`string`, optional).

---

### `b2v_type`

**MCP**

> Human-like typing.

Type text into an element with per-character delays.

#### Parameters

- `selector` (`string`, **required**) — CSS selector of the input.
- `text` (`string`, **required**) — Text to type.
- `pageId` (`string`, optional).

---

### `b2v_press_key`

**MCP**

> Press keyboard key.

Press a keyboard key with a breathing pause.

#### Parameters

- `key` (`string`, **required**) — Key name (e.g. `"Enter"`, `"Tab"`, `"ArrowDown"`).
- `pageId` (`string`, optional).

---

### `b2v_hover`

**MCP**

> Human-like hover.

Move the cursor to an element with smooth, human-like motion.

#### Parameters

- `selector` (`string`, **required**) — CSS selector.
- `pageId` (`string`, optional).

---

### `b2v_drag`

**MCP**

> Human-like drag.

Drag from one element to another with smooth cursor movement.

#### Parameters

- `from` (`string`, **required**) — Source CSS selector.
- `to` (`string`, **required**) — Target CSS selector.
- `pageId` (`string`, optional).

---

### `b2v_scroll`

**MCP**

> Scroll page or element.

#### Parameters

- `selector` (`string`, optional) — Scrollable element selector (null for page).
- `deltaY` (`number`, **required**) — Scroll amount in pixels (positive = down).
- `pageId` (`string`, optional).

---

### `b2v_terminal_send`

**MCP**

> Send command to terminal.

Send text or a command to terminal stdin. In human mode, characters are typed visually.

#### Parameters

- `text` (`string`, **required**) — Text to send.
- `terminalId` (`string`, optional) — Target terminal pane ID.

---

### `b2v_terminal_read`

**MCP**

> Read terminal output.

#### Parameters

- `terminalId` (`string`, optional) — Target terminal pane ID.

---

### `b2v_step`

**MCP**

> Mark a recording step.

Mark a named step in the recording. Steps appear as subtitles in the final video.

#### Parameters

- `caption` (`string`, **required**) — Step description.
- `narration` (`string`, optional) — TTS narration text.

---

### `b2v_narrate`

**MCP**

> Speak narration.

Speak text via TTS. Requires `OPENAI_API_KEY`.

#### Parameters

- `text` (`string`, **required**) — Text to speak.

---

### `b2v_add_step`

**MCP**

> Add step with executable code.

Add a step to the scenario being built. The code is executed immediately with `actor`, `page`, and `session` in scope, and recorded for export via `b2v_save_scenario`.

#### Parameters

- `caption` (`string`, **required**) — Step description.
- `narration` (`string`, optional) — TTS narration text.
- `code` (`string`, **required**) — JS/TS code to execute.
- `pageId` (`string`, optional).

#### Example

```json
{
  "caption": "Fill login form",
  "code": "await actor.type('#email', 'user@example.com');\nawait actor.click('button[type=submit]');"
}
```

---

### `b2v_save_scenario`

**MCP**

> Export scenario file.

Export all accumulated steps as a standalone `.ts` scenario file.

#### Parameters

- `filePath` (`string`, **required**) — Output file path.
- `url` (`string`, optional) — The URL the scenario opens.

---

## Batch tools

### `b2v_run`

**MCP** · **CLI**

> Run a scenario with video recording.

Execute a scenario file (.ts or .js) as a subprocess with video recording and optional TTS narration.

#### Parameters

- `scenarioFile` (`string`, **required**) — Path to a scenario .ts or .js file.
- `mode` (`"human" | "fast"`, optional) — Execution speed mode.
- `voice` (`string`, optional) — OpenAI TTS voice.
- `language` (`string`, optional) — Auto-translate narration language.
- `realtimeAudio` (`boolean`, optional) — Play narration in realtime.
- `narrationSpeed` (`number`, optional) — Narration speed 0.25-4.0.

#### Examples

**Run basic-ui scenario**

```bash
b2v run tests/scenarios/basic-ui.test.ts
```

**Run with Russian narration**

```bash
b2v run tests/scenarios/kanban.test.ts --language ru --voice ash
```

---

### `b2v_list_scenarios`

**MCP**

> List available scenario files.

List scenario files in the scenarios directory.

#### Parameters

- `dir` (`string`, optional) — Directory to scan (default: tests/scenarios).

---

### `b2v_doctor`

**MCP** · **CLI**

> Print environment diagnostics.

Check the runtime environment: Node.js version, ffmpeg availability, and platform-specific notes.

---
