import { createSession } from "browser2video";

const session = await createSession({ record: true, mode: "human" });
const { step } = session;
const { page, actor } = await session.openPage({ url: "https://payloadcms.com" });

await step("Accept cookies", async () => {
  
      try {
        await page.waitForSelector('button:has-text("Accept")', { timeout: 5000 });
        await actor.click('button:has-text("Accept")');
      } catch {
        // Cookie banner might not appear
      }
      
});

await step("Scroll to footer", async () => {
  await actor.scroll(null, 3000);
});

await step("Navigate to docs (fallback)", async () => {
  await page.goto("https://payloadcms.com/docs/getting-started/what-is-payload", { waitUntil: "domcontentloaded" });
});

await step("Dismiss cookie banner", async () => {
  
      try {
        const btn = await page.$('button:has-text("Accept")');
        if (btn) await actor.click('button:has-text("Accept")');
      } catch {}
      
});

await step("Wait for page content", async () => {
  await page.waitForSelector('h1', { timeout: 8000 });
});

await step("Select key paragraph", "Payload is the Next.js fullstack framework. Write a Payload Config and instantly get: a full Admin Panel, automatic database schema, and instant REST, GraphQL, and straight-to-DB Node.js APIs.", async () => {
  
      // Find the intro text and the 3rd list item to select from/to
      const fromSel = 'p:has-text("Payload is the Next.js fullstack framework")';
      const toSel = 'li:has-text("Instant REST, GraphQL")';
      await actor.selectText(fromSel, toSel);
      
});

await step("Pause on selection", async () => {
  await new Promise(r => setTimeout(r, 2000));
});

const result = await session.finish();
console.log("Video:", result.video);
