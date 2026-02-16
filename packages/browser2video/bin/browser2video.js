#!/usr/bin/env node
/**
 * browser2video CLI shim.
 *
 * Same CLI as `b2v`, but allows `npx browser2video <command>`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "..", "cli.ts");

const args = [
  "--experimental-strip-types",
  "--no-warnings",
  cliPath,
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

