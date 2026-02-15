/**
 * @description E2E test for tui-terminals scenario using scenarioTest helper.
 */
import { test } from "@playwright/test";
import { scenarioTest } from "@browser2video/runner";

scenarioTest(test, "tui-terminals", import("./tui-terminals.scenario.js"));
