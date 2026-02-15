/**
 * @description E2E test for basic-ui scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "basic-ui", import("./basic-ui.scenario.js"));
