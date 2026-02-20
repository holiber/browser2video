import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.test.ts",
  timeout: 3 * 60 * 1000,
  workers: 1,
  use: {
    baseURL: "http://localhost:9521",
    launchOptions: {
      args: [
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    },
  },
  webServer: {
    command: "node --experimental-strip-types --no-warnings server/index.ts",
    env: {
      ...process.env,
      B2V_AUTO_OPEN_BROWSER: "0",
    },
    port: 9521,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
