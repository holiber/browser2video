---
title: Intro
---

Browser2Video is a toolkit for producing **video proofs** from browser automation:

- MP4 video at 60fps (when recording enabled)
- WebVTT subtitles with step captions
- JSON step timing metadata
- TTS narration with auto-translation to any language

## Quick start

```ts
import { createSession, startServer } from "browser2video";

const server = await startServer({ type: "vite", root: "apps/demo" });
const session = await createSession();
const { step } = session;
const { page, actor } = await session.openPage({ url: server.baseURL });

await step("Fill the form", async () => {
  await actor.type('[data-testid="name"]', "Jane Doe");
  await actor.click('[data-testid="submit"]');
});

await session.finish();
server.close();
```

See **[Video examples](/docs/examples)** for recorded demos.
