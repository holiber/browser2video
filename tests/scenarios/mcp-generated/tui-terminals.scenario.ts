/**
 * Generated scenario: tui-terminals
 * Interactive TUI apps (mc, htop, vim) running in browser terminal panes.
 * Requires startServer + startTerminalWsServer for the demo app with real PTYs.
 */
import { createSession, startServer, type Page } from "browser2video";
import { startTerminalWsServer } from "browser2video/terminal";

async function typeInTerminal(page: Page, testId: string, text: string, opts?: { delay?: number }) {
  const selector = `[data-testid="${testId}"] .xterm-helper-textarea`;
  const el = await page.$(selector);
  if (!el) throw new Error(`Terminal textarea not found: ${selector}`);
  await el.focus();
  for (const ch of text) {
    if (ch === "\n") {
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.type(ch, { delay: 0 });
    }
    if (opts?.delay) await new Promise((r) => setTimeout(r, opts.delay));
  }
}

async function waitForWsOpen(page: Page, selector: string, timeoutMs = 15000) {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel) as any;
      return String(el?.dataset?.b2vWsState ?? "") === "open";
    },
    selector,
    { timeout: timeoutMs },
  );
}

async function waitForXtermText(page: Page, rootSelector: string, includes: string[], timeoutMs: number) {
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

async function waitForPrompt(page: Page, testId: string, timeoutMs = 30000) {
  await page.waitForFunction(
    ([sel, _t]: [string, number]) => {
      const root = document.querySelector(sel);
      if (!root) return false;
      const rows = root.querySelector(".xterm-rows");
      if (!rows) return false;
      const text = rows.textContent ?? "";
      return text.includes("$") || text.includes("#");
    },
    [`[data-testid="${testId}"]`, 0] as [string, number],
    { timeout: timeoutMs },
  );
}

async function termCoords(page: Page, testId: string, relX: number, relY: number) {
  const box = await page.$eval(`[data-testid="${testId}"]`, (el: any) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return {
    x: Math.round(box.x + box.width * relX),
    y: Math.round(box.y + box.height * relY),
  };
}

const server = await startServer({ type: "vite", root: "apps/demo" });
if (!server) throw new Error("Failed to start Vite server");
const srv = await startTerminalWsServer();

const session = await createSession({ record: true, mode: "human" });
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
  });

  await step("Wait for htop to render", async () => {
    await waitForXtermText(page, '[data-testid="xterm-term2"]', ["CPU"], 20000);
  });

  await step("Navigate mc with keyboard (left panel)", async () => {
    const pos = await termCoords(page, "xterm-term1", 0.25, 0.25);
    await actor.clickAt(pos.x, pos.y);
    for (let i = 0; i < 4; i++) await actor.pressKey("ArrowDown");
    await actor.pressKey("ArrowUp");
    await actor.pressKey("ArrowUp");
  });

  await step("Switch to right panel (Tab)", async () => {
    await actor.pressKey("Tab");
    for (let i = 0; i < 3; i++) await actor.pressKey("ArrowDown");
  });

  await step("Switch back to left panel (Tab)", async () => {
    await actor.pressKey("Tab");
  });

  await step("Click files in left panel", async () => {
    let pos = await termCoords(page, "xterm-term1", 0.20, 0.20);
    await actor.clickAt(pos.x, pos.y);
    pos = await termCoords(page, "xterm-term1", 0.20, 0.28);
    await actor.clickAt(pos.x, pos.y);
    pos = await termCoords(page, "xterm-term1", 0.20, 0.36);
    await actor.clickAt(pos.x, pos.y);
    pos = await termCoords(page, "xterm-term1", 0.20, 0.24);
    await actor.clickAt(pos.x, pos.y);
  });

  await step("Click files in right panel", async () => {
    let pos = await termCoords(page, "xterm-term1", 0.70, 0.20);
    await actor.clickAt(pos.x, pos.y);
    pos = await termCoords(page, "xterm-term1", 0.70, 0.28);
    await actor.clickAt(pos.x, pos.y);
    pos = await termCoords(page, "xterm-term1", 0.70, 0.36);
    await actor.clickAt(pos.x, pos.y);
  });

  await step("Open directory with Enter", async () => {
    const pos = await termCoords(page, "xterm-term1", 0.70, 0.16);
    await actor.clickAt(pos.x, pos.y);
    await actor.pressKey("Enter");
    await actor.breathe();
  });

  await step("Navigate back in right panel", async () => {
    const pos = await termCoords(page, "xterm-term1", 0.70, 0.16);
    await actor.clickAt(pos.x, pos.y);
    await actor.pressKey("Enter");
    await actor.breathe();
  });

  await step("Click back to left panel and browse", async () => {
    const pos = await termCoords(page, "xterm-term1", 0.20, 0.24);
    await actor.clickAt(pos.x, pos.y);
    await actor.pressKey("ArrowDown");
    await actor.pressKey("ArrowDown");
    await actor.pressKey("ArrowDown");
  });

  await step("View file with F3 in mc", async () => {
    await actor.pressKey("F3");
    await actor.breathe();
    for (let i = 0; i < 5; i++) await actor.pressKey("ArrowDown");
    await actor.breathe();
    await actor.pressKey("q");
  });

  await step("Wait for shell prompt", async () => {
    await waitForPrompt(page, "xterm-term4");
  });

  await step("Run ls in shell", async () => {
    await typeInTerminal(page, "xterm-term4", "ls\n", { delay: 60 });
    await waitForPrompt(page, "xterm-term4");
  });

  await step("Run ls -la in shell", async () => {
    await typeInTerminal(page, "xterm-term4", "ls -la\n", { delay: 60 });
    await waitForPrompt(page, "xterm-term4");
  });

  await step("Launch vim in shell", async () => {
    await typeInTerminal(page, "xterm-term4", "vim\n", { delay: 60 });
    await waitForXtermText(page, '[data-testid="xterm-term4"]', ["~"], 10000);
  });

  await step("Type text in vim (insert mode)", async () => {
    await actor.pressKey("i");
    await typeInTerminal(page, "xterm-term4", "Hello from browser2video!", { delay: 70 });
    await actor.pressKey("Enter");
    await typeInTerminal(page, "xterm-term4", "This is a demo of vim inside xterm.js", { delay: 60 });
    await actor.pressKey("Enter");
    await typeInTerminal(page, "xterm-term4", "running in a browser terminal pane.", { delay: 60 });
    await actor.breathe();
  });

  await step("Exit vim without saving", async () => {
    await actor.pressKey("Escape");
    await typeInTerminal(page, "xterm-term4", ":q!\n", { delay: 80 });
    await waitForPrompt(page, "xterm-term4");
  });

  await step("Quit mc", async () => {
    const pos = await termCoords(page, "xterm-term1", 0.25, 0.25);
    await actor.clickAt(pos.x, pos.y);
    await actor.pressKey("F10");
    await actor.pressKey("Enter");
    await actor.breathe();
  });

  await step("Quit htop", async () => {
    await typeInTerminal(page, "xterm-term2", "q");
    await actor.breathe();
  });

  const result = await session.finish();
  console.log("Video:", result.video);
} finally {
  await srv.close();
  await server.stop();
}
