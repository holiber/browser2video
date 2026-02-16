/**
 * Browse the browser2video GitHub repo in mobile viewport (iPhone 14).
 * Demonstrates compact video recording on a narrow screen.
 */
import { test } from "@playwright/test";
import { fileURLToPath } from "url";
import { createSession } from "@browser2video/runner";

async function scenario() {
  const session = await createSession();
  const { page, actor } = await session.openPage({
    url: "https://github.com/holiber/browser2video",
    viewport: { width: 390, height: 844 },
  });

  await session.step("Wait for repository page", async () => {
    await actor.waitFor("main", 20000);
  });

  await session.step("Scroll to the file list", async () => {
    await actor.scroll(null, 400);
  });

  await session.step("Browse file tree", async () => {
    await actor.scroll(null, 300);
    await actor.scroll(null, -200);
  });

  await session.step("Open docs folder", async () => {
    // On mobile, try the visible docs link; GitHub's mobile layout may differ
    const docsLink = page.locator('a[href$="/tree/main/docs"]:visible').first();
    await docsLink.waitFor({ state: "visible", timeout: 15000 });
    await docsLink.click({ force: true });
    await page.waitForURL(/\/tree\/.*\/docs/, { timeout: 15000 });
    await actor.waitFor("main", 10000);
  });

  await session.step("Browse docs contents", async () => {
    await actor.scroll(null, 200);
    const firstItem = page.locator("a.Link--primary:visible").first();
    const itemName = await firstItem.textContent();
    console.log(`    Clicking on: ${itemName?.trim()}`);
    await firstItem.click({ force: true });
    await page.waitForTimeout(3000);
  });

  await session.step("Navigate back to repo", async () => {
    const repoLink = page.locator('a[href="/holiber/browser2video"]').first();
    await repoLink.click();
    await actor.waitFor("main", 10000);
  });

  await session.step("Scroll through README", async () => {
    await actor.scroll(null, 600);
    await actor.scroll(null, 600);
    await actor.scroll(null, -300);
  });

  await session.finish();
}

test("github-mobile", scenario);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
