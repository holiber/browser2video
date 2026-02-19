import { useMemo } from "react";
import type { ViewMode, StepState, PaneLayoutInfo } from "../hooks/use-player";

interface PreviewProps {
  screenshot: string | null;
  liveFrame: string | null;
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
  if (layout.pageUrl) {
    return layout.pageUrl;
  }
  return null;
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

export function Preview({
  screenshot,
  liveFrame,
  activeStep,
  stepCaption,
  viewMode,
  stepState,
  paneLayout,
  videoPath,
}: PreviewProps) {
  const isRunning = stepState === "running" || stepState === "fast-forwarding";
  const observerUrl = useMemo(() => paneLayout ? buildObserverUrl(paneLayout) : null, [paneLayout]);

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
            <video
              key={src}
              src={src}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl"
            />
          </div>
        </div>
      );
    }

    // Video not ready yet — show screencast / screenshot as fallback
    const fallbackSrc = liveFrame
      ? `data:image/jpeg;base64,${liveFrame}`
      : screenshot
        ? `data:image/png;base64,${screenshot}`
        : null;

    if (!fallbackSrc) {
      return (
        <div className="flex items-center justify-center h-full text-zinc-600">
          <div className="text-center">
            <div className="text-5xl mb-4 opacity-40">🎬</div>
            <p className="text-lg font-medium text-zinc-400">No video yet</p>
            <p className="text-sm text-zinc-600 mt-1">Run all steps to generate a recording</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">Step {activeStep + 1}</span>
          <span className="text-sm text-zinc-300">{stepCaption}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
            Recording in progress…
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img
            src={fallbackSrc}
            alt={stepCaption ?? "Step preview"}
            className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl"
          />
        </div>
      </div>
    );
  }

  // --- Live mode ---
  if (observerUrl) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">Step {activeStep + 1}</span>
          <span className="text-sm text-zinc-300">{stepCaption}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            key={observerUrl}
            src={observerUrl}
            className="w-full h-full border-none"
            title="Scenario live view"
          />
        </div>
      </div>
    );
  }

  // Fallback: show screencast frames or screenshot (before layout info arrives)
  const displaySrc = liveFrame
    ? `data:image/jpeg;base64,${liveFrame}`
    : screenshot
      ? `data:image/png;base64,${screenshot}`
      : null;

  if (!displaySrc && isRunning) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">Step {activeStep + 1}</span>
          <span className="text-sm text-zinc-300">{stepCaption}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Starting…
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <p>Waiting for scenario to initialize…</p>
        </div>
      </div>
    );
  }

  if (!displaySrc) return idlePlaceholder;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
        <span className="text-xs font-mono text-zinc-500">Step {activeStep + 1}</span>
        <span className="text-sm text-zinc-300">{stepCaption}</span>
        {liveFrame && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Screencast
          </span>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <img
          src={displaySrc}
          alt={stepCaption ?? "Step preview"}
          className="max-w-full max-h-full rounded-lg border border-zinc-800 shadow-2xl"
        />
      </div>
    </div>
  );
}
