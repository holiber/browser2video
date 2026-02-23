/**
 * @description InjectedActor — injects a visible cursor and typing engine
 * directly into a page's DOM. Unlike the regular Actor (which uses real CDP
 * mouse/keyboard events for recording), InjectedActor dispatches synthetic
 * DOM events and renders cursor movement inside the page itself.
 *
 * Use case: testing apps where you need visible in-page cursors without CDP
 * screencasts — e.g., the player smoke-testing its own UI.
 *
 * ```ts
 * const actor = new InjectedActor(page, "tester");
 * await actor.init();
 * await actor.click("[data-testid='add-btn']");
 * await actor.type("#search", "hello");
 * ```
 */
import type { Page, Frame } from "playwright";
import type { Mode, ActorDelays, DelayRange } from "./types.ts";
import { CURSOR_OVERLAY_SCRIPT, windMouse, linearPath, pickMs, mergeDelays } from "./actor.ts";

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function easedStepMs(baseMs: number, i: number, n: number): number {
    if (n <= 1) return baseMs;
    const t = Math.min(1, Math.max(0, i / (n - 1)));
    const mult = 0.3 + 1.2 * t * t;
    return Math.max(0, Math.round(baseMs * mult));
}

// ---------------------------------------------------------------------------
//  InjectedActor
// ---------------------------------------------------------------------------

export class InjectedActor {
    readonly page: Page;
    readonly actorId: string;
    readonly mode: Mode;
    private cursorX = 0;
    private cursorY = 0;
    private _initialized = false;
    private _cursorInitialized = false;
    private delays: ActorDelays;
    /** DOM context for selector lookups — page by default, can be an iframe Frame */
    private _context: Page | Frame;

    constructor(
        page: Page,
        actorId: string = "injected",
        opts?: {
            mode?: Mode;
            delays?: Partial<ActorDelays>;
            context?: Page | Frame;
        },
    ) {
        this.page = page;
        this.actorId = actorId;
        this.mode = opts?.mode ?? "human";
        this.delays = mergeDelays(this.mode, opts?.delays);
        this._context = opts?.context ?? page;
    }

    /** Inject the cursor overlay script into the page. Must be called once before interaction. */
    async init(): Promise<void> {
        if (this._initialized) return;
        await this.page.evaluate(CURSOR_OVERLAY_SCRIPT);
        this._initialized = true;
    }

    // -----------------------------------------------------------------------
    //  Cursor movement
    // -----------------------------------------------------------------------

    /** Move cursor smoothly to absolute page coordinates. */
    async moveCursorTo(x: number, y: number): Promise<void> {
        await this.init();
        const tx = Math.round(x);
        const ty = Math.round(y);

        if (!this._cursorInitialized) {
            this._cursorInitialized = true;
            this.cursorX = tx;
            this.cursorY = ty;
            await this.page.evaluate(
                `window.__b2v_moveCursor?.(${tx}, ${ty}, '${this.actorId}')`,
            );
            return;
        }

        if (this.mode === "fast") {
            this.cursorX = tx;
            this.cursorY = ty;
            await this.page.evaluate(
                `window.__b2v_moveCursor?.(${tx}, ${ty}, '${this.actorId}')`,
            );
            return;
        }

        const from = { x: this.cursorX, y: this.cursorY };
        const points = windMouse(from, { x: tx, y: ty });
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            await this.page.evaluate(
                `window.__b2v_moveCursor?.(${p.x}, ${p.y}, '${this.actorId}')`,
            );
            await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, points.length));
        }
        this.cursorX = tx;
        this.cursorY = ty;
    }

    // -----------------------------------------------------------------------
    //  Element interaction helpers
    // -----------------------------------------------------------------------

    /**
     * Resolve an element's bounding box center. Scrolls it into view first.
     */
    private async _getElementCenter(
        selector: string,
    ): Promise<{ x: number; y: number }> {
        const el = await this._context.waitForSelector(selector, {
            state: "visible",
            timeout: 10_000,
        });
        if (!el) throw new Error(`Element not found: ${selector}`);

        const scrollBehavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";
        await el.evaluate(
            (e, b) => (e as Element).scrollIntoView({ block: "center", behavior: b }),
            scrollBehavior,
        );
        await sleep(pickMs(this.delays.afterScrollIntoViewMs));

        const box = await el.boundingBox();
        if (!box) throw new Error(`Element has no bounding box: ${selector}`);
        return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
        };
    }

    // -----------------------------------------------------------------------
    //  Click
    // -----------------------------------------------------------------------

    /**
     * Click on an element. Moves cursor smoothly, shows click ripple, and
     * dispatches a real Playwright click (which fires all DOM events properly).
     */
    async click(selector: string): Promise<void> {
        const center = await this._getElementCenter(selector);
        await this.moveCursorTo(center.x, center.y);

        // Show visual click effect
        if (this.mode === "human") {
            await this.page.evaluate(
                `window.__b2v_clickEffect?.(${center.x}, ${center.y})`,
            );
            await sleep(pickMs(this.delays.clickEffectMs));
        }

        // Perform actual click via Playwright (this fires native events properly)
        await this.page.mouse.click(center.x, center.y);

        if (this.mode === "human") {
            await sleep(pickMs(this.delays.afterClickMs));
        }
    }

    /**
     * Click at specific page coordinates.
     */
    async clickAt(x: number, y: number): Promise<void> {
        await this.moveCursorTo(x, y);

        if (this.mode === "human") {
            await this.page.evaluate(`window.__b2v_clickEffect?.(${x}, ${y})`);
            await sleep(pickMs(this.delays.clickEffectMs));
        }

        await this.page.mouse.click(x, y);

        if (this.mode === "human") {
            await sleep(pickMs(this.delays.afterClickMs));
        }
    }

    // -----------------------------------------------------------------------
    //  Type
    // -----------------------------------------------------------------------

    /**
     * Type text into an element. Clicks the element first to focus it,
     * then types character by character with human-like delays.
     */
    async type(selector: string, text: string): Promise<void> {
        await this.click(selector);
        await sleep(pickMs(this.delays.beforeTypeMs));

        if (this.mode === "fast") {
            await this.page.keyboard.type(text, { delay: 0 });
            return;
        }

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "\n") {
                await this.page.keyboard.press("Enter");
            } else {
                await this.page.keyboard.type(ch, { delay: pickMs(this.delays.keyDelayMs) });
            }
            if (ch === " " || ch === "@" || ch === ".") {
                await sleep(pickMs(this.delays.keyBoundaryPauseMs));
            }
        }

        await sleep(pickMs(this.delays.afterTypeMs));
    }

    /**
     * Type text and press Enter.
     */
    async typeAndEnter(selector: string, text: string): Promise<void> {
        await this.type(selector, text + "\n");
    }

    // -----------------------------------------------------------------------
    //  Key press
    // -----------------------------------------------------------------------

    /**
     * Press a keyboard key.
     */
    async pressKey(key: string): Promise<void> {
        await this.page.keyboard.press(key);
        if (this.mode === "human") {
            await sleep(pickMs(this.delays.breatheMs));
        }
    }

    // -----------------------------------------------------------------------
    //  Navigation
    // -----------------------------------------------------------------------

    /** Navigate the page to a URL. */
    async goto(url: string): Promise<void> {
        await this._context.goto(url, { waitUntil: "domcontentloaded" });
        // Re-inject cursor overlay after navigation
        this._initialized = false;
        await this.init();
    }

    // -----------------------------------------------------------------------
    //  Wait/assert helpers
    // -----------------------------------------------------------------------

    /** Wait for an element to appear. */
    async waitFor(selector: string, timeout = 10_000): Promise<void> {
        await this._context.waitForSelector(selector, { state: "visible", timeout });
    }

    /** Wait for an element to become hidden. */
    async waitForHidden(selector: string, timeout = 10_000): Promise<void> {
        await this._context.waitForSelector(selector, { state: "hidden", timeout });
    }

    // -----------------------------------------------------------------------
    //  Scroll
    // -----------------------------------------------------------------------

    /** Scroll within an element or the page. */
    async scroll(selector: string | null, deltaY: number): Promise<void> {
        if (selector) {
            await this.moveCursorTo(
                ...(Object.values(await this._getElementCenter(selector)) as [number, number]),
            );
        }

        const behavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";

        if (selector) {
            await this._context.evaluate(
                ({ selector, deltaY, behavior }) => {
                    const el = document.querySelector(selector) as HTMLElement | null;
                    if (el) el.scrollBy({ top: deltaY, behavior });
                    else window.scrollBy({ top: deltaY, behavior });
                },
                { selector, deltaY, behavior },
            );
        } else {
            await this._context.evaluate(
                ({ deltaY, behavior }) => {
                    window.scrollBy({ top: deltaY, behavior });
                },
                { deltaY, behavior },
            );
        }

        await sleep(this.mode === "human" ? 600 : 50);
    }

    // -----------------------------------------------------------------------
    //  Breathe
    // -----------------------------------------------------------------------

    /** Add a breathing pause between major steps (human mode only). */
    async breathe(): Promise<void> {
        await sleep(pickMs(this.delays.breatheMs));
    }
}
