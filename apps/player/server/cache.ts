import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export interface StepMeta {
  index: number;
  durationMs: number;
  hasAudio: boolean;
}

export interface CacheMeta {
  scenarioFile: string;
  contentHash: string;
  steps: StepMeta[];
  videoPath?: string;
  subtitlesPath?: string;
  sourceArtifactDir?: string;
}

/** Metadata from a CI artifact's run.json */
export interface ArtifactRunJson {
  mode: string;
  durationMs: number;
  steps: Array<{ index: number; caption: string; startMs: number; endMs: number }>;
  videoPath?: string;
  subtitlesPath?: string;
  recordMode?: string;
  panes?: Array<{ id: string; type: string; label: string }>;
  audioEvents?: unknown[];
  timestamp?: string;
}

export class PlayerCache {
  private cacheRoot: string;
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.cacheRoot = path.join(projectRoot, ".cache", "player");
  }

  private hashForFile(filePath: string): string {
    const content = fs.readFileSync(filePath, "utf-8");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private scenarioCacheDir(scenarioFile: string, hash: string): string {
    const safeName = scenarioFile.replace(/[/\\]/g, "_").replace(/\.scenario\.ts$/, "");
    return path.join(this.cacheRoot, `${safeName}_${hash}`);
  }

  getDir(scenarioAbsPath: string, scenarioRelPath: string): { dir: string; hash: string } {
    const hash = this.hashForFile(scenarioAbsPath);
    return { dir: this.scenarioCacheDir(scenarioRelPath, hash), hash };
  }

  loadMeta(dir: string): CacheMeta | null {
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as CacheMeta;
    } catch {
      return null;
    }
  }

  saveMeta(dir: string, meta: CacheMeta): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  saveScreenshot(dir: string, index: number, base64Png: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `step-${index}.png`), Buffer.from(base64Png, "base64"));
  }

  loadScreenshot(dir: string, index: number): string | null {
    const p = path.join(dir, `step-${index}.png`);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p).toString("base64");
  }

  getVideoPath(dir: string): string | null {
    const mp4 = path.join(dir, "video.mp4");
    if (fs.existsSync(mp4)) return mp4;
    const meta = this.loadMeta(dir);
    if (meta?.videoPath && fs.existsSync(meta.videoPath)) return meta.videoPath;
    return null;
  }

  getSubtitlesPath(dir: string): string | null {
    const vtt = path.join(dir, "captions.vtt");
    if (fs.existsSync(vtt)) return vtt;
    return null;
  }

  saveVideo(dir: string, srcVideoPath: string): void {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "video.mp4");
    fs.copyFileSync(srcVideoPath, dest);
  }

  saveSubtitles(dir: string, srcVttPath: string): void {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "captions.vtt");
    fs.copyFileSync(srcVttPath, dest);
  }

  loadCachedData(scenarioAbsPath: string, scenarioRelPath: string, stepCount: number): {
    screenshots: (string | null)[];
    stepDurations: (number | null)[];
    stepHasAudio: boolean[];
    cacheDir: string;
    contentHash: string;
    videoPath: string | null;
  } | null {
    const { dir, hash } = this.getDir(scenarioAbsPath, scenarioRelPath);
    const meta = this.loadMeta(dir);
    if (!meta || meta.contentHash !== hash) return null;

    const screenshots: (string | null)[] = [];
    const stepDurations: (number | null)[] = [];
    const stepHasAudio: boolean[] = [];

    for (let i = 0; i < stepCount; i++) {
      screenshots.push(this.loadScreenshot(dir, i));
      const stepMeta = meta.steps.find((s) => s.index === i);
      stepDurations.push(stepMeta?.durationMs ?? null);
      stepHasAudio.push(stepMeta?.hasAudio ?? false);
    }

    const videoPath = this.getVideoPath(dir);

    return { screenshots, stepDurations, stepHasAudio, cacheDir: dir, contentHash: hash, videoPath };
  }

  /**
   * Import a CI artifact directory into the cache for a given scenario.
   * The artifact dir should contain run.json and run.mp4 at minimum.
   */
  importArtifact(scenarioAbsPath: string, scenarioRelPath: string, artifactDir: string): CacheMeta | null {
    const runJsonPath = path.join(artifactDir, "run.json");
    if (!fs.existsSync(runJsonPath)) return null;

    let runJson: ArtifactRunJson;
    try {
      runJson = JSON.parse(fs.readFileSync(runJsonPath, "utf-8"));
    } catch {
      return null;
    }

    const { dir, hash } = this.getDir(scenarioAbsPath, scenarioRelPath);
    fs.mkdirSync(dir, { recursive: true });

    const steps: StepMeta[] = runJson.steps.map((s) => ({
      index: s.index - 1,
      durationMs: s.endMs - s.startMs,
      hasAudio: !!(runJson.audioEvents && runJson.audioEvents.length > 0),
    }));

    const videoSrc = path.join(artifactDir, "run.mp4");
    if (fs.existsSync(videoSrc)) {
      this.saveVideo(dir, videoSrc);
    }

    const vttSrc = path.join(artifactDir, "captions.vtt");
    if (fs.existsSync(vttSrc)) {
      this.saveSubtitles(dir, vttSrc);
    }

    const thumbSrc = path.join(artifactDir, "thumbnail.png");
    if (fs.existsSync(thumbSrc)) {
      const thumbData = fs.readFileSync(thumbSrc).toString("base64");
      this.saveScreenshot(dir, steps.length - 1, thumbData);
    }

    const meta: CacheMeta = {
      scenarioFile: scenarioRelPath,
      contentHash: hash,
      steps,
      videoPath: this.getVideoPath(dir) ?? undefined,
      subtitlesPath: this.getSubtitlesPath(dir) ?? undefined,
      sourceArtifactDir: artifactDir,
    };
    this.saveMeta(dir, meta);
    return meta;
  }

  /**
   * Scan a directory of CI artifacts and auto-import any that match known scenario files.
   * Returns a map of scenario file → import result.
   */
  importAllFromDir(artifactsDir: string, scenarioFiles: string[]): Map<string, CacheMeta> {
    const results = new Map<string, CacheMeta>();
    if (!fs.existsSync(artifactsDir)) return results;

    const entries = fs.readdirSync(artifactsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const artDir = path.join(artifactsDir, entry.name);
      if (!fs.existsSync(path.join(artDir, "run.json"))) continue;

      const testName = entry.name.replace(/-\d{4}-\d{2}-\d{2}T.*$/, "");
      const matchedScenario = this.matchArtifactToScenario(testName, scenarioFiles);
      if (!matchedScenario) continue;

      const absPath = path.resolve(this.projectRoot, matchedScenario);
      if (!fs.existsSync(absPath)) continue;

      const meta = this.importArtifact(absPath, matchedScenario, artDir);
      if (meta) results.set(matchedScenario, meta);
    }

    return results;
  }

  /** Map artifact directory name (e.g. "basic-ui.test") to a scenario file path */
  private matchArtifactToScenario(testName: string, scenarioFiles: string[]): string | null {
    const baseName = testName.replace(/\.test$/, "");
    for (const sf of scenarioFiles) {
      const scenarioBase = path.basename(sf, ".scenario.ts");
      if (scenarioBase === baseName) return sf;
    }
    return null;
  }

  /**
   * Download CI artifacts from GitHub using `gh run download` and import them.
   * Returns the number of imported scenarios.
   */
  async downloadFromGitHub(
    scenarioFiles: string[],
    opts?: { runId?: string; artifactName?: string },
  ): Promise<{ imported: Map<string, CacheMeta>; downloadDir: string }> {
    const downloadDir = path.join(this.cacheRoot, "_gh-download");
    fs.mkdirSync(downloadDir, { recursive: true });

    const args = ["run", "download"];
    if (opts?.runId) {
      args.push(opts.runId);
    } else {
      args.push("--name", opts?.artifactName ?? "scenario-videos");
    }
    args.push("-D", downloadDir);

    try {
      execFileSync("gh", args, {
        cwd: this.projectRoot,
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err);
      throw new Error(`gh run download failed: ${msg}`);
    }

    const imported = this.importAllFromDir(downloadDir, scenarioFiles);

    try {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    } catch { /* cleanup is best-effort */ }

    return { imported, downloadDir };
  }

  clearForScenario(scenarioAbsPath: string, scenarioRelPath: string): void {
    const { dir } = this.getDir(scenarioAbsPath, scenarioRelPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  clearAll(): void {
    if (fs.existsSync(this.cacheRoot)) {
      fs.rmSync(this.cacheRoot, { recursive: true, force: true });
    }
  }
}
