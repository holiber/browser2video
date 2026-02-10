# Default Agent

This file defines the default rules and behavior for any agent.
Agent should follow the default rules if they don't have their own rules depending on the role or additional rules file.

## Common rules

Agent MUST not edit files in agents/ folder without permission.
You can find useful resources in the agents/DOCS.md file.

## Documentation

The README.md is an index file for the project with the most important information.
It should have links to other information and basic examples.
Do not overblow it with technical details, for those things use docs/ARCHITECTURE.md file or other files in docs/ folder.

When you edit js, ts files use jsdoc header with description of the file.
When you edit md files make sure links are valid and clickable.
Avoid overdocumenting with repeatable information.

## Temporary files

You may create any files in the gitignored .cache/ folder.
If you find something you wrote can be useful for other agents, ask the user to approve it and move to the correct place.

## Roles

You can find description of roles in the agents/ROLES.md file.
If you don't have a role, try to define it using from your context and task.

## Preferred defaults

We have preferred default ways and dev stack for agents in this repo.
Use the preferred defaults if you can perform the task efficiently.
In other cases use your own way, but explain why you choose it.

### Testing tasks

We prefer to start with one good story test rather than multiple unit tests.
For example if you write a CLI tool that uses several classes like User, Order, Product, etc - do not start with unit tests for each class.
Test this CLI tool close to real usage calling it directly from the command line.

Unit tests are good for testing pure but complex functions.

## Short phrases glossary

When user speaks with agent it can use short phrases or commands:

- "oyd" - once you done
- "/p" - ping or progress - ask to report state and the progress
