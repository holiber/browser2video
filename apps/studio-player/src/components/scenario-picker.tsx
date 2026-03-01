import { useRef, useEffect, useState } from "react";
import { FolderOpen, ChevronDown, Monitor, Film, Database, Trash2 } from "lucide-react";
import type { ViewMode } from "../stores/player-store";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface ScenarioPickerProps {
  onLoad: (file: string) => void;
  connected: boolean;
  scenarioFile: string | null;
  scenarioName: string | null;
  scenarioFiles: string[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClearScenarioCache?: () => void;
  onClearGlobalCache?: () => void;
  scenarioCacheSize?: number;
  globalCacheSize?: number;
}

export function ScenarioPicker({ onLoad, connected, scenarioFile, scenarioName, scenarioFiles, viewMode, onViewModeChange, onClearScenarioCache, onClearGlobalCache, scenarioCacheSize, globalCacheSize }: ScenarioPickerProps) {
  const [cachePopoverOpen, setCachePopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cachePopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCachePopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [cachePopoverOpen]);

  const handleSelect = (file: string) => {
    if (file) onLoad(file);
  };

  const hasFiles = scenarioFiles.length > 0;

  return (
    <div className="h-9 flex items-center gap-3 px-3 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
      <FolderOpen size={16} className="text-zinc-500 flex-shrink-0" />

      {hasFiles ? (
        <div className="relative w-72 max-w-[50vw] flex-shrink-0">
          <select
            value={scenarioFile ?? ""}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={!connected}
            className="h-7 w-full appearance-none bg-zinc-800 border border-zinc-700 rounded px-3 pr-7 text-xs text-zinc-200 cursor-pointer hover:border-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-30"
            data-testid="picker-select"
          >
            <option value="">Select a scenario...</option>
            {scenarioFiles.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      ) : (
        <span className="text-xs text-zinc-600">
          {connected ? "No .scenario.ts files found" : "Connecting..."}
        </span>
      )}

      {scenarioName && (
        <span className="text-xs text-zinc-500 truncate min-w-0">{scenarioName}</span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1 rounded-full bg-zinc-800 p-0.5 flex-shrink-0">
        <button
          onClick={() => onViewModeChange("live")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${viewMode === "live"
            ? "bg-emerald-600 text-white"
            : "text-zinc-400 hover:text-zinc-200"
            }`}
          title="Embed scenario content inline"
          data-testid="ctrl-view-live"
        >
          <Monitor size={12} />
          Live
        </button>
        <button
          onClick={() => onViewModeChange("video")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${viewMode === "video"
            ? "bg-blue-600 text-white"
            : "text-zinc-400 hover:text-zinc-200"
            }`}
          title="Play recorded video"
          data-testid="ctrl-view-video"
        >
          <Film size={12} />
          Video
        </button>
      </div>

      {(onClearScenarioCache || onClearGlobalCache) && (
        <div className="relative flex-shrink-0" ref={popoverRef}>
          <button
            onClick={() => setCachePopoverOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Cache management"
            data-testid="ctrl-clear-cache"
          >
            <Database size={12} />
            <span>
              {formatBytes(scenarioCacheSize ?? 0)}
              {" / "}
              {formatBytes(globalCacheSize ?? 0)}
            </span>
          </button>

          {cachePopoverOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-zinc-300">Scenario cache</span>
                  <span className="text-[10px] text-zinc-500">{formatBytes(scenarioCacheSize ?? 0)}</span>
                </div>
                {onClearScenarioCache && (
                  <button
                    onClick={() => { onClearScenarioCache(); setCachePopoverOpen(false); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors"
                    data-testid="ctrl-clear-scenario-cache"
                  >
                    <Trash2 size={11} />
                    Clear
                  </button>
                )}
              </div>

              <div className="border-t border-zinc-800" />

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-zinc-300">Global cache</span>
                  <span className="text-[10px] text-zinc-500">{formatBytes(globalCacheSize ?? 0)}</span>
                </div>
                {onClearGlobalCache && (
                  <button
                    onClick={() => { onClearGlobalCache(); setCachePopoverOpen(false); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors"
                    data-testid="ctrl-clear-global-cache"
                  >
                    <Trash2 size={11} />
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? "bg-emerald-500" : "bg-red-500"}`}
        title={connected ? "Connected" : "Disconnected"}
      />
    </div>
  );
}
