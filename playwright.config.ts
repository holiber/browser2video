import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/scenarios",
  testMatch: "*.test.ts",
  timeout: 2 * 60 * 1000,
  /* Run tests serially — scenarios are heavyweight (each launches a browser) */
  workers: 1,
});
