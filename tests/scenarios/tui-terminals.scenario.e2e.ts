import { test } from "@playwright/test";
import { run } from "@browser2video/runner";
import { tuiTerminalsScenario } from "./tui-terminals.scenario.js";

test("tui-terminals scenario", async () => {
  await run({
    mode: "fast",
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    scenario: tuiTerminalsScenario,
    artifactDir: `test-results/tui-terminals-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
