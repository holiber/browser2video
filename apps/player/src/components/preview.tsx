import { useMemo, useRef, useState, useEffect } from "react";
import type { ViewMode, StepState, PaneLayoutInfo, CursorState } from "../hooks/use-player";
import { CursorOverlay } from "./cursor-overlay";
import { StudioGrid } from "./studio-grid";

const isElectron = !!(window as any).electronAPI?.isElectron;

interface PreviewProps {
  screenshot: string | null;
  liveFrame: string | null;
  liveFrames: Record<string, string>;
  studioFrames: Record<string, string>;
  activeStep: number;
  stepCaption?: string;
  viewMode: ViewMode;
  stepState?: StepState;
  paneLayout: PaneLayoutInfo | null;
  terminalServerUrl: string | null;
  showStudio: boolean;
  videoPath: string | null;
  cursor: CursorState;
  sendStudioEvent: (msg: Record<string, unknown>) => void;
}

function buildObserverUrl(layout: PaneLayoutInfo): string | null {
  if (layout.gridConfig && layout.terminalServerUrl) {
    const observeConfig = {
      ...layout.gridConfig,
      panes: layout.gridConfig.panes.map((p) => ({ ...p })),
    };
    const url = new URL(`${layout.terminalServerUrl}/terminal-grid`);
    url.searchParams.set("config", JSON.stringify(observeConfig));
    url.searchParams.set("mode", "observe");
    return url.toString();
  }
  return null;
}

function layoutToFlexClass(layout?: string): string {
  if (layout === "row") return "flex-row";
  if (layout === "column") return "flex-col";
  return "flex-row flex-wrap";
}

const idlePlaceholder = (
  <div data-preview-mode="idle" className="flex items-center justify-center h-full text-zinc-600">
    <div className="text-center">
      <div className="text-5xl mb-4">▶</div>
      <p className="text-lg">Click a step to run it</p>
      <p className="text-sm text-zinc-700 mt-1">
        Previous steps will be fast-forwarded automatically
      </p>
    </div>
  </div>
);

function StepHeader({ activeStep, stepCaption, badge }: { activeStep: number; stepCaption?: string; badge: React.ReactNode }) {
  return (
    <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
      <span className="text-xs font-mono text-zinc-500">Step {activeStep + 1}</span>
      <span className="text-sm text-zinc-300">{stepCaption}</span>
      <span className="ml-auto">{badge}</span>
    </div>
  );
}

const liveBadge = (
  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
    Live
  </span>
);

/**
 * In Electron mode, the scenario page is rendered as a WebContentsView
 * positioned over the preview area by the main process. This component
 * tracks its position/size and sends IPC to keep the view aligned.
 * The cursor overlay is rendered on top (in the React layer).
 */
function ElectronScenarioView({
  vp,
  cursor,
  active,
}: {
  vp: { width: number; height: number };
  cursor: CursorState;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !window.electronAPI) return;
    const el = containerRef.current;
    if (!el) return;

    const sendBounds = () => {
      const rect = el.getBoundingClientRect();
      window.electronAPI!.scenarioView.resize({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    const ro = new ResizeObserver(() => sendBounds());
    ro.observe(el);
    sendBounds();

    return () => {
      ro.disconnect();
    };
  }, [active]);

  // Cleanup: destroy the view when component unmounts
  useEffect(() => {
    return () => {
      if (window.electronAPI) {
        window.electronAPI.scenarioView.destroy();
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden relative" style={{ background: "transparent" }}>
      {/* The WebContentsView is rendered by Electron behind/over this area */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <CursorOverlay cursor={cursor} viewportWidth={vp.width} viewportHeight={vp.height} />
      </div>
      {active && (
        <button
          onClick={() => window.electronAPI?.scenarioView.openDevTools()}
          className="absolute bottom-2 right-2 z-20 px-2 py-1 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-xs rounded border border-zinc-600"
          title="Open DevTools for the scenario page"
        >
          Inspect
        </button>
      )}
    </div>
  );
}

/**
 * Renders the observer iframe at the exact Playwright viewport dimensions
 * and CSS-scales it to fit the available container. This ensures page content
 * has an identical layout to the Playwright session, so cursor coordinates
 * from replay events map 1:1 to actual element positions.
 */
function ScaledObserverIframe({
  observerUrl,
  vp,
  cursor,
}: {
  observerUrl: string;
  vp: { width: number; height: number };
  cursor: CursorState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    return () => ro.disconnect();
  }, []);

  const scale =
    containerSize.w > 0 && containerSize.h > 0
      ? Math.min(containerSize.w / vp.width, containerSize.h / vp.height)
      : 1;

  const scaledW = vp.width * scale;
  const scaledH = vp.height * scale;
  const offsetX = Math.max(0, (containerSize.w - scaledW) / 2);
  const offsetY = Math.max(0, (containerSize.h - scaledH) / 2);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden relative bg-black">
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: vp.width,
          height: vp.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <iframe
          key={observerUrl}
          name="b2v-scenario"
          src={observerUrl}
          style={{ width: vp.width, height: vp.height, border: "none" }}
          title="Scenario live view"
        />
        <CursorOverlay cursor={cursor} viewportWidth={vp.width} viewportHeight={vp.height} />
      </div>
    </div>
  );
}

export function Preview({
  screenshot,
  liveFrame,
  liveFrames,
  activeStep,
  stepCaption,
  studioFrames,
  viewMode,
  stepState,
  paneLayout,
  terminalServerUrl,
  showStudio,
  videoPath,
  cursor,
  sendStudioEvent,
}: PreviewProps) {
  const isRunning = stepState === "running" || stepState === "fast-forwarding";
  const observerUrl = useMemo(() => paneLayout ? buildObserverUrl(paneLayout) : null, [paneLayout]);
  const singlePageLiveUrl = useMemo(
    () => (paneLayout && !paneLayout.gridConfig ? paneLayout.pageUrl ?? null : null),
    [paneLayout],
  );
  const isMultiPane = (paneLayout?.panes?.length ?? 0) > 1 && !paneLayout?.gridConfig;
  const hasLiveFrames = Object.keys(liveFrames).length > 0;

  console.error(
    `[preview] mode=${viewMode} step=${activeStep} state=${stepState ?? "none"}`,
    `observerUrl=${!!observerUrl} paneLayout=${!!paneLayout}`,
    `showStudio=${showStudio} termSrv=${!!terminalServerUrl}`,
    `gridConfig=${!!paneLayout?.gridConfig} termSrv=${!!paneLayout?.terminalServerUrl}`,
    `liveFrame=${!!liveFrame} screenshot=${!!screenshot} isRunning=${isRunning}`,
  );

  // --- Cached video (no steps run yet) ---
  if (viewMode === "video" && videoPath && activeStep < 0) {
    const src = `/api/video?path=${encodeURIComponent(videoPath)}`;
    return (
      <div data-preview-mode="cached-video" className="flex flex-col h-full">
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">Cached video</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-400">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            From cache / CI
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <video key={src} src={src} controls autoPlay className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
        </div>
      </div>
    );
  }

  if (activeStep < 0 && viewMode === "live" && showStudio && terminalServerUrl) {
    return (
      <div data-preview-mode="studio-react" className="flex flex-col h-full">
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">Studio</span>
          <span className="text-sm text-zinc-300">Compose panes with + and layout presets</span>
          <span className="ml-auto">{liveBadge}</span>
        </div>
        <StudioGrid terminalServerUrl={terminalServerUrl} studioFrames={studioFrames} sendStudioEvent={sendStudioEvent} />
      </div>
    );
  }

  if (activeStep < 0) return idlePlaceholder;

  // --- Video mode ---
  if (viewMode === "video") {
    if (videoPath) {
      const src = `/api/video?path=${encodeURIComponent(videoPath)}`;
      return (
        <div data-preview-mode="video-playback" className="flex flex-col h-full">
          <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-500">Video playback</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Recorded
            </span>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
            <video key={src} src={src} controls autoPlay className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
          </div>
        </div>
      );
    }

    const fallbackSrc = liveFrame
      ? `data:image/jpeg;base64,${liveFrame}`
      : screenshot
        ? `data:image/png;base64,${screenshot}`
        : null;

    if (!fallbackSrc) {
      return (
        <div data-preview-mode="no-video" className="flex items-center justify-center h-full text-zinc-600">
          <div className="text-center">
            <div className="text-5xl mb-4 opacity-40">&#x1f3ac;</div>
            <p className="text-lg font-medium text-zinc-400">No video yet</p>
            <p className="text-sm text-zinc-600 mt-1">Run all steps to generate a recording</p>
          </div>
        </div>
      );
    }

    return (
      <div data-preview-mode="video-screencast" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={<span className="text-xs text-zinc-500">Recording in progress…</span>} />
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img src={fallbackSrc} alt={stepCaption ?? "Step preview"} className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
        </div>
      </div>
    );
  }

  // --- Electron live mode: WebContentsView for real DOM interactions ---
  if (isElectron && viewMode === "live" && paneLayout?.gridConfig) {
    const vp = paneLayout?.viewport ?? { width: 1280, height: 720 };
    return (
      <div data-preview-mode="electron-scenario-view" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveBadge} />
        <ElectronScenarioView vp={vp} cursor={cursor} active={isRunning} />
      </div>
    );
  }

  // --- Live mode: grid observer (non-Electron fallback) ---
  if (observerUrl) {
    const vp = paneLayout?.viewport ?? { width: 1280, height: 720 };
    return (
      <div data-preview-mode="observer-iframe" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveBadge} />
        <ScaledObserverIframe observerUrl={observerUrl} vp={vp} cursor={cursor} />
      </div>
    );
  }

  // --- Live mode: single page iframe (debuggable DOM) ---
  if (viewMode === "live" && singlePageLiveUrl) {
    return (
      <div data-preview-mode="single-page-iframe" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveBadge} />
        <div className="flex-1 overflow-hidden bg-black">
          <iframe
            key={singlePageLiveUrl}
            src={singlePageLiveUrl}
            className="w-full h-full border-none"
            title="Scenario live view"
          />
        </div>
      </div>
    );
  }

  // --- Live mode: multi-pane screencast (collab-like scenarios) ---
  if (isMultiPane && hasLiveFrames) {
    const panes = paneLayout!.panes!;
    const flexDir = layoutToFlexClass(paneLayout!.layout);
    return (
      <div data-preview-mode="multi-pane" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveBadge} />
        <div className={`flex-1 flex ${flexDir} gap-0.5 overflow-hidden bg-zinc-900 p-1`}>
          {panes.map((pane) => {
            const frame = liveFrames[pane.id];
            return (
              <div key={pane.id} className="flex-1 flex flex-col min-w-0 min-h-0 relative">
                <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-zinc-400 font-mono">
                  {pane.label}
                </div>
                {frame ? (
                  <img
                    src={`data:image/jpeg;base64,${frame}`}
                    alt={pane.label}
                    className="w-full h-full object-contain rounded border border-zinc-800"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs border border-zinc-800 rounded">
                    Waiting…
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --- Screencast or screenshot fallback ---
  const displaySrc = liveFrame
    ? `data:image/jpeg;base64,${liveFrame}`
    : screenshot
      ? `data:image/png;base64,${screenshot}`
      : null;

  if (isRunning && !displaySrc) {
    return (
      <div data-preview-mode="waiting" className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {viewMode === "live" ? "Live" : "Starting…"}
          </span>
        } />
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <p>{viewMode === "live" ? "Waiting for scenario layout…" : "Waiting for scenario to initialize…"}</p>
        </div>
      </div>
    );
  }

  if (!displaySrc) return idlePlaceholder;

  return (
    <div data-preview-mode="screenshot" className="flex flex-col h-full">
      <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveFrame ? liveBadge : (isRunning ? liveBadge : null)} />
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <img src={displaySrc} alt={stepCaption ?? "Step preview"} className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
      </div>
    </div>
  );
}
