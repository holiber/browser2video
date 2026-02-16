/**
 * @description Narration / TTS schemas.
 */
import { z } from "zod";

export const NarrationOptionsSchema = z.object({
  enabled: z.boolean().describe("Whether TTS narration is active."),
  voice: z.string().optional().describe("OpenAI TTS voice: alloy | ash | coral | echo | fable | nova | onyx | sage | shimmer."),
  speed: z.number().min(0.25).max(4).optional().describe("Speech speed 0.25–4.0 (default: 1.0)."),
  model: z.string().optional().describe("OpenAI TTS model: tts-1 | tts-1-hd."),
  apiKey: z.string().optional().describe("OpenAI API key (defaults to OPENAI_API_KEY env var)."),
  cacheDir: z.string().optional().describe("Cache directory for TTS audio files (default: .cache/tts)."),
  realtime: z.boolean().optional().describe("Play audio through speakers in realtime while the scenario runs."),
  language: z.string().optional().describe("Auto-translate narration text to this language before TTS (e.g. 'ru', 'es', 'de')."),
});

export type NarrationOptions = z.infer<typeof NarrationOptionsSchema>;

export const SpeakOptionsSchema = z.object({
  voice: z.string().optional().describe("Override the default TTS voice for this utterance."),
  speed: z.number().min(0.25).max(4).optional().describe("Override the default speech speed."),
});

export type SpeakOptions = z.infer<typeof SpeakOptionsSchema>;

export const EffectOptionsSchema = z.object({
  volume: z.number().min(0).max(1).optional().describe("Volume multiplier 0–1."),
});

export type EffectOptions = z.infer<typeof EffectOptionsSchema>;

export const AudioEventSchema = z.object({
  type: z.enum(["speak", "effect"]).describe("Event kind."),
  startMs: z.number().describe("Offset from video start in milliseconds."),
  durationMs: z.number().describe("Duration in milliseconds."),
  audioPath: z.string().describe("Path to the audio file."),
  label: z.string().describe("Original text (speak) or effect name."),
  volume: z.number().describe("Volume multiplier 0–1."),
});

export type AudioEvent = z.infer<typeof AudioEventSchema>;
