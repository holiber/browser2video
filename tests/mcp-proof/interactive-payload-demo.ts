/**
 * MCP Client demo: dynamically builds a browser2video scenario by calling
 * b2v MCP tools over stdio. Navigates payloadcms.com, selects text, and
 * narrates it — producing a video and a replayable scenario file.
 *
 * Usage:
 *   node --experimental-strip-types tests/mcp-proof/interactive-payload-demo.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LoggingMessageNotificationSchema, ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const mcpServerPath = path.resolve(projectRoot, "packages/browser2video/bin/b2v-mcp.js");

// ---------------------------------------------------------------------------
//  Connect to b2v MCP server
// ---------------------------------------------------------------------------

console.log("Starting b2v MCP server...");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--experimental-strip-types",
    "--no-warnings",
    mcpServerPath,
  ],
  cwd: projectRoot,
  env: { ...process.env } as Record<string, string>,
  stderr: "pipe",
});

// Pipe server stderr to our stderr so [b2v] logs are visible
const stderrStream = transport.stderr;
if (stderrStream) {
  stderrStream.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
}

const client = new Client(
  { name: "payload-demo", version: "1.0.0" },
  { capabilities: {} },
);

// Listen for MCP logging notifications from the server
client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
  const p = notification.params;
  console.log(`  [mcp-log/${p.level}] ${p.data}`);
});

// Listen for progress notifications
client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
  const p = notification.params;
  const pct = p.total ? `${p.progress}/${p.total}` : String(p.progress);
  console.log(`  [progress] ${pct} ${p.message ?? ""}`);
});

await client.connect(transport);
console.log("Connected to b2v MCP server.\n");

// ---------------------------------------------------------------------------
//  Helper: call a tool and handle errors
// ---------------------------------------------------------------------------

async function call(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  console.log(`>>> ${toolName}(${JSON.stringify(args)})`);
  const result = await client.callTool(
    { name: toolName, arguments: args },
    undefined,
    { timeout: 180_000 },
  );
  const text = (result as any).content?.[0]?.text;
  if ((result as any).isError) {
    console.error(`  ERROR: ${text}`);
    throw new Error(text ?? "Unknown tool error");
  }
  const parsed = text ? JSON.parse(text) : result;
  console.log(`  OK: ${JSON.stringify(parsed).slice(0, 200)}`);
  return parsed;
}

// Attempt a b2v_add_step; on failure log and skip (step is NOT recorded)
async function tryStep(caption: string, code: string, narration?: string): Promise<boolean> {
  try {
    const args: Record<string, unknown> = { caption, code };
    if (narration) args.narration = narration;
    await call("b2v_add_step", args);
    return true;
  } catch (err: any) {
    console.error(`  STEP FAILED (skipped): ${caption} — ${err.message?.slice(0, 120)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Main demo flow
// ---------------------------------------------------------------------------

try {
  // 1. Start session
  await call("b2v_start", { mode: "human", record: true, cdpPort: 9333 });

  // 2. Open page at payloadcms.com
  await call("b2v_open_page", { url: "https://payloadcms.com" });

  // 3. Dynamic steps — each sent as code strings executed server-side
  await tryStep(
    "Accept cookies",
    `
    try {
      await page.waitForSelector('button:has-text("Accept")', { timeout: 5000 });
      await actor.click('button:has-text("Accept")');
    } catch {
      // Cookie banner might not appear
    }
    `,
  );

  // Scroll down to footer where "Documentation" link lives
  await tryStep(
    "Scroll to footer",
    `await actor.scroll(null, 3000);`,
  );

  // Click Documentation link
  const navOk = await tryStep(
    "Navigate to Documentation",
    `
    await actor.click('a:has-text("Documentation")');
    await page.waitForURL('**/docs/**', { timeout: 10000 });
    `,
  );

  if (!navOk) {
    // Fallback: navigate directly
    await tryStep(
      "Navigate to docs (fallback)",
      `await page.goto("https://payloadcms.com/docs/getting-started/what-is-payload", { waitUntil: "domcontentloaded" });`,
    );
  } else {
    // Click "What is Payload?" in the sidebar
    await tryStep(
      "Open What is Payload page",
      `
      await page.waitForSelector('a:has-text("What is Payload?")', { timeout: 5000 });
      await actor.click('a:has-text("What is Payload?")');
      await page.waitForURL('**/what-is-payload**', { timeout: 8000 });
      `,
    );
  }

  // Dismiss cookie banner again if it reappears after navigation
  await tryStep(
    "Dismiss cookie banner",
    `
    try {
      const btn = await page.$('button:has-text("Accept")');
      if (btn) await actor.click('button:has-text("Accept")');
    } catch {}
    `,
  );

  // Wait for page content to be visible
  await tryStep(
    "Wait for page content",
    `await page.waitForSelector('h1', { timeout: 8000 });`,
  );

  // Select the target paragraph with human-like mouse drag
  await tryStep(
    "Select key paragraph",
    `
    // Find the intro text and the 3rd list item to select from/to
    const fromSel = 'p:has-text("Payload is the Next.js fullstack framework")';
    const toSel = 'li:has-text("Instant REST, GraphQL")';
    await actor.selectText(fromSel, toSel);
    `,
    "Payload is the Next.js fullstack framework. Write a Payload Config and instantly get: a full Admin Panel, automatic database schema, and instant REST, GraphQL, and straight-to-DB Node.js APIs.",
  );

  // Small pause to show the selection
  await tryStep(
    "Pause on selection",
    `await new Promise(r => setTimeout(r, 2000));`,
  );

  // 4. Save scenario file
  const scenarioPath = "tests/mcp-proof/payload-walkthrough.scenario.ts";
  await call("b2v_save_scenario", {
    filePath: scenarioPath,
    url: "https://payloadcms.com",
  });

  // 5. Finish session — compose video
  const result = await call("b2v_finish");

  console.log("\n=== DEMO COMPLETE ===");
  console.log(`Video:    ${result.videoPath}`);
  console.log(`Scenario: ${path.resolve(projectRoot, scenarioPath)}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Steps:    ${result.steps}`);
} catch (err: any) {
  console.error("\nFATAL:", err.message);
} finally {
  await client.close();
  process.exit(0);
}
