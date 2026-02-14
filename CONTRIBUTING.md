# Contributing

Thanks for contributing to Browser2Video.

## Development setup

```bash
pnpm install
pnpm dev
```

## Run scenarios

```bash
pnpm b2v list-scenarios
pnpm b2v run --scenario basic-ui --mode human --record screencast --headed
pnpm b2v run --scenario basic-ui --mode fast  --record none
```

## CI expectations

- PRs should keep `pnpm -r build` passing.
- CI uploads artifacts for debugging (see `.github/workflows/ci.yml`).

## Coding style

- **English only** for code and comments.
- Prefer small, composable helpers and keep platform-specific behavior behind best-effort abstractions.

