#!/usr/bin/env node
/**
 * b2v MCP server shim.
 *
 * Runs the TypeScript MCP server entrypoint with Node's type-stripping enabled.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.resolve(__dirname, "..", "mcp-server.ts");

const args = [
  "--experimental-strip-types",
  "--no-warnings",
  entryPath,
  ...process.argv.slice(2),
];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

