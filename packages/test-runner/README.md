# test-runner

Small, policy-light test runner intended to be copied between repos (or published).

## CLI

```bash
test-runner <suite> [--smoke] [--human] [--pkg <name>...] [--project <name>] [--allow-missing-project]
```

Suites:

- `unit`: run unit tests (Vitest if installed; otherwise `node --test`)
- `scenario`: run Playwright project `scenario` (recommended naming: `*.scenario.e2e.ts`)
- `e2e`: run Playwright project `e2e` (recommended naming: `*.e2e.ts`, ignoring scenario)
- `integration`: run Playwright project `integration` (optional)
- `all`: `unit` + `scenario` + `e2e` (never runs `integration`)

Smoke rules (`--smoke`) apply to Playwright suites only:

- per-test timeout via `SMOKE_PER_TEST_TIMEOUT_MS` (default 30000)
- total timeout via `SMOKE_TOTAL_TIMEOUT_MS` (default 180000)
- stop on first failure
- dot reporter output goes to `run.log`
- terminal output: **one line only** on success / failure

Human execution (`--human`) is orthogonal:

- Playwright: `--headed`, `--workers=1`, `--trace=on`
- Exposes `TEST_RUNNER_HUMAN=1` for test utilities (see `test-runner/human`)

## Artifacts

Each run writes to:

`.cache/tests/<run-id>/` (cleaned before each run)

With:

- `run.log`: full raw output
- `pw-output/`: Playwright output directory (traces/videos/screenshots if enabled by config)

## Playwright config convention (recommended)

Define projects so the runner doesn’t need tags or discovery logic:

```ts
import { defineConfig } from "@playwright/test";

const E2E = /.*\.e2e\.(ts|js)x?$/;
const SCENARIO = /.*\.scenario\.e2e\.(ts|js)x?$/;

export default defineConfig({
  testDir: "tests",
  projects: [
    { name: "e2e", testMatch: E2E, testIgnore: [SCENARIO] },
    { name: "scenario", testMatch: SCENARIO },
  ],
});
```

## Test helper: `breath()`

```js
import { breath } from "test-runner/human";

await breath(300);
```

