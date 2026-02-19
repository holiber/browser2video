/**
 * Terminal scenario — opens a shell and runs "echo hello world".
 *
 * Run:  npx b2v run examples/terminal-echo.ts
 * Or:   node --experimental-transform-types examples/terminal-echo.ts
 */
import { createSession } from "browser2video";

const session = await createSession({ mode: "human", record: true });
const { step } = session;

const shell = await session.createTerminal();

await step("Wait for prompt", async () => {
  await shell.waitForPrompt();
});

await step("Run echo", async () => {
  await shell.typeAndEnter('echo "hello world"');
  await shell.waitForPrompt();
});

await step("List files", async () => {
  await shell.typeAndEnter("ls -la");
  await shell.waitForPrompt();
});

const result = await session.finish();
console.log("Video:", result.video);
