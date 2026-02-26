/**
 * @description Audio narration engine for Browser2Video.
 * Provides TTS generation via OpenAI, audio event collection,
 * and ffmpeg-based audio mixing into the final video.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync, execSync, spawn as spawnProcess, type ChildProcess } from "child_process";
import { resolveCacheDir } from "./cache-dir.ts";

// Re-export types from local schemas (single source of truth)
export type {
  NarrationOptions,
  AudioEvent,
  SpeakOptions,
  EffectOptions,
} from "./schemas/narration.ts";

import type {
  NarrationOptions,
  AudioEvent,
  SpeakOptions,
  EffectOptions,
} from "./schemas/narration.ts";

import { getOpenAITtsDefaultsForLanguage, getGoogleTtsDefaultsForLanguage, isGoogleVoiceName, resolveVoiceForGender } from "./tts-language-presets.ts";

// ---------------------------------------------------------------------------
//  AudioDirectorAPI — interface exposed to scenarios via session.audio
// ---------------------------------------------------------------------------

export interface AudioDirectorAPI {
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  effect(name: string, opts?: EffectOptions): Promise<void>;
  /** Pre-generate TTS audio so a subsequent speak() starts instantly. */
  warmup(text: string, opts?: SpeakOptions): Promise<void>;
  /** Kill all playing audio processes and cancel pending timers. */
  stop(): void;
}

// ---------------------------------------------------------------------------
//  TTS Engine interface
// ---------------------------------------------------------------------------

interface ITTSEngine {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }>;
}

// ---------------------------------------------------------------------------
//  TTS Engine (OpenAI)
// ---------------------------------------------------------------------------

class TTSEngine implements ITTSEngine {
  private apiKey: string;
  private cacheDir: string;
  private defaultVoice: string;
  private defaultSpeed: number;
  private model: string;
  private language?: string;

  constructor(opts: {
    apiKey: string;
    cacheDir: string;
    voice: string;
    speed: number;
    model: string;
    language?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.cacheDir = opts.cacheDir;
    this.defaultVoice = opts.voice;
    this.defaultSpeed = opts.speed;
    this.model = opts.model;
    this.language = opts.language;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private cacheKey(text: string, voice: string, speed: number, lang?: string): string {
    const langPart = lang ? `:${lang}` : "";
    const hash = crypto
      .createHash("sha256")
      .update(`${this.model}:${voice}:${speed}${langPart}:${text}`)
      .digest("hex")
      .slice(0, 16);
    return hash;
  }

  /**
   * Translate text to the configured language using OpenAI Chat API.
   * Results are cached to disk alongside TTS audio.
   */
  private async translate(text: string): Promise<string> {
    if (!this.language) return text;

    const cacheFile = path.join(
      this.cacheDir,
      `tr_${crypto.createHash("sha256").update(`${this.language}:${text}`).digest("hex").slice(0, 16)}.txt`,
    );

    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, "utf-8");
    }

    console.error(`    [TTS] Translating to ${this.language}: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Translate the following text to ${this.language}. Respond with ONLY the translation, no explanations or extra text.`,
          },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.warn(`    [TTS] Translation failed (${response.status}), using original text: ${errBody}`);
      return text;
    }

    const data = (await response.json()) as any;
    const translated: string = data.choices?.[0]?.message?.content?.trim() ?? text;

    fs.writeFileSync(cacheFile, translated, "utf-8");
    console.error(`    [TTS] Translated: "${translated.slice(0, 60)}${translated.length > 60 ? "..." : ""}"`);
    return translated;
  }

  /**
   * Generate TTS audio for the given text.
   * If a language is configured, the text is auto-translated first.
   * Returns the path to the MP3 file and its duration in ms.
   */
  async generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }> {
    const voice = opts?.voice ?? this.defaultVoice;
    const speed = opts?.speed ?? this.defaultSpeed;

    // Translate if language is set
    const ttsText = this.language ? await this.translate(text) : text;

    const key = this.cacheKey(text, voice, speed, this.language);
    const audioPath = path.join(this.cacheDir, `${key}.mp3`);

    // Check cache
    if (fs.existsSync(audioPath)) {
      const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
      return { audioPath, durationMs };
    }

    // Call OpenAI TTS API
    console.error(`    [TTS] Generating: "${ttsText.slice(0, 60)}${ttsText.length > 60 ? "..." : ""}"`);
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        voice,
        input: ttsText,
        speed,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(
        `OpenAI TTS API error ${response.status}: ${errBody}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);

    const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
    console.error(`    [TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
    return { audioPath, durationMs };
  }
}

// ---------------------------------------------------------------------------
//  TTS Engine (Google Cloud)
// ---------------------------------------------------------------------------

class GoogleTTSEngine implements ITTSEngine {
  private googleApiKey: string;
  private cacheDir: string;
  private defaultVoice: string;
  private defaultSpeed: number;
  private language?: string;

  constructor(opts: {
    googleApiKey: string;
    cacheDir: string;
    voice: string;
    speed: number;
    language?: string;
  }) {
    this.googleApiKey = opts.googleApiKey;
    this.cacheDir = opts.cacheDir;
    this.defaultVoice = opts.voice;
    this.defaultSpeed = opts.speed;
    this.language = opts.language;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private cacheKey(text: string, voice: string, speed: number, lang?: string): string {
    const langPart = lang ? `:${lang}` : "";
    const hash = crypto
      .createHash("sha256")
      .update(`google:${voice}:${speed}${langPart}:${text}`)
      .digest("hex")
      .slice(0, 16);
    return hash;
  }

  /**
   * Resolve the Google voice to use. Per-utterance overrides that look like
   * OpenAI short names (e.g. "shimmer") are ignored — the default Google voice
   * is used instead. Full Google voice names (e.g. "ru-RU-Neural2-B") are honoured.
   */
  private resolveVoice(override?: string): string {
    if (override && isGoogleVoiceName(override)) return override;
    return this.defaultVoice;
  }

  async generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }> {
    const voice = this.resolveVoice(opts?.voice);
    const speed = opts?.speed ?? this.defaultSpeed;

    const ttsText = this.language
      ? await translateText(text, this.language)
      : text;

    const key = this.cacheKey(text, voice, speed, this.language);
    const audioPath = path.join(this.cacheDir, `${key}.mp3`);

    if (fs.existsSync(audioPath)) {
      const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
      return { audioPath, durationMs };
    }

    const languageCode = voice.split("-").slice(0, 2).join("-");

    console.error(`    [Google TTS] Generating (${voice}): "${ttsText.slice(0, 60)}${ttsText.length > 60 ? "..." : ""}"`);
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: ttsText },
          voice: { languageCode, name: voice },
          audioConfig: { audioEncoding: "MP3", speakingRate: speed },
        }),
      },
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Google Cloud TTS API error ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as any;
    const buffer = Buffer.from(data.audioContent, "base64");
    fs.writeFileSync(audioPath, buffer);

    const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
    console.error(`    [Google TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
    return { audioPath, durationMs };
  }
}

// ---------------------------------------------------------------------------
//  TTS Engine (System — macOS say / Windows SAPI / Linux espeak-ng)
// ---------------------------------------------------------------------------

class SystemTTSEngine implements ITTSEngine {
  private cacheDir: string;
  private defaultVoice: string;
  private defaultSpeed: number;
  private language?: string;
  private platform: string;

  constructor(opts: {
    cacheDir: string;
    voice?: string;
    speed?: number;
    language?: string;
  }) {
    this.cacheDir = opts.cacheDir;
    this.platform = process.platform;
    this.defaultVoice = opts.voice ?? SystemTTSEngine.defaultVoiceForPlatform(this.platform);
    this.defaultSpeed = opts.speed ?? 1.0;
    this.language = opts.language;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private static defaultVoiceForPlatform(p: string): string {
    if (p === "darwin") return "Samantha";
    if (p === "win32") return "Microsoft David Desktop";
    return "default";
  }

  static isAvailable(): boolean {
    const p = process.platform;
    if (p === "darwin") {
      try { execFileSync("which", ["say"], { stdio: "pipe" }); return true; } catch { return false; }
    }
    if (p === "win32") return true; // SAPI is always present
    // Linux: check for espeak-ng or espeak
    try { execFileSync("which", ["espeak-ng"], { stdio: "pipe" }); return true; } catch {
      try { execFileSync("which", ["espeak"], { stdio: "pipe" }); return true; } catch { return false; }
    }
  }

  private cacheKey(text: string, voice: string, speed: number, lang?: string): string {
    const langPart = lang ? `:${lang}` : "";
    return crypto.createHash("sha256")
      .update(`system:${this.platform}:${voice}:${speed}${langPart}:${text}`)
      .digest("hex").slice(0, 16);
  }

  async generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }> {
    const voice = opts?.voice ?? this.defaultVoice;
    const speed = opts?.speed ?? this.defaultSpeed;

    const ttsText = this.language ? await translateText(text, this.language) : text;

    const key = this.cacheKey(text, voice, speed, this.language);
    const audioPath = path.join(this.cacheDir, `${key}.mp3`);

    if (fs.existsSync(audioPath)) {
      return { audioPath, durationMs: getAudioDurationMs(audioPath, ffmpegPath) };
    }

    console.error(`    [System TTS] Generating (${voice}): "${ttsText.slice(0, 60)}${ttsText.length > 60 ? "..." : ""}"`);

    const rawPath = path.join(this.cacheDir, `${key}.aiff`);
    const ffmpeg = ffmpegPath ?? "ffmpeg";

    if (this.platform === "darwin") {
      const rate = Math.round(200 * speed);
      execFileSync("say", ["-v", voice, "-r", String(rate), "-o", rawPath, ttsText], { stdio: "pipe" });
    } else if (this.platform === "win32") {
      const wavPath = rawPath.replace(/\.aiff$/, ".wav");
      const ps = `Add-Type -AssemblyName System.Speech;` +
        `$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;` +
        `$s.SelectVoice('${voice.replace(/'/g, "''")}');` +
        `$s.Rate=${Math.round((speed - 1) * 10)};` +
        `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}');` +
        `$s.Speak('${ttsText.replace(/'/g, "''")}');$s.Dispose()`;
      execFileSync("powershell", ["-Command", ps], { stdio: "pipe" });
      execFileSync(ffmpeg, ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", audioPath], { stdio: "pipe" });
      try { fs.unlinkSync(wavPath); } catch {}
      const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
      console.error(`    [System TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
      return { audioPath, durationMs };
    } else {
      // Linux: espeak-ng
      const wavPath = rawPath.replace(/\.aiff$/, ".wav");
      const espeakBin = (() => {
        try { execFileSync("which", ["espeak-ng"], { stdio: "pipe" }); return "espeak-ng"; } catch { return "espeak"; }
      })();
      const espeakSpeed = Math.round(175 * speed);
      execFileSync(espeakBin, ["-s", String(espeakSpeed), "-w", wavPath, ttsText], { stdio: "pipe" });
      execFileSync(ffmpeg, ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", audioPath], { stdio: "pipe" });
      try { fs.unlinkSync(wavPath); } catch {}
      const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
      console.error(`    [System TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
      return { audioPath, durationMs };
    }

    // macOS: convert AIFF to MP3
    execFileSync(ffmpeg, ["-y", "-i", rawPath, "-codec:a", "libmp3lame", "-b:a", "192k", audioPath], { stdio: "pipe" });
    try { fs.unlinkSync(rawPath); } catch {}

    const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
    console.error(`    [System TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
    return { audioPath, durationMs };
  }
}

// ---------------------------------------------------------------------------
//  TTS Engine (Piper — free offline neural TTS)
// ---------------------------------------------------------------------------

class PiperTTSEngine implements ITTSEngine {
  private cacheDir: string;
  private defaultVoice: string;
  private defaultSpeed: number;
  private language?: string;
  private piperBin: string;

  constructor(opts: {
    cacheDir: string;
    voice?: string;
    speed?: number;
    language?: string;
    piperBin?: string;
  }) {
    this.cacheDir = opts.cacheDir;
    this.defaultVoice = opts.voice ?? "en_US-lessac-medium";
    this.defaultSpeed = opts.speed ?? 1.0;
    this.language = opts.language;
    this.piperBin = opts.piperBin ?? "piper";
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  static isAvailable(): boolean {
    try { execFileSync("which", ["piper"], { stdio: "pipe" }); return true; } catch { return false; }
  }

  /**
   * Attempt to install Piper via pip.
   * Returns true if installation succeeded.
   */
  static tryInstall(): boolean {
    console.error("    [Piper] Attempting to install piper-tts via pip...");
    try {
      execSync("pip install piper-tts 2>&1", { stdio: "pipe", timeout: 120_000 });
      console.error("    [Piper] Installation successful.");
      return true;
    } catch {
      console.warn("    [Piper] pip install failed. Install manually: pip install piper-tts");
      return false;
    }
  }

  private cacheKey(text: string, voice: string, speed: number, lang?: string): string {
    const langPart = lang ? `:${lang}` : "";
    return crypto.createHash("sha256")
      .update(`piper:${voice}:${speed}${langPart}:${text}`)
      .digest("hex").slice(0, 16);
  }

  async generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }> {
    const voice = opts?.voice ?? this.defaultVoice;
    const speed = opts?.speed ?? this.defaultSpeed;

    const ttsText = this.language ? await translateText(text, this.language) : text;

    const key = this.cacheKey(text, voice, speed, this.language);
    const audioPath = path.join(this.cacheDir, `${key}.mp3`);

    if (fs.existsSync(audioPath)) {
      return { audioPath, durationMs: getAudioDurationMs(audioPath, ffmpegPath) };
    }

    console.error(`    [Piper] Generating (${voice}): "${ttsText.slice(0, 60)}${ttsText.length > 60 ? "..." : ""}"`);

    const wavPath = path.join(this.cacheDir, `${key}.wav`);
    const ffmpeg = ffmpegPath ?? "ffmpeg";

    // Piper reads from stdin and writes WAV
    const args = ["--model", voice, "--output_file", wavPath];
    if (speed !== 1.0) args.push("--length_scale", String(1.0 / speed));

    try {
      execSync(`echo ${JSON.stringify(ttsText)} | ${this.piperBin} ${args.join(" ")}`, {
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch (err) {
      throw new Error(`Piper TTS failed: ${(err as Error).message}`);
    }

    // Convert WAV to MP3
    execFileSync(ffmpeg, ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", audioPath], { stdio: "pipe" });
    try { fs.unlinkSync(wavPath); } catch {}

    const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
    console.error(`    [Piper] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
    return { audioPath, durationMs };
  }
}

// ---------------------------------------------------------------------------
//  resolveNarrator — auto-detect best available TTS provider
// ---------------------------------------------------------------------------

export interface ResolvedNarrator {
  provider: string;
  engine: ITTSEngine;
}

/**
 * Resolve the best available TTS engine based on explicit provider choice
 * or auto-detection. Priority: Google Cloud → OpenAI → System → Piper → noop.
 */
export function resolveNarrator(narr: NarrationOptions): ResolvedNarrator | null {
  const provider = narr.provider ?? "auto";
  const cacheDir = narr.cacheDir ?? resolveCacheDir("tts");

  const googleKey = narr.googleApiKey ?? process.env.GOOGLE_TTS_API_KEY;
  const openaiKey = narr.apiKey ?? process.env.OPENAI_API_KEY;

  // Helper to create engines — gender-based voice selection when explicit voice is absent
  const makeGoogle = () => {
    const googleDefaults = getGoogleTtsDefaultsForLanguage(narr.language);
    const genderVoice = !narr.voice ? resolveVoiceForGender("google", narr.language, narr.gender) : null;
    return new GoogleTTSEngine({
      googleApiKey: googleKey!,
      cacheDir,
      voice: narr.voice && isGoogleVoiceName(narr.voice)
        ? narr.voice
        : genderVoice ?? googleDefaults?.voice ?? "en-US-Neural2-J",
      speed: narr.speed ?? googleDefaults?.speed ?? 1.0,
      language: narr.language,
    });
  };

  const makeOpenAI = () => {
    const langDefaults = getOpenAITtsDefaultsForLanguage(narr.language);
    const genderVoice = !narr.voice ? resolveVoiceForGender("openai", narr.language, narr.gender) : null;
    return new TTSEngine({
      apiKey: openaiKey!,
      cacheDir,
      voice: narr.voice ?? genderVoice ?? langDefaults?.voice ?? "ash",
      speed: narr.speed ?? langDefaults?.speed ?? 1.0,
      model: narr.model ?? langDefaults?.model ?? "tts-1-hd",
      language: narr.language,
    });
  };

  const makeSystem = () => {
    const genderVoice = !narr.voice ? resolveVoiceForGender("system", narr.language, narr.gender) : null;
    return new SystemTTSEngine({
      cacheDir,
      voice: narr.voice ?? genderVoice,
      speed: narr.speed,
      language: narr.language,
    });
  };

  const makePiper = () => {
    const genderVoice = !narr.voice ? resolveVoiceForGender("piper", narr.language, narr.gender) : null;
    return new PiperTTSEngine({
      cacheDir,
      voice: narr.voice ?? genderVoice,
      speed: narr.speed,
      language: narr.language,
    });
  };

  // Explicit provider
  if (provider !== "auto") {
    switch (provider) {
      case "google":
        if (!googleKey) { console.warn("  [Narration] GOOGLE_TTS_API_KEY not set."); return null; }
        return { provider: "google", engine: makeGoogle() };
      case "openai":
        if (!openaiKey) { console.warn("  [Narration] OPENAI_API_KEY not set."); return null; }
        return { provider: "openai", engine: makeOpenAI() };
      case "system":
        if (!SystemTTSEngine.isAvailable()) { console.warn("  [Narration] No system TTS available."); return null; }
        return { provider: "system", engine: makeSystem() };
      case "piper":
        if (!PiperTTSEngine.isAvailable()) {
          if (!PiperTTSEngine.tryInstall()) return null;
        }
        return { provider: "piper", engine: makePiper() };
    }
  }

  // Auto-detect: try each in priority order
  if (googleKey) {
    console.error("  [Narration] Auto-detected provider: Google Cloud TTS");
    return { provider: "google", engine: makeGoogle() };
  }
  if (openaiKey) {
    console.error("  [Narration] Auto-detected provider: OpenAI");
    return { provider: "openai", engine: makeOpenAI() };
  }
  if (SystemTTSEngine.isAvailable()) {
    console.error("  [Narration] Auto-detected provider: System TTS (" + process.platform + ")");
    return { provider: "system", engine: makeSystem() };
  }
  if (PiperTTSEngine.isAvailable()) {
    console.error("  [Narration] Auto-detected provider: Piper");
    return { provider: "piper", engine: makePiper() };
  }

  console.warn("  [Narration] No TTS provider available. Narration disabled.");
  return null;
}

// ---------------------------------------------------------------------------
//  Audio duration detection via ffprobe
// ---------------------------------------------------------------------------

function getAudioDurationMs(
  filePath: string,
  ffmpegPath?: string,
): number {
  // ffprobe is co-located with ffmpeg
  const ffprobePath = resolveFfprobe(ffmpegPath);
  try {
    const out = execFileSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const seconds = parseFloat(out);
    if (Number.isFinite(seconds)) {
      return Math.round(seconds * 1000);
    }
  } catch {
    // fallback: estimate from file size (MP3 ~128kbps)
  }

  // Rough fallback: MP3 at ~128kbps
  const stat = fs.statSync(filePath);
  return Math.round((stat.size * 8) / 128000 * 1000);
}

function resolveFfprobe(ffmpegPath?: string): string {
  if (ffmpegPath) {
    // ffprobe is next to ffmpeg in the same directory
    const dir = path.dirname(ffmpegPath);
    const ext = path.extname(ffmpegPath);
    const probePath = path.join(dir, `ffprobe${ext}`);
    if (fs.existsSync(probePath)) return probePath;
  }
  return "ffprobe";
}

// ---------------------------------------------------------------------------
//  Realtime audio playback
// ---------------------------------------------------------------------------

/** Play an audio file through system speakers. Returns the spawned process. */
function playAudioFile(audioPath: string, ffmpegPath?: string): ChildProcess {
  const isMac = process.platform === "darwin";
  const player = isMac ? "afplay" : undefined;

  if (player) {
    const proc = spawnProcess(player, [audioPath], { stdio: "ignore", detached: true });
    proc.unref();
    return proc;
  }

  const ffplayPath = ffmpegPath
    ? path.join(path.dirname(ffmpegPath), `ffplay${path.extname(ffmpegPath)}`)
    : "ffplay";
  const proc = spawnProcess(ffplayPath, ["-nodisp", "-autoexit", "-loglevel", "quiet", audioPath], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return proc;
}

// ---------------------------------------------------------------------------
//  Public translation helper — shares cache with TTSEngine.translate
// ---------------------------------------------------------------------------

/**
 * Translate text via OpenAI Chat API with disk caching.
 * Uses the same cache directory and key format as the TTS engine, so
 * translations are shared between pre-translation and TTS generation.
 *
 * Returns the original text unchanged when `language` is falsy or
 * `OPENAI_API_KEY` is missing.
 */
export async function translateText(
  text: string,
  language: string | undefined | null,
  opts?: { apiKey?: string; cacheDir?: string },
): Promise<string> {
  if (!language) return text;

  const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return text;

  const cacheDir = opts?.cacheDir ?? resolveCacheDir("tts");
  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheFile = path.join(
    cacheDir,
    `tr_${crypto.createHash("sha256").update(`${language}:${text}`).digest("hex").slice(0, 16)}.txt`,
  );

  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile, "utf-8");
  }

  console.error(`    [translate] → ${language}: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate the following text to ${language}. Respond with ONLY the translation, no explanations or extra text.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.warn(`    [translate] Failed (${response.status}), using original: ${errBody}`);
    return text;
  }

  const data = (await response.json()) as any;
  const translated: string = data.choices?.[0]?.message?.content?.trim() ?? text;

  fs.writeFileSync(cacheFile, translated, "utf-8");
  console.error(`    [translate] "${translated.slice(0, 60)}${translated.length > 60 ? "..." : ""}"`);
  return translated;
}

// ---------------------------------------------------------------------------
//  AudioDirector — collects audio events during scenario execution
// ---------------------------------------------------------------------------

export class AudioDirector implements AudioDirectorAPI {
  private events: AudioEvent[] = [];
  private tts: ITTSEngine;
  private videoStartTime: number;
  private ffmpegPath?: string;
  private realtime: boolean;
  private provider: string;
  private language?: string;
  private sessionGender?: "male" | "female";
  private _activeProcs = new Set<ChildProcess>();
  private _sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private _sleepResolve: (() => void) | null = null;
  private _stopped = false;

  constructor(opts: {
    tts: ITTSEngine;
    videoStartTime: number;
    ffmpegPath?: string;
    realtime?: boolean;
    provider?: string;
    language?: string;
    gender?: "male" | "female";
  }) {
    this.tts = opts.tts;
    this.videoStartTime = opts.videoStartTime;
    this.ffmpegPath = opts.ffmpegPath;
    this.realtime = opts.realtime ?? false;
    this.provider = opts.provider ?? "openai";
    this.language = opts.language;
    this.sessionGender = opts.gender;
  }

  /** Pre-generate TTS audio so a subsequent speak() starts instantly. */
  async warmup(text: string, opts?: SpeakOptions): Promise<void> {
    await this.tts.generate(text, opts, this.ffmpegPath);
  }

  /** Narrate text. Generates TTS, optionally plays in realtime, and pauses for speech duration. */
  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (this._stopped) return;

    const effectiveOpts = { ...opts };
    const gender = effectiveOpts.gender ?? this.sessionGender;
    if (gender && !effectiveOpts.voice) {
      const genderVoice = resolveVoiceForGender(
        this.provider as any,
        this.language,
        gender,
      );
      if (genderVoice) effectiveOpts.voice = genderVoice;
    }

    const startMs = Date.now() - this.videoStartTime;
    const { audioPath, durationMs } = await this.tts.generate(
      text,
      effectiveOpts,
      this.ffmpegPath,
    );

    this.events.push({
      type: "speak",
      startMs,
      durationMs,
      audioPath,
      label: text,
      volume: 1.0,
    });

    if (this.realtime) {
      const proc = playAudioFile(audioPath, this.ffmpegPath);
      this._activeProcs.add(proc);
      proc.on("exit", () => this._activeProcs.delete(proc));
    }

    await new Promise<void>((resolve) => {
      this._sleepResolve = resolve;
      this._sleepTimer = setTimeout(() => {
        this._sleepTimer = null;
        this._sleepResolve = null;
        resolve();
      }, durationMs + 50);
    });
  }

  /** Play a sound effect at the current timestamp. */
  async effect(name: string, opts?: EffectOptions): Promise<void> {
    const sfxPath = resolveSfxPath(name);
    if (!sfxPath) {
      console.warn(`    [SFX] Unknown effect: "${name}"`);
      return;
    }

    const startMs = Date.now() - this.videoStartTime;
    const durationMs = getAudioDurationMs(sfxPath, this.ffmpegPath);

    this.events.push({
      type: "effect",
      startMs,
      durationMs,
      audioPath: sfxPath,
      label: name,
      volume: opts?.volume ?? 0.5,
    });

    // Effects are short — don't pause
  }

  /** Kill all playing audio and cancel pending sleep timers. */
  stop(): void {
    this._stopped = true;
    for (const proc of this._activeProcs) {
      try { proc.kill("SIGTERM"); } catch { /* already exited */ }
    }
    this._activeProcs.clear();
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    if (this._sleepResolve) {
      this._sleepResolve();
      this._sleepResolve = null;
    }
  }

  /** Get all collected audio events */
  getEvents(): AudioEvent[] {
    return [...this.events];
  }
}

// ---------------------------------------------------------------------------
//  NoopAudioDirector — used when narration is disabled
// ---------------------------------------------------------------------------

export class NoopAudioDirector implements AudioDirectorAPI {
  async warmup(_text: string, _opts?: SpeakOptions): Promise<void> {}
  async speak(_text: string, _opts?: SpeakOptions): Promise<void> {}
  async effect(_name: string, _opts?: EffectOptions): Promise<void> {}
  stop(): void {}
}

// ---------------------------------------------------------------------------
//  Sound effects resolution
// ---------------------------------------------------------------------------

/** Resolve a built-in sound effect name to its file path */
function resolveSfxPath(name: string): string | undefined {
  // Look for bundled effects in the assets directory
  const assetsDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../assets/sfx",
  );

  const candidates = [
    path.join(assetsDir, `${name}.wav`),
    path.join(assetsDir, `${name}.mp3`),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Also allow absolute / relative paths
  if (fs.existsSync(name)) return name;

  return undefined;
}

// ---------------------------------------------------------------------------
//  Audio mixing — merge audio events into the final MP4
// ---------------------------------------------------------------------------

/**
 * Mix all audio events into the video file using ffmpeg.
 * Produces a new file with audio track merged in.
 *
 * @returns Path to the output file (with audio), or the original path if no events.
 */
export function mixAudioIntoVideo(opts: {
  videoPath: string;
  events: AudioEvent[];
  ffmpegPath: string;
  outputPath?: string;
}): string {
  const { videoPath, events, ffmpegPath } = opts;

  if (events.length === 0) return videoPath;

  const outputPath =
    opts.outputPath ??
    videoPath.replace(/\.mp4$/, ".narrated.mp4");

  console.error(`\n  Mixing ${events.length} audio clip(s) into video...`);

  // Build the ffmpeg command with a complex filter graph.
  // Strategy:
  // 1. Input 0 = video file
  // 2. Inputs 1..N = audio clips
  // 3. Delay each audio clip to its start time
  // 4. Mix all together
  // 5. Mux with the video stream (copy video, encode audio as AAC)

  const args: string[] = ["-y", "-i", videoPath];

  // Add each audio clip as input
  for (const ev of events) {
    args.push("-i", ev.audioPath);
  }

  // Build filter graph
  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const inputIdx = i + 1; // 0 is the video
    const label = `a${i}`;

    // Delay and adjust volume
    const delayMs = Math.max(0, Math.round(ev.startMs));
    let filter = `[${inputIdx}:a]adelay=${delayMs}|${delayMs}`;
    if (ev.volume !== 1.0) {
      filter += `,volume=${ev.volume.toFixed(2)}`;
    }
    // Pad with silence so all streams have same length
    filter += `,apad[${label}]`;
    filterParts.push(filter);
    mixInputs.push(`[${label}]`);
  }

  // Mix all audio streams
  const mixLabel = "mixed";
  filterParts.push(
    `${mixInputs.join("")}amix=inputs=${events.length}:normalize=0[${mixLabel}]`,
  );

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "0:v", "-map", `[${mixLabel}]`);
  args.push("-c:v", "copy"); // Don't re-encode video
  args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-shortest");
  args.push(outputPath);

  try {
    execFileSync(ffmpegPath, args, { stdio: "pipe" });
    console.error(`  Narrated video: ${outputPath}`);

    // Replace original with narrated version
    fs.renameSync(outputPath, videoPath);
    console.error(`  Replaced original video with narrated version`);
    return videoPath;
  } catch (err) {
    console.warn(
      "  Audio mixing failed:",
      (err as Error).message,
    );
    return videoPath;
  }
}

// ---------------------------------------------------------------------------
//  Factory — create the right AudioDirector based on options
// ---------------------------------------------------------------------------

export function createAudioDirector(opts: {
  narration?: NarrationOptions;
  videoStartTime: number;
  ffmpegPath?: string;
}): AudioDirectorAPI & { getEvents?: () => AudioEvent[] } {
  const narr = opts.narration;
  if (!narr?.enabled) {
    return new NoopAudioDirector();
  }

  const resolved = resolveNarrator(narr);
  if (!resolved) {
    console.warn("  [Narration] Falling back to silent mode.");
    return new NoopAudioDirector();
  }

  console.error(`  [Narration] Provider: ${resolved.provider}`);
  return new AudioDirector({
    tts: resolved.engine,
    videoStartTime: opts.videoStartTime,
    ffmpegPath: opts.ffmpegPath,
    realtime: narr.realtime,
    provider: resolved.provider,
    language: narr.language,
    gender: narr.gender,
  });
}
