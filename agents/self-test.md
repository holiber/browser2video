# Player Self-Test

## Running

```bash
# Fast mode (CI, headless, ~2.5 min)
pnpm self-test

# Human mode (headed, visible cursor + 1s breathe pauses, ~3 min)
pnpm self-test:human

# Headed but fast (visible window, no animation delays)
pnpm self-test -- --headed
```

`--human` sets `B2V_HUMAN=1` which:
- Enables human mode (visible cursor animations, 1s breathe pauses between actions)
- Auto-enables `--headed` (Electron window is visible on screen)

`--headed` alone shows the window but keeps fast mode (no delays).

## Architecture

The self-test **uses the player to test the player**:

1. Playwright launches the outer player (Electron)
2. Selects `player-self-test` scenario via the picker
3. Clicks "Play All"
4. Monitors all steps until completion

The actual test logic lives in `tests/scenarios/player-self-test.scenario.ts` which:
- Spawns an **inner** player (Player B) as a child process
- Opens Player B's web UI in the outer player's session
- Uses `InjectedActor` to drive Player B's UI (cursor visible in-page)

## Test Steps

- actor should split screen horizontally and open the terminal in bottom pane
- actor launches our demo app in terminal and once it ready actors create a browser page with todo app
- ensure we can add todos, reorder them and scroll when there are too many todos (looks like we need to inject another actor to work there)
- after that player closes the terminal, and make sure the todo app doesn't work anymore
- after that player opens basic ui scenario and play it
- once it's played it replay it and click stop after first slide, and go through all slides one by one
- we should ensure we don't have errors in consoles

## Mode Behavior

| Feature | Fast mode | Human mode |
|---------|-----------|------------|
| `breathe()` | Always 0ms (instant) | 1000ms pause |
| Cursor movement | Instant teleport | Smooth wind-mouse animation |
| Click effects | Instant | 25ms ripple + 300ms after-click |
| Typing | Instant | 35ms per keystroke |
| `--headed` | Optional | Auto-enabled |