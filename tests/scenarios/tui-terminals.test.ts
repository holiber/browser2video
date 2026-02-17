/**
 * Interactive shell terminals with TUI apps (htop, mc) running inside
 * in-browser xterm panes connected to real PTYs.
 * All terminals share a single CSS grid page (no ffmpeg composition needed).
 */
import { fileURLToPath } from "url";
import { createSession } from "browser2video";

async function scenario() {
  const session = await createSession();
  const { step } = session;

  const [mc, htop, shell] = await session.createTerminalGrid(
    [
      { command: "mc", label: "Midnight Commander" },
      { command: "htop", label: "htop" },
      { label: "Shell" },
    ],
    {
      viewport: { width: 1280, height: 720 },
      grid: [[0, 2], [1, 2]], // mc top-left, htop bottom-left, shell spans right column
    },
  );

  await step("Open terminals", async () => {
    await mc.waitForText(["1Help"], 30000);
    await htop.waitForText(["CPU"], 30000);
  });

  await step("Browse files in mc", async () => {
    // Keyboard-only navigation (independent of terminal row count)
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
    // Navigate to the first directory entry and enter it
    await mc.pressKey("Home");
    await mc.pressKey("ArrowDown");
    await mc.pressKey("Enter");
    // Navigate back up via ".."
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

  await session.finish();
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("tui-terminals", scenario);
}
