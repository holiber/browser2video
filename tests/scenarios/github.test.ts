/**
 * Browse the browser2video GitHub repo: scroll the file tree,
 * navigate into docs, click files, scroll through the README.
 * No authorization required.
 */
import { fileURLToPath } from "url";
import { createSession } from "@browser2video/runner";

async function scenario() {
  const session = await createSession();
  const { step } = session;
  const { page, actor } = await session.openPage({
    url: "https://github.com/holiber/browser2video",
    viewport: { width: 1024, height: 768 },
  });

  await step("Wait for repository page", async () => {
    await actor.waitFor("main", 20000);
  });

  await step("Scroll to the file list", async () => {
    await actor.scroll(null, 400);
  });

  await step("Retrieve first-level files and folders", async () => {
    const items = await page.evaluate(() => {
      const rows = document.querySelectorAll(
        'table[aria-labelledby] tbody tr, div[role="grid"] div[role="row"]',
      );
      const result: { name: string; type: "file" | "directory" }[] = [];
      for (const row of Array.from(rows)) {
        const nameEl =
          row.querySelector("a.Link--primary") ??
          row.querySelector('a[class*="Link"]') ??
          row.querySelector("a");
        if (!nameEl) continue;
        const name = nameEl.textContent?.trim();
        if (!name || name.includes("Commit")) continue;

        const svgs = row.querySelectorAll("svg");
        let isDir = false;
        for (const svg of Array.from(svgs)) {
          const label = (svg.getAttribute("aria-label") ?? "").toLowerCase();
          if (label.includes("directory") || label.includes("folder")) {
            isDir = true;
            break;
          }
        }
        if (!isDir) {
          const href = nameEl.getAttribute("href") ?? "";
          isDir = /\/tree\//.test(href);
        }

        result.push({ name, type: isDir ? "directory" : "file" });
      }
      return result;
    });

    console.log(`    Found ${items.length} items in the file tree:`);
    for (const item of items) {
      console.log(`      ${item.type === "directory" ? "D" : "F"} ${item.name}`);
    }
    if (items.length === 0) {
      throw new Error("No files or folders found in the repository file tree");
    }
  });

  await step("Open docs folder", async () => {
    const docsLink = page.locator('a[href$="/tree/main/docs"]').last();
    await actor.clickLocator(docsLink);
    await page.waitForURL(/\/tree\/.*\/docs/, { timeout: 15000 });
    await actor.waitFor("main", 10000);
  });

  await step("Browse docs contents", async () => {
    await actor.scroll(null, 300);
    const firstItem = page.locator("a.Link--primary:visible").first();
    const itemName = await firstItem.textContent();
    console.log(`    Clicking on: ${itemName?.trim()}`);
    await actor.clickLocator(firstItem);
    await page.waitForTimeout(3000);
  });

  await step("Navigate back to docs", async () => {
    await page.goBack({ waitUntil: "domcontentloaded" });
    await actor.waitFor("main", 10000);
  });

  await step("Open another docs item", async () => {
    await actor.scroll(null, 200);
    const items = page.locator("a.Link--primary:visible");
    const count = await items.count();
    if (count >= 2) {
      const second = items.nth(1);
      const name = await second.textContent();
      console.log(`    Clicking on: ${name?.trim()}`);
      await actor.clickLocator(second);
      await page.waitForTimeout(3000);
    }
  });

  await step("Navigate back to repo root", async () => {
    const repoLink = page.locator('a[href="/holiber/browser2video"]').first();
    await actor.clickLocator(repoLink);
    await actor.waitFor("main", 10000);
  });

  await step("Scroll through README", async () => {
    await actor.scroll(null, 500);
    await actor.scroll(null, 500);
    await actor.scroll(null, -300);
  });

  await session.finish();
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("github", scenario);
}
