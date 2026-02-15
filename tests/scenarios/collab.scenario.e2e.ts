import { test } from "@playwright/test";
import { runCollab } from "@browser2video/runner";
import { collabScenario } from "./collab.scenario.js";
import { startTerminalWsServer } from "./terminal/terminal-ws-server.js";

test("collab scenario", async () => {
  const termServer = await startTerminalWsServer();
  const termWs = encodeURIComponent(termServer.baseWsUrl);

  try {
    await runCollab({
      mode: "fast",
      baseURL: process.env.BASE_URL ?? "http://localhost:5173",
      scenario: collabScenario,
      bossPath: `/notes?role=boss&termWs=${termWs}`,
      workerPath: `/notes?role=worker&termWs=${termWs}`,
      artifactDir: `test-results/collab-${Date.now()}`,
      recordMode: "none",
      headless: true,
    });
  } finally {
    await termServer.close();
  }
});
