The default agent for this repo is agents/DEFAULT.AGENT.md
^ Read this file on session start

Testing strategy: agents/testing-strategy.md

## Player scenario concurrency rule

When driving **Studio Player** (Electron app) via UI automation, WebSocket messages, or CLI:

- Never start multiple scenarios concurrently in a single player instance.
- Always serialize scenario commands (`load`, `runAll`, `runStep`, `reset`, `cancel`).
- Do not issue a second `runAll`/`runStep` while a run is in progress; wait for completion or send `cancel` and wait for cancellation acknowledgement before starting another run.
- If you implement new automation, ensure it cannot trigger overlapping executions (race conditions between `load` and `runAll`, double-clicks, reconnect retries, etc.).

## Pre-commit sanitization

Before committing any changes, check [agents/SANITIZER.md](agents/SANITIZER.md) for path and credential sanitization rules.

## Scenario debugging workflow rule

When validating “all scenarios run without errors” and you find a failure:

- First reproduce by playing **only the failing scenario** (do not rerun the full suite yet).
- Fix the scenario (or the underlying library/app bug), then rerun **only that scenario** until it passes reliably.
- Only after the single-scenario run is stable, rerun the **all-scenarios** suite again.
