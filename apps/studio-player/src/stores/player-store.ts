import { makeAutoObservable, runInAction } from "mobx";
import type { SceneConfig } from "browser2video";

// ---------------------------------------------------------------------------
//  Types (re-exported for components)
// ---------------------------------------------------------------------------

export type StepState = "pending" | "fast-forwarding" | "running" | "done";

export interface StepInfo {
  caption: string;
  narration?: string;
}

export type ViewMode = "live" | "video";

export interface PaneLayoutInfo {
  panes?: Array<{ id: string; type: "browser" | "terminal"; label: string }>;
  layout?: string;
  terminalServerUrl?: string;
  gridConfig?: {
    panes: Array<{
      type: "terminal" | "browser";
      cmd?: string;
      testId?: string;
      title: string;
      url?: string;
      allowAddTab?: boolean;
    }>;
    grid?: number[][];
    viewport: { width: number; height: number };
    jabtermWsUrl?: string;
  };
  sceneConfig?: SceneConfig;
  pageUrl?: string;
  viewport: { width: number; height: number };
  electronView?: boolean;
}

export interface AudioSettings {
  provider?: string;
  voice?: string;
  speed?: number;
  model?: string;
  language?: string;
  realtime?: boolean;
}

export interface CursorState {
  x: number;
  y: number;
  clickEffect: boolean;
  visible: boolean;
}

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

export class PlayerStore {
  // Connection
  connected = false;
  terminalServerUrl: string | null = null;

  // Scenario list & current scenario
  scenarioFiles: string[] = [];
  scenario: { name: string; steps: StepInfo[] } | null = null;
  currentScenarioFile: string | null = null;

  // Per-step state
  stepStates: StepState[] = [];
  screenshots: (string | null)[] = [];
  stepDurations: (number | null)[] = [];
  stepDurationsFast: (number | null)[] = [];
  stepDurationsHuman: (number | null)[] = [];
  stepHasAudio: boolean[] = [];

  // Playback
  activeStep = -1;
  runMode: "human" | "fast" = "human";
  liveFrame: string | null = null;
  liveFrames: Record<string, string> = {};
  studioFrames: Record<string, string> = {};
  paneLayout: PaneLayoutInfo | null = null;
  videoPath: string | null = null;
  viewMode: ViewMode = "live";

  // UI state
  error: string | null = null;
  loading = false;
  executing = false;
  importing = false;
  importResult: { count: number; scenarios: string[] } | null = null;

  // Cache
  scenarioCacheSize = 0;
  globalCacheSize = 0;

  // Audio / TTS
  audioSettings: AudioSettings = {};
  detectedProvider = "none";
  buildProgress: { step: number; total: number; message: string } | null = null;

  // Cursor (updated at RAF cadence, not every WS message)
  cursor: CursorState = { x: 0, y: 0, clickEffect: false, visible: false };

  // WebSocket internals (not observable — managed imperatively)
  private _ws: WebSocket | null = null;
  private _wsUrl: string;
  private _disposed = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _backoff = 500;
  private _cursorRaf = 0;
  private _pendingCursor: { x: number; y: number } | null = null;

  constructor(wsUrl: string) {
    this._wsUrl = wsUrl;
    makeAutoObservable(this, {
      // Private WS fields are not observable
      _ws: false,
      _wsUrl: false,
      _disposed: false,
      _reconnectTimer: false,
      _backoff: false,
      _cursorRaf: false,
      _pendingCursor: false,
    } as any);
  }

  // =========================================================================
  //  Computed
  // =========================================================================

  get isFastForwarding(): boolean {
    return this.stepStates.some((s) => s === "fast-forwarding");
  }

  get showOverlay(): boolean {
    return this.loading || this.isFastForwarding || !!this.buildProgress;
  }

  get overlayLabel(): string {
    if (this.buildProgress) return "Building the cache...";
    if (this.loading) return "Loading...";
    return "Replaying slides...";
  }

  get activeScreenshot(): string | null {
    return this.activeStep >= 0 ? this.screenshots[this.activeStep] ?? null : null;
  }

  get activeCaption(): string | undefined {
    return this.activeStep >= 0 && this.scenario
      ? this.scenario.steps[this.activeStep]?.caption
      : undefined;
  }

  // =========================================================================
  //  Actions — outgoing commands to server
  // =========================================================================

  private _send(msg: Record<string, unknown>): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  loadScenario(file: string): void {
    this.currentScenarioFile = file;
    this.loading = true;
    this._send({ type: "load", file });
  }

  runStep(index: number): void {
    this._send({ type: "runStep", index });
  }

  runAll(): void {
    this.executing = true;
    this._send({ type: "runAll" });
  }

  reset(): void {
    this.executing = false;
    this._send({ type: "reset" });
    if (this.scenario) {
      this.stepStates = this.scenario.steps.map(() => "pending" as StepState);
      this.screenshots = this.scenario.steps.map(() => null);
      this.activeStep = -1;
      this.liveFrame = null;
      this.liveFrames = {};
      this.paneLayout = null;
      this.videoPath = null;
      this.error = null;
    }
  }

  cancel(): void {
    this._send({ type: "cancel" });
  }

  clearScenarioCache(): void {
    this._send({ type: "clearScenarioCache" });
  }

  clearGlobalCache(): void {
    this._send({ type: "clearGlobalCache" });
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this._send({ type: "setViewMode", mode });
  }

  importArtifacts(dir: string): void {
    this.importing = true;
    this.importResult = null;
    this._send({ type: "importArtifacts", dir });
  }

  downloadArtifacts(runId?: string, artifactName?: string): void {
    this.importing = true;
    this.importResult = null;
    this._send({ type: "downloadArtifacts", runId, artifactName });
  }

  sendStudioEvent(msg: Record<string, unknown>): void {
    this._send(msg);
  }

  dispatchSceneAction(sceneName: string, actionId: string, payload?: unknown): void {
    this._send({ type: "sceneAction", sceneName, actionId, payload });
  }

  setAudioSettings(settings: AudioSettings): void {
    this._send({ type: "setAudioSettings", settings });
  }

  // =========================================================================
  //  Actions — incoming WS message handlers (called inside runInAction)
  // =========================================================================

  private _handleMessage(msg: any): void {
    switch (msg.type) {
      case "studioReady":
        this.terminalServerUrl = msg.terminalServerUrl;
        break;

      case "scenarioFiles":
        this.scenarioFiles = msg.files;
        break;

      case "scenario":
        this.loading = false;
        this.scenario = { name: msg.name, steps: msg.steps };
        this.stepStates = msg.steps.map(() => "pending" as StepState);
        this.screenshots = msg.steps.map(() => null);
        this.stepDurations = msg.steps.map(() => null);
        this.stepDurationsFast = msg.steps.map(() => null);
        this.stepDurationsHuman = msg.steps.map(() => null);
        this.stepHasAudio = msg.steps.map(() => false);
        this.activeStep = -1;
        this.liveFrame = null;
        this.liveFrames = {};
        this.paneLayout = null;
        this.videoPath = null;
        this.error = null;
        this.cursor = { x: 0, y: 0, clickEffect: false, visible: false };
        break;

      case "cachedData":
        this.screenshots = (msg.screenshots as (string | null)[]).map(
          (s, i) => s ?? this.screenshots[i] ?? null,
        );
        this.stepDurations = msg.stepDurations;
        this.stepDurationsFast = msg.stepDurationsFast ?? msg.stepDurations.map(() => null);
        this.stepDurationsHuman = msg.stepDurationsHuman ?? msg.stepDurations.map(() => null);
        this.stepHasAudio = msg.stepHasAudio;
        if (msg.videoPath != null) this.videoPath = msg.videoPath;
        break;

      case "cacheCleared": {
        const empty = this.scenario?.steps.map(() => null) ?? [];
        this.screenshots = empty;
        this.stepDurations = [...empty];
        this.stepDurationsFast = [...empty];
        this.stepDurationsHuman = [...empty];
        this.scenarioCacheSize = msg.scenarioSize ?? 0;
        this.globalCacheSize = msg.globalSize ?? 0;
        break;
      }

      case "cancelled":
        this.executing = false;
        this.stepStates = this.stepStates.map((s) =>
          s === "running" || s === "fast-forwarding" ? "pending" : s,
        );
        this.liveFrame = null;
        this.liveFrames = {};
        this.error = null;
        break;

      case "stepStart": {
        const states = [...this.stepStates];
        for (let i = msg.index; i < states.length; i++) {
          if (states[i] === "done") states[i] = "pending";
        }
        states[msg.index] = msg.fastForward ? "fast-forwarding" : "running";
        this.stepStates = states;
        const shots = [...this.screenshots];
        for (let i = msg.index; i < shots.length; i++) {
          if (this.stepStates[i] === "done") shots[i] = null;
        }
        this.screenshots = shots;
        this.activeStep = msg.index;
        this.error = null;
        break;
      }

      case "stepComplete": {
        const states = [...this.stepStates];
        states[msg.index] = "done";
        this.stepStates = states;
        if (msg.screenshot) {
          const shots = [...this.screenshots];
          shots[msg.index] = msg.screenshot;
          this.screenshots = shots;
        }
        if (msg.durationMs) {
          const durs = [...this.stepDurations];
          durs[msg.index] = msg.durationMs;
          this.stepDurations = durs;
          if (msg.mode === "fast") {
            const f = [...this.stepDurationsFast];
            f[msg.index] = msg.durationMs;
            this.stepDurationsFast = f;
          } else {
            const h = [...this.stepDurationsHuman];
            h[msg.index] = msg.durationMs;
            this.stepDurationsHuman = h;
          }
        }
        this.runMode = msg.mode === "fast" ? "fast" : "human";
        this.activeStep = msg.index;
        this.liveFrame = null;
        this.liveFrames = {};
        this.cursor = { ...this.cursor, clickEffect: false };
        break;
      }

      case "liveFrame": {
        const paneId = msg.paneId ?? "pane-0";
        this.liveFrame = msg.data;
        this.liveFrames = { ...this.liveFrames, [paneId]: msg.data };
        break;
      }

      case "paneLayout":
        this.paneLayout = msg.layout;
        break;

      case "finished":
        this.executing = false;
        this.liveFrame = null;
        this.liveFrames = {};
        this.videoPath = msg.videoPath ?? null;
        this.error = null;
        this.cursor = { x: 0, y: 0, clickEffect: false, visible: false };
        break;

      case "viewMode":
        this.viewMode = msg.mode;
        break;

      case "replayEvent":
        this._handleReplayEvent(msg.event);
        return; // cursor updates handled separately

      case "artifactsImported":
        this.importing = false;
        this.importResult = { count: msg.count, scenarios: msg.scenarios };
        break;

      case "audioSettings":
        this.audioSettings = msg.settings;
        this.detectedProvider = msg.detected;
        break;

      case "cacheSize":
        this.scenarioCacheSize = msg.scenarioSize ?? 0;
        this.globalCacheSize = msg.globalSize ?? 0;
        break;

      case "error":
        this.loading = false;
        this.executing = false;
        this.error = msg.message;
        this.stepStates = this.stepStates.map((s) =>
          s === "running" || s === "fast-forwarding" ? "pending" : s,
        );
        this.buildProgress = null;
        break;

      case "status":
        if (msg.runMode) this.runMode = msg.runMode;
        break;

      case "buildProgress":
        this.buildProgress = { step: msg.step, total: msg.total, message: msg.message };
        break;

      case "buildComplete":
        this.buildProgress = null;
        break;

      case "playAudio": {
        const audio = new Audio(msg.url);
        audio.play().catch((e: unknown) => console.error("[audio] playback failed:", e));
        break;
      }

      case "sceneAction":
        this._handleSceneAction(msg.sceneName, msg.actionId, msg.payload);
        break;
    }
  }

  /** Scene action state: { "Bob/toggleTerminal": true } */
  sceneActionStates: Record<string, unknown> = {};

  private _handleSceneAction(sceneName: string, actionId: string, payload?: unknown): void {
    const key = `${sceneName}/${actionId}`;
    this.sceneActionStates = { ...this.sceneActionStates, [key]: payload };
  }

  private _handleReplayEvent(event: any): void {
    if (event.type === "cursorMove") {
      this._pendingCursor = { x: event.x, y: event.y };
      if (!this._cursorRaf) {
        this._cursorRaf = requestAnimationFrame(() => {
          this._cursorRaf = 0;
          const p = this._pendingCursor;
          if (p) {
            runInAction(() => {
              this.cursor = { ...this.cursor, x: p.x, y: p.y, visible: true };
            });
            this._pendingCursor = null;
          }
        });
      }
    } else if (event.type === "click") {
      this.cursor = { ...this.cursor, x: event.x, y: event.y, clickEffect: true, visible: true };
      setTimeout(() => {
        runInAction(() => {
          this.cursor = { ...this.cursor, clickEffect: false };
        });
      }, 600);
    }
  }

  // =========================================================================
  //  WebSocket lifecycle
  // =========================================================================

  connect(): void {
    if (this._disposed) return;

    const ws = new WebSocket(this._wsUrl);
    this._ws = ws;
    (window as any).__b2vWsInstances = [(window as any).__b2vWsInstances ?? [], ws].flat();

    ws.onopen = () => {
      this._backoff = 500;
      runInAction(() => {
        this.connected = true;
        this.error = null;
      });
    };

    ws.onclose = () => {
      if (this._ws === ws) {
        this._ws = null;
        runInAction(() => {
          this.connected = false;
          this.terminalServerUrl = null;
        });
      }
      if (!this._disposed) {
        this._reconnectTimer = setTimeout(() => {
          this._backoff = Math.min(this._backoff * 2, 5000);
          this.connect();
        }, this._backoff);
      }
    };

    ws.onerror = () => {};

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        runInAction(() => this._handleMessage(msg));
      } catch { /* ignore parse errors */ }
    };
  }

  dispose(): void {
    this._disposed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._ws) this._ws.close();
    this._ws = null;
    if (this._cursorRaf) cancelAnimationFrame(this._cursorRaf);
  }
}
