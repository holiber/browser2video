import { fileURLToPath } from "url";
import { runScenario } from "browser2video";
import descriptor from "./external-website.scenario.ts";

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
    runScenario(descriptor).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
    const { test } = await import("@playwright/test");
    test("external-website", async () => { test.setTimeout(120_000); await runScenario(descriptor); });
}
