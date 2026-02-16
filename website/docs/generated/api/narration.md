---
title: "Narration API"
sidebar_position: 3
---

# Narration API

## `speak`

> Narrate text via TTS.

Generates speech via OpenAI TTS, records the audio event at the current timestamp, optionally plays through speakers in realtime, and pauses for the speech duration to keep the video in sync.

### Parameters

- `text` (`string`, **required**) — Text to speak.
- `opts` (`object`, optional) — Override voice or speed for this utterance.

### Examples

**Speak**

```ts
await session.audio.speak("Welcome to the demo.");
```

---

## `warmup`

> Pre-generate TTS audio.

Generates and caches the TTS audio for the given text without playing it. A subsequent speak() call with the same text will start playback instantly.

### Parameters

- `text` (`string`, **required**) — Text to pre-generate.
- `opts` (`object`, optional) — Override voice or speed.

### Examples

**Warmup**

```ts
await session.audio.warmup("Next we click the button.");
```

---

## `effect`

> Play a sound effect.

Plays a named sound effect at the current timestamp. Effects are short and do not pause execution.

### Parameters

- `name` (`string`, **required**) — Effect name or file path.
- `opts` (`object`, optional) — Override volume.

### Examples

**Play click sound**

```ts
await session.audio.effect("click");
```

---
