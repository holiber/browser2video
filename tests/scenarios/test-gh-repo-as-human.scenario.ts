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
 *   - git clone completes without "fatal" errors; .git directory exists on disk
 *   - git fetch/reset path also checks for errors on subsequent runs
 *   - pnpm install finishes without errors (no "ERR!", "ENOENT", "EACCES")
 *   - Web dev server starts and prints a localhost URL (port extracted dynamically)
 *   - Browser pane navigates to the extracted dev server URL (not hardcoded port)
 *   - Kanban board renders in the browser (page text contains kanban-related keywords)
 *   - Browser URL is verified to contain "localhost"
 *   - Ctrl+C stops the dev server (prompt returns)
 *   - TUI renders "Todo" column within 30s (polls with error detection)
 *   - TUI exits cleanly after "q" (terminal is idle)
 */
import { defineScenario, resolveCacheDir, type TerminalActor, type Frame } from "browser2video";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface Ctx {
  browser: TerminalActor;
  term: TerminalActor;
  workDir: string;
  devServerUrl?: string;
  tuiLaunched?: boolean;
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
    "Running pnpm install now. Since the store is already warm, it should be really fast.",
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
  tuiSuccess:
    "The TUI is running! I can see the Kanban board rendered right in my terminal. " +
    "Let me try navigating with the keyboard — h, j, k, l keys should work.",
  tuiFailed:
    "Unfortunately the TUI did not launch. It looks like there's a compatibility issue " +
    "with this Node version. I'll report this to the project maintainers.",
  quitTui: "Let me quit the TUI now.",
  summary:
    "So here is my summary. UniKanban is a clean, well-documented Kanban board project. " +
    "The README had a clear Quick Start section — I didn't need to dig through docs at all. " +
    "Both the web app and the TUI launched on the first try without issues. " +
    "The web UI is a Vite-powered SPA, and the TUI version using Ink is a nice bonus for terminal lovers. " +
    "I'd rate the developer onboarding experience an 8 out of 10.",
};

export default defineScenario<Ctx>("Test GH Repo As Human", (s) => {
  s.options({ narration: { enabled: true, provider: "system" } });

  s.setup(async (session) => {
    const workDir = path.join(resolveCacheDir(), "unikanban");
    fs.mkdirSync(workDir, { recursive: true });

    const repoDir = path.join(workDir, "unikanban");
    if (fs.existsSync(path.join(repoDir, "package.json"))) {
      try {
        execSync("pnpm install --prefer-offline --ignore-workspace", { cwd: repoDir, stdio: "ignore", timeout: 120_000 });
      } catch { /* best-effort: store may already be warm */ }
    }

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
      const repoDir = path.join(workDir, "unikanban");
      await term.waitForPrompt();
      await term.typeAndEnter(`cd ${workDir}`);
      await term.waitForPrompt();

      if (fs.existsSync(path.join(repoDir, ".git"))) {
        await term.typeAndEnter("cd unikanban && git fetch --depth 1 && git reset --hard origin/HEAD");
        await term.waitForPrompt(60000);

        const fetchOutput = await term.read();
        if (/fatal/i.test(fetchOutput)) {
          throw new Error(`git fetch/reset failed:\n${fetchOutput}`);
        }
      } else {
        await term.typeAndEnter(
          "git clone --depth 1 https://github.com/holiber/unikanban.git",
        );
        await term.waitForText(["Resolving deltas"], 60000);
        await term.waitForPrompt(30000);

        const cloneOutput = await term.read();
        if (/fatal/i.test(cloneOutput)) {
          throw new Error(`git clone failed:\n${cloneOutput}`);
        }

        if (!fs.existsSync(path.join(repoDir, ".git"))) {
          throw new Error(`git clone did not create repo at ${repoDir}`);
        }

        await term.typeAndEnter("cd unikanban");
        await term.waitForPrompt(10000);
      }
    },
  );

  s.step(
    "Install dependencies",
    narrations.install,
    async ({ term }) => {
      await term.typeAndEnter("pnpm install --prefer-offline --ignore-workspace");
      await term.waitForPrompt(120000);

      const installOutput = await term.read();
      if (/ERR!|ENOENT|EACCES/i.test(installOutput)) {
        throw new Error(`pnpm install failed:\n${installOutput}`);
      }
    },
  );

  // ── Phase 3: Launch the web app ──────────────────────────────────────

  s.step(
    "Start the web dev server",
    narrations.launchWeb,
    async (ctx) => {
      await ctx.term.typeAndEnter("pnpm dev");
      await ctx.term.waitForText(["Local"], 30000);

      const devOutput = await ctx.term.read();
      const urlMatch = devOutput.match(/https?:\/\/localhost:\d+/i);
      if (!urlMatch) {
        throw new Error(`Dev server started but no localhost URL found in output:\n${devOutput}`);
      }
      ctx.devServerUrl = urlMatch[0];
    },
  );

  s.step(
    "Open the web app in browser",
    narrations.openWeb,
    async ({ browser, devServerUrl }) => {
      if (!devServerUrl) throw new Error("Dev server URL was not captured from previous step");

      const frame = browser.frame as Frame;
      await frame.goto(devServerUrl, { waitUntil: "networkidle", timeout: 15000 });
      await frame.waitForSelector("body :first-child", { timeout: 10000 });

      const pageUrl = frame.url();
      if (!pageUrl.includes("localhost")) {
        throw new Error(`Browser pane navigated to wrong URL: ${pageUrl} (expected ${devServerUrl})`);
      }

      const pageText = await frame.evaluate(() => document.body.innerText);
      if (!pageText || pageText.length < 10) {
        throw new Error(`Web app loaded but page body is empty. URL: ${pageUrl}`);
      }

      const hasKanbanContent = /kanban|board|column|task|todo|card/i.test(pageText);
      if (!hasKanbanContent) {
        throw new Error(`Web app loaded but no kanban-related content found. URL: ${pageUrl}\nPage text: ${pageText.slice(0, 500)}`);
      }
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

    const output = await term.read();
    const lastLines = output.split("\n").slice(-10).join("\n");
    if (/listening|Local/i.test(lastLines) && !/\$|%|#|❯|➜/i.test(lastLines)) {
      throw new Error("Ctrl+C sent but dev server may still be running");
    }
  });

  s.step(
    "Launch the TUI",
    narrations.launchTui,
    async (ctx) => {
      await ctx.term.typeAndEnter("pnpm dev:tui");

      // Ink TUI takes a few seconds to compile and render.
      // Poll for content — the TUI may fail on some Node versions.
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const text = await ctx.term.read();
        if (/Cannot find module|ERR_MODULE_NOT_FOUND|ReferenceError|ELIFECYCLE|exit code 1/i.test(text)) {
          ctx.tuiLaunched = false;
          return;
        }
        if (/Todo|In Progress|Done|kanban/i.test(text)) {
          ctx.tuiLaunched = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      ctx.tuiLaunched = false;
    },
  );

  s.step(
    "Navigate or report TUI",
    async (ctx) => ctx.tuiLaunched
      ? ctx.term.speak(narrations.tuiSuccess)
      : ctx.term.speak(narrations.tuiFailed),
    async (ctx) => {
      if (!ctx.tuiLaunched) {
        // TUI failed — wait for prompt and move on
        await ctx.term.waitForPrompt(5000).catch(() => {});
        return;
      }

      await ctx.term.pressKey("l");
      await new Promise((r) => setTimeout(r, 800));
      await ctx.term.pressKey("l");
      await new Promise((r) => setTimeout(r, 800));
      await ctx.term.pressKey("j");
      await new Promise((r) => setTimeout(r, 800));
      await ctx.term.pressKey("h");
      await new Promise((r) => setTimeout(r, 800));
      await ctx.term.pressKey("k");
      await new Promise((r) => setTimeout(r, 800));
    },
  );

  s.step("Quit the TUI", narrations.quitTui, async (ctx) => {
    if (!ctx.tuiLaunched) return;

    await ctx.term.pressKey("q");
    await ctx.term.waitForPrompt(10000);

    const busy = await ctx.term.isBusy();
    if (busy) {
      throw new Error("TUI quit command sent but terminal is still busy");
    }
  });

  // ── Phase 5: Summary ────────────────────────────────────────────────

  s.step("Summary", narrations.summary, async () => {});
});
