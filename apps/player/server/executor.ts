/**
 * Step executor with fast-forward logic.
 * Manages a b2v Session and executes scenario steps one at a time,
 * fast-forwarding through earlier steps when the user jumps ahead.
 *
 * Always runs headless. The player frontend decides how to display:
 * - "live": embeds the scenario page/grid via iframe (observer mode)
 * - "video": plays the recorded MP4 after the run completes
 */
import {
  createSession,
  type Session,
  type SessionOptions,
} from "browser2video";
import type { ScenarioDescriptor, StepDescriptor } from "browser2video/scenario";
import type { GridPaneConfig } from "browser2video/terminal";

export type ViewMode = "live" | "video";

export interface PaneLayoutInfo {
  panes?: Array<{ id: string; type: "browser" | "terminal"; label: string }>;
  layout?: string;
  terminalServerUrl?: string;
  gridConfig?: { panes: GridPaneConfig[]; grid?: number[][]; viewport: { width: number; height: number } };
  pageUrl?: string;
  viewport: { width: number; height: number };
}

export interface StepResult {
  index: number;
  screenshot: string; // base64 PNG
  mode: "human" | "fast";
  durationMs: number;
}

export class Executor<T = any> {
  private session: Session | null = null;
  private ctx: T | null = null;
  private executedUpTo = -1;
  private descriptor: ScenarioDescriptor<T>;
  private sessionOpts: Partial<SessionOptions>;
  private projectRoot: string | null;
  private cdpSessions: Map<string, any> = new Map();
  private lastVideoPath: string | null = null;

  viewMode: ViewMode = "live";
  onLiveFrame: ((data: string, paneId?: string) => void) | null = null;
  onPaneLayout: ((layout: PaneLayoutInfo) => void) | null = null;

  constructor(descriptor: ScenarioDescriptor<T>, opts?: { sessionOpts?: Partial<SessionOptions>; projectRoot?: string }) {
    this.descriptor = descriptor;
    this.sessionOpts = opts?.sessionOpts ?? {};
    this.projectRoot = opts?.projectRoot ?? null;

    const hasNarration = descriptor.steps.some((s) => !!s.narration);
    if (hasNarration && !process.env.OPENAI_API_KEY) {
      console.warn("\n  WARNING: Scenario has narrated steps but OPENAI_API_KEY is not set.");
      console.warn("  Set the env var to enable text-to-speech narration.\n");
    }
  }

  get stepCount(): number {
    return this.descriptor.steps.length;
  }

  get lastExecutedIndex(): number {
    return this.executedUpTo;
  }

  get videoPath(): string | null {
    return this.lastVideoPath;
  }

  get steps(): Array<{ caption: string; narration?: string }> {
    return this.descriptor.steps.map((s) => ({
      caption: s.caption,
      narration: s.narration,
    }));
  }

  private async ensureSession(mode: "human" | "fast"): Promise<Session> {
    if (!this.session) {
      const prevCwd = process.cwd();
      if (this.projectRoot) process.chdir(this.projectRoot);
      try {
        this.session = await createSession({
          mode,
          record: mode === "human",
          narration: { enabled: true, realtime: true },
          ...this.descriptor.sessionOpts,
          ...this.sessionOpts,
          headed: false,
        });
        this.ctx = await this.descriptor.setupFn(this.session);

        try {
          const layout = this.session.getLayoutInfo();
          const hasGrid = !!layout.gridConfig;
          const hasTermSrv = !!layout.terminalServerUrl;
          const paneCount = layout.panes?.length ?? 0;
          console.error(`[executor] paneLayout: panes=${paneCount} layout=${JSON.stringify(layout.layout)} grid=${hasGrid} termSrv=${hasTermSrv} pageUrl=${layout.pageUrl ?? "none"}`);
          this.onPaneLayout?.(layout);
        } catch (err) {
          console.error("[executor] Failed to get layout info:", err);
        }

        // CDP screencast as fallback display / for video mode thumbnail
        if (this.onLiveFrame) {
          await this.startScreencast();
        }
      } finally {
        process.chdir(prevCwd);
      }
    }
    return this.session;
  }

  private async startScreencast(): Promise<void> {
    if (!this.session || !this.onLiveFrame) return;

    const panes: Map<string, any> = (this.session as any).panes;
    if (!panes || panes.size === 0) return;

    const callback = this.onLiveFrame;
    for (const [, pane] of panes) {
      const paneId = pane.id as string;
      try {
        const cdp = await pane.page.context().newCDPSession(pane.page);

        cdp.on("Page.screencastFrame", (params: any) => {
          callback(params.data, paneId);
          cdp.send("Page.screencastFrameAck", {
            sessionId: params.sessionId,
          }).catch(() => {});
        });

        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: 70,
          maxWidth: 1280,
          maxHeight: 960,
          everyNthFrame: 2,
        });
        this.cdpSessions.set(paneId, cdp);
      } catch (err) {
        console.error(`[executor] Failed to start screencast for ${paneId}:`, err);
      }
    }
  }

  private async stopScreencast(): Promise<void> {
    for (const [paneId, cdp] of this.cdpSessions) {
      try {
        await cdp.send("Page.stopScreencast");
        await cdp.detach();
      } catch { /* already closed */ }
    }
    this.cdpSessions.clear();
  }

  private async executeStep(
    stepDesc: StepDescriptor<T>,
    index: number,
    mode: "human" | "fast",
  ): Promise<{ screenshot: string; durationMs: number }> {
    const session = await this.ensureSession(mode);
    const { step } = session;
    const t0 = Date.now();

    if (stepDesc.narration && mode === "human") {
      await step(stepDesc.caption, stepDesc.narration, () => stepDesc.run(this.ctx!));
    } else {
      await step(stepDesc.caption, () => stepDesc.run(this.ctx!));
    }

    const durationMs = Date.now() - t0;
    let screenshot = "";
    try {
      const panes: Map<string, any> = (this.session as any).panes;
      const firstPane = panes?.values().next().value;
      if (firstPane?.page) {
        const buf = await firstPane.page.screenshot({ type: "png" });
        screenshot = buf.toString("base64");
      }
    } catch { /* page may be closed */ }

    return { screenshot, durationMs };
  }

  async runTo(
    targetIndex: number,
    mode: "human" | "fast" = "human",
    onStepStart?: (index: number, fastForward: boolean) => void,
    onStepComplete?: (result: StepResult) => void,
  ): Promise<StepResult> {
    if (targetIndex < 0 || targetIndex >= this.descriptor.steps.length) {
      throw new Error(`Step index ${targetIndex} out of range (0-${this.descriptor.steps.length - 1})`);
    }

    for (let i = this.executedUpTo + 1; i < targetIndex; i++) {
      onStepStart?.(i, true);
      const { screenshot, durationMs } = await this.executeStep(this.descriptor.steps[i], i, "fast");
      this.executedUpTo = i;
      onStepComplete?.({ index: i, screenshot, mode: "fast", durationMs });
    }

    if (targetIndex > this.executedUpTo) {
      onStepStart?.(targetIndex, false);
      const { screenshot, durationMs } = await this.executeStep(
        this.descriptor.steps[targetIndex],
        targetIndex,
        mode,
      );
      this.executedUpTo = targetIndex;
      const result: StepResult = { index: targetIndex, screenshot, mode, durationMs };
      onStepComplete?.(result);
      return result;
    }

    return { index: targetIndex, screenshot: "", mode, durationMs: 0 };
  }

  async reset(): Promise<void> {
    await this.stopScreencast();
    if (this.session) {
      try {
        const result = await this.session.finish();
        this.lastVideoPath = result.video ?? null;
      } catch { /* ignore */ }
      this.session = null;
      this.ctx = null;
      this.executedUpTo = -1;
    }
  }

  async dispose(): Promise<void> {
    await this.reset();
  }
}
