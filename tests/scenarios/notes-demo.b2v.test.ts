/**
 * Sample test demonstrating @browser2video/test integration.
 *
 * Each test() call automatically becomes a b2v step using the test title.
 * The `actor` fixture is set via `setActor()` in beforeAll.
 *
 * Run:
 *   npx playwright test notes-demo.b2v.test.ts
 */
import { test, expect, setActor, getSession } from "@browser2video/test";

test.describe("Notes Demo", () => {
    test.beforeAll(async () => {
        const session = getSession();
        const { actor } = await session.openPage({
            url: "https://demo.playwright.dev/todomvc/#/",
        });
        setActor(actor);
    });

    test("Add first todo", async ({ actor }) => {
        // This test title "Add first todo" becomes step caption
        await actor.type(".new-todo", "Setup database");
        await actor.pressKey("Enter");
    });

    test("Add second todo", async ({ actor }) => {
        await actor.type(".new-todo", "Write API routes");
        await actor.pressKey("Enter");
    });

    test("Add third todo", async ({ actor }) => {
        await actor.type(".new-todo", "Deploy to production");
        await actor.pressKey("Enter");
    });
});
