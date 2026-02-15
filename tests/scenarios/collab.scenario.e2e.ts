/**
 * @description E2E test for collab scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "collab", import("./collab.scenario.js"));
