/**
 * @description E2E scenario that opens the browser2video GitHub repo,
 * opens README.md, and scrolls around to generate a stable video proof.
 */
import type { ScenarioContext } from "@browser2video/runner";

const REPO_URL = "https://github.com/holiber/browser2video";

export async function githubScenario(ctx: ScenarioContext) {
  const { step, actor, page } = ctx;

  // ------------------------------------------------------------------
  //  1. Navigate to the repository
  // ------------------------------------------------------------------

  await step("Open GitHub repository page", async () => {
    await page.goto(REPO_URL, { waitUntil: "load", timeout: 20000 });
    await actor.injectCursor();
    await actor.waitFor("main", 15000);
  });

  // ------------------------------------------------------------------
  //  2. Open README.md
  // ------------------------------------------------------------------

  await step("Open README.md file", async () => {
    // GitHub: file list entries typically have a title attribute with the filename.
    await actor.waitFor('a[title="README.md"]', 15000);
    await actor.click('a[title="README.md"]');
    await actor.waitFor("article", 15000);
  });

  // ------------------------------------------------------------------
  //  3. Scroll the README content
  // ------------------------------------------------------------------

  await step("Scroll through README", async () => {
    await actor.scroll(null, 700);
    await actor.scroll(null, 700);
    await actor.scroll(null, -400);
  });
}
