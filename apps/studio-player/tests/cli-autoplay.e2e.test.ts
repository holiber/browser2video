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

    // Use per-test ports to avoid cross-test interference.
    const TEST_PORT = 9661 + i * 4;
    const TEST_CDP_PORT = 9461 + i * 4;
    killPort(TEST_PORT);
    killPort(TEST_CDP_PORT);

    let electronApp: ElectronApplication | null = null;
    try {
      electronApp = await _electron.launch({
        // Provide scenario file as CLI arg (positional)
        args: [PLAYER_DIR, scenarioFile],
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          NODE_OPTIONS: "--experimental-strip-types --no-warnings",
          PORT: String(TEST_PORT),
          B2V_CDP_PORT: String(TEST_CDP_PORT),
          // Keep it fast; we only validate the CLI auto-load + auto-start wiring.
          B2V_MODE: "fast",
        },
        timeout: 60_000,
      });

      const page: Page = await electronApp.firstWindow();
      await page.waitForLoadState("domcontentloaded");

      // Scenario should auto-load (step cards appear).
      await page.waitForSelector("[data-testid='step-card-0']", { timeout: 90_000 });

      // Autoplay should either start (Play -> Stop) or fail with an error banner.
      // Some scenarios have heavy setup and may error quickly in CI environments.
      await Promise.race([
        page.waitForSelector("[data-testid='ctrl-stop']", { timeout: 120_000 }),
        page.waitForSelector(".bg-red-950", { timeout: 120_000 }),
      ]);
    } finally {
      if (electronApp) await closeElectron(electronApp);
    }
  });
}

