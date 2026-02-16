---
title: "Actor API"
sidebar_position: 2
---

# Actor API

## `goto`

> Navigate to a URL.

Navigates the page and waits for network idle. The cursor overlay is auto-injected after navigation in human mode.

### Parameters

- `url` (`string`, **required**) — URL to navigate to.

### Examples

**Navigate**

```ts
await actor.goto("https://example.com");
```

---

## `waitFor`

> Wait for an element to appear.

Waits until the element matching the selector is visible in the DOM.

### Parameters

- `selector` (`string`, **required**) — CSS selector to wait for.
- `timeout` (`number`, optional) — Timeout in milliseconds (default: 3000).

### Examples

**Wait for button**

```ts
await actor.waitFor("button.submit");
```

---

## `click`

> Click on an element.

Moves the cursor to the element center using WindMouse physics and clicks. In human mode, a ripple click effect is shown and the mouse button is held briefly.

### Parameters

- `selector` (`string`, **required**) — CSS selector for the target element.

### Examples

**Click a button**

```ts
await actor.click("button.submit");
```

---

## `type`

> Type text into an element.

Clicks the element to focus it, then types text character by character in human mode (with word-boundary pauses) or instantly in fast mode.

### Parameters

- `selector` (`string`, **required**) — CSS selector for the input element.
- `text` (`string`, **required**) — Text to type.

### Examples

**Type into input**

```ts
await actor.type("#email", "user@example.com");
```

---

## `selectOption`

> Select a dropdown option.

Opens a dropdown by clicking the trigger, then finds and clicks the option with matching text.

### Parameters

- `triggerSelector` (`string`, **required**) — CSS selector for the dropdown trigger.
- `valueText` (`string`, **required**) — Visible text of the option to select.

### Examples

**Select country**

```ts
await actor.selectOption("#country", "Japan");
```

---

## `scroll`

> Scroll an element or the page.

Scrolls within the matched element (auto-detecting scrollable children and Radix scroll areas) or the page itself if selector is null. Uses smooth scrolling in human mode.

### Parameters

- `selector` (`string | null`, **required**) — CSS selector for the scroll container, or null for page scroll.
- `deltaY` (`number`, **required**) — Scroll amount in pixels (positive = down).

### Examples

**Scroll page**

```ts
await actor.scroll(null, 400);
```

**Scroll element**

```ts
await actor.scroll(".content", 200);
```

---

## `drag`

> Drag from one element to another.

Moves the cursor to the source element, presses the mouse, drags to the target element with smooth linear interpolation, then releases.

### Parameters

- `fromSelector` (`string`, **required**) — CSS selector for the drag source.
- `toSelector` (`string`, **required**) — CSS selector for the drop target.

### Examples

**Drag item**

```ts
await actor.drag("#item-1", "#drop-zone");
```

---

## `dragByOffset`

> Drag an element by a pixel offset.

Grabs the element and drags it by the specified dx/dy pixel offset, then releases.

### Parameters

- `selector` (`string`, **required**) — CSS selector for the element to drag.
- `dx` (`number`, **required**) — Horizontal offset in pixels.
- `dy` (`number`, **required**) — Vertical offset in pixels.

### Examples

**Drag right 100px**

```ts
await actor.dragByOffset(".slider", 100, 0);
```

---

## `draw`

> Draw on a canvas.

Draws a path on a canvas element. Points use 0–1 normalized coordinates relative to the canvas bounds. In human mode, segments are interpolated with smooth easing.

### Parameters

- `canvasSelector` (`string`, **required**) — CSS selector for the canvas element.
- `points` (`object[]`, **required**) — Array of normalized points defining the path.

### Examples

**Draw a line**

```ts
await actor.draw("canvas", [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }]);
```

---

## `circleAround`

> Circle the cursor around an element.

Draws a spiral path (1.5 rotations) around the element, like a presenter circling something on a whiteboard. Radius grows from 0.7x to 1.0x with slight noise for human imperfection. Duration auto-scales with element size. No-op in fast mode.

### Parameters

- `selector` (`string`, **required**) — CSS selector for the element to circle.
- `durationMs` (`number`, optional) — Override the auto-calculated duration.

### Examples

**Circle a heading**

```ts
await actor.circleAround("h1.title");
```

---

## `breathe`

> Add a breathing pause.

Inserts a short pause between major steps for natural pacing. No-op in fast mode.

### Examples

**Pause**

```ts
await actor.breathe();
```

---

## `injectCursor`

> Inject the cursor overlay.

Injects the SVG cursor overlay and click-ripple effect into the page. Called automatically after navigation in human mode.

---

## `moveCursorTo`

> Move cursor to specific coordinates.

Moves the cursor smoothly to the given (x, y) coordinates using WindMouse physics. Useful when interacting with Playwright APIs directly.

### Parameters

- `x` (`number`, **required**) — Target X coordinate.
- `y` (`number`, **required**) — Target Y coordinate.

---

## `clickLocator`

> Click a Playwright Locator.

Moves the cursor to a Playwright Locator's center and clicks it. Useful when working with Playwright's Locator API directly.

### Parameters

- `locator` (`any`, **required**) — Playwright Locator instance.

---
