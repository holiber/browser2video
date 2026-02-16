---
title: "API Reference"
sidebar_position: 0
---

# API Reference

Auto-generated from the [`@browser2video/lib`](https://github.com/holiber/browser2video/tree/main/packages/lib) operation registry (26 operations).

## Session

- [`createSession`](./session#createsession) — Create a new recording session.
- [`openPage`](./session#openpage) — Open a browser page.
- [`openTerminal`](./session#openterminal) — Open a terminal pane.
- [`step`](./session#step) — Execute a named step.
- [`finish`](./session#finish) — Finish recording and compose the video.

## Actor

- [`goto`](./actor#goto) — Navigate to a URL.
- [`waitFor`](./actor#waitfor) — Wait for an element to appear.
- [`click`](./actor#click) — Click on an element.
- [`type`](./actor#type) — Type text into an element.
- [`selectOption`](./actor#selectoption) — Select a dropdown option.
- [`scroll`](./actor#scroll) — Scroll an element or the page.
- [`drag`](./actor#drag) — Drag from one element to another.
- [`dragByOffset`](./actor#dragbyoffset) — Drag an element by a pixel offset.
- [`draw`](./actor#draw) — Draw on a canvas.
- [`circleAround`](./actor#circlearound) — Circle the cursor around an element.
- [`breathe`](./actor#breathe) — Add a breathing pause.
- [`injectCursor`](./actor#injectcursor) — Inject the cursor overlay.
- [`moveCursorTo`](./actor#movecursorto) — Move cursor to specific coordinates.
- [`clickLocator`](./actor#clicklocator) — Click a Playwright Locator.

## Narration

- [`speak`](./narration#speak) — Narrate text via TTS.
- [`warmup`](./narration#warmup) — Pre-generate TTS audio.
- [`effect`](./narration#effect) — Play a sound effect.

## Server

- [`startServer`](./server#startserver) — Start a local web server.

## Tools (CLI / MCP)

- [`b2v_run`](./tool#b2v_run) — Run a scenario with video recording.
- [`b2v_list_scenarios`](./tool#b2v_list_scenarios) — List available scenario files.
- [`b2v_doctor`](./tool#b2v_doctor) — Print environment diagnostics.
