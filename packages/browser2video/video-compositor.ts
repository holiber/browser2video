/**
 * @description Generalized N-pane video composition using ffmpeg.
 * Supports row (hstack), column (vstack), grid (xstack), and auto layouts.
 */
import { execFileSync, spawnSync } from "child_process";
import { probeDurationSeconds } from "./screen-capture.ts";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function probeWidth(videoPath: string, ffmpeg: string): number {
  const size = probeSize(videoPath, ffmpeg);
  return size.w;
}

function probeSize(videoPath: string, ffmpeg: string): { w: number; h: number } {
  const res = spawnSync(ffmpeg, ["-i", videoPath], { encoding: "utf-8" });
  const text = String(res.stderr ?? "") + String(res.stdout ?? "");
  const match = text.match(/Stream.*Video:.* (\d{3,5})x(\d{3,5})/);
  return match ? { w: parseInt(match[1], 10), h: parseInt(match[2], 10) } : { w: 0, h: 0 };
}

export interface ComposeOptions {
  /** Ordered array of input video file paths. */
  inputs: string[];
  outputPath: string;
  ffmpeg: string;
  /** Layout mode (default: "auto"). */
  layout?: "auto" | "row" | "column" | "grid" | { cols: number } | number[][];
  /** Target duration in seconds (for PTS normalisation). */
  targetDurationSec?: number;
  /** Optional CSS crop rectangle (used with cssViewportW). */
  cssCrop?: { x: number; y: number; w: number; h: number };
  cssViewportW?: number;
  /**
   * Per-input time offset in ms relative to the earliest stream.
   * Used to pad the beginning of later-starting streams with `tpad`
   * so that PTS-STARTPTS alignment preserves real wall-clock sync.
   */
  startOffsets?: number[];
}

/**
 * Compose N video files into a single video.
 * - 1 input: simple re-encode (WebM → MP4).
 * - 2+ inputs (auto): grid with ceil(sqrt(n)) columns.
 * - row: hstack, column: vstack, grid: xstack.
 */
export function composeVideos(opts: ComposeOptions): void {
  const { inputs, outputPath, ffmpeg } = opts;
  const layout = opts.layout ?? "auto";

  if (inputs.length === 0) throw new Error("composeVideos: no inputs");

  // Single input: just re-encode to MP4
  if (inputs.length === 1 && !Array.isArray(layout)) {
    reencodeToMp4(inputs[0], outputPath, ffmpeg);
    return;
  }

  // Grid template layout: 2D array of pane indices with optional spanning
  if (Array.isArray(layout)) {
    composeWithGridTemplate(inputs, outputPath, ffmpeg, layout, opts);
    return;
  }

  // Determine effective layout
  const effectiveLayout: "row" | "column" | "grid" | { cols: number } =
    layout === "auto" ? "grid" : layout;

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
    if (scale !== 1) console.error(`  Video scale: ${scale}x (${actualW}px actual vs ${cssVp}px CSS)`);
  }

  // Build per-input filter chains — use tpad + PTS-STARTPTS to preserve
  // real-world time alignment between panes that started at different wall-clock times.
  const streamLabels: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const label = `s${i}`;
    streamLabels.push(`[${label}]`);
    const offsetMs = opts.startOffsets?.[i] ?? 0;
    const tpadFilter = offsetMs > 0 ? `tpad=start_duration=${offsetMs}ms,` : "";
    filterParts.push(`[${i}:v]${tpadFilter}setpts=PTS-STARTPTS,fps=60${cropFilter}[${label}]`);
  }

  // Build stack filter
  let stackFilter: string;
  if (effectiveLayout === "row") {
    stackFilter = `${streamLabels.join("")}hstack=inputs=${inputs.length}:shortest=1[v]`;
  } else if (effectiveLayout === "column") {
    stackFilter = `${streamLabels.join("")}vstack=inputs=${inputs.length}:shortest=1[v]`;
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
  if (outDur > 0) console.error(`  Output duration: ${outDur.toFixed(2)}s`);
}

/** Re-encode a single WebM to MP4 at constant 60fps for smooth playback. */
function reencodeToMp4(inputPath: string, outputPath: string, ffmpeg: string): void {
  const args = [
    "-y",
    "-i", inputPath,
    "-vf", "fps=60,format=yuv420p",
    "-r", "60",
    "-fps_mode", "cfr",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  try {
    execFileSync(ffmpeg, args, { stdio: "pipe" });
  } catch (err: any) {
    const stderr: string = err?.stderr ?? "";
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
}

// ---------------------------------------------------------------------------
//  Grid template layout (2D pane-index array with optional spanning)
// ---------------------------------------------------------------------------

/**
 * Compose videos using a grid template layout.
 * The grid is a 2D array of pane indices. When a pane appears in multiple
 * cells, it spans those cells and is scaled to fill the merged area.
 *
 * Example: `[[0, 2], [1, 2]]` — pane 2 spans the right column.
 */
function composeWithGridTemplate(
  inputs: string[],
  outputPath: string,
  ffmpeg: string,
  grid: number[][],
  opts: ComposeOptions,
): void {
  const gridRows = grid.length;
  const gridCols = Math.max(...grid.map((r) => r.length));

  // Probe first input to determine cell dimensions
  const cellSize = probeSize(inputs[0], ffmpeg);
  if (cellSize.w === 0 || cellSize.h === 0) {
    throw new Error("composeWithGridTemplate: could not probe input dimensions");
  }
  const cellW = cellSize.w;
  const cellH = cellSize.h;

  // Find bounding box for each unique pane index
  const paneBoxes = new Map<number, { minRow: number; maxRow: number; minCol: number; maxCol: number }>();
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const idx = grid[r][c];
      const box = paneBoxes.get(idx);
      if (!box) {
        paneBoxes.set(idx, { minRow: r, maxRow: r, minCol: c, maxCol: c });
      } else {
        box.minRow = Math.min(box.minRow, r);
        box.maxRow = Math.max(box.maxRow, r);
        box.minCol = Math.min(box.minCol, c);
        box.maxCol = Math.max(box.maxCol, c);
      }
    }
  }

  // Sort pane indices to build deterministic filter chains
  const paneIndices = [...paneBoxes.keys()].sort((a, b) => a - b);

  // Build crop filter string (if cssCrop is set)
  let cropFilter = "";
  if (opts.cssCrop) {
    const cssVp = opts.cssViewportW ?? 1280;
    const scale = cellW > 0 ? Math.round(cellW / cssVp) : 1;
    const cr = {
      x: opts.cssCrop.x * scale,
      y: opts.cssCrop.y * scale,
      w: opts.cssCrop.w * scale,
      h: opts.cssCrop.h * scale,
    };
    cropFilter = `,crop=${cr.w}:${cr.h}:${cr.x}:${cr.y}`;
  }

  // Build per-input filter chains with optional scaling for spanning panes
  const streamLabels: string[] = [];
  const filterParts: string[] = [];

  for (const idx of paneIndices) {
    if (idx >= inputs.length) continue;
    const box = paneBoxes.get(idx)!;
    const spanCols = box.maxCol - box.minCol + 1;
    const spanRows = box.maxRow - box.minRow + 1;
    const targetW = spanCols * cellW;
    const targetH = spanRows * cellH;
    const needsScale = spanCols > 1 || spanRows > 1;

    const label = `s${idx}`;
    streamLabels.push(`[${label}]`);

    const offsetMs = opts.startOffsets?.[idx] ?? 0;
    const tpadFilter = offsetMs > 0 ? `tpad=start_duration=${offsetMs}ms,` : "";
    const scaleFilter = needsScale ? `,scale=${targetW}:${targetH}` : "";

    filterParts.push(
      `[${idx}:v]${tpadFilter}setpts=PTS-STARTPTS,fps=60${cropFilter}${scaleFilter}[${label}]`,
    );
  }

  // Build xstack layout with absolute pixel coordinates
  const layoutParts: string[] = [];
  for (const idx of paneIndices) {
    if (idx >= inputs.length) continue;
    const box = paneBoxes.get(idx)!;
    const x = box.minCol * cellW;
    const y = box.minRow * cellH;
    layoutParts.push(`${x}_${y}`);
  }

  const activeCount = paneIndices.filter((idx) => idx < inputs.length).length;
  const stackFilter = `${streamLabels.join("")}xstack=inputs=${activeCount}:layout=${layoutParts.join("|")}:shortest=1[v]`;
  filterParts.push(stackFilter);

  const filterComplex = filterParts.join(";");

  // Build ffmpeg args
  const args: string[] = ["-y"];
  for (const idx of paneIndices) {
    if (idx >= inputs.length) continue;
    args.push("-i", inputs[idx]);
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
  if (outDur > 0) console.error(`  Output duration: ${outDur.toFixed(2)}s`);
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
