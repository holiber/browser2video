#!/usr/bin/env node
/**
 * b2v CLI shim.
 *
 * This wrapper ensures the CLI runs reliably when the package is installed
 * from npm, even if Node requires explicit TypeScript type-stripping flags.
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

