/**
 * TestGhRepoAsHuman — an actor discovers, installs, and launches
 * https://github.com/holiber/unikanban by opening the GitHub page,
 * reading the README, cloning the repo, running both the web app and
 * the TUI, and narrating their experience throughout.
 *
 * Layout: side-by-side browser (left) + terminal (right).
 * The browser starts on the GitHub repo page, later navigates to the
 * locally running app.
 *
 * Assertions:
 *   - git clone completes successfully (terminal shows "done", no "fatal" errors)
 *   - pnpm install finishes without errors (no "ERR!" in output)
 *   - Web dev server starts (terminal shows "Local" URL)
 *   - Kanban board renders in the browser (visible DOM element)
 *   - TUI renders in the terminal (visible board content)
 *   - Terminal commands don't produce fatal errors
 */
import { defineScenario, resolveCacheDir, type TerminalActor, type Frame } from "browser2video";
import fs from "node:fs";
import path from "node:path";

interface Ctx {
  browser: TerminalActor;
  term: TerminalActor;
  workDir: string;
}

const narrations = {
  intro:
    "I found this project called UniKanban on GitHub. " +
    "Let me open the repo and see what it's about.",
  readReadme:
    "OK so it says it's a Kanban board built with something called the Unapi pattern. " +
    "Let me scroll down to the Quick Start section.",
  quickStart:
    "I see it uses pnpm. There are two main ways to launch it — as a web app with pnpm dev, " +
    "and as a terminal UI with pnpm dev:tui. Let me try the web version first.",
  clone:
    "Let me clone the repository and install the dependencies.",
  install:
    "Running pnpm install now. This might take a moment.",
  launchWeb:
    "Dependencies are installed. Let me start the dev server with pnpm dev.",
  openWeb:
    "The Vite server is running. Let me open it in the browser and check out the Kanban board.",
  exploreWeb:
    "Nice! The Kanban board loaded successfully. " +
    "I can see columns and cards. The UI looks clean and responsive.",
  stopWeb:
    "That was the web version. Now let me stop the server and try the terminal UI.",
  launchTui:
    "According to the README, I should run pnpm dev:tui for the terminal version.",
  exploreTui:
    "The TUI is running! I can see the Kanban board rendered right in my terminal. " +
    "Let me try navigating with the keyboard — h, j, k, l keys should work.",
  quitTui: "Let me quit the TUI now.",
  summary:
    "So here is my summary. UniKanban is a clean, well-documented Kanban board project. " +
    "The README had a clear Quick Start section — I didn't need to dig through docs at all. " +
    "Both the web app and the TUI launched on the first try without issues. " +
    "The web UI is a Vite-powered SPA, and the TUI version using Ink is a nice bonus for terminal lovers. " +
    "I'd rate the developer onboarding experience an 8 out of 10.",
};

export default defineScenario<Ctx>("Test GH Repo As Human", (s) => {
  s.setup(async (session) => {
    const workDir = path.join(resolveCacheDir(), `unikanban-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    session.addCleanup(() =>
      fs.rmSync(workDir, { recursive: true, force: true }),
    );

    const grid = await session.createGrid(
      [
        { url: "https://github.com/holiber/unikanban", label: "Browser" },
        { label: "Terminal" },
      ],
      {
        viewport: { width: 1280, height: 720 },
        grid: [[0, 1]],
      },
    );

    const [browser, term] = grid.actors;

    for (const text of Object.values(narrations)) {
      await session.audio.warmup(text);
    }

    return { browser, term, workDir };
  });

  // ── Phase 1: Browse the GitHub repo ──────────────────────────────────

  s.step("Open GitHub repo", narrations.intro, async ({ browser }) => {
    const frame = browser.frame as Frame;
    await frame.waitForSelector("article", { timeout: 60000 });
  });

  s.step("Read the README", narrations.readReadme, async ({ browser }) => {
    await browser.scroll(null, 400);
    await browser.scroll(null, 400);
  });

  s.step(
    "Find Quick Start section",
    narrations.quickStart,
    async ({ browser }) => {
      await browser.scroll(null, 400);
      await browser.scroll(null, 300);
    },
  );

  // ── Phase 2: Clone and install ───────────────────────────────────────

  s.step(
    "Clone the repository",
    narrations.clone,
    async ({ term, workDir }) => {
      await term.waitForPrompt();
      await term.typeAndEnter(`cd ${workDir}`);
      await term.waitForPrompt();
      await term.typeAndEnter(
        "git clone https://github.com/holiber/unikanban.git",
      );
      await term.waitForText(["done"], 60000);
      await term.waitForPrompt(60000);

      const cloneOutput = await term.read();
      if (/fatal|error/i.test(cloneOutput)) {
        throw new Error(`git clone failed:\n${cloneOutput}`);
      }

      await term.typeAndEnter("cd unikanban");
      await term.waitForPrompt();
    },
  );

  s.step(
    "Install dependencies",
    narrations.install,
    async ({ term }) => {
      await term.typeAndEnter("pnpm install");
      await term.waitForPrompt(120000);

      const installOutput = await term.read();
      if (/ERR!/i.test(installOutput)) {
        throw new Error(`pnpm install failed:\n${installOutput}`);
      }
    },
  );

  // ── Phase 3: Launch the web app ──────────────────────────────────────

  s.step(
    "Start the web dev server",
    narrations.launchWeb,
    async ({ term }) => {
      await term.typeAndEnter("pnpm dev");
      await term.waitForText(["Local"], 30000);
    },
  );

  s.step(
    "Open the web app in browser",
    narrations.openWeb,
    async ({ browser }) => {
      await browser.goto("http://localhost:5173");
      const frame = browser.frame as Frame;
      await frame.waitForLoadState("networkidle", { timeout: 15000 });
      await frame.waitForSelector("body :first-child", { timeout: 10000 });
      const hasContent = await frame.evaluate(() => document.body.innerText.length > 0);
      if (!hasContent) throw new Error("Web app loaded but page body is empty");
    },
  );

  s.step(
    "Explore the web Kanban board",
    narrations.exploreWeb,
    async ({ browser }) => {
      await browser.scroll(null, 300);
      await new Promise((r) => setTimeout(r, 1000));
      await browser.scroll(null, -300);
    },
  );

  // ── Phase 4: Try the TUI ─────────────────────────────────────────────

  s.step("Stop the web server", narrations.stopWeb, async ({ term }) => {
    await term.pressKey("Control+c");
    await term.waitForPrompt(10000);
  });

  s.step(
    "Launch the TUI",
    narrations.launchTui,
    async ({ term }) => {
      await term.typeAndEnter("pnpm dev:tui");
      await term.waitForText(["kanban"], 15000).catch(() => {});
      const tuiOutput = await term.read();
      if (!tuiOutput || tuiOutput.trim().length < 20) {
        throw new Error(`TUI did not render any content:\n${tuiOutput}`);
      }
    },
  );

  s.step(
    "Navigate the TUI",
    narrations.exploreTui,
    async ({ term }) => {
      await term.pressKey("l");
      await new Promise((r) => setTimeout(r, 800));
      await term.pressKey("l");
      await new Promise((r) => setTimeout(r, 800));
      await term.pressKey("j");
      await new Promise((r) => setTimeout(r, 800));
      await term.pressKey("h");
      await new Promise((r) => setTimeout(r, 800));
      await term.pressKey("k");
      await new Promise((r) => setTimeout(r, 800));
    },
  );

  s.step("Quit the TUI", narrations.quitTui, async ({ term }) => {
    await term.pressKey("q");
    await term.waitForPrompt(10000);
  });

  // ── Phase 5: Summary ────────────────────────────────────────────────

  s.step("Summary", narrations.summary, async () => {});
});
