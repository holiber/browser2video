import { test } from "@playwright/test";
import { run } from "@browser2video/runner";
import { consoleLogsScenario } from "./console-logs.scenario.js";

test("console-logs scenario", async () => {
  await run({
    mode: "fast",
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    scenario: consoleLogsScenario,
    artifactDir: `test-results/console-logs-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
