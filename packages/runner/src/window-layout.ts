/**
 * @description Best-effort window layout helpers (headed mode only).
 *
 * Uses Chrome DevTools Protocol `Browser.setWindowBounds` when available.
 * In headless mode or unsupported environments, functions become no-ops.
 */
import type { Page, CDPSession } from "playwright";

export type WindowRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

async function tryGetWindowId(page: Page): Promise<number | null> {
  try {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const res = await cdp.send("Browser.getWindowForTarget");
    await cdp.detach();
    const id = (res as any)?.windowId;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

export async function trySetWindowRect(page: Page, rect: WindowRect): Promise<boolean> {
  const windowId = await tryGetWindowId(page);
  if (windowId === null) return false;
  try {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { ...rect, windowState: "normal" },
    });
    await cdp.detach();
    return true;
  } catch {
    return false;
  }
}

export async function tryTileHorizontally(
  pages: Page[],
  opts: { left: number; top: number; tileWidth: number; tileHeight: number; gap?: number },
): Promise<void> {
  const gap = opts.gap ?? 0;
  await Promise.all(
    pages.map((page, i) =>
      trySetWindowRect(page, {
        left: opts.left + i * (opts.tileWidth + gap),
        top: opts.top,
        width: opts.tileWidth,
        height: opts.tileHeight,
      }),
    ),
  );
}

