/**
 * @description E2E test for github scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "github", import("./github.scenario.js"));
