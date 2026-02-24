/**
 * @browser2video/test — Playwright integration for browser2video.
 *
 * Each test(title, ...) automatically becomes a b2v step with that title.
 * The test context provides `session`, `grid`, and `actor` fixtures.
 *
 * ```ts
 * import { test, expect, setGrid } from '@browser2video/test';
 *
 * test.beforeAll(async ({ session }) => {
 *   const grid = await session.createGrid([
 *     { url: 'http://localhost:3000', label: 'App' },
 *   ], { viewport: { width: 1280, height: 720 }, grid: [[0]] });
 *   setGrid(grid);
 * });
 *
 * test('Create Todo', async ({ actor }) => {
 *   await actor.type('[data-testid="input"]', 'Buy groceries');
 *   await actor.click('[data-testid="add-btn"]');
 * });
 * ```
 */
export { test, setGrid, setActor, getSession } from "./fixtures.ts";
export type { B2VTestFixtures, B2VWorkerFixtures } from "./fixtures.ts";
export { expect } from "@playwright/test";
