# AI Test Setup Rules (Repository Contract)

This file defines a unified testing contract for AI agents working on this repo.
Agents MUST run tests via the package scripts below (do not call test tools directly unless a script is missing).

## Goals

- **One unified interface** for writing + running tests across repos.
- **Fast confidence first**: smoke rules provide quick signal and low terminal noise.
- **Clear separation of concerns**: unit vs e2e vs scenario vs integration.
- **Predictable artifacts**: every run writes logs/videos/traces into a clean gitignored folder.

---

## Commands contract (package.json)

Every repo MUST expose these scripts (names are fixed):

```jsonc
{
  "scripts": {
    "test": "…",               // Run ALL tests: unit + e2e + scenario. MUST EXCLUDE integration.

    "test:unit": "…",          // Unit tests only

    "test:e2e": "…",           // E2E tests only

    "test:scenario": "…",      // Scenario tests only (default run settings)

    "test:smoke": "…",         // Run scenario tests with SMOKE rules enabled (see below)

    "test:integration": "…"    // Integration tests only. NEVER included in "test".
  }
}
```

### How agents run commands

Agents may use either `npm` or `pnpm` depending on the repo:

* `npm run test:smoke`
* `pnpm run test:smoke`

(Use the package manager already used by the repo.)

---

## Test types (what each test is for)

### Unit tests (`test:unit`)

**Goal:** validate isolated logic fast and deterministically.

* Prefer Node-first unit tests.
* Recommended tools: **Vitest** (Vite projects) or **Node test runner** (`node:test`) for simple Node libraries.
* Should be fast, low-flake, and runnable offline.

### E2E tests (`test:e2e`)

**Goal:** validate behavior across the full running app boundary (UI and/or real runtime).

* Recommended tool: **Playwright**.

### Scenario tests (`test:scenario`)

**Goal:** validate the main user workflow end-to-end, from a user perspective, quickly.

Rules:

* Each repo MUST have **at least one** scenario test that exercises the core workflow.
* Scenario tests should cover "happy path" basics, not exhaustive edge cases.

**Web app minimum scenario (recommended):**

* start the app
* open key pages/routes
* assert:

  * no error pages
  * no browser console errors
  * no server/launcher errors (terminal output)

### Integration tests (`test:integration`)

**Goal:** validate expensive/external integrations (LLMs, paid APIs, cloud resources, etc.).

Rules:

* MUST be runnable only via `test:integration`.
* MUST NOT run as part of `test` or `test:smoke`.

---

## Execution rules (orthogonal concepts)

### SMOKE (ruleset)

**Smoke is not a "mode".** It is a ruleset that can be combined with how tests are executed.

**Smoke rules are enabled when running `test:smoke`:**

* strict time limits
* minimal terminal output on success
* stop on first failure
* full details go to logs/artifacts

**Smoke terminal output rules:**

* On success, print **one line** only, e.g.:

  * `SMOKE: 5/5 passed in 10.5s`
* On failure:

  * stop immediately
  * print one short line, e.g.:

  * `SMOKE FAIL: ()`
  * print the artifacts folder path

### Human execution mode (watchable)

**Human is an execution mode** for scenario/e2e runs: headed UI + pacing for humans.

Human execution expectations:

* headed mode (where applicable, e.g. Playwright headed)
* slower, watchable actions
* video recording on (saved to artifacts)
* optional screenshots/traces as needed

#### `breath()` helper (recommended)

Create a test utility like `breath()` that only delays when "human mode" is enabled:

* `breath()` is a no-op in normal runs
* `breath()` introduces a small delay in human mode to make actions watchable

(Implementation is tool-specific; keep it in shared test utils.)

---

## Default test priorities (what agents should do first)

When changing code, agents MUST follow this order:

1. **First:** run smoke rules

   * `npm run test:smoke` or `pnpm run test:smoke`
2. Then, pick based on what changed:

   * logic-only changes → `test:unit`
   * UI/workflows → `test:scenario` and/or `test:e2e`
3. Before finalizing a larger change:

   * `test`
4. Only when explicitly needed:

   * `test:integration`

Agents SHOULD report:

* which commands were run
* pass/fail
* artifacts folder path (especially on failure)

---

## Artifacts and logs

All test runs MUST write artifacts into:

* `.cache/tests/<run-name>/`

Where `<run-name>` MUST be stable and human-readable, without timestamps.
Recommended format:

* `<script-name>__<variant>`

Examples:

* `.cache/tests/test-smoke__scenario/`
* `.cache/tests/test-scenario__human/`
* `.cache/tests/test-e2e__chromium/`

Rules:

* The run folder MUST be **cleaned before each run** (no stale artifacts).
* `.cache/` MUST be gitignored.

Suggested contents:

* `run.log` (full output)
* `videos/` (human execution)
* `screenshots/` (on failure)
* `traces/` (Playwright trace when enabled)

---

## Smoke time limits (environment variables)

Only these environment variables are part of the contract, and only for SMOKE rules:

* `SMOKE_PER_TEST_TIMEOUT_MS` (default `30000`)
* `SMOKE_TOTAL_TIMEOUT_MS` (default `180000`)
* `SMOKE_WARN_AFTER_MS` (default `60000`)

Behavior:

* If total runtime exceeds `SMOKE_WARN_AFTER_MS`, print a warning (do not fail solely for warning).
* On timeout, fail fast and point to logs.

---

## Recommended tooling (non-binding)

* **Unit:** Vitest (Vite repos) or Node's built-in test runner for Node libs
* **E2E/Scenario:** Playwright
* Keep scenario tests as a "thin happy path" layer; push edge cases into unit tests.

---

## Glossary

* **Unit:** isolated logic tests (fast, deterministic)
* **E2E:** tests across the full app boundary (UI/runtime)
* **Scenario:** a user-workflow "happy path" validation
* **Smoke rules:** fast-fail constraints + minimal terminal noise (can be combined with human execution)
* **Human execution:** headed + paced runs intended to be watchable
* **Integration:** tests involving external/costly dependencies
