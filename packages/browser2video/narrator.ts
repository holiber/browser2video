/**
 * @description Audio narration engine for Browser2Video.
 * Provides TTS generation via OpenAI, audio event collection,
 * and ffmpeg-based audio mixing into the final video.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync, execSync, spawn as spawnProcess } from "child_process";

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

// ---------------------------------------------------------------------------
//  AudioDirectorAPI — interface exposed to scenarios via session.audio
// ---------------------------------------------------------------------------

export interface AudioDirectorAPI {
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  effect(name: string, opts?: EffectOptions): Promise<void>;
  /** Pre-generate TTS audio so a subsequent speak() starts instantly. */
  warmup(text: string, opts?: SpeakOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
//  TTS Engine (OpenAI)
// ---------------------------------------------------------------------------

class TTSEngine {
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

/** Play an audio file through system speakers (fire-and-forget). */
function playAudioFile(audioPath: string, ffmpegPath?: string): void {
  // Try platform-native players first, fall back to ffplay (bundled with ffmpeg)
  const isMac = process.platform === "darwin";
  const player = isMac ? "afplay" : undefined;

  if (player) {
    const proc = spawnProcess(player, [audioPath], { stdio: "ignore", detached: true });
    proc.unref();
    return;
  }

  // ffplay fallback (cross-platform, co-located with ffmpeg)
  const ffplayPath = ffmpegPath
    ? path.join(path.dirname(ffmpegPath), `ffplay${path.extname(ffmpegPath)}`)
    : "ffplay";
  const proc = spawnProcess(ffplayPath, ["-nodisp", "-autoexit", "-loglevel", "quiet", audioPath], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

// ---------------------------------------------------------------------------
//  AudioDirector — collects audio events during scenario execution
// ---------------------------------------------------------------------------

export class AudioDirector implements AudioDirectorAPI {
  private events: AudioEvent[] = [];
  private tts: TTSEngine;
  private videoStartTime: number;
  private ffmpegPath?: string;
  private realtime: boolean;

  constructor(opts: {
    tts: TTSEngine;
    videoStartTime: number;
    ffmpegPath?: string;
    realtime?: boolean;
  }) {
    this.tts = opts.tts;
    this.videoStartTime = opts.videoStartTime;
    this.ffmpegPath = opts.ffmpegPath;
    this.realtime = opts.realtime ?? false;
  }

  /** Pre-generate TTS audio so a subsequent speak() starts instantly. */
  async warmup(text: string, opts?: SpeakOptions): Promise<void> {
    await this.tts.generate(text, opts, this.ffmpegPath);
  }

  /** Narrate text. Generates TTS, optionally plays in realtime, and pauses for speech duration. */
  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    const startMs = Date.now() - this.videoStartTime;
    const { audioPath, durationMs } = await this.tts.generate(
      text,
      opts,
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

    // Play through speakers in realtime if enabled
    if (this.realtime) {
      playAudioFile(audioPath, this.ffmpegPath);
    }

    // Pause so the video stays in sync with narration.
    // Add a small buffer (50ms) for natural pacing.
    await new Promise((r) => setTimeout(r, durationMs + 50));
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

  const apiKey = narr.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "  [Narration] No OpenAI API key found. Set OPENAI_API_KEY env var or pass apiKey option.",
    );
    console.warn("  [Narration] Falling back to silent mode.");
    return new NoopAudioDirector();
  }

  const tts = new TTSEngine({
    apiKey,
    cacheDir: narr.cacheDir ?? path.resolve(".cache/tts"),
    voice: narr.voice ?? "ash",
    speed: narr.speed ?? 1.0,
    model: narr.model ?? "tts-1",
    language: narr.language,
  });

  return new AudioDirector({
    tts,
    videoStartTime: opts.videoStartTime,
    ffmpegPath: opts.ffmpegPath,
    realtime: narr.realtime,
  });
}
