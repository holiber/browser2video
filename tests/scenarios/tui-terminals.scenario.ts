/**
 * Interactive shell terminals with TUI apps (htop, mc) running inside
 * in-browser xterm panes connected to real PTYs.
 * Demonstrates dynamic tab creation and closure.
 */
import { defineScenario, type TerminalActor } from "browser2video";

interface Ctx {
  grid: Awaited<ReturnType<import("browser2video").Session["createGrid"]>>;
  mc: TerminalActor;
  htop: TerminalActor;
  shell: TerminalActor;
}

export default defineScenario<Ctx>("TUI Terminals", (s) => {
  s.setup(async (session) => {
    const grid = await session.createGrid(
      [
        { command: "mc", label: "Midnight Commander" },
        { command: "htop", label: "htop" },
        { label: "Shell", allowAddTab: true },
      ],
      {
        viewport: { width: 1280, height: 720 },
        grid: [[0, 2], [1, 2]],
      },
    );
    const [mc, htop, shell] = grid.actors;
    return { grid, mc, htop, shell };
  });

  s.step("Open terminals", async ({ mc, htop }) => {
    await mc.waitForText(["1Help"], 30000);
    await htop.waitForText(["PID"], 30000);
  });

  s.step("Click files in left panel", async ({ mc }) => {
    await mc.click(0.15, 0.25);
    await mc.click(0.15, 0.35);
    await mc.click(0.15, 0.45);
    await mc.click(0.15, 0.30);
  });

  s.step("Click into right panel", async ({ mc }) => {
    await mc.click(0.65, 0.25);
    await mc.click(0.65, 0.35);
    await mc.click(0.65, 0.45);
  });

  s.step("Double-click to enter a directory", async ({ mc }) => {
    await mc.click(0.15, 0.15);
    await mc.click(0.15, 0.25);
    await mc.pressKey("Enter");
    await mc.pressKey("Home");
    await mc.pressKey("Enter");
  });

  s.step("Run ls in shell", async ({ shell }) => {
    await shell.typeAndEnter("ls");
    await shell.waitForPrompt();
  });

  s.step("Run ls -la in shell", async ({ shell }) => {
    await shell.typeAndEnter("ls -la");
    await shell.waitForPrompt();
  });

  s.step("Launch vim in shell", async ({ shell }) => {
    await shell.typeAndEnter("vim");
    await shell.waitForText(["~"], 10000);
  });

  s.step("Type text in vim (insert mode)", async ({ shell }) => {
    await shell.pressKey("i");
    await shell.typeAndEnter("Hello from browser2video!");
    await shell.typeAndEnter("This is a demo of vim inside xterm.js");
    await shell.type("running in a browser terminal pane.");
  });

  s.step("Exit vim without saving", async ({ shell }) => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":q!");
    await shell.waitForPrompt();
  });

  let newTab: TerminalActor;

  s.step("Add a new shell tab", async ({ shell, grid }) => {
    await shell.click('[data-testid="b2v-add-tab"]');
    await grid.page.waitForTimeout(300);
    newTab = await grid.wrapLatestTab();
    await newTab.waitForPrompt();
  });

  s.step("Run command in new tab", async () => {
    await newTab.typeAndEnter('echo "hello world"');
    await newTab.waitForPrompt();
  });

  s.step("Close the new tab", async ({ shell }) => {
    await shell.click('.b2v-closable .dv-default-tab-action');
  });
});
