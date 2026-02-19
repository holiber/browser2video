import { test, expect, type Page } from "@playwright/test";

const BASIC_UI = "tests/scenarios/basic-ui.scenario.ts";
const TUTORIAL = "tests/scenarios/css-buttons-tutorial.scenario.ts";

async function loadScenario(page: Page, scenarioFile: string) {
  await page.goto("/");
  await page.locator('[title="Connected"]').waitFor({ timeout: 15_000 });

  const dropdown = page.locator("select").first();
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  await dropdown.locator(`option[value="${scenarioFile}"]`).waitFor({ state: "attached", timeout: 15_000 });
  await dropdown.selectOption(scenarioFile);

  const playAll = page.getByRole("button", { name: "Play all" });
  await expect(playAll).toBeVisible({ timeout: 15_000 });
  return playAll;
}

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

test("cached screenshots appear on second load", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  await page.locator('[title="Connected"]').waitFor({ timeout: 15_000 });

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
