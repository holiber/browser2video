/**
 * Browse alexn.pro portfolio, find the Three Charts project,
 * navigate to its demo, and interact with the chart.
 */
import { defineScenario, type Actor, type Page } from "browser2video";

interface Ctx {
    actor: Actor;
    page: Page;
}

export default defineScenario<Ctx>("External Website", (s) => {
    s.setup(async (session) => {
        const { page, actor } = await session.openPage({
            url: "https://alexn.pro",
            viewport: { width: 1280, height: 720 },
        });
        return { actor, page };
    });

    s.step("Wait for portfolio page", async ({ actor }) => {
        await actor.waitFor("main", 20000);
    });

    s.step("Scroll to projects section", async ({ actor }) => {
        await actor.scroll(null, 800);
        await actor.scroll(null, 600);
    });

    s.step("Find Three Charts project", async ({ actor, page }) => {
        const threeCharts = page.locator("text=Three charts").first();
        await threeCharts.waitFor({ state: "visible", timeout: 15000 });
        await actor.clickLocator(threeCharts);
        // Wait for any navigation or popup
        await page.waitForTimeout(2000);
    });

    s.step("Navigate to Three Charts demo", async ({ actor, page }) => {
        // Go directly to the demo page
        await actor.goto("https://holiber.github.io/three-charts/demo/");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => { });
        // Wait for the WebGL chart to render
        await page.waitForTimeout(3000);
    });

    s.step("Switch to bars view", async ({ actor, page }) => {
        const barsBtn = page.locator('button[name="switch-bars"]');
        await barsBtn.waitFor({ state: "visible", timeout: 10000 });
        await actor.clickLocator(barsBtn);
        await page.waitForTimeout(1000);
    });

    s.step("Change timeframe: 5 minutes", async ({ actor, page }) => {
        const btn5m = page.locator('button.timeframe:has-text("5m")');
        await btn5m.waitFor({ state: "visible", timeout: 10000 });
        await actor.clickLocator(btn5m);
        await page.waitForTimeout(1000);
    });

    s.step("Change timeframe: 30 minutes", async ({ actor, page }) => {
        const btn30m = page.locator('button.timeframe:has-text("30m")');
        await actor.clickLocator(btn30m);
        await page.waitForTimeout(1000);
    });

    s.step("Switch to line view", async ({ actor, page }) => {
        const lineBtn = page.locator('button[name="switch-line"]');
        await actor.clickLocator(lineBtn);
        await page.waitForTimeout(1000);
    });

    s.step("Change timeframe: 1 hour", async ({ actor, page }) => {
        const btn1h = page.locator('button.timeframe:has-text("1h")');
        await actor.clickLocator(btn1h);
        await page.waitForTimeout(1000);
    });

    s.step("Toggle trend overlays", async ({ actor, page }) => {
        // Enable Red trend
        const redTrend = page.locator('input[name="redtrend"]');
        await actor.clickLocator(redTrend);
        await page.waitForTimeout(500);
        // Enable Blue trend
        const blueTrend = page.locator('input[name="bluetrend"]');
        await actor.clickLocator(blueTrend);
        await page.waitForTimeout(500);
    });
});
