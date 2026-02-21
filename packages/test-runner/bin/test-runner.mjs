#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

const ROOT = process.cwd();

function getPackageManager(rootDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    );
    const pm = String(pkg?.packageManager || "");
    if (pm.startsWith("pnpm@")) return "pnpm";
    if (pm.startsWith("npm@")) return "npm";
  } catch {
    /* ignore */
  }
  if (fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(rootDir, "package-lock.json"))) return "npm";
  return "npm";
}

const PM = getPackageManager(ROOT);

function pmExecArgs(bin, args) {
  if (PM === "npm") return ["exec", "--", bin, ...args];
  return ["exec", bin, ...args];
}

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

function spawnTee(cmd, args, { cwd, env, logStream, passthrough }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
      if (passthrough) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
      if (passthrough) process.stderr.write(chunk);
    });

    child.on("close", (code, signal) =>
      resolve({ code: code ?? 0, signal }),
    );
  });
}

function spawnCapture(cmd, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c.toString("utf8")));
    child.stderr.on("data", (c) => (err += c.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? 0, out, err }));
  });
}

function sanitizePathSegment(s) {
  return String(s)
    .trim()
    .replace(/^@/, "")
    .replace(/[\/@]/g, "__")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 120);
}

function runId({ suite, smoke, human }) {
  const parts = [`test-${suite}`];
  if (smoke) parts.push("smoke");
  if (human) parts.push("human");
  return parts.join("__");
}

function artifactsDirFor({ runId: rid, pkgName }) {
  const base = path.join(ROOT, ".cache", "tests", rid);
  return pkgName ? path.join(base, sanitizePathSegment(pkgName)) : base;
}

function readPkgName(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return pkg?.name || path.basename(dir);
  } catch {
    return path.basename(dir);
  }
}

function pkgHasDep(dir, depName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return Boolean(pkg?.dependencies?.[depName] || pkg?.devDependencies?.[depName]);
  } catch {
    return false;
  }
}

async function listWorkspacePackages() {
  const isPnpmWs =
    PM === "pnpm" && fs.existsSync(path.join(ROOT, "pnpm-workspace.yaml"));
  if (!isPnpmWs) return [{ name: readPkgName(ROOT), dir: ROOT }];

  const res = await spawnCapture(
    PM,
    ["-r", "ls", "--depth", "-1", "--json"],
    { cwd: ROOT, env: process.env },
  );
  if (res.code !== 0) return [{ name: readPkgName(ROOT), dir: ROOT }];

  try {
    const parsed = JSON.parse(res.out);
    const pkgs = Array.isArray(parsed) ? parsed : [];
    const out = [];
    for (const p of pkgs) {
      const dir = p?.path;
      if (!dir || typeof dir !== "string") continue;
      if (!fs.existsSync(path.join(dir, "package.json"))) continue;
      out.push({ name: p?.name || readPkgName(dir), dir });
    }
    return out.length ? out : [{ name: readPkgName(ROOT), dir: ROOT }];
  } catch {
    return [{ name: readPkgName(ROOT), dir: ROOT }];
  }
}

function parsePlaywrightCounts(logText) {
  const totalMatch = logText.match(/Running\s+(\d+)\s+tests?\b/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  // Prefer the final "X passed" summary when available.
  const passedMatches = Array.from(logText.matchAll(/^\s*(\d+)\s+passed\b/mg));
  const passed = passedMatches.length
    ? parseInt(passedMatches.at(-1)[1], 10)
    : 0;

  return { total, passed };
}

function parseFirstFailureHeadline(logText) {
  const m = logText.match(/^\s*\d+\)\s+(.+)$/m);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim().slice(0, 180);
}

function truncateOneLine(s, max = 160) {
  const one = String(s || "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

async function runUnit({ pkg, artifactsDir, logStream, passthrough }) {
  const env = { ...process.env, TEST_ARTIFACTS_DIR: artifactsDir };

  if (pkgHasDep(pkg.dir, "vitest")) {
    return await spawnTee(PM, pmExecArgs("vitest", ["run"]), {
      cwd: pkg.dir,
      env,
      logStream,
      passthrough,
    });
  }

  return await spawnTee(process.execPath, ["--test"], {
    cwd: pkg.dir,
    env,
    logStream,
    passthrough,
  });
}

function shouldTreatMissingProjectAsSuccess(output, project) {
  const text = String(output || "");
  return (
    text.includes(`Project(s) "${project}" not found`) ||
    text.includes(`Project(s) '${project}' not found`) ||
    text.includes("Unknown project") ||
    text.includes("No projects matched")
  );
}

async function runPlaywright({
  pkg,
  project,
  smoke,
  human,
  artifactsDir,
  logStream,
  passthrough,
  globalTimeoutMs,
  allowMissingProject,
}) {
  const env = {
    ...process.env,
    TEST_ARTIFACTS_DIR: artifactsDir,
    ...(human ? { TEST_RUNNER_HUMAN: "1" } : {}),
  };

  const pwOut = path.join(artifactsDir, "pw-output");
  const args = [
    "test",
    "--project",
    project,
    "--output",
    pwOut,
    "--pass-with-no-tests",
    ...(human ? ["--headed", "--workers=1", "--trace=on"] : []),
    ...(smoke
      ? [
          "--max-failures=1",
          "--workers=1",
          "--reporter=dot",
          "--timeout",
          String(
            parseInt(process.env.SMOKE_PER_TEST_TIMEOUT_MS || "30000", 10),
          ),
          "--global-timeout",
          String(globalTimeoutMs),
        ]
      : []),
  ];

  const res = await spawnTee(PM, pmExecArgs("playwright", args), {
    cwd: pkg.dir,
    env,
    logStream,
    passthrough,
  });

  if (res.code !== 0 && allowMissingProject) {
    const logPath = path.join(artifactsDir, "run.log");
    const logTxt = await fsp.readFile(logPath, "utf8").catch(() => "");
    if (shouldTreatMissingProjectAsSuccess(logTxt, project)) return { code: 0 };
  }

  return res;
}

const argv = await yargs(hideBin(process.argv))
  .scriptName("test-runner")
  .command(
    "$0 <suite>",
    "Run tests",
    (y) =>
      y
        .positional("suite", {
          choices: ["unit", "e2e", "scenario", "integration", "all"],
          type: "string",
        })
        .option("smoke", {
          type: "boolean",
          default: false,
          describe: "Enable smoke rules (Playwright suites only)",
        })
        .option("human", {
          type: "boolean",
          default: false,
          describe: "Human execution mode (headed + trace + paced via breath())",
        })
        .option("pkg", {
          type: "array",
          describe: "Workspace package name(s) to run (default: all packages)",
        })
        .option("project", {
          type: "string",
          describe: "Override Playwright project name",
        })
        .option("allow-missing-project", {
          type: "boolean",
          default: false,
          describe: "Treat missing Playwright project as success",
        }),
  )
  .help()
  .strict()
  .parseAsync();

const SUITE = argv.suite;
const SMOKE = Boolean(argv.smoke);
const HUMAN = Boolean(argv.human);
const ONLY_PKGS = (argv.pkg || []).map(String);
const PROJECT_OVERRIDE = argv.project ? String(argv.project) : null;
const ALLOW_MISSING_PROJECT = Boolean(argv["allow-missing-project"]);

const totalTimeoutMs = parseInt(process.env.SMOKE_TOTAL_TIMEOUT_MS || "180000", 10);
const warnAfterMs = parseInt(process.env.SMOKE_WARN_AFTER_MS || "60000", 10);

const rid = runId({ suite: SUITE, smoke: SMOKE, human: HUMAN });
const startedAt = Date.now();

const pkgsAll = await listWorkspacePackages();
const pkgs = ONLY_PKGS.length
  ? pkgsAll.filter((p) => ONLY_PKGS.includes(p.name))
  : pkgsAll;

if (pkgs.length === 0) {
  console.error(`No matching packages for --pkg=${ONLY_PKGS.join(", ")}`);
  process.exit(2);
}

let aggPassed = 0;
let aggTotal = 0;

for (const pkg of pkgs) {
  const multi = pkgs.length > 1;
  const artifactsDir = artifactsDirFor({ runId: rid, pkgName: multi ? pkg.name : null });
  await rmrf(artifactsDir);
  await mkdirp(artifactsDir);

  const logPath = path.join(artifactsDir, "run.log");
  const logStream = fs.createWriteStream(logPath, { flags: "w" });

  const elapsedMs = Date.now() - startedAt;
  const remainingMs = Math.max(1000, totalTimeoutMs - elapsedMs);

  try {
    if (SUITE === "unit") {
      const res = await runUnit({ pkg, artifactsDir, logStream, passthrough: true });
      if (res.code !== 0) process.exit(res.code || 1);
      continue;
    }

    if (SUITE === "all") {
      const unitDir = path.join(artifactsDir, "unit");
      await rmrf(unitDir);
      await mkdirp(unitDir);
      const u = await runUnit({
        pkg,
        artifactsDir: unitDir,
        logStream,
        passthrough: true,
      });
      if (u.code !== 0) process.exit(u.code || 1);

      if (!pkgHasDep(pkg.dir, "@playwright/test")) continue;

      const sDir = path.join(artifactsDir, "scenario");
      await rmrf(sDir);
      await mkdirp(sDir);
      const s = await runPlaywright({
        pkg,
        project: PROJECT_OVERRIDE || "scenario",
        smoke: false,
        human: false,
        artifactsDir: sDir,
        logStream,
        passthrough: true,
        globalTimeoutMs: remainingMs,
        allowMissingProject: ALLOW_MISSING_PROJECT,
      });
      if (s.code !== 0) process.exit(s.code || 1);

      const eDir = path.join(artifactsDir, "e2e");
      await rmrf(eDir);
      await mkdirp(eDir);
      const e = await runPlaywright({
        pkg,
        project: PROJECT_OVERRIDE || "e2e",
        smoke: false,
        human: false,
        artifactsDir: eDir,
        logStream,
        passthrough: true,
        globalTimeoutMs: remainingMs,
        allowMissingProject: ALLOW_MISSING_PROJECT,
      });
      if (e.code !== 0) process.exit(e.code || 1);

      continue;
    }

    // For Playwright suites: skip packages without Playwright.
    if (!pkgHasDep(pkg.dir, "@playwright/test")) continue;

    const project =
      PROJECT_OVERRIDE ||
      (SUITE === "scenario"
        ? "scenario"
        : SUITE === "e2e"
          ? "e2e"
          : "integration");

    const res = await runPlaywright({
      pkg,
      project,
      smoke: SMOKE,
      human: HUMAN,
      artifactsDir,
      logStream,
      passthrough: !SMOKE,
      globalTimeoutMs: remainingMs,
      allowMissingProject: ALLOW_MISSING_PROJECT,
    });

    if (!SMOKE) {
      if (res.code !== 0) process.exit(res.code || 1);
      continue;
    }

    const logTxt = await fsp.readFile(logPath, "utf8").catch(() => "");
    const { passed, total } = parsePlaywrightCounts(logTxt);
    aggPassed += passed;
    aggTotal += total;

    if (res.code !== 0) {
      const headline = parseFirstFailureHeadline(logTxt);
      const what = headline ? `${pkg.name}: ${headline}` : `${pkg.name}: exit ${res.code}`;
      console.log(
        `SMOKE FAIL: ${truncateOneLine(what)} | Artifacts: ${artifactsDir}`,
      );
      process.exit(res.code || 1);
    }
  } finally {
    await new Promise((resolve) => logStream.end(resolve));
  }
}

if (SMOKE) {
  const elapsedS = (Date.now() - startedAt) / 1000;
  const ratio = aggTotal > 0 ? `${aggPassed}/${aggTotal}` : "all";
  const warnSuffix = elapsedS * 1000 > warnAfterMs ? " (warn: slow smoke)" : "";
  console.log(`SMOKE: ${ratio} passed in ${elapsedS.toFixed(1)}s${warnSuffix}`);
}

