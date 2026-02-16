import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/scenarios",
  testMatch: "*.test.ts",
  /* Each scenario can be long-running (TUI terminals, collab sync, etc.) */
  timeout: 5 * 60 * 1000,
  /* Run tests serially — scenarios are heavyweight (each launches a browser) */
  workers: 1,
});
