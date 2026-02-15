/**
 * @description E2E scenario that opens the browser2video GitHub repo,
 * opens README.md, and scrolls around to generate a stable video proof.
 */
import type { ScenarioConfig, ScenarioContext } from "@browser2video/runner";

export const config: ScenarioConfig = {
  panes: [{ id: "main", type: "browser", url: "https://github.com/holiber/browser2video" }],
};

const REPO_URL = "https://github.com/holiber/browser2video";

export default async function scenario(ctx: ScenarioContext) {
  const actor = ctx.actor("main");
  const page = ctx.page("main");

  // ------------------------------------------------------------------
  //  1. Navigate to the repository
  // ------------------------------------------------------------------

  await ctx.step("main", "Open GitHub repository page", async () => {
    await page.goto(REPO_URL, { waitUntil: "load", timeout: 20000 });
    await actor.injectCursor();
    await actor.waitFor("main", 15000);
  });

  // ------------------------------------------------------------------
  //  2. Open README.md
  // ------------------------------------------------------------------

  await ctx.step("main", "Open README.md file", async () => {
    // GitHub: file list entries typically have a title attribute with the filename.
    await actor.waitFor('a[title="README.md"]', 15000);
    await actor.click('a[title="README.md"]');
    await actor.waitFor("article", 15000);
  });

  // ------------------------------------------------------------------
  //  3. Scroll the README content
  // ------------------------------------------------------------------

  await ctx.step("main", "Scroll through README", async () => {
    await actor.scroll(null, 700);
    await actor.scroll(null, 700);
    await actor.scroll(null, -400);
  });
}
