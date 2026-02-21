/**
 * Browse the browser2video GitHub repo in mobile viewport (iPhone 14).
 * Demonstrates compact video recording on a narrow screen.
 */
import { defineScenario, type Actor, type Page } from "browser2video";

interface Ctx {
  actor: Actor;
  page: Page;
}

export default defineScenario<Ctx>("GitHub Mobile", (s) => {
  s.setup(async (session) => {
    const { page, actor } = await session.openPage({
      url: "https://github.com/nicedoc/browser2video",
      viewport: { width: 390, height: 844 },
    });
    return { actor, page };
  });

  s.step("Wait for repository page", async ({ actor }) => {
    await actor.waitFor("main", 20000);
  });

  s.step("Scroll to the file list", async ({ actor }) => {
    await actor.scroll(null, 400);
  });

  s.step("Browse file tree", async ({ actor }) => {
    await actor.scroll(null, 300);
    await actor.scroll(null, -200);
  });

  s.step("Open docs folder", async ({ actor, page }) => {
    const docsLink = page.locator('a[href$="/tree/main/docs"]:visible').first();
    await docsLink.waitFor({ state: "visible", timeout: 15000 });
    await actor.clickLocator(docsLink);
    await page.waitForURL(/\/tree\/.*\/docs/, { timeout: 15000 });
    await actor.waitFor("main", 10000);
  });

  s.step("Browse docs contents", async ({ actor, page }) => {
    await actor.scroll(null, 200);
    const firstItem = page.locator("a.Link--primary:visible").first();
    const itemName = await firstItem.textContent();
    console.log(`    Clicking on: ${itemName?.trim()}`);
    await actor.clickLocator(firstItem);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  });

  s.step("Navigate back to repo", async ({ actor, page }) => {
    const repoLink = page.locator('a[href="/nicedoc/browser2video"]').first();
    await actor.clickLocator(repoLink);
    await actor.waitFor("main", 10000);
  });

  s.step("Scroll through README", async ({ actor }) => {
    await actor.scroll(null, 600);
    await actor.scroll(null, 600);
    await actor.scroll(null, -300);
  });
});
