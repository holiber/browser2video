# browser2video

Record smooth browser automation videos with subtitles, optional narration, and step metadata.

## Requirements

- **Node.js** >= 22
- **ffmpeg** in `PATH` (video composition and audio mixing)
- `OPENAI_API_KEY` (optional; enables narration/TTS)

## CLI (via npx)

Run commands from your scenario project directory (the current working directory is used to resolve paths):

```bash
npx -y b2v doctor
npx -y b2v run tests/scenarios/basic-ui.test.ts --mode human --headed
```

## Library usage

```ts
import { createSession } from "browser2video";

const session = await createSession({ mode: "human", record: true });
const { step } = session;
const { actor } = await session.openPage({ url: "https://example.com" });

await step("Click sign in", async () => {
  await actor.click("text=Sign in");
});

await session.finish();
```

## MCP server (Cursor / OpenClaw)

Run the MCP server with:

```bash
npx -y --package browser2video b2v-mcp
```

Example `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "browser2video": {
      "command": "npx",
      "args": ["-y", "--package", "browser2video", "b2v-mcp"],
      "env": {}
    }
  }
}
```

