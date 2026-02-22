import { useState } from "react";
import { FolderOpen, ChevronDown, Monitor, Film, Trash2 } from "lucide-react";
import type { ViewMode } from "../hooks/use-player";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface ScenarioPickerProps {
  onLoad: (file: string) => void;
  connected: boolean;
  scenarioName: string | null;
  scenarioFiles: string[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClearCache?: () => void;
  cacheSize?: number;
}

export function ScenarioPicker({ onLoad, connected, scenarioName, scenarioFiles, viewMode, onViewModeChange, onClearCache, cacheSize }: ScenarioPickerProps) {
  const [selected, setSelected] = useState("");

  const handleSelect = (file: string) => {
    if (file) {
      setSelected(file);
      onLoad(file);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900">
      <FolderOpen size={16} className="text-zinc-500 flex-shrink-0" />

      {scenarioName ? (
        <div className="flex items-center gap-3 flex-1">
          <span className="text-sm font-medium text-zinc-200">{scenarioName}</span>
          <span className="text-xs text-zinc-600 truncate">{selected}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <select
                value=""
                onChange={(e) => handleSelect(e.target.value)}
                disabled={!connected}
                className="appearance-none bg-zinc-800 border border-zinc-700 rounded px-3 py-1 pr-7 text-xs text-zinc-300 cursor-pointer hover:border-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-30"
              >
                <option value="">Switch scenario...</option>
                {scenarioFiles.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1">
          {scenarioFiles.length > 0 ? (
            <div className="relative flex-1 max-w-md">
              <select
                value={selected}
                onChange={(e) => handleSelect(e.target.value)}
                disabled={!connected}
                className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 pr-8 text-sm text-zinc-200 cursor-pointer hover:border-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-30"
              >
                <option value="">Select a scenario file...</option>
                {scenarioFiles.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            </div>
          ) : (
            <span className="text-sm text-zinc-600">
              {connected ? "No .scenario.ts files found" : "Connecting..."}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 rounded-full bg-zinc-800 p-0.5 flex-shrink-0">
        <button
          onClick={() => onViewModeChange("live")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${viewMode === "live"
            ? "bg-emerald-600 text-white"
            : "text-zinc-400 hover:text-zinc-200"
            }`}
          title="Embed scenario content inline"
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
        >
          <Film size={12} />
          Video
        </button>
      </div>

      {onClearCache && (
        <button
          onClick={onClearCache}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex-shrink-0"
          title="Clear cache"
        >
          <Trash2 size={12} />
          {cacheSize && cacheSize > 0
            ? `${formatBytes(cacheSize)} clear cache`
            : "Clear cache"}
        </button>
      )}

      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? "bg-emerald-500" : "bg-red-500"}`}
        title={connected ? "Connected" : "Disconnected"}
      />
    </div>
  );
}
