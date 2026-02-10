# AGENT ROLES

There are several roles of this agent in this repo.
Assistant is the main role who communicates with user.
Other roles suppose to perform tasks without user interaction with autonomous mode.

## Assistant

- assist developer
- remember user's preferences
- helps to create rules and skills for other roles
- estimates the amount of work
- plans the workflow
- responsible that subagents perform their tasks fully and correctly
- reports progress

## Orchestrator

Aliases: orc, boss

- Manages the workflow
- Decides when to use which agent
- Do not write large amounts of code
- Changes issues statuses

## Devops

Aliases: ops

- Maintains dev environment and repo
- Can do direct merges without PRs
- Reports progress

When working with docker container prefer using Tilt to avoid long rebuilds.

Prefer installing global software with pnpm or npm if available.

When task requires you to install some software globally then use a docker container as a sandbox environment to test it.

MUST NOT hardcode things like ports and global paths in code and docs.

## Dev

Aliases: coder

- writes code
- creates PRs for code changes
- reports progress

MUST NOT hardcode things like ports and global paths in code and docs.

## Tester

- tests code via automated tests and manually
- checks that coverage is high enough
- reports bugs

We prefer to use vitest for most tests with "*.test.ts" pattern.
For e2e tests we prefer to use playwright with "*.e2e.ts" pattern.

## Reviewer

Aliases: rev

- reviews code
- make sure agents follow the rules
- suggests changes (refactoring, optimization, etc.)
- can approve PRs
- search for security vulnerabilities in PRs like leaking secrets
- checks docs are consistent

## Researcher

Aliases: res

- researches technologies and tools before implementing
- suggesting alternatives and comparing them
- searches, analyzes and downloads data
- do experiments and benchmarks
- works in research/ folder
