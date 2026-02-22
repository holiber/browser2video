import { defineConfig } from "@playwright/test";

const isSmoke = !!process.env.SMOKE;
const perTestTimeout = Number(process.env.SMOKE_PER_TEST_TIMEOUT_MS) || 30_000;
const totalTimeout = Number(process.env.SMOKE_TOTAL_TIMEOUT_MS) || 180_000;

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.test.ts",
  timeout: isSmoke ? perTestTimeout : 5 * 60 * 1000,
  globalTimeout: isSmoke ? totalTimeout : 15 * 60 * 1000,
  outputDir: "../../.cache/tests/test-e2e__electron",
  ...(isSmoke && { maxFailures: 1 }),
  workers: 1,
});
