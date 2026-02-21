/**
 * Manages Playwright-backed browser panes for the studio.
 * Each pane is a real Playwright Page with CDP screencast streaming
 * and an Actor for interaction (both UI-forwarded and scenario-driven).
 */
import { chromium, Actor, type ReplayEvent } from "browser2video";
import type { Browser, BrowserContext, Page } from "playwright";

export interface StudioPane {
  id: string;
  url: string;
  context: BrowserContext;
  page: Page;
  actor: Actor;
  cdpSession: any;
}

export class StudioBrowserManager {
  private browser: Browser | null = null;
  private panes = new Map<string, StudioPane>();

  onFrame: ((paneId: string, data: string) => void) | null = null;
  onReplayEvent: ((paneId: string, event: ReplayEvent) => void) | null = null;

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async openPane(paneId: string, url: string): Promise<Actor> {
    if (this.panes.has(paneId)) {
      await this.closePane(paneId);
    }

    console.error(`[studio-browser] Launching browser for pane "${paneId}"...`);
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    await context.route("**/*", async (route) => {
      try {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers["x-frame-options"];
        delete headers["X-Frame-Options"];
        const csp = headers["content-security-policy"];
        if (csp) {
          headers["content-security-policy"] = csp.replace(/frame-ancestors\s+[^;]+;?/gi, "");
        }
        await route.fulfill({ response, headers });
      } catch {
        await route.continue().catch(() => {});
      }
    });

    const page = await context.newPage();
    const actor = new Actor(page, "human");
    actor.setSessionStartTime(Date.now());
    actor.onReplayEvent = (event) => {
      this.onReplayEvent?.(paneId, event);
    };

    console.error(`[studio-browser] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((err) => {
      console.error(`[studio-browser] Navigation error (non-fatal): ${err.message}`);
    });

    console.error(`[studio-browser] Starting CDP screencast for pane "${paneId}"...`);
    const cdpSession = await page.context().newCDPSession(page);
    let firstFrame = true;
    cdpSession.on("Page.screencastFrame", (params: any) => {
      if (firstFrame) { firstFrame = false; console.error(`[studio-browser] First screencast frame for "${paneId}"`); }
      this.onFrame?.(paneId, params.data);
      cdpSession.send("Page.screencastFrameAck", {
        sessionId: params.sessionId,
      }).catch(() => {});
    });
    await cdpSession.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 2,
    });

    const pane: StudioPane = { id: paneId, url, context, page, actor, cdpSession };
    this.panes.set(paneId, pane);
    console.error(`[studio-browser] Pane "${paneId}" ready`);

    return actor;
  }

  getActor(paneId: string): Actor | undefined {
    return this.panes.get(paneId)?.actor;
  }

  getPage(paneId: string): Page | undefined {
    return this.panes.get(paneId)?.page;
  }

  async forwardMouseEvent(paneId: string, action: string, x: number, y: number, opts?: {
    button?: "left" | "right" | "middle";
    deltaX?: number;
    deltaY?: number;
  }): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const { page, actor } = pane;
    switch (action) {
      case "move":
        await page.mouse.move(x, y);
        actor.onReplayEvent?.({ type: "cursorMove", x, y, ts: Date.now() - (actor as any)._sessionStartTime });
        break;
      case "click":
        await page.mouse.click(x, y, { button: opts?.button ?? "left" });
        actor.onReplayEvent?.({ type: "click", x, y, ts: Date.now() - (actor as any)._sessionStartTime });
        break;
      case "down":
        await page.mouse.down({ button: opts?.button ?? "left" });
        break;
      case "up":
        await page.mouse.up({ button: opts?.button ?? "left" });
        break;
      case "wheel":
        await page.mouse.wheel(opts?.deltaX ?? 0, opts?.deltaY ?? 0);
        break;
    }
  }

  async forwardKeyboardEvent(paneId: string, action: string, key: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const { page, actor } = pane;
    switch (action) {
      case "press":
        await page.keyboard.press(key);
        actor.onReplayEvent?.({ type: "keyPress", key, ts: Date.now() - (actor as any)._sessionStartTime });
        break;
      case "type":
        await page.keyboard.type(key);
        break;
      case "down":
        await page.keyboard.down(key);
        break;
      case "up":
        await page.keyboard.up(key);
        break;
    }
  }

  async closePane(paneId: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    this.panes.delete(paneId);

    try { await pane.cdpSession.send("Page.stopScreencast"); } catch {}
    try { await pane.cdpSession.detach(); } catch {}
    try { await pane.context.close(); } catch {}
  }

  async dispose(): Promise<void> {
    for (const paneId of [...this.panes.keys()]) {
      await this.closePane(paneId);
    }
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }
}
