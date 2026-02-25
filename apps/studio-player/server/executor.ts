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
  type ReplayEvent,
} from "browser2video";
import type { ScenarioDescriptor, StepDescriptor } from "browser2video/scenario";
import type { GridPaneConfig } from "browser2video/terminal";

export type ViewMode = "live" | "video";

export interface PaneLayoutInfo {
  panes?: Array<{ id: string; type: "browser" | "terminal"; label: string }>;
  layout?: string;
  terminalServerUrl?: string;
  gridConfig?: { panes: GridPaneConfig[]; grid?: number[][]; viewport: { width: number; height: number }; jabtermWsUrl?: string };
  pageUrl?: string;
  viewport: { width: number; height: number };
  /** True when the scenario page is an Electron WebContentsView (managed via CDP) */
  electronView?: boolean;
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
  private _aborted = false;
  private descriptor: ScenarioDescriptor<T>;
  private sessionOpts: Partial<SessionOptions>;
  private projectRoot: string | null;
  private cdpSessions: Map<string, any> = new Map();
  private lastVideoPath: string | null = null;
  private lastEmittedLayout = "";
  private cdpEndpoint: string | null;
  private onRequestPage: ((url: string, viewport: { width: number; height: number }) => Promise<void>) | null;

  viewMode: ViewMode = "live";
  onLiveFrame: ((data: string, paneId?: string) => void) | null = null;
  onPaneLayout: ((layout: PaneLayoutInfo) => void) | null = null;
  onReplayEvent: ((event: ReplayEvent) => void) | null = null;

  constructor(descriptor: ScenarioDescriptor<T>, opts?: {
    sessionOpts?: Partial<SessionOptions>;
    projectRoot?: string;
    cdpEndpoint?: string | null;
    onRequestPage?: ((url: string, viewport: { width: number; height: number }) => Promise<void>) | null;
  }) {
    this.descriptor = descriptor;
    this.sessionOpts = opts?.sessionOpts ?? {};
    this.projectRoot = opts?.projectRoot ?? null;
    this.cdpEndpoint = opts?.cdpEndpoint ?? null;
    this.onRequestPage = opts?.onRequestPage ?? null;

    const hasNarration = descriptor.steps.some((s) => !!s.narration || !!s.narrationFn);
    if (hasNarration && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_TTS_API_KEY) {
      console.warn("\n  WARNING: Scenario has narrated steps but no cloud TTS key is set.");
      console.warn("  Will try system TTS (macOS say / Windows SAPI) or Piper as fallback.");
      console.warn("  For best quality, set OPENAI_API_KEY or GOOGLE_TTS_API_KEY.\n");
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
      // Starting fresh — clear any stale abort flag from a previous session.
      // This prevents late-arriving cancel messages from blocking new executions.
      this._aborted = false;
      const isEmbedded = process.env.B2V_EMBEDDED === "1";
      const prevCwd = process.cwd();
      if (this.projectRoot) process.chdir(this.projectRoot);
      let newSession: Session | null = null;
      try {
        newSession = await createSession({
          mode,
          // Embedded (nested StudioPlayer) needs live frames via CDP screencast.
          // Session recording in Electron mode also uses CDP screencast internally,
          // so enabling both would conflict and produce 0 live frames.
          record: mode === "human" && !isEmbedded,
          narration: { enabled: true, realtime: process.env.B2V_HEADLESS !== "1" },
          ...this.descriptor.sessionOpts,
          ...this.sessionOpts,
          headed: false,
          cdpEndpoint: this.cdpEndpoint ?? undefined,
          onRequestPage: this.onRequestPage ?? undefined,
        });

        // When the session has grid config ready, push it to the player
        // immediately so it can render the ScenarioGrid while setupFn
        // is still waiting for terminals to appear.
        newSession._onGridConfigReady = () => {
          try {
            const layout = newSession!.getLayoutInfo();
            this.lastEmittedLayout = JSON.stringify(layout);
            console.error(`[executor] Grid config ready, pushing paneLayout to player`);
            this.onPaneLayout?.(layout);
          } catch (err) {
            console.error("[executor] Failed to push grid config:", err);
          }
        };

        this.ctx = await this.descriptor.setupFn(newSession);
        this.session = newSession;

        try {
          const layout = this.session.getLayoutInfo();
          const serialized = JSON.stringify(layout);
          if (serialized !== this.lastEmittedLayout) {
            this.lastEmittedLayout = serialized;
            const hasGrid = !!layout.gridConfig;
            const hasTermSrv = !!layout.terminalServerUrl;
            const paneCount = layout.panes?.length ?? 0;
            console.error(`[executor] paneLayout: panes=${paneCount} layout=${JSON.stringify(layout.layout)} grid=${hasGrid} termSrv=${hasTermSrv} pageUrl=${layout.pageUrl ?? "none"}`);
            this.onPaneLayout?.(layout);
          }
        } catch (err) {
          console.error("[executor] Failed to get layout info:", err);
        }

        if (this.onReplayEvent) {
          this.session.replayLog.onEvent = this.onReplayEvent;
        }

        // Start screencasting for video mode, or when embedded (no ElectronView overlay)
        if (this.onLiveFrame && (this.viewMode === "video" || isEmbedded)) {
          await this.startScreencast();
        }
      } catch (err) {
        // Setup failed — clean up the session so next call can retry
        if (newSession) {
          try { await newSession.finish(); } catch { }
        }
        this.session = null;
        this.ctx = null as any;
        throw err;
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
          }).catch(() => { });
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

  private async checkLayoutChange(): Promise<void> {
    if (!this.session) return;
    try {
      const layout = this.session.getLayoutInfo();
      const serialized = JSON.stringify(layout);
      if (serialized !== this.lastEmittedLayout) {
        this.lastEmittedLayout = serialized;
        const paneCount = layout.panes?.length ?? 0;
        console.error(`[executor] Layout changed mid-run: panes=${paneCount} grid=${!!layout.gridConfig}`);
        this.onPaneLayout?.(layout);
        const isEmbedded = process.env.B2V_EMBEDDED === "1";
        if (this.onLiveFrame && (this.viewMode === "video" || isEmbedded)) {
          await this.stopScreencast();
          await this.startScreencast();
        }
        // In Electron mode, layout changes trigger new WebContentsView creation
        // via onRequestPage callback during the next createGrid call
      }
    } catch (err) {
      console.error("[executor] Failed to check layout change:", err);
    }
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
    } else if (stepDesc.narrationFn && mode === "human") {
      // Narration function runs concurrently; step waits for both
      const ctx = this.ctx!;
      await step(stepDesc.caption, async () => {
        const narrationPromise = stepDesc.narrationFn!(ctx);
        await stepDesc.run(ctx);
        await narrationPromise;
      });
    } else {
      await step(stepDesc.caption, () => stepDesc.run(this.ctx!));
    }

    await this.checkLayoutChange();

    const durationMs = Date.now() - t0;
    let screenshot = "";
    try {
      const panes: Map<string, any> = (this.session as any).panes;
      const firstPane = panes?.values().next().value;
      if (firstPane?.page) {
        const isEmbedded = process.env.B2V_EMBEDDED === "1";

        // Embedded Electron pages can hang on Playwright's screenshot pipeline
        // ("waiting for fonts to load..."). In that case, use a raw CDP capture
        // which is fast and doesn't depend on window visibility.
        if (isEmbedded && this.cdpEndpoint) {
          try {
            const cdp = await firstPane.page.context().newCDPSession(firstPane.page);
            const timeoutMs = 5000;
            const res = await Promise.race([
              cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)),
            ]);
            await cdp.detach().catch(() => { });
            if (res?.data) {
              screenshot = String(res.data);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[executor] CDP screenshot failed (falling back): ${message}`);
          }
        }

        if (!screenshot) {
          const buf = await firstPane.page.screenshot({ type: "png", timeout: 10_000 });
          screenshot = buf.toString("base64");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[executor] Screenshot capture failed: ${message}`);
    }

    return { screenshot, durationMs };
  }

  async runTo(
    targetIndex: number,
    mode: "human" | "fast" = "human",
    onStepStart?: (index: number, fastForward: boolean) => void,
    onStepComplete?: (result: StepResult) => void,
  ): Promise<StepResult> {
    if (targetIndex < 0 || targetIndex >= this.descriptor.steps.length) {
      throw new Error(`Step index ${targetIndex} out of range(0 - ${this.descriptor.steps.length - 1})`);
    }

    // Ensure session is initialised in the target mode before fast-forwarding
    await this.ensureSession(mode);

    for (let i = this.executedUpTo + 1; i < targetIndex; i++) {
      if (this._aborted) throw new Error("Execution aborted");
      onStepStart?.(i, true);
      const { screenshot, durationMs } = await this.executeStep(this.descriptor.steps[i], i, "fast");
      this.executedUpTo = i;
      onStepComplete?.({ index: i, screenshot, mode: "fast", durationMs });
    }

    if (targetIndex > this.executedUpTo) {
      if (this._aborted) throw new Error("Execution aborted");
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
    const wasAborted = this._aborted;
    this._aborted = true;
    await this.stopScreencast();
    if (this.session) {
      try {
        if (wasAborted) {
          // Force-abort: close pages immediately (interrupts running steps)
          await this.session.abort();
        } else {
          // Graceful finish: compose video, generate subtitles, etc.
          const result = await this.session.finish();
          this.lastVideoPath = result.video ?? null;
        }
      } catch { /* ignore */ }
      this.session = null;
      this.ctx = null;
      this.executedUpTo = -1;
      this.lastEmittedLayout = "";
    }
    this._aborted = false;
  }

  /** Force-abort the current execution (called by cancel button). */
  async abort(): Promise<void> {
    this._aborted = true;
    await this.stopScreencast();
    if (this.session) {
      try { await this.session.abort(); } catch { /* ignore */ }
      this.session = null;
      this.ctx = null;
      this.executedUpTo = -1;
      this.lastEmittedLayout = "";
    }
  }

  async dispose(): Promise<void> {
    await this.reset();
  }
}
