import { defineConfig } from "@playwright/test";

const SCENARIO = /.*\.test\.(ts|js)x?$/;

export default defineConfig({
  timeout: 2 * 60 * 1000,
  /* Run tests serially — scenarios are heavyweight (each launches a browser) */
  workers: 1,
  projects: [
    {
      name: "scenario",
      testDir: "./tests/scenarios",
      testMatch: SCENARIO,
    },
    {
      name: "e2e",
      testDir: "./tests/scenarios",
      testMatch: SCENARIO,
    },
  ],
});
