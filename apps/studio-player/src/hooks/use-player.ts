import { useReducer, useEffect, useRef, useCallback, useState } from "react";

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
    jabtermWsUrl?: string;
  };
  pageUrl?: string;
  viewport: { width: number; height: number };
  electronView?: boolean;
}

export interface PlayerState {
  connected: boolean;
  terminalServerUrl: string | null;
  scenarioFiles: string[];
  scenario: { name: string; steps: StepInfo[] } | null;
  stepStates: StepState[];
  screenshots: (string | null)[];
  stepDurations: (number | null)[];
  stepHasAudio: boolean[];
  activeStep: number;
  liveFrame: string | null;
  liveFrames: Record<string, string>;
  studioFrames: Record<string, string>;
  paneLayout: PaneLayoutInfo | null;
  videoPath: string | null;
  viewMode: ViewMode;
  error: string | null;
  importing: boolean;
  importResult: { count: number; scenarios: string[] } | null;
  cacheSize: number;
}

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "studioReady"; terminalServerUrl: string }
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
  | { type: "cacheCleared"; cacheSize?: number }
  | { type: "cancelled" }
  | { type: "viewMode"; mode: ViewMode }
  | { type: "importStart" }
  | { type: "artifactsImported"; count: number; scenarios: string[] }
  ;

const initial: PlayerState = {
  connected: false,
  terminalServerUrl: null,
  scenarioFiles: [],
  scenario: null,
  stepStates: [],
  screenshots: [],
  stepDurations: [],
  stepHasAudio: [],
  activeStep: -1,
  liveFrame: null,
  liveFrames: {},
  studioFrames: {},
  paneLayout: null,
  videoPath: null,
  viewMode: "live",
  error: null,
  importing: false,
  importResult: null,
  cacheSize: 0,
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true, error: null };
    case "disconnected":
      return { ...state, connected: false, terminalServerUrl: null };
    case "studioReady":
      return { ...state, terminalServerUrl: action.terminalServerUrl };
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
        cacheSize: action.cacheSize ?? 0,
      };
    case "cancelled":
      return {
        ...state,
        stepStates: state.stepStates.map((s) => s === "running" || s === "fast-forwarding" ? "pending" : s),
        liveFrame: null,
        liveFrames: {},
        error: null,
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

export interface CursorState {
  x: number;
  y: number;
  clickEffect: boolean;
  visible: boolean;
}

export function usePlayer(wsUrl: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [cursor, setCursor] = useState<CursorState>({ x: 0, y: 0, clickEffect: false, visible: false });
  const wsRef = useRef<WebSocket | null>(null);
  const cursorRafRef = useRef<number>(0);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 500;
    const MAX_BACKOFF = 5000;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      // Expose for e2e testing: allows tests to force-close the connection
      (window as any).__b2vWsInstances = [(window as any).__b2vWsInstances ?? [], ws].flat();

      ws.onopen = () => {
        backoff = 500;
        dispatch({ type: "connected" });
      };

      ws.onclose = () => {
        // Only update state if this WS is still the active one.
        // React strict mode double-mounts can cause a stale WS's onclose
        // to fire after a new WS has already been assigned.
        if (wsRef.current === ws) {
          wsRef.current = null;
          dispatch({ type: "disconnected" });
        }
        if (!disposed) {
          reconnectTimer = setTimeout(() => {
            backoff = Math.min(backoff * 2, MAX_BACKOFF);
            connect();
          }, backoff);
        }
      };

      ws.onerror = () => { };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          switch (msg.type) {
            case "studioReady":
              dispatch({ type: "studioReady", terminalServerUrl: msg.terminalServerUrl });
              break;
            case "scenarioFiles":
              dispatch({ type: "scenarioFiles", files: msg.files });
              break;
            case "scenario":
              dispatch({ type: "scenario", name: msg.name, steps: msg.steps });
              setCursor({ x: 0, y: 0, clickEffect: false, visible: false });
              break;
            case "cachedData":
              dispatch({ type: "cachedData", screenshots: msg.screenshots, stepDurations: msg.stepDurations, stepHasAudio: msg.stepHasAudio, videoPath: msg.videoPath });
              break;
            case "cacheCleared":
              dispatch({ type: "cacheCleared", cacheSize: msg.cacheSize });
              break;
            case "cancelled":
              dispatch({ type: "cancelled" });
              break;
            case "stepStart":
              dispatch({ type: "stepStart", index: msg.index, fastForward: msg.fastForward });
              break;
            case "stepComplete":
              dispatch({ type: "stepComplete", index: msg.index, screenshot: msg.screenshot, mode: msg.mode, durationMs: msg.durationMs ?? 0 });
              setCursor((c) => ({ ...c, clickEffect: false }));
              break;
            case "liveFrame":
              dispatch({ type: "liveFrame", data: msg.data, paneId: msg.paneId });
              break;
            case "paneLayout":
              dispatch({ type: "paneLayout", layout: msg.layout });
              break;
            case "finished":
              dispatch({ type: "finished", videoPath: msg.videoPath });
              setCursor({ x: 0, y: 0, clickEffect: false, visible: false });
              break;
            case "viewMode":
              dispatch({ type: "viewMode", mode: msg.mode });
              break;
            case "replayEvent": {
              const event = msg.event;
              if (event.type === "cursorMove") {
                pendingCursorRef.current = { x: event.x, y: event.y };
                if (!cursorRafRef.current) {
                  cursorRafRef.current = requestAnimationFrame(() => {
                    cursorRafRef.current = 0;
                    const p = pendingCursorRef.current;
                    if (p) {
                      setCursor((c) => ({ ...c, x: p.x, y: p.y, visible: true }));
                      pendingCursorRef.current = null;
                    }
                  });
                }
              } else if (event.type === "click") {
                setCursor((c) => ({ ...c, x: event.x, y: event.y, clickEffect: true, visible: true }));
                setTimeout(() => setCursor((c) => ({ ...c, clickEffect: false })), 600);
              }
              break;
            }
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
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
      if (cursorRafRef.current) cancelAnimationFrame(cursorRafRef.current);
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

  const cancel = useCallback(() => {
    sendMsg({ type: "cancel" });
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

  const sendStudioEvent = useCallback((msg: Record<string, unknown>) => {
    sendMsg(msg);
  }, [sendMsg]);

  return { state, cursor, loadScenario, runStep, runAll, reset, cancel, clearCache, setViewMode, importArtifacts, downloadArtifacts, sendStudioEvent };
}
