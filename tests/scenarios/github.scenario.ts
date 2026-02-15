/**
 * @description E2E scenario that opens the browser2video GitHub repo,
 * scrolls through the file tree, and retrieves the first-level files/folders.
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
    await page.goto(REPO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await actor.injectCursor();
    await actor.waitFor("main", 20000);
  });

  // ------------------------------------------------------------------
  //  2. Scroll to the file tree
  // ------------------------------------------------------------------

  await ctx.step("main", "Scroll to the file list", async () => {
    // Scroll down so the full file tree is visible
    await actor.scroll(null, 400);
  });

  // ------------------------------------------------------------------
  //  3. Retrieve the first-level files and folders
  // ------------------------------------------------------------------

  await ctx.step("main", "Retrieve first-level files and folders", async () => {
    const items = await page.evaluate(() => {
      // GitHub renders the file tree in role="grid" rows
      const rows = document.querySelectorAll(
        'table[aria-labelledby] tbody tr, div[role="grid"] div[role="row"]',
      );
      const result: { name: string; type: "file" | "directory" }[] = [];
      for (const row of Array.from(rows)) {
        const nameEl =
          row.querySelector('a.Link--primary') ??
          row.querySelector('a[class*="Link"]') ??
          row.querySelector('a');
        if (!nameEl) continue;
        const name = nameEl.textContent?.trim();
        if (!name || name.includes("Commit")) continue;

        // Detect directories: GitHub uses an SVG with aria-label "Directory"
        // or the link href ends with /tree/.../<name>
        const svgs = row.querySelectorAll('svg');
        let isDir = false;
        for (const svg of Array.from(svgs)) {
          const label = (svg.getAttribute('aria-label') ?? '').toLowerCase();
          if (label.includes('directory') || label.includes('folder')) {
            isDir = true;
            break;
          }
        }
        // Fallback: check if the href contains /tree/
        if (!isDir) {
          const href = nameEl.getAttribute('href') ?? '';
          isDir = /\/tree\//.test(href);
        }

        result.push({ name, type: isDir ? "directory" : "file" });
      }
      return result;
    });

    console.log(`    Found ${items.length} items in the file tree:`);
    for (const item of items) {
      console.log(`      ${item.type === "directory" ? "📁" : "📄"} ${item.name}`);
    }

    if (items.length === 0) {
      throw new Error("No files or folders found in the repository file tree");
    }
  });

  // ------------------------------------------------------------------
  //  4. Scroll through the rest of the page
  // ------------------------------------------------------------------

  await ctx.step("main", "Scroll through the page", async () => {
    await actor.scroll(null, 600);
    await actor.scroll(null, 600);
    await actor.scroll(null, -300);
  });
}
