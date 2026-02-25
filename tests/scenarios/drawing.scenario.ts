/**
 * Drawing scenario — tests laser-pointer highlight and freehand drawing
 * annotations on a slide carousel with an animated starfield background.
 */
import { defineScenario, startServer } from "browser2video";
import type { Page } from "playwright-core";

interface Ctx {
    actor: import("browser2video").Actor;
}

const narrations = {
    intro: "This scenario demonstrates the laser pointer and drawing overlay features.",
    highlight: "First, let's highlight the slide title using the laser pointer.",
    drawing: "Now let's draw some annotations right on the page.",
    outro: "And that's it!",
};

const CHECKMARK_POINTS = [
    { x: 0.42, y: 0.52 },
    { x: 0.46, y: 0.58 },
    { x: 0.48, y: 0.60 },
    { x: 0.54, y: 0.48 },
    { x: 0.60, y: 0.40 },
];

const STAR_POINTS = [
    { x: 0.50, y: 0.30 },
    { x: 0.53, y: 0.42 },
    { x: 0.62, y: 0.42 },
    { x: 0.55, y: 0.50 },
    { x: 0.58, y: 0.62 },
    { x: 0.50, y: 0.54 },
    { x: 0.42, y: 0.62 },
    { x: 0.45, y: 0.50 },
    { x: 0.38, y: 0.42 },
    { x: 0.47, y: 0.42 },
    { x: 0.50, y: 0.30 },
];

async function assertSlide(page: Page, expected: number) {
    const expectedText = `Slide ${expected} of 5`;
    await page.waitForFunction(
        (text: string) =>
            document.querySelector('[data-testid="slides-current"]')?.textContent?.trim() === text,
        expectedText,
        { timeout: 5000 },
    );
}

export default defineScenario<Ctx>("Drawing", (s) => {
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

    s.step("Highlight slide title", narrations.highlight, async ({ actor }) => {
        await actor.highlight('[data-testid="slides-title-0"]');
    });

    s.step("Draw annotation", narrations.drawing, async ({ actor }) => {
        await actor.drawOnPage(STAR_POINTS, {
            color: "rgba(250, 204, 21, 0.9)",
            lineWidth: 3,
        });
        await actor.drawOnPage(CHECKMARK_POINTS, {
            color: "rgba(74, 222, 128, 0.9)",
            lineWidth: 4,
        });
    });

    s.step("Outro", narrations.outro, async ({ actor }) => {
        await actor.page.evaluate(() => {
            const c = document.getElementById("__b2v_draw_overlay");
            if (c) c.remove();
        });
    });
});
