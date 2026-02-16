/**
 * @description Narration operations — TTS and sound effects.
 */
import { z } from "zod";
import { defineOp } from "../define-op.ts";
import { SpeakOptionsSchema, EffectOptionsSchema } from "../schemas/narration.ts";

export const narratorSpeak = defineOp({
  name: "narration.speak",
  category: "narration",
  summary: "Narrate text via TTS.",
  description:
    "Generates speech via OpenAI TTS, records the audio event at the current timestamp, " +
    "optionally plays through speakers in realtime, and pauses for the speech duration " +
    "to keep the video in sync.",
  input: z.object({
    text: z.string().describe("Text to speak."),
    opts: SpeakOptionsSchema.optional().describe("Override voice or speed for this utterance."),
  }),
  output: z.void(),
  examples: [{ title: "Speak", code: 'await session.audio.speak("Welcome to the demo.");' }],
  tags: ["audio"],
});

export const narratorWarmup = defineOp({
  name: "narration.warmup",
  category: "narration",
  summary: "Pre-generate TTS audio.",
  description:
    "Generates and caches the TTS audio for the given text without playing it. " +
    "A subsequent speak() call with the same text will start playback instantly.",
  input: z.object({
    text: z.string().describe("Text to pre-generate."),
    opts: SpeakOptionsSchema.optional().describe("Override voice or speed."),
  }),
  output: z.void(),
  examples: [{ title: "Warmup", code: 'await session.audio.warmup("Next we click the button.");' }],
  tags: ["audio"],
});

export const narratorEffect = defineOp({
  name: "narration.effect",
  category: "narration",
  summary: "Play a sound effect.",
  description: "Plays a named sound effect at the current timestamp. Effects are short and do not pause execution.",
  input: z.object({
    name: z.string().describe("Effect name or file path."),
    opts: EffectOptionsSchema.optional().describe("Override volume."),
  }),
  output: z.void(),
  examples: [{ title: "Play click sound", code: 'await session.audio.effect("click");' }],
  tags: ["audio"],
});

export const narrationOps = [narratorSpeak, narratorWarmup, narratorEffect] as const;
