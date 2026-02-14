/**
 * @description Audio narration engine for Browser2Video.
 * Provides TTS generation via OpenAI, audio event collection,
 * and ffmpeg-based audio mixing into the final video.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync, execSync } from "child_process";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface NarrationOptions {
  enabled: boolean;
  /** OpenAI TTS voice: alloy | echo | fable | onyx | nova | shimmer */
  voice?: string;
  /** Speech speed 0.25-4.0 (default: 1.0) */
  speed?: number;
  /** OpenAI TTS model: tts-1 | tts-1-hd */
  model?: string;
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Cache directory for TTS audio files (default: .cache/tts) */
  cacheDir?: string;
}

export interface AudioEvent {
  type: "speak" | "effect";
  /** Offset from video start in milliseconds */
  startMs: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Path to the audio file */
  audioPath: string;
  /** Original text (for speak events) or effect name */
  label: string;
  /** Volume multiplier 0-1 (default: 1.0) */
  volume: number;
}

export interface SpeakOptions {
  voice?: string;
  speed?: number;
}

export interface EffectOptions {
  volume?: number;
}

/** Interface exposed to scenarios via ctx.audio */
export interface AudioDirectorAPI {
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  effect(name: string, opts?: EffectOptions): Promise<void>;
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

  constructor(opts: {
    apiKey: string;
    cacheDir: string;
    voice: string;
    speed: number;
    model: string;
  }) {
    this.apiKey = opts.apiKey;
    this.cacheDir = opts.cacheDir;
    this.defaultVoice = opts.voice;
    this.defaultSpeed = opts.speed;
    this.model = opts.model;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private cacheKey(text: string, voice: string, speed: number): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${this.model}:${voice}:${speed}:${text}`)
      .digest("hex")
      .slice(0, 16);
    return hash;
  }

  /**
   * Generate TTS audio for the given text.
   * Returns the path to the MP3 file and its duration in ms.
   */
  async generate(
    text: string,
    opts?: { voice?: string; speed?: number },
    ffmpegPath?: string,
  ): Promise<{ audioPath: string; durationMs: number }> {
    const voice = opts?.voice ?? this.defaultVoice;
    const speed = opts?.speed ?? this.defaultSpeed;
    const key = this.cacheKey(text, voice, speed);
    const audioPath = path.join(this.cacheDir, `${key}.mp3`);

    // Check cache
    if (fs.existsSync(audioPath)) {
      const durationMs = getAudioDurationMs(audioPath, ffmpegPath);
      return { audioPath, durationMs };
    }

    // Call OpenAI TTS API
    console.log(`    [TTS] Generating: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        voice,
        input: text,
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
    console.log(`    [TTS] Generated ${(durationMs / 1000).toFixed(1)}s audio`);
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
//  AudioDirector — collects audio events during scenario execution
// ---------------------------------------------------------------------------

export class AudioDirector implements AudioDirectorAPI {
  private events: AudioEvent[] = [];
  private tts: TTSEngine;
  private videoStartTime: number;
  private ffmpegPath?: string;

  constructor(opts: {
    tts: TTSEngine;
    videoStartTime: number;
    ffmpegPath?: string;
  }) {
    this.tts = opts.tts;
    this.videoStartTime = opts.videoStartTime;
    this.ffmpegPath = opts.ffmpegPath;
  }

  /** Narrate text. Generates TTS and pauses for speech duration. */
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

    // Pause so the video stays in sync with narration.
    // Add a small buffer (200ms) for natural pacing.
    await new Promise((r) => setTimeout(r, durationMs + 200));
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

  console.log(`\n  Mixing ${events.length} audio clip(s) into video...`);

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
    console.log(`  Narrated video: ${outputPath}`);

    // Replace original with narrated version
    fs.renameSync(outputPath, videoPath);
    console.log(`  Replaced original video with narrated version`);
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
    voice: narr.voice ?? "nova",
    speed: narr.speed ?? 1.0,
    model: narr.model ?? "tts-1",
  });

  return new AudioDirector({
    tts,
    videoStartTime: opts.videoStartTime,
    ffmpegPath: opts.ffmpegPath,
  });
}
