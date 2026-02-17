# browser2video

Record browser and terminal automation as smooth, narrated videos with subtitles and step metadata.

## Requirements

- **Node.js** >= 22
- **ffmpeg** in `PATH` (video composition and audio mixing)
- `OPENAI_API_KEY` (optional; enables narration/TTS)

## CLI (via npx)

```bash
npx -y b2v doctor
npx -y b2v run tests/scenarios/basic-ui.test.ts --mode human --headed
```

## Library usage

```ts
import { createSession, startServer } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });

const session = await createSession({ mode: "human", record: true });
session.addCleanup(() => server.stop());

const { step } = session;
const { actor } = await session.openPage({ url: server.baseURL });

await step("Fill form", async () => {
  await actor.type('[data-testid="name"]', "Jane Doe");
  await actor.click('[data-testid="submit"]');
});

await session.finish(); // composes video + runs cleanup
```

## MCP server (Cursor / OpenClaw)

b2v MCP provides interactive browser/terminal control with human-like interactions, video recording, and scenario export. It works alongside Playwright MCP, which connects to the same browser via CDP for page inspection.

### Recommended `mcp.json`

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
npx -y b2v-mcp  # starts the MCP server
```

Tools: `b2v_run`, `b2v_list_scenarios`, `b2v_doctor`.

For complete tool parameters, schemas, and agent workflow details, see [`SKILL.md`](../../SKILL.md).
