/**
 * Playwright fixtures for browser2video integration.
 *
 * Provides:
 * - `session` — b2v Session (lazily created, shared across all tests)
 * - `actor` — test-scoped convenience accessor for the current actor
 * - Auto step wrapping — each test(title) → session.beginStep(title) / endStep()
 *
 * Usage with openPage:
 * ```ts
 * import { test, expect, setActor, getSession } from '@browser2video/test';
 *
 * test.beforeAll(async () => {
 *   const session = await getSession();
 *   const { actor } = await session.openPage({ url: 'http://localhost:3000' });
 *   setActor(actor);
 * });
 *
 * test('Create Todo', async ({ actor }) => {
 *   await actor.type('#input', 'Buy groceries');
 *   await actor.click('#add');
 * });
 * ```
 *
 * Usage with createGrid:
 * ```ts
 * import { test, expect, setGrid, getSession } from '@browser2video/test';
 *
 * test.beforeAll(async () => {
 *   const session = await getSession();
 *   const grid = await session.createGrid([...], { ... });
 *   setGrid(grid);
 * });
 *
 * test('Open terminal', async ({ actor }) => {
 *   await actor.typeAndEnter('ls -la');
 * });
 * ```
 */
import { test as base } from "@playwright/test";
import { createSession, type Session, type GridHandle, type Actor, TerminalActor } from "browser2video";

// ---------------------------------------------------------------------------
//  Shared state per worker
// ---------------------------------------------------------------------------

let _session: Session | null = null;
let _sessionPromise: Promise<Session> | null = null;
let _currentGrid: GridHandle | null = null;
let _currentActor: Actor | TerminalActor | null = null;

// ---------------------------------------------------------------------------
//  Fixture types
// ---------------------------------------------------------------------------

export interface B2VTestFixtures {
    /** The b2v Session. */
    session: Session;
    /** The current grid handle. Set via `setGrid()` in beforeAll. */
    grid: GridHandle;
    /** The current actor. Set via `setActor()` or derived from `setGrid()`. */
    actor: Actor | TerminalActor;
    /** Auto-fixture: wraps each test in beginStep/endStep. Do not use directly. */
    _b2vAutoStep: void;
}

export interface B2VWorkerFixtures {
    /** Internal: worker-level Session lifecycle. */
    _b2vWorker: void;
}

// ---------------------------------------------------------------------------
//  Extended test
// ---------------------------------------------------------------------------

export const test = base.extend<B2VTestFixtures, B2VWorkerFixtures>({
    // Worker-scoped: ensure session is cleaned up after all tests
    _b2vWorker: [async ({ }, use) => {
        await use();
        // Cleanup when worker is done
        if (_session) {
            try { await _session.finish(); } catch { /* cleanup */ }
            _session = null;
            _sessionPromise = null;
            _currentGrid = null;
            _currentActor = null;
        }
    }, { scope: "worker", auto: true }],

    // Test-scoped session accessor
    session: async ({ }, use) => {
        await use(await getSession());
    },

    // Auto-fixture: wraps test body in beginStep / endStep
    _b2vAutoStep: [async ({ }, use, testInfo) => {
        const session = await getSession();
        session.beginStep(testInfo.title);
        await use();
        await session.endStep();
    }, { auto: true }],

    // Grid accessor
    grid: async ({ }, use) => {
        if (!_currentGrid) {
            throw new Error("No grid. Call setGrid() in test.beforeAll after createGrid.");
        }
        await use(_currentGrid);
    },

    // Actor accessor — works with both openPage and createGrid
    actor: async ({ }, use) => {
        if (_currentActor) {
            await use(_currentActor);
        } else if (_currentGrid) {
            await use(_currentGrid.actors[0]);
        } else {
            throw new Error(
                "No actor available. Call setActor() or setGrid() in test.beforeAll.",
            );
        }
    },
});

// ---------------------------------------------------------------------------
//  Public helpers
// ---------------------------------------------------------------------------

/**
 * Get or create the b2v Session. Safe to call from test.beforeAll.
 * The session is created once and shared across all tests in the worker.
 */
export async function getSession(): Promise<Session> {
    if (_session) return _session;
    if (!_sessionPromise) {
        _sessionPromise = createSession().then((s) => {
            _session = s;
            return s;
        });
    }
    return _sessionPromise;
}

/**
 * Set the active actor for subsequent tests.
 * Call from test.beforeAll after session.openPage().
 */
export function setActor(actor: Actor | TerminalActor): void {
    _currentActor = actor;
}

/**
 * Set the active grid (and its first actor) for subsequent tests.
 * Call from test.beforeAll after session.createGrid().
 */
export function setGrid(grid: GridHandle): void {
    _currentGrid = grid;
    if (!_currentActor) {
        _currentActor = grid.actors[0];
    }
}
