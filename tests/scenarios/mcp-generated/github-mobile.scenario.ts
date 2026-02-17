/**
 * Generated scenario: github-mobile
 * Browse the browser2video GitHub repo in mobile viewport (iPhone 14).
 */
import { createSession } from "browser2video";

const session = await createSession({ record: true, mode: "human" });
const { step } = session;
const { page, actor } = await session.openPage({
  url: "https://github.com/holiber/browser2video",
  viewport: { width: 390, height: 844 },
});

await step("Wait for repository page", async () => {
  await actor.waitFor("main", 20000);
});

await step("Scroll to the file list", async () => {
  await actor.scroll(null, 400);
});

await step("Browse file tree", async () => {
  await actor.scroll(null, 300);
  await actor.scroll(null, -200);
});

await step("Open docs folder", async () => {
  const docsLink = page.locator('a[href$="/tree/main/docs"]:visible').first();
  await docsLink.waitFor({ state: "visible", timeout: 15000 });
  await actor.clickLocator(docsLink);
  await page.waitForURL(/\/tree\/.*\/docs/, { timeout: 15000 });
  await actor.waitFor("main", 10000);
});

await step("Browse docs contents", async () => {
  await actor.scroll(null, 200);
  const firstItem = page.locator("a.Link--primary:visible").first();
  await actor.clickLocator(firstItem);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
});

await step("Navigate back to repo", async () => {
  const repoLink = page.locator('a[href="/holiber/browser2video"]').first();
  await actor.clickLocator(repoLink);
  await actor.waitFor("main", 10000);
});

await step("Scroll through README", async () => {
  await actor.scroll(null, 600);
  await actor.scroll(null, 600);
  await actor.scroll(null, -300);
});

const result = await session.finish();
console.log("Video:", result.video);
