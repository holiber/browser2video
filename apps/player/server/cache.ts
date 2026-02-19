import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface StepMeta {
  index: number;
  durationMs: number;
  hasAudio: boolean;
}

export interface CacheMeta {
  scenarioFile: string;
  contentHash: string;
  steps: StepMeta[];
}

export class PlayerCache {
  private cacheRoot: string;

  constructor(projectRoot: string) {
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

  loadCachedData(scenarioAbsPath: string, scenarioRelPath: string, stepCount: number): {
    screenshots: (string | null)[];
    stepDurations: (number | null)[];
    stepHasAudio: boolean[];
    cacheDir: string;
    contentHash: string;
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

    return { screenshots, stepDurations, stepHasAudio, cacheDir: dir, contentHash: hash };
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
