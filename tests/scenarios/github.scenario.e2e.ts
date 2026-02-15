import { test } from "@playwright/test";
import { run } from "@browser2video/runner";
import { githubScenario } from "./github.scenario.js";

test("github scenario", async () => {
  // GitHub scenario doesn't need a local Vite server
  await run({
    mode: "fast",
    scenario: githubScenario,
    artifactDir: `test-results/github-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
