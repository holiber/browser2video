/**
 * @description Shared screen capture utilities for ffmpeg-based full-display recording.
 * Used by both single-page and collab runners when recordMode is "screen".
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function tryParseDisplaySize(size?: string): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

export function tryGetMacMainDisplayPixels(): { width: number; height: number } | null {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync("system_profiler", ["SPDisplaysDataType"], { stdio: "pipe" })
      .toString("utf-8");
    const m = out.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/);
    if (!m) return null;
    const width = parseInt(m[1], 10);
    const height = parseInt(m[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export function probeDurationSeconds(videoPath: string, ffmpeg: string): number {
  const parseHms = (m: RegExpMatchArray) => {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    const fracRaw = m[4];
    const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
    return hh * 3600 + mm * 60 + ss + frac;
  };

  {
    const res = spawnSync(ffmpeg, ["-i", videoPath], { encoding: "utf-8" });
    const text = String(res.stderr ?? "") + String(res.stdout ?? "");
    const m = text.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (m) return parseHms(m);
  }

  const res = spawnSync(
    ffmpeg,
    ["-hide_banner", "-i", videoPath, "-map", "0:v:0", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const text = String(res.stderr ?? "") + String(res.stdout ?? "");
  const matches = Array.from(text.matchAll(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/g));
  const last = matches[matches.length - 1];
  if (!last) return 0;
  return parseHms(last as unknown as RegExpMatchArray);
}

export function probeFrameCount(videoPath: string, ffmpeg: string): number {
  const res = spawnSync(
    ffmpeg,
    ["-hide_banner", "-i", videoPath, "-map", "0:v:0", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const text = String(res.stderr ?? "") + String(res.stdout ?? "");
  const matches = Array.from(text.matchAll(/frame=\s*([0-9]+)/g));
  const last = matches[matches.length - 1];
  if (!last) return 0;
  return parseInt(last[1], 10);
}

/* ------------------------------------------------------------------ */
/*  Screen capture                                                     */
/* ------------------------------------------------------------------ */

export interface ScreenCaptureOptions {
  ffmpeg: string;
  outputPath: string;
  fps: number;
  screenIndex?: number;
  display?: string;
  displaySize?: string;
  crop?: { x: number; y: number; w: number; h: number };
}

export async function startScreenCapture(opts: ScreenCaptureOptions): Promise<{ stop: () => Promise<void> }> {
  const { ffmpeg, outputPath, fps, screenIndex, display, displaySize, crop } = opts;

  const args: string[] = ["-y"];
  if (process.platform === "darwin") {
    const idx = screenIndex;
    if (typeof idx !== "number") {
      throw new Error(
        "screen recording on macOS requires --screen-index. " +
        "Run: ffmpeg -f avfoundation -list_devices true -i \"\"",
      );
    }
    args.push("-f", "avfoundation", "-framerate", String(fps), "-i", `${idx}:none`);
  } else if (process.platform === "win32") {
    const size = displaySize ?? "1920x1080";
    args.push(
      "-thread_queue_size", "1024",
      "-rtbufsize", "512M",
      "-use_wallclock_as_timestamps", "1",
      "-f", "gdigrab",
      "-video_size", size,
      "-framerate", String(fps),
      "-i", "desktop",
    );
  } else {
    const disp = display ?? process.env.DISPLAY;
    if (!disp) {
      throw new Error("screen recording on Linux requires DISPLAY (e.g. run via xvfb-run).");
    }
    const size = displaySize ?? "1920x1080";
    args.push(
      "-thread_queue_size", "1024",
      "-rtbufsize", "512M",
      "-use_wallclock_as_timestamps", "1",
      "-f", "x11grab",
      "-video_size", size,
      "-framerate", String(fps),
      "-i", `${disp}.0`,
    );
  }

  const vfParts: string[] = [];
  if (crop && process.platform === "darwin") {
    vfParts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }
  if (process.platform === "darwin") {
    vfParts.push(`fps=${fps}`);
  }
  vfParts.push("format=yuv420p");

  if (process.platform === "darwin") {
    args.push(
      "-vf", vfParts.join(","),
      "-c:v", "h264_videotoolbox",
      "-r", String(fps),
      "-vsync", "cfr",
      "-b:v", "10M",
      "-maxrate", "12M",
      "-bufsize", "20M",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    );
  } else {
    const size = tryParseDisplaySize(displaySize);
    const canForceLevel42 = (() => {
      if (!size) return false;
      const mbW = Math.ceil(size.w / 16);
      const mbH = Math.ceil(size.h / 16);
      const mbPerSec = mbW * mbH * fps;
      return mbPerSec <= 522240;
    })();
    args.push(
      "-vf", vfParts.join(","),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-r", String(fps),
      "-vsync", "cfr",
      "-crf", "18",
      "-profile:v", "baseline",
      ...(canForceLevel42 ? ["-level", "4.2"] : []),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    );
  }

  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  const startedAt = Date.now();

  let stderrBuf = "";
  proc.stderr?.on("data", (chunk) => {
    stderrBuf += String(chunk);
    if (stderrBuf.length > 32768) stderrBuf = stderrBuf.slice(-32768);
  });

  if (proc.exitCode !== null) {
    throw new Error("ffmpeg screen recorder exited immediately");
  }

  console.log(`  Screen recording started (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

  const stop = async () => {
    const t0 = Date.now();
    try {
      proc.stdin?.write("q");
      proc.stdin?.end();
    } catch {
      // fallback to SIGINT below
    }
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => proc.once("exit", () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
    if (!exited) {
      try { proc.kill("SIGINT"); } catch { /* ignore */ }
      await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    }
    console.log(`  Screen recording stopped (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    const frames = probeFrameCount(outputPath, ffmpeg);
    if (frames <= 0) {
      const hint =
        process.platform === "darwin"
          ? "On macOS you must grant Screen Recording permission to the app launching ffmpeg (Cursor/Terminal) in System Settings → Privacy & Security → Screen Recording."
          : "On Linux you must run under Xvfb and set DISPLAY (e.g. via xvfb-run).";
      throw new Error(
        `FFmpeg screen capture produced no frames (output has no video stream). ${hint}\n` +
        `Last ffmpeg logs:\n${stderrBuf}`.trim(),
      );
    }
  };

  return { stop };
}
