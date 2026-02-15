/**
 * @description Generalized N-pane video composition using ffmpeg.
 * Supports row (hstack), grid (xstack), and auto layouts.
 */
import { execFileSync, spawnSync } from "child_process";
import { probeDurationSeconds } from "./screen-capture.js";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function probeWidth(videoPath: string, ffmpeg: string): number {
  const res = spawnSync(ffmpeg, ["-i", videoPath], { encoding: "utf-8" });
  const text = String(res.stderr ?? "") + String(res.stdout ?? "");
  const match = text.match(/Stream.*Video:.* (\d{3,5})x(\d{3,5})/);
  return match ? parseInt(match[1], 10) : 0;
}

export interface ComposeOptions {
  /** Ordered array of input video file paths. */
  inputs: string[];
  outputPath: string;
  ffmpeg: string;
  /** Layout mode (default: "auto"). */
  layout?: "auto" | "row" | "grid" | { cols: number };
  /** Target duration in seconds (for PTS normalisation). */
  targetDurationSec?: number;
  /** Optional CSS crop rectangle (used with cssViewportW). */
  cssCrop?: { x: number; y: number; w: number; h: number };
  cssViewportW?: number;
}

/**
 * Compose N video files into a single video.
 * - 1 input: simple re-encode (WebM → MP4).
 * - 2-3 inputs (row / auto): hstack.
 * - 4+ inputs (grid / auto): xstack with calculated layout.
 */
export function composeVideos(opts: ComposeOptions): void {
  const { inputs, outputPath, ffmpeg } = opts;
  const layout = opts.layout ?? "auto";

  if (inputs.length === 0) throw new Error("composeVideos: no inputs");

  // Single input: just re-encode to MP4
  if (inputs.length === 1) {
    reencodeToMp4(inputs[0], outputPath, ffmpeg);
    return;
  }

  // Determine effective layout
  const effectiveLayout: "row" | "grid" | { cols: number } =
    layout === "auto"
      ? (inputs.length <= 3 ? "row" : "grid")
      : layout;

  // Build crop filter string (if cssCrop is set)
  let cropFilter = "";
  if (opts.cssCrop) {
    const actualW = probeWidth(inputs[0], ffmpeg);
    const cssVp = opts.cssViewportW ?? 1280;
    const scale = actualW > 0 ? Math.round(actualW / cssVp) : 1;
    const c = {
      x: opts.cssCrop.x * scale,
      y: opts.cssCrop.y * scale,
      w: opts.cssCrop.w * scale,
      h: opts.cssCrop.h * scale,
    };
    cropFilter = `,crop=${c.w}:${c.h}:${c.x}:${c.y}`;
    if (scale !== 1) console.log(`  Video scale: ${scale}x (${actualW}px actual vs ${cssVp}px CSS)`);
  }

  // Build per-input filter chains — use PTS-STARTPTS to preserve real-world
  // time alignment between panes (frame-count normalization breaks sync).
  const streamLabels: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const label = `s${i}`;
    streamLabels.push(`[${label}]`);
    filterParts.push(`[${i}:v]setpts=PTS-STARTPTS,fps=60${cropFilter}[${label}]`);
  }

  // Build stack filter
  let stackFilter: string;
  if (effectiveLayout === "row") {
    stackFilter = `${streamLabels.join("")}hstack=inputs=${inputs.length}:shortest=1[v]`;
  } else {
    const cols = typeof effectiveLayout === "object" ? effectiveLayout.cols : Math.ceil(Math.sqrt(inputs.length));
    stackFilter = buildXstackFilter(streamLabels, cols);
  }
  filterParts.push(stackFilter);

  const filterComplex = filterParts.join(";");

  // Build ffmpeg args
  const args: string[] = ["-y"];
  for (const inp of inputs) {
    args.push("-i", inp);
  }
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-r", "60",
    "-fps_mode", "cfr",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  );

  try {
    execFileSync(ffmpeg, args, { stdio: "pipe" });
  } catch (err: any) {
    const stderr: string = err?.stderr ?? "";
    // Fallback: some ffmpeg builds don't support -fps_mode
    if (stderr.includes("fps_mode") && (stderr.includes("Unrecognized option") || stderr.includes("Option not found"))) {
      const fallbackArgs = args.filter((a) => a !== "-fps_mode" && a !== "cfr");
      const rIdx = fallbackArgs.findIndex((a) => a === "-r");
      if (rIdx >= 0) {
        fallbackArgs.splice(rIdx + 2, 0, "-vsync", "cfr");
      }
      execFileSync(ffmpeg, fallbackArgs, { stdio: "pipe" });
    } else {
      throw err;
    }
  }

  const outDur = probeDurationSeconds(outputPath, ffmpeg);
  if (outDur > 0) console.log(`  Output duration: ${outDur.toFixed(2)}s`);
}

/** Simple re-encode a single WebM to MP4. */
function reencodeToMp4(inputPath: string, outputPath: string, ffmpeg: string): void {
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ],
    { stdio: "pipe" },
  );
}

/**
 * Build an xstack filter for a grid layout.
 * Arranges N streams into a grid with the given number of columns.
 */
function buildXstackFilter(labels: string[], cols: number): string {
  const rows = Math.ceil(labels.length / cols);
  const layoutParts: string[] = [];

  for (let i = 0; i < labels.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    // xstack layout format: each entry is "x_y"
    // For the first column: x = 0, for subsequent: x = w0 * col (using w0 placeholder)
    // For the first row: y = 0, for subsequent: y = h0 * row
    let x: string;
    let y: string;

    if (col === 0) {
      x = "0";
    } else {
      x = Array(col).fill("w0").join("+");
    }
    if (row === 0) {
      y = "0";
    } else {
      y = Array(row).fill("h0").join("+");
    }

    layoutParts.push(`${x}_${y}`);
  }

  return `${labels.join("")}xstack=inputs=${labels.length}:layout=${layoutParts.join("|")}:shortest=1[v]`;
}
