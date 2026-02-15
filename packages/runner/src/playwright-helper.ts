/**
 * @description Playwright test helper for running scenario files.
 * Provides scenarioTest() to create a one-liner Playwright test from a scenario module.
 */
import type { ScenarioConfig, ScenarioContext, RunOptions } from "./types.js";
import { run } from "./unified-runner.js";

export type ScenarioModule = {
  config: ScenarioConfig;
  default: (ctx: ScenarioContext) => Promise<void>;
};

/**
 * Run a scenario inside a Playwright test.
 *
 * Usage in a *.scenario.e2e.ts file:
 * ```ts
 * import { test } from "@playwright/test";
 * import { scenarioTest } from "@browser2video/runner/playwright";
 *
 * scenarioTest(test, "basic-ui", import("./basic-ui.scenario.js"));
 * ```
 */
export function scenarioTest(
  /** Playwright `test` function. */
  testFn: (name: string, fn: () => Promise<void>) => void,
  /** Test / scenario name. */
  name: string,
  /** Dynamic import of the scenario module. */
  modulePromise: Promise<ScenarioModule>,
  /** Optional run options override. */
  optsOverride?: Partial<RunOptions>,
) {
  testFn(name, async () => {
    const mod = await modulePromise;
    const config = mod.config;
    const scenario = mod.default;

    // When Playwright's webServer is configured (the typical setup), it already
    // starts a Vite / dev server. Use BASE_URL env or the standard localhost:5173
    // so the runner does NOT try to start its own server.
    const baseURL =
      process.env.BASE_URL ??
      (config.server ? "http://localhost:5173" : undefined);

    await run(config, scenario, {
      mode: "fast",
      baseURL,
      artifactDir: `test-results/${name}-${Date.now()}`,
      recordMode: "none",
      headless: true,
      ...optsOverride,
    });
  });
}
