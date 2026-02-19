import { fileURLToPath } from "url";
import { runScenario } from "browser2video";
import descriptor from "./collab.scenario.ts";

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runScenario(descriptor).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  const { test } = await import("@playwright/test");
  test("collab", async () => { test.setTimeout(180_000); await runScenario(descriptor); });
}
