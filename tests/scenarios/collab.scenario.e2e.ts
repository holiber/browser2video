import { test } from "@playwright/test";
import { runCollab } from "@browser2video/runner";
import { collabScenario } from "./collab.scenario.js";

test("collab scenario", async () => {
  await runCollab({
    mode: "fast",
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    scenario: collabScenario,
    bossPath: `/notes?role=boss`,
    workerPath: `/notes?role=worker`,
    viewportWidth: 460,
    artifactDir: `test-results/collab-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
