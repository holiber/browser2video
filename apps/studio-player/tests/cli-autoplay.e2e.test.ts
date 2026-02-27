import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const PLAYER_DIR = path.resolve(import.meta.dirname, "..");

function findScenarioFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      results.push(...findScenarioFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".scenario.ts")) {
      results.push(path.relative(base, full));
    }
  }
  return results.sort();
}

function killPort(port: number) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch { }
    }
  } catch { }
}

/**
 * Assert that no errors.log was written during the scenario run.
 * Parses the artifact directory from stderr and checks for the file.
 */
function noErrorsInLogsAssertion(stderr: string): void {
  const artifactMatch = stderr.match(/Artifacts:\s+(.+)/);
  if (!artifactMatch) return;
  const errorsLogPath = path.join(artifactMatch[1].trim(), "errors.log");
  if (!fs.existsSync(errorsLogPath)) return;
  const content = fs.readFileSync(errorsLogPath, "utf-8");
  expect(false, `errors.log should not exist for a clean run but found:\n${content}`).toBe(true);
}

async function closeElectron(electronApp: ElectronApplication) {
  try {
    const proc = electronApp.process();
    const pid = proc.pid;
    if (pid && proc.exitCode === null && proc.signalCode === null) {
      process.kill(pid, "SIGTERM");
      await new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        setTimeout(() => {
          try { process.kill(pid, "SIGKILL"); } catch { }
          resolve();
        }, 5_000);
      });
    }
  } catch { /* already exited */ }
}

const scenarioFiles = findScenarioFiles(path.join(PROJECT_ROOT, "tests", "scenarios"), PROJECT_ROOT);

test.describe.configure({ mode: "serial" });

for (const [i, scenarioFile] of scenarioFiles.entries()) {
  test(`CLI scenario autoplay: ${scenarioFile}`, async () => {
    test.setTimeout(180_000);

    const TEST_PORT = 9661 + i * 4;
    const TEST_CDP_PORT = 9461 + i * 4;
    killPort(TEST_PORT);
    killPort(TEST_CDP_PORT);

    let electronApp: ElectronApplication | null = null;
    const stderrChunks: string[] = [];
    try {
      electronApp = await _electron.launch({
        args: [PLAYER_DIR, scenarioFile],
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          NODE_OPTIONS: "--experimental-strip-types --no-warnings",
          PORT: String(TEST_PORT),
          B2V_CDP_PORT: String(TEST_CDP_PORT),
          B2V_MODE: "fast",
        },
        timeout: 60_000,
      });

      electronApp.process().stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      });

      const page: Page = await electronApp.firstWindow();
      await page.waitForLoadState("domcontentloaded");

      await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });

      // Wait for autoplay to start, then finish (play button reappears)
      // or fail with an error banner.
      const outcome = await Promise.race([
        page.waitForSelector("[data-testid='ctrl-stop']", { timeout: 120_000 }).then(() => "started" as const),
        page.waitForSelector(".bg-red-950", { timeout: 120_000 }).then(() => "error" as const),
      ]);

      if (outcome === "started") {
        // Wait for autoplay to finish: stop button disappears, play button returns
        await page.waitForSelector("[data-testid='ctrl-play-all']", { timeout: 120_000 });
      }

      // Wait for stderr to flush
      await new Promise((r) => setTimeout(r, 1000));

      // Parse step completion lines from stderr.
      // Filter out [inner] prefixed lines to avoid counting step logs from
      // nested players (e.g. the player-self-test embeds an inner player).
      const stderr = stderrChunks.join("");
      const outerStderr = stderr.split("\n").filter((l) => !l.startsWith("[inner]")).join("\n");
      const stepLogPattern = /step (\d+)\/(\d+) ran for ([\d.]+)s "(.+)"/g;
      const matches = [...outerStderr.matchAll(stepLogPattern)];

      // Extract error messages from stderr for diagnostics
      const errorLines = stderr.split("\n").filter((l) =>
        /runAll error:|Error:|Step ".*" failed:|aborted/i.test(l),
      ).join("\n");

      if (outcome === "started") {
        expect(matches.length, `Expected step logs in stderr but got ${matches.length}.\nErrors:\n${errorLines}\nstderr tail:\n${stderr.slice(-2000)}`).toBeGreaterThan(0);

        const totalSteps = Number(matches[0][2]);
        expect(matches.length, `Expected ${totalSteps} step log lines, got ${matches.length}.\nErrors:\n${errorLines}\nstderr tail:\n${stderr.slice(-2000)}`).toBe(totalSteps);

        const seenIndices = new Set(matches.map((m) => Number(m[1])));
        for (let s = 1; s <= totalSteps; s++) {
          expect(seenIndices.has(s), `Missing log for step ${s}/${totalSteps}`).toBe(true);
        }

        for (const m of matches) {
          const dur = Number(m[3]);
          expect(dur, `Step "${m[4]}" duration should be >= 0`).toBeGreaterThanOrEqual(0);
        }
      }

      noErrorsInLogsAssertion(stderr);
    } finally {
      if (electronApp) await closeElectron(electronApp);
    }
  });
}

