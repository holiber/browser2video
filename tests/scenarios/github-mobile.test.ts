/**
 * Browse the browser2video GitHub repo in mobile viewport (iPhone 14).
 * Demonstrates compact video recording on a narrow screen.
 */
import { fileURLToPath } from "url";
import { createSession } from "@browser2video/runner";

async function scenario() {
  const session = await createSession();
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
    const itemName = await firstItem.textContent();
    console.log(`    Clicking on: ${itemName?.trim()}`);
    await actor.clickLocator(firstItem);
    await page.waitForTimeout(3000);
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

  await session.finish();
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("github-mobile", scenario);
}
