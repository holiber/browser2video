/**
 * @description E2E test for console-logs scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "console-logs", import("./console-logs.scenario.js"));
