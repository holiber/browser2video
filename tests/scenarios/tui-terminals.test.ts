/**
 * Interactive shell terminals with TUI apps (htop, mc) running inside
 * in-browser xterm panes connected to real PTYs.
 */
import { fileURLToPath } from "url";
import { createSession } from "browser2video";

async function scenario() {
  const session = await createSession();
  const { step } = session;

  const mc = await session.createTerminal("mc", {
    viewport: { width: 640, height: 500 },
    label: "Midnight Commander",
  });
  const htop = await session.createTerminal("htop", {
    viewport: { width: 640, height: 500 },
    label: "htop",
  });
  const shell = await session.createTerminal(undefined, {
    viewport: { width: 640, height: 500 },
    label: "Shell",
  });

  await step("Open terminals", async () => {
    await mc.waitForText(["1Help"]);
    await htop.waitForText(["CPU"]);
  });

  await step("Navigate mc with keyboard (left panel)", async () => {
    await mc.click(0.25, 0.25);
    for (let i = 0; i < 4; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("ArrowUp");
    await mc.pressKey("ArrowUp");
  });

  await step("Switch to right panel (Tab)", async () => {
    await mc.pressKey("Tab");
    for (let i = 0; i < 3; i++) await mc.pressKey("ArrowDown");
  });

  await step("Switch back to left panel (Tab)", async () => {
    await mc.pressKey("Tab");
  });

  await step("Click files in left panel", async () => {
    await mc.click(0.20, 0.20);
    await mc.click(0.20, 0.28);
    await mc.click(0.20, 0.36);
    await mc.click(0.20, 0.24);
  });

  await step("Click files in right panel", async () => {
    await mc.click(0.70, 0.20);
    await mc.click(0.70, 0.28);
    await mc.click(0.70, 0.36);
  });

  await step("Open directory with Enter", async () => {
    await mc.click(0.70, 0.16);
    await mc.pressKey("Enter");
  });

  await step("Navigate back in right panel", async () => {
    await mc.click(0.70, 0.16);
    await mc.pressKey("Enter");
  });

  await step("Click back to left panel and browse", async () => {
    await mc.click(0.20, 0.24);
    await mc.pressKey("ArrowDown");
    await mc.pressKey("ArrowDown");
    await mc.pressKey("ArrowDown");
  });

  await step("View file with F3 in mc", async () => {
    await mc.pressKey("F3");
    for (let i = 0; i < 5; i++) await mc.pressKey("ArrowDown");
    await mc.pressKey("q");
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
