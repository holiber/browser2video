# browser2video

Record browser and terminal automation as smooth, narrated videos (MP4 @ 60fps) with subtitles and step metadata.

## Requirements

- **Node.js** >= 22
- **ffmpeg** in `PATH` (video composition and audio mixing)
- `OPENAI_API_KEY` (optional; enables narration/TTS)

## Quick start

```bash
npm install browser2video
npx b2v doctor
```

### Starter examples

```bash
npx b2v run node_modules/browser2video/examples/simple-browser.ts
npx b2v run node_modules/browser2video/examples/terminal-echo.ts
```

### CLI

```bash
npx b2v run my-scenario.ts --mode human --headed
npx b2v run my-scenario.ts --narrate --voice onyx
```

## Library usage

```ts
import { createSession } from "browser2video";

const session = await createSession({ mode: "human", record: true });
const { step } = session;
const { actor } = await session.openPage({ url: "https://example.com" });

await step("Click link", async () => {
  await actor.click("a");
});

await session.finish();
```

### Terminal scenario

```ts
import { createSession } from "browser2video";

const session = await createSession({ mode: "human", record: true });
const shell = await session.createTerminal();

await session.step("Run command", async () => {
  await shell.typeAndEnter('echo "hello world"');
  await shell.waitForPrompt();
});

await session.finish();
```

## MCP server (Cursor / OpenClaw)

b2v MCP provides interactive browser/terminal control with human-like interactions, video recording, and scenario export. It works alongside Playwright MCP, which connects to the same browser via CDP for page inspection.

### Recommended `mcp.json`

```json
{
  "mcpServers": {
    "b2v": {
      "command": "npx",
      "args": ["-y", "-p", "browser2video", "b2v-mcp"],
      "env": { "B2V_CDP_PORT": "9222" }
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

### Interactive workflow

1. `b2v_start` — Launch browser with recording and CDP endpoint
2. `b2v_open_page` — Open a page (returns `pageId`)
3. Use Playwright MCP for inspection (`browser_snapshot`, `browser_screenshot`)
4. Use b2v tools for human-like interactions (`b2v_click`, `b2v_type`, `b2v_drag`, etc.)
5. `b2v_step` / `b2v_narrate` — Mark recording steps with subtitles and narration
6. `b2v_add_step` — Execute code and record it for scenario export
7. `b2v_save_scenario` — Export as a replayable `.ts` scenario file
8. `b2v_finish` — Compose the final video

### Batch mode

Run pre-written scenario files as subprocesses:

```bash
npx -y -p browser2video b2v-mcp  # starts the MCP server
```

Tools: `b2v_run`, `b2v_list_scenarios`, `b2v_doctor`.

For complete tool parameters, schemas, and agent workflow details, see [`SKILL.md`](../../SKILL.md).
