import { test } from "@playwright/test";
import { run } from "@browser2video/runner";
import { kanbanScenario } from "./kanban.scenario.js";

test("kanban scenario", async () => {
  await run({
    mode: "fast",
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    scenario: kanbanScenario,
    artifactDir: `test-results/kanban-${Date.now()}`,
    recordMode: "none",
    headless: true,
  });
});
