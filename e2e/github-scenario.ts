/**
 * @description E2E scenario that opens the browser2video GitHub repo,
 * creates docs/itsme.md with markdown content, and commits it.
 * Requires a Chrome profile that is already logged into GitHub.
 */
import type { Page } from "puppeteer";
import type { ScenarioContext } from "./runner.js";

const REPO_URL = "https://github.com/holiber/browser2video";

/**
 * Tag the first <button> whose textContent starts with `text`
 * by setting a `data-b2v` attribute so the Actor can select it.
 */
async function tagButton(page: Page, text: string, tag: string) {
  const found = await page.evaluate(
    (searchText, id) => {
      for (const btn of document.querySelectorAll("button")) {
        if (btn.textContent?.trim().startsWith(searchText)) {
          btn.setAttribute("data-b2v", id);
          return true;
        }
      }
      return false;
    },
    text,
    tag,
  );
  if (!found) throw new Error(`Button starting with "${text}" not found`);
}

export async function githubScenario(ctx: ScenarioContext) {
  const { step, actor, page } = ctx;

  // ------------------------------------------------------------------
  //  1. Navigate to "Create new file" page
  // ------------------------------------------------------------------

  await step("Navigate to create new file page", async () => {
    // Use page.goto directly (actor.goto uses networkidle0 which hangs on GitHub)
    await page.goto(
      `${REPO_URL}/new/main?filename=docs/itsme.md`,
      { waitUntil: "load", timeout: 15000 },
    );
    await actor.injectCursor();
    // Wait for the CodeMirror editor to render
    await actor.waitFor(".cm-editor", 10000);
  });

  // ------------------------------------------------------------------
  //  2. Type markdown content into the editor
  // ------------------------------------------------------------------

  await step("Type markdown content", async () => {
    // Click the CodeMirror content-editable area
    await actor.click(".cm-content");

    const lines = [
      "# Hello from Browser2Video",
      "",
      "This file was created automatically by the **browser2video** E2E test.",
      "",
      "It demonstrates human-like cursor interaction with GitHub's web UI.",
    ];

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.press("Enter");
        if (actor.mode === "human") {
          await new Promise((r) => setTimeout(r, 40 + Math.random() * 40));
        }
      }
      const line = lines[i];
      if (line.length === 0) continue;

      if (actor.mode === "human") {
        for (const char of line) {
          await page.keyboard.type(char, {
            delay: Math.floor(Math.random() * 45) + 25,
          });
          if (char === " " || char === "." || char === "*") {
            await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
          }
        }
      } else {
        await page.keyboard.type(line);
      }
    }
  });

  // ------------------------------------------------------------------
  //  3. Open the commit dialog
  // ------------------------------------------------------------------

  await step("Open commit dialog", async () => {
    await tagButton(page, "Commit changes", "commit-open");
    await actor.click('[data-b2v="commit-open"]');
    // Wait for the modal / dialog to appear
    await page.waitForSelector('[role="dialog"]', {
      visible: true,
      timeout: 5000,
    });
  });

  // ------------------------------------------------------------------
  //  4. Confirm the commit
  // ------------------------------------------------------------------

  await step("Confirm commit", async () => {
    // Inside the dialog there is a second "Commit changes" button (submit)
    await page.waitForSelector('[role="dialog"] button[type="submit"]', {
      visible: true,
      timeout: 5000,
    });
    // Tag it so Actor can click it with cursor animation
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const btn = dialog.querySelector('button[type="submit"]');
      if (btn) btn.setAttribute("data-b2v", "commit-confirm");
    });
    await actor.click('[data-b2v="commit-confirm"]');
    // Wait for navigation after commit
    await page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  });
}
