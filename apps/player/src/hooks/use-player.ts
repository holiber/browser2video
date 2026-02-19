import { useReducer, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
//  Types
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
  };
  pageUrl?: string;
  viewport: { width: number; height: number };
}

export interface PlayerState {
  connected: boolean;
  scenarioFiles: string[];
  scenario: { name: string; steps: StepInfo[] } | null;
  stepStates: StepState[];
  screenshots: (string | null)[];
  stepDurations: (number | null)[];
  stepHasAudio: boolean[];
  activeStep: number;
  liveFrame: string | null;
  liveFrames: Record<string, string>;
  paneLayout: PaneLayoutInfo | null;
  videoPath: string | null;
  viewMode: ViewMode;
  error: string | null;
  importing: boolean;
  importResult: { count: number; scenarios: string[] } | null;
}

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "scenarioFiles"; files: string[] }
  | { type: "scenario"; name: string; steps: StepInfo[] }
  | { type: "stepStart"; index: number; fastForward: boolean }
  | { type: "stepComplete"; index: number; screenshot: string; mode: string; durationMs: number }
  | { type: "liveFrame"; data: string; paneId?: string }
  | { type: "paneLayout"; layout: PaneLayoutInfo }
  | { type: "finished"; videoPath?: string }
  | { type: "error"; message: string }
  | { type: "reset" }
  | { type: "cachedData"; screenshots: (string | null)[]; stepDurations: (number | null)[]; stepHasAudio: boolean[]; videoPath?: string | null }
  | { type: "cacheCleared" }
  | { type: "viewMode"; mode: ViewMode }
  | { type: "importStart" }
  | { type: "artifactsImported"; count: number; scenarios: string[] };

const initial: PlayerState = {
  connected: false,
  scenarioFiles: [],
  scenario: null,
  stepStates: [],
  screenshots: [],
  stepDurations: [],
  stepHasAudio: [],
  activeStep: -1,
  liveFrame: null,
  liveFrames: {},
  paneLayout: null,
  videoPath: null,
  viewMode: "live",
  error: null,
  importing: false,
  importResult: null,
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true, error: null };
    case "disconnected":
      return { ...state, connected: false };
    case "scenarioFiles":
      return { ...state, scenarioFiles: action.files };
    case "scenario":
      return {
        ...state,
        scenario: { name: action.name, steps: action.steps },
        stepStates: action.steps.map(() => "pending" as StepState),
        screenshots: action.steps.map(() => null),
        stepDurations: action.steps.map(() => null),
        stepHasAudio: action.steps.map(() => false),
        activeStep: -1,
        liveFrame: null,
        liveFrames: {},
        paneLayout: null,
        videoPath: null,
        error: null,
      };
    case "cachedData":
      return {
        ...state,
        screenshots: action.screenshots.map((s, i) => s ?? state.screenshots[i] ?? null),
        stepDurations: action.stepDurations,
        stepHasAudio: action.stepHasAudio,
        videoPath: action.videoPath ?? state.videoPath,
      };
    case "cacheCleared":
      return {
        ...state,
        screenshots: state.scenario?.steps.map(() => null) ?? [],
        stepDurations: state.scenario?.steps.map(() => null) ?? [],
      };
    case "stepStart": {
      const stepStates = [...state.stepStates];
      for (let i = action.index; i < stepStates.length; i++) {
        if (stepStates[i] === "done") stepStates[i] = "pending";
      }
      stepStates[action.index] = action.fastForward ? "fast-forwarding" : "running";
      const screenshots = [...state.screenshots];
      for (let i = action.index; i < screenshots.length; i++) {
        if (state.stepStates[i] === "done") screenshots[i] = null;
      }
      return { ...state, stepStates, screenshots, activeStep: action.index, error: null };
    }
    case "stepComplete": {
      const stepStates = [...state.stepStates];
      stepStates[action.index] = "done";
      const screenshots = [...state.screenshots];
      if (action.screenshot) screenshots[action.index] = action.screenshot;
      const stepDurations = [...state.stepDurations];
      if (action.durationMs) stepDurations[action.index] = action.durationMs;
      return { ...state, stepStates, screenshots, stepDurations, activeStep: action.index, liveFrame: null, liveFrames: {} };
    }
    case "liveFrame": {
      const paneId = action.paneId ?? "pane-0";
      return {
        ...state,
        liveFrame: action.data,
        liveFrames: { ...state.liveFrames, [paneId]: action.data },
      };
    }
    case "paneLayout":
      return { ...state, paneLayout: action.layout };
    case "finished":
      return { ...state, liveFrame: null, liveFrames: {}, videoPath: action.videoPath ?? null, error: null };
    case "error":
      return { ...state, error: action.message };
    case "viewMode":
      return { ...state, viewMode: action.mode };
    case "importStart":
      return { ...state, importing: true, importResult: null };
    case "artifactsImported":
      return { ...state, importing: false, importResult: { count: action.count, scenarios: action.scenarios } };
    case "reset":
      return {
        ...state,
        stepStates: state.scenario?.steps.map(() => "pending" as StepState) ?? [],
        screenshots: state.scenario?.steps.map(() => null) ?? [],
        activeStep: -1,
        liveFrame: null,
        liveFrames: {},
        paneLayout: null,
        videoPath: null,
        error: null,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

export function usePlayer(wsUrl: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => dispatch({ type: "connected" });
    ws.onclose = () => dispatch({ type: "disconnected" });
    ws.onerror = () => dispatch({ type: "error", message: "WebSocket connection failed" });

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        switch (msg.type) {
          case "scenarioFiles":
            dispatch({ type: "scenarioFiles", files: msg.files });
            break;
          case "scenario":
            dispatch({ type: "scenario", name: msg.name, steps: msg.steps });
            break;
          case "cachedData":
            dispatch({ type: "cachedData", screenshots: msg.screenshots, stepDurations: msg.stepDurations, stepHasAudio: msg.stepHasAudio, videoPath: msg.videoPath });
            break;
          case "cacheCleared":
            dispatch({ type: "cacheCleared" });
            break;
          case "stepStart":
            dispatch({ type: "stepStart", index: msg.index, fastForward: msg.fastForward });
            break;
          case "stepComplete":
            dispatch({ type: "stepComplete", index: msg.index, screenshot: msg.screenshot, mode: msg.mode, durationMs: msg.durationMs ?? 0 });
            break;
          case "liveFrame":
            dispatch({ type: "liveFrame", data: msg.data, paneId: msg.paneId });
            break;
          case "paneLayout":
            dispatch({ type: "paneLayout", layout: msg.layout });
            break;
          case "finished":
            dispatch({ type: "finished", videoPath: msg.videoPath });
            break;
          case "viewMode":
            dispatch({ type: "viewMode", mode: msg.mode });
            break;
          case "artifactsImported":
            dispatch({ type: "artifactsImported", count: msg.count, scenarios: msg.scenarios });
            break;
          case "error":
            dispatch({ type: "error", message: msg.message });
            break;
          case "status":
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  const sendMsg = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const loadScenario = useCallback((file: string) => {
    sendMsg({ type: "load", file });
  }, [sendMsg]);

  const runStep = useCallback((index: number) => {
    sendMsg({ type: "runStep", index });
  }, [sendMsg]);

  const runAll = useCallback(() => {
    sendMsg({ type: "runAll" });
  }, [sendMsg]);

  const reset = useCallback(() => {
    sendMsg({ type: "reset" });
    dispatch({ type: "reset" });
  }, [sendMsg]);

  const clearCache = useCallback(() => {
    sendMsg({ type: "clearCache" });
  }, [sendMsg]);

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: "viewMode", mode });
    sendMsg({ type: "setViewMode", mode });
  }, [sendMsg]);

  const importArtifacts = useCallback((dir: string) => {
    dispatch({ type: "importStart" });
    sendMsg({ type: "importArtifacts", dir });
  }, [sendMsg]);

  const downloadArtifacts = useCallback((runId?: string, artifactName?: string) => {
    dispatch({ type: "importStart" });
    sendMsg({ type: "downloadArtifacts", runId, artifactName });
  }, [sendMsg]);

  return { state, loadScenario, runStep, runAll, reset, clearCache, setViewMode, importArtifacts, downloadArtifacts };
}
