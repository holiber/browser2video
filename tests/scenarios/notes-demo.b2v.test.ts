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
import { startServer } from "browser2video";

test.describe("Notes Demo", () => {
    test.beforeAll(async () => {
        const session = getSession();

        // Start the project's demo Vite server
        const server = await startServer({ type: "vite", root: "apps/demo" });
        session.addCleanup(() => server.stop());

        const { actor } = await session.openPage({
            url: `${server.baseURL}/notes?role=boss`,
        });
        setActor(actor);
    });

    test("Add first task", async ({ actor }) => {
        await actor.type('[data-testid="note-input"]', "Setup database");
        await actor.click('[data-testid="note-add-btn"]');
    });

    test("Add second task", async ({ actor }) => {
        await actor.type('[data-testid="note-input"]', "Write API routes");
        await actor.click('[data-testid="note-add-btn"]');
    });

    test("Complete first task", async ({ actor }) => {
        await actor.click('[data-testid="note-check-0"]');
    });
});
