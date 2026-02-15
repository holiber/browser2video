/**
 * @description E2E test for kanban scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "kanban", import("./kanban.scenario.js"));
