/**
 * Simple Click scenario — opens a static HTML page and clicks the Confirm button.
 * Used by cursor-proof test to verify cursor overlay visibility.
 */
import { defineScenario, startServer, type Actor } from "browser2video";

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

interface Ctx {
    actor: Actor;
}

export default defineScenario<Ctx>("Simple Click", (s) => {
    s.setup(async (session) => {
        const server = await startServer({ type: "static", root: "tests/fixtures" });
        if (!server) throw new Error("Failed to start static server");
        session.addCleanup(() => server.stop());
        const { actor } = await session.openPage({
            url: `${server.baseURL}/simple-page.html`,
            viewport: { width: 650 },
        });
        return { actor };
    });

    s.step("Wait for page", async ({ actor }) => {
        await actor.waitFor('[data-testid="btn-confirm"]');
    });

    s.step("Hover confirm (cursor proof)", async ({ actor }) => {
        await actor.hover('[data-testid="btn-confirm"]');
        // Keep the cursor visible long enough for the player preview screencast
        // to capture a frame where the cursor is clearly present.
        await sleep(1500);
    });

    s.step("Click confirm button", async ({ actor }) => {
        const btn = actor.page.locator('[data-testid="btn-confirm"]');
        await actor.clickLocator(btn);
        await actor.waitFor('[data-testid="done-msg"].show', 10_000);
    });
});
