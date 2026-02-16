/**
 * Interactive shell terminals with TUI apps (htop, mc) running inside
 * in-browser xterm panes connected to real PTYs.
 */
import { fileURLToPath } from "url";
import { createSession, startServer } from "@browser2video/runner";
import { startTerminalWsServer } from "./terminal/terminal-ws-server.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function waitForWsOpen(page: any, selector: string, timeoutMs = 15000) {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel) as any;
      return String(el?.dataset?.b2vWsState ?? "") === "open";
    },
    selector,
    { timeout: timeoutMs },
  );
}

async function waitForXtermText(page: any, rootSelector: string, includes: string[], timeoutMs: number) {
  await page.waitForFunction(
    ([sel, inc]: [string, string[]]) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const rows = root.querySelector(".xterm-rows");
      const text = String((rows as any)?.textContent ?? (root as any)?.textContent ?? "");
      return inc.every((s: string) => text.includes(s));
    },
    [rootSelector, includes] as [string, string[]],
    { timeout: timeoutMs },
  );
}

async function waitForPrompt(page: any, testId: string, timeoutMs = 15000) {
  await waitForXtermText(page, `[data-testid="${testId}"]`, ["$"], timeoutMs);
}

async function clickInTerminal(page: any, testId: string, relX: number, relY: number) {
  const box = await page.$eval(`[data-testid="${testId}"]`, (el: any) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const targetX = Math.round(box.x + box.width * relX);
  const targetY = Math.round(box.y + box.height * relY);
  const startPos = await page.evaluate(() => {
    const cursor = document.getElementById("__b2v_cursor");
    if (!cursor) return null;
    const m = cursor.style.transform.match(/translate\((.+?)px,\s*(.+?)px\)/);
    if (m) return { x: parseFloat(m[1]) + 2, y: parseFloat(m[2]) + 2 };
    return null;
  });
  const fromX = startPos?.x ?? targetX - 80;
  const fromY = startPos?.y ?? targetY - 40;
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
  await page.evaluate(`window.__b2v_clickEffect?.(${targetX}, ${targetY})`);
  await sleep(40);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(60);
}

async function scenario() {
  const server = await startServer({ type: "vite", root: "apps/demo" });
  if (!server) throw new Error("Failed to start Vite server");
  const srv = await startTerminalWsServer();

  const session = await createSession();
  const { step } = session;
  const { page, actor } = await session.openPage({ url: server.baseURL });

  try {
    await step("Open terminals page", async () => {
      const url = `${server.baseURL}/terminals?termWs=${encodeURIComponent(srv.baseWsUrl)}`;
      await actor.goto(url);
      await actor.waitFor('[data-testid="terminals-page"]');
      await actor.waitFor('[data-testid="xterm-term1"] .xterm');
      await actor.waitFor('[data-testid="xterm-term2"] .xterm');
      await actor.waitFor('[data-testid="xterm-term4"] .xterm');
    });

    await step("Wait for terminal connections", async () => {
      await waitForWsOpen(page, '[data-testid="xterm-term1"]');
      await waitForWsOpen(page, '[data-testid="xterm-term2"]');
      await waitForWsOpen(page, '[data-testid="xterm-term4"]');
    });

    await step("Wait for mc to render", async () => {
      await waitForXtermText(page, '[data-testid="xterm-term1"]', ["1Help"], 20000);
      await sleep(800);
    });

    await step("Wait for htop to render", async () => {
      await waitForXtermText(page, '[data-testid="xterm-term2"]', ["CPU"], 20000);
      await sleep(1000);
    });

    await step("Navigate mc with keyboard (left panel)", async () => {
      await focusTerminal(page, "xterm-term1");
      for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowDown"); await sleep(250); }
      await page.keyboard.press("ArrowUp"); await sleep(250);
      await page.keyboard.press("ArrowUp"); await sleep(300);
    });

    await step("Switch to right panel (Tab)", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.press("Tab"); await sleep(500);
      for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowDown"); await sleep(250); }
    });

    await step("Switch back to left panel (Tab)", async () => {
      await page.keyboard.press("Tab"); await sleep(400);
    });

    await step("Click files in left panel", async () => {
      await focusTerminal(page, "xterm-term1");
      await clickInTerminal(page, "xterm-term1", 0.20, 0.14); await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.22); await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.30); await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.20, 0.18); await sleep(400);
    });

    await step("Click files in right panel", async () => {
      await clickInTerminal(page, "xterm-term1", 0.70, 0.14); await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.70, 0.22); await sleep(400);
      await clickInTerminal(page, "xterm-term1", 0.70, 0.30); await sleep(400);
    });

    await step("Open directory with Enter", async () => {
      await clickInTerminal(page, "xterm-term1", 0.70, 0.10); await sleep(300);
      await page.keyboard.press("Enter"); await sleep(800);
    });

    await step("Navigate back in right panel", async () => {
      await clickInTerminal(page, "xterm-term1", 0.70, 0.10); await sleep(300);
      await page.keyboard.press("Enter"); await sleep(600);
    });

    await step("Click back to left panel and browse", async () => {
      await clickInTerminal(page, "xterm-term1", 0.20, 0.18); await sleep(400);
      await page.keyboard.press("ArrowDown"); await sleep(250);
      await page.keyboard.press("ArrowDown"); await sleep(250);
      await page.keyboard.press("ArrowDown"); await sleep(300);
    });

    await step("View file with F3 in mc", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.press("F3"); await sleep(1200);
      for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowDown"); await sleep(200); }
      await sleep(400);
      await page.keyboard.press("q"); await sleep(600);
    });

    await step("Wait for shell prompt", async () => {
      await waitForPrompt(page, "xterm-term4");
    });

    await step("Run ls in shell", async () => {
      await typeInTerminal(page, "xterm-term4", "ls\n", { delay: 60 });
      await sleep(600);
      await waitForPrompt(page, "xterm-term4");
    });

    await step("Run ls -la in shell", async () => {
      await typeInTerminal(page, "xterm-term4", "ls -la\n", { delay: 60 });
      await sleep(800);
      await waitForPrompt(page, "xterm-term4");
    });

    await step("Launch vim in shell", async () => {
      await typeInTerminal(page, "xterm-term4", "vim\n", { delay: 60 });
      await sleep(1200);
    });

    await step("Type text in vim (insert mode)", async () => {
      await focusTerminal(page, "xterm-term4");
      await page.keyboard.press("i"); await sleep(400);
      await typeInTerminal(page, "xterm-term4", "Hello from browser2video!", { delay: 70 });
      await sleep(300);
      await page.keyboard.press("Enter"); await sleep(200);
      await typeInTerminal(page, "xterm-term4", "This is a demo of vim inside xterm.js", { delay: 60 });
      await sleep(300);
      await page.keyboard.press("Enter"); await sleep(200);
      await typeInTerminal(page, "xterm-term4", "running in a browser terminal pane.", { delay: 60 });
      await sleep(500);
    });

    await step("Exit vim without saving", async () => {
      await page.keyboard.press("Escape"); await sleep(400);
      await typeInTerminal(page, "xterm-term4", ":q!\n", { delay: 80 });
      await sleep(800);
      await waitForPrompt(page, "xterm-term4");
    });

    await step("Quit mc", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.press("F10"); await sleep(500);
      await page.keyboard.press("Enter"); await sleep(1000);
    });

    await step("Quit htop", async () => {
      await typeInTerminal(page, "xterm-term2", "q");
      await sleep(1000);
    });

    await session.finish();
  } finally {
    await srv.close();
    await server.stop();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("tui-terminals", scenario);
}
