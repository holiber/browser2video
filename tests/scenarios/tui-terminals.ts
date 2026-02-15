/**
 * @description Scenario showing interactive shell terminals with TUI apps (htop, mc)
 * running inside in-browser xterm panes connected to real PTYs.
 */
import type { ScenarioContext } from "@browser2video/runner";
import { startTerminalWsServer } from "./terminal/terminal-ws-server.js";

/** Focus xterm.js terminal without generating a mouse event in the PTY. */
async function focusTerminal(page: any, testId: string) {
  await page.evaluate((sel: string) => {
    const ta = document.querySelector(`${sel} .xterm-helper-textarea`) as HTMLElement | null;
    ta?.focus();
  }, `[data-testid="${testId}"]`);
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

/** Wait for shell prompt ($ ) to appear, indicating the shell is ready. */
async function waitForPrompt(page: any, testId: string, timeoutMs = 15000) {
  await waitForXtermText(page, `[data-testid="${testId}"]`, ["$"], timeoutMs);
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

    await step("Run ls in Terminal 1", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.type("ls\n", { delay: 40 });
      // Wait for the prompt to return after ls completes
      await new Promise((r) => setTimeout(r, 500));
      await waitForPrompt(page, "xterm-term1");
    });

    await step("Run htop in Terminal 2", async () => {
      await focusTerminal(page, "xterm-term2");
      await page.keyboard.type("htop\n", { delay: 40 });
      // Wait for htop to render (any substantial output)
      await page.waitForFunction(
        () => {
          const rows = document.querySelector('[data-testid="xterm-term2"] .xterm-rows') as any;
          return String(rows?.textContent ?? "").trim().length > 20;
        },
        { timeout: 15000 },
      );
    });

    await step("Quit htop", async () => {
      await focusTerminal(page, "xterm-term2");
      await page.keyboard.type("q");
      // Wait for shell prompt to return
      await waitForPrompt(page, "xterm-term2", 10000);
    });

    await step("Run mc in Terminal 1", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.type("mc\n", { delay: 40 });
      // Wait for mc to render
      await page.waitForFunction(
        () => {
          const rows = document.querySelector('[data-testid="xterm-term1"] .xterm-rows') as any;
          return String(rows?.textContent ?? "").trim().length > 20;
        },
        { timeout: 15000 },
      );
    });

    await step("Quit mc (F10)", async () => {
      await focusTerminal(page, "xterm-term1");
      await page.keyboard.press("F10");
      // Wait for shell prompt to return
      await waitForPrompt(page, "xterm-term1", 10000);
    });
  } finally {
    await srv.close();
  }
}
