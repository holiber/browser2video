import { useMemo } from "react";
import type { ViewMode, StepState, PaneLayoutInfo } from "../hooks/use-player";

interface PreviewProps {
  screenshot: string | null;
  liveFrame: string | null;
  liveFrames: Record<string, string>;
  activeStep: number;
  stepCaption?: string;
  viewMode: ViewMode;
  stepState?: StepState;
  paneLayout: PaneLayoutInfo | null;
  videoPath: string | null;
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
  <div className="flex items-center justify-center h-full text-zinc-600">
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

export function Preview({
  screenshot,
  liveFrame,
  liveFrames,
  activeStep,
  stepCaption,
  viewMode,
  stepState,
  paneLayout,
  videoPath,
}: PreviewProps) {
  const isRunning = stepState === "running" || stepState === "fast-forwarding";
  const observerUrl = useMemo(() => paneLayout ? buildObserverUrl(paneLayout) : null, [paneLayout]);
  const isMultiPane = (paneLayout?.panes?.length ?? 0) > 1 && !paneLayout?.gridConfig;
  const hasLiveFrames = Object.keys(liveFrames).length > 0;

  // --- Cached video (no steps run yet) ---
  if (viewMode === "video" && videoPath && activeStep < 0) {
    const src = `/api/video?path=${encodeURIComponent(videoPath)}`;
    return (
      <div className="flex flex-col h-full">
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

  if (activeStep < 0) return idlePlaceholder;

  // --- Video mode ---
  if (viewMode === "video") {
    if (videoPath) {
      const src = `/api/video?path=${encodeURIComponent(videoPath)}`;
      return (
        <div className="flex flex-col h-full">
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
        <div className="flex items-center justify-center h-full text-zinc-600">
          <div className="text-center">
            <div className="text-5xl mb-4 opacity-40">&#x1f3ac;</div>
            <p className="text-lg font-medium text-zinc-400">No video yet</p>
            <p className="text-sm text-zinc-600 mt-1">Run all steps to generate a recording</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={<span className="text-xs text-zinc-500">Recording in progress…</span>} />
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img src={fallbackSrc} alt={stepCaption ?? "Step preview"} className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
        </div>
      </div>
    );
  }

  // --- Live mode: grid observer (TUI scenarios) ---
  if (observerUrl) {
    return (
      <div className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveBadge} />
        <div className="flex-1 overflow-hidden">
          <iframe key={observerUrl} src={observerUrl} className="w-full h-full border-none" title="Scenario live view" />
        </div>
      </div>
    );
  }

  // --- Live mode: multi-pane screencast (collab-like scenarios) ---
  if (isMultiPane && hasLiveFrames) {
    const panes = paneLayout!.panes!;
    const flexDir = layoutToFlexClass(paneLayout!.layout);
    return (
      <div className="flex flex-col h-full">
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

  // --- Single-pane screencast fallback ---
  const displaySrc = liveFrame
    ? `data:image/jpeg;base64,${liveFrame}`
    : screenshot
      ? `data:image/png;base64,${screenshot}`
      : null;

  if (!displaySrc && isRunning) {
    return (
      <div className="flex flex-col h-full">
        <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Starting…
          </span>
        } />
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <p>Waiting for scenario to initialize…</p>
        </div>
      </div>
    );
  }

  if (!displaySrc) return idlePlaceholder;

  return (
    <div className="flex flex-col h-full">
      <StepHeader activeStep={activeStep} stepCaption={stepCaption} badge={liveFrame ? liveBadge : null} />
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <img src={displaySrc} alt={stepCaption ?? "Step preview"} className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl" />
      </div>
    </div>
  );
}
