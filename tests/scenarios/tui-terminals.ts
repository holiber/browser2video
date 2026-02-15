/**
 * @description Scenario showing interactive shell terminals with TUI apps (htop, mc)
 * running inside in-browser xterm panes connected to real PTYs.
 * Demonstrates keyboard and mouse interaction within TUIs.
 * htop runs in Terminal 2 while mc is used in Terminal 1 — both visible simultaneously.
 */
import type { ScenarioContext } from "@browser2video/runner";
import { startTerminalWsServer } from "./terminal/terminal-ws-server.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Focus xterm.js terminal and verify the textarea received focus.
 */
async function focusTerminal(page: any, testId: string) {
  const selector = `[data-testid="${testId}"] .xterm-helper-textarea`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((sel: string) => {
      const ta = document.querySelector(sel) as HTMLElement | null;
      ta?.focus();
    }, selector);
    await sleep(150);
    const ok = await page.evaluate(
      (sel: string) => document.activeElement === document.querySelector(sel),
      selector,
    );
    if (ok) return;
  }
}

/**
 * Type text into a terminal. Focuses the textarea element handle directly
 * to ensure keystrokes reach the correct terminal.
 */
async function typeInTerminal(page: any, testId: string, text: string, opts?: { delay?: number }) {
  const selector = `[data-testid="${testId}"] .xterm-helper-textarea`;
  const el = await page.$(selector);
  if (!el) throw new Error(`Terminal textarea not found: ${selector}`);
  await el.focus();
  await sleep(100);
  for (const ch of text) {
    if (ch === "\n") {
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.type(ch, { delay: 0 });
    }
    if (opts?.delay) await sleep(opts.delay);
  }
}

/** Wait until the XtermPane WebSocket transitions to "open". */
async function waitForWsOpen(page: any, selector: string, timeoutMs = 15000) {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel) as any;
      return String(el?.dataset?.b2vWsState ?? "") === "open";
    },
    { timeout: timeoutMs },
    selector,
  );
}

/** Wait until the xterm rows contain ALL of the given substrings. */
async function waitForXtermText(page: any, rootSelector: string, includes: string[], timeoutMs: number) {
  await page.waitForFunction(
    (sel: string, inc: string[]) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const rows = root.querySelector(".xterm-rows");
      const text = String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
      return inc.every((s) => text.includes(s));
    },
    { timeout: timeoutMs },
    rootSelector,
    includes,
  );
}

/** Wait for shell prompt ($ ) to appear. */
async function waitForPrompt(page: any, testId: string, timeoutMs = 15000) {
  await waitForXtermText(page, `[data-testid="${testId}"]`, ["$"], timeoutMs);
}

/**
 * Click at a relative position inside a terminal with visible cursor animation.
 * Uses the actor's cursor overlay (__b2v_moveCursor / __b2v_clickEffect) so
 * the mouse movement and click are visible in the recorded video.
 */
async function clickInTerminal(page: any, testId: string, relX: number, relY: number) {
  const box = await page.$eval(`[data-testid="${testId}"]`, (el: any) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const targetX = Math.round(box.x + box.width * relX);
  const targetY = Math.round(box.y + box.height * relY);

  // Read current cursor position from the overlay element
  const startPos = await page.evaluate(() => {
    const cursor = document.getElementById("__b2v_cursor");
    if (!cursor) return null;
    const m = cursor.style.transform.match(/translate\((.+?)px,\s*(.+?)px\)/);
    if (m) return { x: parseFloat(m[1]) + 2, y: parseFloat(m[2]) + 2 };
    return null;
  });

  const fromX = startPos?.x ?? targetX - 80;
  const fromY = startPos?.y ?? targetY - 40;

  // Animate cursor movement with ease-out cubic (visible in recording)
  const steps = 25;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 3);
    const px = Math.round(fromX + (targetX - fromX) * ease);
    const py = Math.round(fromY + (targetY - fromY) * ease);
    await page.mouse.move(px, py);
    await page.evaluate(`window.__b2v_moveCursor?.(${px}, ${py})`);
    if (i < steps) await sleep(8);
  }

  // Click ripple effect
  await page.evaluate(`window.__b2v_clickEffect?.(${targetX}, ${targetY})`);
  await sleep(40);

  // Press-and-release
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(60);
}

export async function tuiTerminalsScenario(ctx: ScenarioContext) {
  const { step, actor, page, baseURL } = ctx;
  const srv = await startTerminalWsServer();

  try {
    await step("Open notes with terminals", async () => {
      const url = `${baseURL}/notes?termWs=${encodeURIComponent(srv.baseWsUrl)}`;
      await actor.goto(url);
      await actor.waitFor('[data-testid="notes-page"]');
      await actor.waitFor('[data-testid="xterm-term1"] .xterm');
      await actor.waitFor('[data-testid="xterm-term2"] .xterm');
    });

    await step("Wait for terminal connections", async () => {
      await waitForWsOpen(page, '[data-testid="xterm-term1"]');
      await waitForWsOpen(page, '[data-testid="xterm-term2"]');
    });

    await step("Wait for shell prompts", async () => {
      await waitForPrompt(page, "xterm-term1");
      await waitForPrompt(page, "xterm-term2");
    });

    // --- Launch htop in Terminal 2 (stays running throughout) ---

    await step("Run htop in Terminal 2", async () => {
      await typeInTerminal(page, "xterm-term2", "htop\n", { delay: 60 });
      await waitForXtermText(page, '[data-testid="xterm-term2"]', ["CPU"], 20000);
      await sleep(1000);
    });

    // --- Launch mc in Terminal 1 (htop keeps running in Terminal 2) ---

    await step("Run mc in Terminal 1", async () => {
      await typeInTerminal(page, "xterm-term1", "mc\n", { delay: 60 });
      await waitForXtermText(page, '[data-testid="xterm-term1"]', ["1Help"], 20000);
      await sleep(800);
    });

    await step("Navigate mc with keyboard", async () => {
      await focusTerminal(page, "xterm-term1");
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("ArrowDown");
        await sleep(300);
      }
      await page.keyboard.press("ArrowUp");
      await sleep(300);
    });

    await step("Click files in left panel", async () => {
      await focusTerminal(page, "xterm-term1");
      await clickInTerminal(page, "xterm-term1", 0.20, 0.14);
      await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.22);
      await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.30);
      await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.18);
      await sleep(400);
    });

    await step("Click files in right panel", async () => {
      await clickInTerminal(page, "xterm-term1", 0.70, 0.14);
      await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.70, 0.22);
      await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.70, 0.30);
      await sleep(400);
    });

    await step("Open directory with Enter", async () => {
      await clickInTerminal(page, "xterm-term1", 0.70, 0.10);
      await sleep(300);
      await page.keyboard.press("Enter");
      await sleep(800);
    });

    await step("Click back to left panel", async () => {
      await clickInTerminal(page, "xterm-term1", 0.20, 0.18);
      await sleep(400);
      await page.keyboard.press("ArrowDown");
      await sleep(300);
      await page.keyboard.press("ArrowDown");
      await sleep(300);
    });

    // --- Quit both TUIs ---

    await step("Quit mc", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.press("F10");
      await sleep(500);
      await page.keyboard.press("Enter");
      await waitForPrompt(page, "xterm-term1", 10000);
    });

    await step("Quit htop", async () => {
      await typeInTerminal(page, "xterm-term2", "q");
      await waitForPrompt(page, "xterm-term2", 10000);
    });
  } finally {
    await srv.close();
  }
}
