/**
 * Narrated tutorial: building 3 animated CSS buttons from scratch.
 * Demonstrates vim editing, live-reload preview, narration, and circleAround highlighting.
 */
import { defineScenario, startServer, type Session } from "browser2video";
import type { GridHandle, TerminalActor } from "browser2video";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

interface Ctx {
  session: Session;
  grid: GridHandle;
  shell: TerminalActor;
  workDir: string;
}

const narrations = [
  "In this tutorial we'll build three animated buttons using just HTML and CSS, starting from an empty file.",
  "First, let's create a minimal HTML file with a Hello World heading to make sure our setup works.",
  "Our live server is running and the browser shows Hello World. Now let's add our first button.",
  "There it is, a plain unstyled button. Let's duplicate it to create three buttons with different labels.",
  "Now we have three buttons: Primary, Secondary, and Danger. Let's give each one a unique color.",
  "Each button now has its own color. Finally, let's add a hover animation to make them interactive.",
  "The buttons scale up and glow on hover. That's it! Three animated buttons built from scratch.",
];

async function vimTypeLines(shell: TerminalActor, lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    if (i < lines.length - 1) {
      await shell.typeAndEnter(lines[i]);
    } else {
      await shell.type(lines[i]);
    }
  }
}

async function vimSaveAndWait(shell: TerminalActor, grid: GridHandle) {
  await shell.pressKey("Escape");
  await shell.typeAndEnter(":w");
  await new Promise((r) => setTimeout(r, 800));
}

export default defineScenario<Ctx>("CSS Buttons Tutorial", (s) => {
  s.setup(async (session) => {
    const workDir = path.join(os.tmpdir(), `b2v-buttons-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    session.addCleanup(() => fs.rmSync(workDir, { recursive: true, force: true }));

    const server = await startServer({ type: "static", root: workDir, liveReload: true });
    if (!server) throw new Error("Failed to start static server");
    session.addCleanup(() => server.stop());

    const grid = await session.createGrid(
      [
        { url: server.baseURL, label: "Browser" },
        { label: "Editor" },
      ],
      {
        viewport: { width: 1280, height: 720 },
        grid: [[0], [1]],
      },
    );
    const shell = grid.actors[1];

    await shell.typeAndEnter(`cd ${workDir}`);
    await shell.waitForPrompt();

    return { session, grid, shell, workDir };
  });

  s.step("Warm up narration cache", async ({ session }) => {
    await Promise.all(narrations.map((text) => session.audio.warmup(text)));
  });

  s.step("Introduce the tutorial", narrations[0], async () => {});

  s.step("Create index.html with Hello World", narrations[1], async ({ shell, grid }) => {
    await shell.typeAndEnter("vim index.html");
    await shell.waitForText(["~"], 5000);
    await shell.pressKey("i");
    await vimTypeLines(shell, [
      "<!DOCTYPE html>",
      "<html><head><title>Buttons</title></head>",
      "<body>",
      "  <h1>Hello World</h1>",
      "</body></html>",
    ]);
    await vimSaveAndWait(shell, grid);
  });

  s.step("Verify Hello World and add a button", narrations[2], async ({ shell, grid }) => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":4");
    await shell.pressKey("o");
    await shell.type("  <button>Click me</button>");
    await vimSaveAndWait(shell, grid);
  });

  s.step("Create three buttons", narrations[3], async ({ shell, grid }) => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":5");
    await shell.typeAndEnter("dd");
    await shell.pressKey("i");
    await vimTypeLines(shell, [
      "  <div class=\"buttons\">",
      "    <button>Primary</button>",
      "    <button>Secondary</button>",
      "    <button>Danger</button>",
      "  </div>",
    ]);
    await vimSaveAndWait(shell, grid);
  });

  s.step("Add CSS colors to each button", narrations[4], async ({ shell, grid }) => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":2");
    await shell.pressKey("o");
    await vimTypeLines(shell, [
      "<style>",
      ".buttons { display: flex; gap: 12px; padding: 20px; }",
      "button { padding: 10px 24px; border: none; border-radius: 6px;",
      "  color: white; font-size: 16px; cursor: pointer; }",
      "button:nth-child(1) { background: #3b82f6; }",
      "button:nth-child(2) { background: #6b7280; }",
      "button:nth-child(3) { background: #ef4444; }",
      "</style>",
    ]);
    await vimSaveAndWait(shell, grid);
  });

  s.step("Add hover animation", narrations[5], async ({ shell, grid }) => {
    await shell.pressKey("Escape");
    await shell.typeAndEnter(":9");
    await shell.pressKey("o");
    await vimTypeLines(shell, [
      "button { transition: transform 0.2s, box-shadow 0.2s; }",
      "button:hover { transform: scale(1.08);",
      "  box-shadow: 0 4px 15px rgba(0,0,0,0.3); }",
    ]);
    await vimSaveAndWait(shell, grid);
  });

  s.step("Final result", narrations[6], async () => {});
});
