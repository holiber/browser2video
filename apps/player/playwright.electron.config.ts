import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "electron.e2e.test.ts",
  timeout: 5 * 60 * 1000,
  workers: 1,
});
