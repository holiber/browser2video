/**
 * Interactive shell terminals with TUI apps (htop, mc) running inside
 * in-browser xterm panes connected to real PTYs.
 * All terminals share a single dockview grid page (no ffmpeg composition needed).
 * Demonstrates dynamic tab creation and closure.
 */
import { fileURLToPath } from "url";
import { createSession } from "browser2video";

async function scenario() {
  const session = await createSession();
  const { step } = session;

  const grid = await session.createGrid(
    [
      { command: "mc", label: "Midnight Commander" },
      { command: "htop", label: "htop" },
      { label: "Shell", allowAddTab: true },
    ],
    {
      viewport: { width: 1280, height: 720 },
      grid: [[0, 2], [1, 2]], // mc top-left, htop bottom-left, shell spans right column
    },
  );
  const [mc, htop, shell] = grid.actors;

  await step("Open terminals", async () => {
    await mc.waitForText(["1Help"], 30000);
    await htop.waitForText(["PID"], 30000);
  });

  await step("Browse files in mc", async () => {
    for (let i = 0; i < 4; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("ArrowUp");
    await mc.pressKey("ArrowUp");
  });

  await step("Switch panels and navigate", async () => {
    await mc.pressKey("Tab");
    for (let i = 0; i < 3; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("Tab");
  });

  await step("Enter a directory", async () => {
    await mc.pressKey("Home");
    await mc.pressKey("ArrowDown");
    await mc.pressKey("Enter");
    await mc.pressKey("Home");
    await mc.pressKey("Enter");
  });

  await step("Run ls in shell", async () => {
    await shell.typeAndEnter("ls");
    await shell.waitForPrompt();
  });

  await step("Run ls -la in shell", async () => {
    await shell.typeAndEnter("ls -la");
    await shell.waitForPrompt();
  });

  await step("Launch vim in shell", async () => {
    await shell.typeAndEnter("vim");
    await shell.waitForText(["~"], 10000);
  });

  await step("Type text in vim (insert mode)", async () => {
    await shell.pressKey("i");
    await shell.typeAndEnter("Hello from browser2video!");
    await shell.typeAndEnter("This is a demo of vim inside xterm.js");
    await shell.type("running in a browser terminal pane.");
  });

  await step("Exit vim without saving", async () => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":q!");
    await shell.waitForPrompt();
  });

  // Dynamic tab management: click "+" to add a tab, run a command, close it
  let newTab: Awaited<ReturnType<typeof grid.addTab>>;

  await step("Add a new shell tab", async () => {
    await shell.click('[data-testid="b2v-add-tab"]');
    await grid.page.waitForTimeout(300);
    newTab = await grid.wrapLatestTab();
    await newTab.waitForPrompt();
  });

  await step("Run command in new tab", async () => {
    await newTab.typeAndEnter('echo "hello world"');
    await newTab.waitForPrompt();
  });

  await step("Close the new tab", async () => {
    await shell.click('.b2v-closable .dv-default-tab-action');
  });

  await session.finish();
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("tui-terminals", scenario);
}
