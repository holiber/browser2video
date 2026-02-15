import { test } from "@playwright/test";
import { run } from "@browser2video/runner";
import { basicUiScenario } from "./basic-ui.scenario.js";

test("basic-ui scenario", async () => {
  await run({
    mode: "fast",
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    scenario: basicUiScenario,
    artifactDir: `test-results/basic-ui-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
