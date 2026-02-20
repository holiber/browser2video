import { test, expect, type Page } from "@playwright/test";

const BASIC_UI = "tests/scenarios/basic-ui.scenario.ts";
const TUTORIAL = "tests/scenarios/css-buttons-tutorial.scenario.ts";
const ALL_IN_ONE = "tests/scenarios/mcp-generated/all-in-one.scenario.ts";

async function enableFrameHeaderBypass(page: Page) {
  await page.route("**/*", async (route) => {
    try {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];

      const csp = headers["content-security-policy"];
      if (csp) headers["content-security-policy"] = csp.replace(/frame-ancestors\s+[^;]+;?/gi, "");
      const cspReportOnly = headers["content-security-policy-report-only"];
      if (cspReportOnly) headers["content-security-policy-report-only"] = cspReportOnly.replace(/frame-ancestors\s+[^;]+;?/gi, "");

      await route.fulfill({ response, headers });
    } catch {
      await route.continue().catch(() => {});
    }
  });
}

function getStudioBrowserFrameUrl(page: Page): string {
  const frame = page
    .frames()
    .find((f) => f.parentFrame() === page.mainFrame() && f.url().includes("github.com"));
  return frame?.url() ?? "";
}

async function waitForPlayerReady(page: Page) {
  await page.goto("/");
  const notReady = page.getByText("Vite dev server not ready");
  await expect(notReady).toBeHidden({ timeout: 60_000 });
  await page.locator('[title="Connected"]').waitFor({ timeout: 60_000 });
}

async function loadScenario(page: Page, scenarioFile: string) {
  await waitForPlayerReady(page);

  const dropdown = page.locator("select").first();
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  await dropdown.locator(`option[value="${scenarioFile}"]`).waitFor({ state: "attached", timeout: 15_000 });
  await dropdown.selectOption(scenarioFile);

  const playAll = page.getByRole("button", { name: "Play all" });
  await expect(playAll).toBeVisible({ timeout: 15_000 });
  return playAll;
}

test("studio starts with 1x1 placeholder and supports browser/terminal workflow", async ({ page }) => {
  test.setTimeout(90_000);
  await enableFrameHeaderBypass(page);
  await waitForPlayerReady(page);

  const studioMode = page.locator("[data-preview-mode='studio-react']");
  await expect(studioMode).toBeVisible({ timeout: 30_000 });

  const placeholderAdd = page.locator("[data-testid='studio-placeholder-add']").first();
  await expect(placeholderAdd).toBeVisible({ timeout: 20_000 });

  // Add browser pane via URL prompt (direct iframe by default)
  await placeholderAdd.click();
  await expect(page.locator("[data-testid='studio-add-pane-popup']")).toBeVisible();
  await page.locator("[data-testid='studio-add-browser']").click();

  const urlDialog = page.locator("[data-testid='studio-browser-url-dialog']");
  const urlInput = page.locator("[data-testid='studio-browser-url-input']");
  const playwrightModeCheckbox = page.locator("[data-testid='studio-open-dedicated-checkbox']");

  await expect(urlDialog).toBeVisible();
  await expect(urlInput).toHaveValue("https://github.com/nicedoc/browser2video");
  await expect(playwrightModeCheckbox).toBeVisible();
  // Unchecked means direct iframe mode (real DOM in iframe).
  await expect(playwrightModeCheckbox).not.toBeChecked();
  await page.locator("[data-testid='studio-browser-url-confirm']").click();

  // Default browser pane is now a real direct iframe (not a screencast image).
  const browserIframe = page.locator("[data-testid='studio-browser-iframe']").first();
  await expect(browserIframe).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-testid='studio-playwright-frame']")).toHaveCount(0);

  // Ensure iframe content is real DOM we can inspect (equivalent to devtools access).
  const githubFrame = page.frameLocator("[data-testid='studio-browser-iframe']").first();
  await expect(githubFrame.locator("main")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => getStudioBrowserFrameUrl(page), { timeout: 30_000 })
    .toContain("github.com/");

  // Click a GitHub in-app link and ensure navigation stays inside direct iframe.
  const inAppLink = githubFrame.locator("a[href^='/']").first();
  await expect(inAppLink).toBeVisible({ timeout: 30_000 });
  await inAppLink.click();
  await expect
    .poll(() => getStudioBrowserFrameUrl(page), { timeout: 30_000 })
    .toContain("github.com/");
  await expect(githubFrame.locator("body")).not.toContainText("refused to connect");

  // Split to top-bottom and add terminal into the new slot
  await page.locator("[data-testid='studio-layout-picker']").selectOption("top-bottom");
  await expect(placeholderAdd).toBeVisible({ timeout: 15_000 });
  await placeholderAdd.click();
  await page.locator("[data-testid='studio-add-terminal']").click();

  const firstTerminal = page.frameLocator("iframe[src*='/terminal?']").first();
  const firstTerminalInput = firstTerminal.locator(".xterm-helper-textarea");
  const firstTerminalRows = firstTerminal.locator(".xterm-rows");

  await expect(firstTerminalInput).toBeVisible({ timeout: 20_000 });
  await firstTerminalInput.click();
  await firstTerminalInput.type("echo hello");
  await firstTerminalInput.press("Enter");
  await expect(firstTerminalRows).toContainText("hello", { timeout: 15_000 });

  await firstTerminalInput.type("htop");
  await firstTerminalInput.press("Enter");
  await expect(firstTerminal.locator("body")).toContainText("F1Help", { timeout: 15_000 });
  await firstTerminalInput.press("q");
  await expect(firstTerminalRows).toContainText("$", { timeout: 15_000 });

  // Add a second terminal tab and run ls
  const addTabBtn = page.locator("[data-testid='studio-add-tab']").first();
  await expect(addTabBtn).toBeVisible({ timeout: 10_000 });
  await addTabBtn.click();

  const secondTerminal = page.frameLocator("iframe[src*='/terminal?']").nth(1);
  const secondTerminalInput = secondTerminal.locator(".xterm-helper-textarea");
  const secondTerminalRows = secondTerminal.locator(".xterm-rows");
  await expect(secondTerminalInput).toBeVisible({ timeout: 15_000 });
  await secondTerminalInput.click();
  await secondTerminalInput.type("ls");
  await secondTerminalInput.press("Enter");
  await expect(secondTerminalRows).toContainText("ls", { timeout: 15_000 });

  // Switch back and forth between tabs, verify previous output persists
  const terminalTabs = page.locator(".dv-default-tab").filter({ hasText: "Shell" });
  await expect(terminalTabs).toHaveCount(2, { timeout: 10_000 });
  await terminalTabs.first().click();
  await expect(firstTerminalRows).toContainText("hello");
  await terminalTabs.nth(1).click();
  await expect(secondTerminalRows).toContainText("ls");

  // Close both terminal tabs
  await terminalTabs.nth(1).click();
  await page.locator("[data-testid='studio-close-active']").click();
  await terminalTabs.first().click();
  await page.locator("[data-testid='studio-close-active']").click();
  await expect(page.locator("iframe[src*='/terminal?']")).toHaveCount(0, { timeout: 15_000 });
});

test("plays basic-ui scenario in live mode", async ({ page }) => {
  test.setTimeout(180_000);
  const playAll = await loadScenario(page, BASIC_UI);
  await playAll.click();

  await page.locator("text=16 / 16").waitFor({ timeout: 150_000 });

  await expect(page.locator(".bg-red-950")).toBeHidden();

  // In live mode, preview shows either an iframe or a screencast image
  const preview = page.locator("iframe[title='Scenario live view'], img[src^='data:image/']");
  await expect(preview.first()).toBeVisible();

  await expect(playAll).toBeDisabled();
});

test("plays narration tutorial and shows audio icons", async ({ page }) => {
  test.setTimeout(180_000);
  const playAll = await loadScenario(page, TUTORIAL);

  const audioIcons = page.locator('[data-testid="audio-icon"]');
  await expect(audioIcons.first()).toBeVisible({ timeout: 10_000 });

  await playAll.click();

  // Grid-based scenario should show an iframe with the observer grid page
  const previewIframe = page.locator("iframe[title='Scenario live view']");
  await expect(previewIframe.first()).toBeVisible({ timeout: 30_000 });

  await page.locator("text=8 / 8").waitFor({ timeout: 150_000 });
  await expect(page.locator(".bg-red-950")).toBeHidden();
  await expect(playAll).toBeDisabled();
});

test("replay step resets and re-executes from that point", async ({ page }) => {
  test.setTimeout(240_000);
  const playAll = await loadScenario(page, BASIC_UI);
  await playAll.click();

  await page.locator("text=16 / 16").waitFor({ timeout: 150_000 });
  await expect(playAll).toBeDisabled();

  const prevStep = page.getByRole("button", { name: "Previous step" });
  await prevStep.click();

  await expect(playAll).toBeDisabled({ timeout: 10_000 });
  await page.locator("text=15 / 16").waitFor({ timeout: 180_000 });
  await expect(playAll).toBeEnabled({ timeout: 10_000 });
});

test("all-in-one scenario renders observer iframe in live mode", async ({ page }) => {
  test.setTimeout(300_000);
  const playAll = await loadScenario(page, ALL_IN_ONE);

  // Collect console messages for diagnostics
  const previewLogs: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[preview]")) previewLogs.push(text);
  });

  await playAll.click();

  // The preview must eventually show an observer iframe (not a screenshot image)
  const observerIframe = page.locator("[data-preview-mode='observer-iframe']");
  const iframe = page.locator("iframe[title='Scenario live view']");

  // Wait up to 90s for the iframe to appear (setup can be slow: Vite start + createGrid)
  try {
    await expect(observerIframe).toBeVisible({ timeout: 90_000 });
  } catch (err) {
    // Dump diagnostics on failure
    const mode = await page.locator("[data-preview-mode]").first().getAttribute("data-preview-mode").catch(() => "none");
    console.error(`[test] Preview mode at failure: "${mode}"`);
    console.error(`[test] Preview console logs:\n${previewLogs.join("\n")}`);
    throw err;
  }

  // Verify the actual iframe element exists
  await expect(iframe).toBeVisible();

  // Ensure we're NOT in screenshot mode
  const screenshotMode = page.locator("[data-preview-mode='screenshot']");
  await expect(screenshotMode).toHaveCount(0);

  // Wait for at least step 1 to complete
  await page.locator("text=1 /").waitFor({ timeout: 120_000 });

  // After step completes, should STILL show observer iframe (paneLayout persists)
  await expect(observerIframe).toBeVisible({ timeout: 5_000 });
  await expect(iframe).toBeVisible();

  // No error banner
  await expect(page.locator(".bg-red-950")).toBeHidden();
});

test("studio: launch demo app from terminal and use todo list", async ({ page }) => {
  test.setTimeout(120_000);
  await waitForPlayerReady(page);

  const studioMode = page.locator("[data-preview-mode='studio-react']");
  await expect(studioMode).toBeVisible({ timeout: 30_000 });

  // Switch to side-by-side layout (terminal left, browser right)
  await page.locator("[data-testid='studio-layout-picker']").selectOption("side-by-side");

  // Add terminal in the left slot
  const placeholderAdd = page.locator("[data-testid='studio-placeholder-add']").first();
  await expect(placeholderAdd).toBeVisible({ timeout: 15_000 });
  await placeholderAdd.click();
  await page.locator("[data-testid='studio-add-terminal']").click();

  const terminal = page.frameLocator("iframe[src*='/terminal?']").first();
  const termInput = terminal.locator(".xterm-helper-textarea");
  const termRows = terminal.locator(".xterm-rows");

  await expect(termInput).toBeVisible({ timeout: 20_000 });
  await termInput.click();

  // Launch demo Vite app on port 5188 (player server cwd is apps/player/)
  await termInput.type("cd ../demo && npx vite --port 5188");
  await termInput.press("Enter");
  await expect(termRows).toContainText("Local:", { timeout: 60_000 });

  // Add browser pane in the right slot pointing to the demo app
  const placeholderAddRight = page.locator("[data-testid='studio-placeholder-add']").first();
  await expect(placeholderAddRight).toBeVisible({ timeout: 15_000 });
  await placeholderAddRight.click();
  await page.locator("[data-testid='studio-add-browser']").click();

  const urlInput = page.locator("[data-testid='studio-browser-url-input']");
  await expect(urlInput).toBeVisible();
  await urlInput.fill("http://localhost:5188");
  await page.locator("[data-testid='studio-browser-url-confirm']").click();

  // Wait for the demo app to load inside the iframe
  const browserIframe = page.locator("[data-testid='studio-browser-iframe']").first();
  await expect(browserIframe).toBeVisible({ timeout: 30_000 });
  const demoFrame = page.frameLocator("[data-testid='studio-browser-iframe']").first();
  await expect(demoFrame.locator("[data-testid='top-bar']")).toBeVisible({ timeout: 30_000 });

  // Navigate to the Todo page via burger menu
  await demoFrame.locator("[data-testid='burger-menu']").click();
  await demoFrame.locator("[data-testid='nav-notes']").click();
  await expect(demoFrame.locator("[data-testid='notes-page']")).toBeVisible({ timeout: 15_000 });

  // Add a todo item
  const noteInput = demoFrame.locator("[data-testid='note-input']");
  await noteInput.fill("Write tests");
  await demoFrame.locator("[data-testid='note-add-btn']").click();
  await expect(demoFrame.locator("[data-testid='note-title-0']")).toContainText("Write tests", { timeout: 5_000 });

  // Toggle the task as completed
  await demoFrame.locator("[data-testid='note-check-0']").click();
  await expect(demoFrame.locator("[data-testid='note-title-0'] span").first()).toHaveClass(/text-amber/, { timeout: 5_000 });

  // Add a second todo item
  await noteInput.fill("Review PR");
  await demoFrame.locator("[data-testid='note-add-btn']").click();
  await expect(demoFrame.locator("[data-testid='note-title-0']")).toContainText("Review PR", { timeout: 5_000 });

  // Delete the top item ("Review PR") and wait for exit animation to finish
  await demoFrame.locator("[data-testid='note-delete-0']").click();
  await expect(demoFrame.getByText("Review PR")).toHaveCount(0, { timeout: 5_000 });
  await expect(demoFrame.locator("[data-testid='note-title-0']")).toContainText("Write tests");
});

test("cached screenshots appear on second load", async ({ page }) => {
  test.setTimeout(30_000);
  await waitForPlayerReady(page);

  const dropdown = page.locator("select").first();
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  await dropdown.locator(`option[value="${BASIC_UI}"]`).waitFor({ state: "attached", timeout: 15_000 });
  await dropdown.selectOption(BASIC_UI);

  const playAll = page.getByRole("button", { name: "Play all" });
  await expect(playAll).toBeVisible({ timeout: 15_000 });

  const sidebarImages = page.locator(".overflow-y-auto img[src^='data:image/']");
  await expect(sidebarImages.first()).toBeVisible({ timeout: 10_000 });

  const clearCacheBtn = page.getByRole("button", { name: "Clear cache" });
  await expect(clearCacheBtn).toBeVisible();
  await clearCacheBtn.click();

  await expect(sidebarImages).toHaveCount(0, { timeout: 5_000 });
});
