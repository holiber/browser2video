/**
 * @description Opinionated TTS presets by language.
 * Supports OpenAI and Google Cloud TTS providers.
 *
 * OpenAI voices are English-optimized; Google Cloud voices are native per language,
 * resulting in significantly better accent quality for non-English languages.
 */

export type OpenAITtsModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
export type TtsProvider = "openai" | "google";

export type PopularLanguageCode =
  | "en" // English
  | "zh" // Chinese (Mandarin)
  | "hi" // Hindi
  | "es" // Spanish
  | "fr" // French
  | "ar" // Arabic
  | "bn" // Bengali
  | "pt" // Portuguese
  | "id" // Indonesian
  | "ru"; // Russian

export interface LanguageTtsPreset {
  /** BCP47-ish base code used for selection. */
  code: PopularLanguageCode;
  /** Human label (used for UI/docs; translation prompt can still use a full name). */
  label: string;
  /** OpenAI defaults to use when narration opts do not specify them. */
  openai: {
    model: OpenAITtsModel;
    voice: string;
    maleVoice: string;
    femaleVoice: string;
    speed: number;
  };
  /** Google Cloud TTS defaults. Voices are native to each language. */
  google: {
    voice: string;
    maleVoice: string;
    femaleVoice: string;
    speed: number;
  };
  /** Short note on known quality limitations. */
  notes?: string;
  /** Optional voice alternatives worth trying. */
  alternatives?: string[];
}

/**
 * Presets for Russian + 9 other most popular languages (by number of speakers).
 *
 * Strategy: "classic-hd" — use `tts-1-hd` everywhere for higher audio fidelity.
 * Only classic voices are available on tts-1-hd: alloy, ash, coral, echo, fable,
 * nova, onyx, sage, shimmer.
 */
export const POPULAR_LANGUAGE_TTS_PRESETS: Record<PopularLanguageCode, LanguageTtsPreset> = {
  en: {
    code: "en",
    label: "English",
    openai: { model: "tts-1-hd", voice: "alloy", maleVoice: "onyx", femaleVoice: "nova", speed: 1.0 },
    google: { voice: "en-US-Neural2-J", maleVoice: "en-US-Neural2-J", femaleVoice: "en-US-Neural2-C", speed: 1.0 },
    alternatives: ["ash", "sage", "nova"],
  },
  zh: {
    code: "zh",
    label: "Chinese",
    openai: { model: "tts-1-hd", voice: "onyx", maleVoice: "onyx", femaleVoice: "shimmer", speed: 1.0 },
    google: { voice: "cmn-CN-Neural2-B", maleVoice: "cmn-CN-Neural2-B", femaleVoice: "cmn-CN-Neural2-A", speed: 1.0 },
    alternatives: ["sage", "nova", "echo"],
  },
  hi: {
    code: "hi",
    label: "Hindi",
    openai: { model: "tts-1-hd", voice: "sage", maleVoice: "echo", femaleVoice: "nova", speed: 1.0 },
    google: { voice: "hi-IN-Neural2-B", maleVoice: "hi-IN-Neural2-B", femaleVoice: "hi-IN-Neural2-A", speed: 1.0 },
    alternatives: ["onyx", "nova", "alloy"],
  },
  es: {
    code: "es",
    label: "Spanish",
    openai: { model: "tts-1-hd", voice: "alloy", maleVoice: "ash", femaleVoice: "coral", speed: 1.0 },
    google: { voice: "es-ES-Neural2-B", maleVoice: "es-ES-Neural2-B", femaleVoice: "es-ES-Neural2-A", speed: 1.0 },
    notes: "Community reports suggest accent control is limited (e.g. ES-ES vs LATAM).",
    alternatives: ["nova", "sage", "coral"],
  },
  fr: {
    code: "fr",
    label: "French",
    openai: { model: "tts-1-hd", voice: "nova", maleVoice: "fable", femaleVoice: "nova", speed: 1.0 },
    google: { voice: "fr-FR-Neural2-B", maleVoice: "fr-FR-Neural2-B", femaleVoice: "fr-FR-Neural2-A", speed: 1.0 },
    alternatives: ["alloy", "sage", "fable"],
  },
  ar: {
    code: "ar",
    label: "Arabic",
    openai: { model: "tts-1-hd", voice: "onyx", maleVoice: "onyx", femaleVoice: "shimmer", speed: 0.95 },
    google: { voice: "ar-XA-Neural2-D", maleVoice: "ar-XA-Neural2-D", femaleVoice: "ar-XA-Neural2-A", speed: 0.95 },
    alternatives: ["sage", "echo", "ash"],
  },
  bn: {
    code: "bn",
    label: "Bengali",
    openai: { model: "tts-1-hd", voice: "sage", maleVoice: "echo", femaleVoice: "nova", speed: 0.95 },
    google: { voice: "bn-IN-Neural2-B", maleVoice: "bn-IN-Neural2-B", femaleVoice: "bn-IN-Neural2-A", speed: 0.95 },
    alternatives: ["onyx", "nova", "alloy"],
  },
  pt: {
    code: "pt",
    label: "Portuguese",
    openai: { model: "tts-1-hd", voice: "nova", maleVoice: "onyx", femaleVoice: "nova", speed: 1.0 },
    google: { voice: "pt-BR-Neural2-B", maleVoice: "pt-BR-Neural2-B", femaleVoice: "pt-BR-Neural2-A", speed: 1.0 },
    alternatives: ["alloy", "sage", "coral"],
  },
  id: {
    code: "id",
    label: "Indonesian",
    openai: { model: "tts-1-hd", voice: "sage", maleVoice: "echo", femaleVoice: "coral", speed: 1.0 },
    google: { voice: "id-ID-Neural2-B", maleVoice: "id-ID-Neural2-B", femaleVoice: "id-ID-Neural2-A", speed: 1.0 },
    alternatives: ["alloy", "nova", "echo"],
  },
  ru: {
    code: "ru",
    label: "Russian",
    openai: { model: "tts-1-hd", voice: "onyx", maleVoice: "onyx", femaleVoice: "shimmer", speed: 0.98 },
    google: { voice: "ru-RU-Neural2-B", maleVoice: "ru-RU-Neural2-B", femaleVoice: "ru-RU-Neural2-A", speed: 1.0 },
    alternatives: ["sage", "shimmer", "echo"],
    notes: "OpenAI voices are not Russian-native; Google Neural2 voices are natively trained for Russian.",
  },
};

export function normalizeLanguageCode(input?: string | null): PopularLanguageCode | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const base = s.split(/[-_]/)[0]!;

  if (base === "en" || s.startsWith("english")) return "en";
  if (base === "ru" || s.startsWith("russian") || s.includes("рус")) return "ru";
  if (base === "zh" || s.startsWith("chinese") || s.includes("mandarin")) return "zh";
  if (base === "hi" || s.startsWith("hindi")) return "hi";
  if (base === "es" || s.startsWith("spanish")) return "es";
  if (base === "fr" || s.startsWith("french")) return "fr";
  if (base === "ar" || s.startsWith("arabic")) return "ar";
  if (base === "bn" || s.startsWith("bengali")) return "bn";
  if (base === "pt" || s.startsWith("portuguese")) return "pt";
  if (base === "id" || s.startsWith("indonesian")) return "id";

  return null;
}

export function getOpenAITtsDefaultsForLanguage(language?: string | null): {
  model: OpenAITtsModel;
  voice: string;
  speed: number;
} | null {
  const code = normalizeLanguageCode(language);
  if (!code) return null;
  return POPULAR_LANGUAGE_TTS_PRESETS[code].openai;
}

export function getGoogleTtsDefaultsForLanguage(language?: string | null): {
  voice: string;
  speed: number;
} | null {
  const code = normalizeLanguageCode(language);
  if (!code) return null;
  return POPULAR_LANGUAGE_TTS_PRESETS[code].google;
}

/** Check if a voice string looks like a Google Cloud TTS voice name (e.g. "ru-RU-Neural2-B"). */
export function isGoogleVoiceName(voice: string): boolean {
  return /^[a-z]{2,3}-[A-Z]{2}/.test(voice);
}

/**
 * Resolve a TTS voice name for a given provider, language, and gender.
 * Falls back to the default (gender-neutral) voice if no gendered variant exists.
 */
export function resolveVoiceForGender(
  provider: "openai" | "google" | "system" | "piper",
  language?: string | null,
  gender?: "male" | "female" | null,
): string | null {
  if (!gender) return null;

  if (provider === "system") {
    if (process.platform === "darwin") return gender === "male" ? "Alex" : "Samantha";
    if (process.platform === "win32") return gender === "male" ? "Microsoft David Desktop" : "Microsoft Zira Desktop";
    return null;
  }

  if (provider === "piper") {
    return gender === "male" ? "en_US-lessac-medium" : "en_US-amy-medium";
  }

  const code = normalizeLanguageCode(language);
  if (!code) {
    if (provider === "openai") return gender === "male" ? "onyx" : "nova";
    return null;
  }

  const preset = POPULAR_LANGUAGE_TTS_PRESETS[code];
  if (provider === "openai") return gender === "male" ? preset.openai.maleVoice : preset.openai.femaleVoice;
  if (provider === "google") return gender === "male" ? preset.google.maleVoice : preset.google.femaleVoice;

  return null;
}

