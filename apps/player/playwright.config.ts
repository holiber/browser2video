import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.test.ts",
  timeout: 3 * 60 * 1000,
  workers: 1,
  use: {
    baseURL: "http://localhost:9521",
  },
  webServer: {
    command: "node --experimental-strip-types --no-warnings server/index.ts",
    port: 9521,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
