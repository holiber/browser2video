/**
 * Slides and Narration scenario — tests narrator speech and mouse interactions
 * (button clicks + swipe via drag) on a slide carousel with an animated
 * starfield background.
 */
import { defineScenario, startServer } from "browser2video";
import type { Page } from "playwright-core";

interface Ctx {
    actor: import("browser2video").Actor;
}

const narrations = {
    intro: "This scenario tests narration and simple mouse interactions with a slide carousel.",
    buttons: "First, let's navigate through the slides using the forward and back buttons.",
    swipe: "Now let's try swiping left and right to change slides, just like on a touchscreen.",
    outro: "And that's it!",
};

const DRAG_SELECTOR = '[data-slot="carousel-content"]';

async function assertSlide(page: Page, expected: number) {
    const expectedText = `Slide ${expected} of 5`;
    await page.waitForFunction(
        (text: string) =>
            document.querySelector('[data-testid="slides-current"]')?.textContent?.trim() === text,
        expectedText,
        { timeout: 5000 },
    );
}

export default defineScenario<Ctx>("Slides and Narration", (s) => {
    s.setup(async (session) => {
        const server = await startServer({ type: "vite", root: "apps/demo" });
        if (!server) throw new Error("Failed to start Vite server");
        session.addCleanup(() => server.stop());

        const { actor } = await session.openPage({
            url: `${server.baseURL}/slides`,
            viewport: { width: 650 },
        });

        for (const text of Object.values(narrations)) {
            await session.audio.warmup(text);
        }

        return { actor };
    });

    s.step("Introduction", narrations.intro, async ({ actor }) => {
        await actor.waitFor('[data-testid="slides-page"]');
        await assertSlide(actor.page, 1);
    });

    s.step("Navigate forward with buttons", narrations.buttons, async ({ actor }) => {
        await actor.click('[data-testid="slides-next"]');
        await assertSlide(actor.page, 2);

        await actor.click('[data-testid="slides-next"]');
        await assertSlide(actor.page, 3);

        await actor.click('[data-testid="slides-next"]');
        await assertSlide(actor.page, 4);
    });

    s.step("Navigate backward with buttons", async ({ actor }) => {
        await actor.click('[data-testid="slides-prev"]');
        await assertSlide(actor.page, 3);

        await actor.click('[data-testid="slides-prev"]');
        await assertSlide(actor.page, 2);
    });

    s.step("Swipe forward", narrations.swipe, async ({ actor }) => {
        await actor.dragByOffset(DRAG_SELECTOR, -300, 0);
        await assertSlide(actor.page, 3);

        await actor.dragByOffset(DRAG_SELECTOR, -300, 0);
        await assertSlide(actor.page, 4);
    });

    s.step("Swipe backward", async ({ actor }) => {
        await actor.dragByOffset(DRAG_SELECTOR, 300, 0);
        await assertSlide(actor.page, 3);
    });

    s.step("Outro", narrations.outro, async () => {});
});
