/**
 * Simple browser scenario — opens example.com, clicks a link, scrolls.
 *
 * Run:  npx b2v run examples/simple-browser.ts
 * Or:   node --experimental-transform-types examples/simple-browser.ts
 */
import { createSession } from "browser2video";

const session = await createSession({ mode: "human", record: true });
const { step } = session;
const { actor } = await session.openPage({ url: "https://example.com" });

await step("Open page", async () => {
  await actor.waitFor("h1");
});

await step("Click the link", async () => {
  await actor.click("a");
});

const result = await session.finish();
console.log("Video:", result.video);
