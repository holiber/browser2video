import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/scenarios",
  testMatch: "*.scenario.e2e.ts",
  /* Each scenario can be long-running (TUI terminals, collab sync, etc.) */
  timeout: 5 * 60 * 1000,
  /* Run tests serially – scenarios are heavyweight (each launches a browser) */
  workers: 1,
  /* Automatically start the Vite dev server for the demo app */
  webServer: {
    command: "pnpm -C apps/demo dev --port 5173",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    /* Forward to scenario runners via env */
    baseURL: "http://localhost:5173",
  },
});
