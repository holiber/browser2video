import { useState } from "react";
import { Play, SkipForward, SkipBack, RotateCcw, Trash2, Download, FolderInput } from "lucide-react";
import type { StepState } from "../hooks/use-player";

interface ControlsProps {
  stepCount: number;
  activeStep: number;
  stepStates: StepState[];
  importing: boolean;
  importResult: { count: number; scenarios: string[] } | null;
  onRunStep: (index: number) => void;
  onRunAll: () => void;
  onReset: () => void;
  onClearCache: () => void;
  onImportArtifacts: (dir: string) => void;
  onDownloadArtifacts: (runId?: string) => void;
}

export function Controls({
  stepCount,
  activeStep,
  stepStates,
  importing,
  importResult,
  onRunStep,
  onRunAll,
  onReset,
  onClearCache,
  onImportArtifacts,
  onDownloadArtifacts,
}: ControlsProps) {
  const isRunning = stepStates.some((s) => s === "running" || s === "fast-forwarding");
  const allDone = stepStates.every((s) => s === "done");
  const nextStep = stepStates.findIndex((s) => s === "pending");
  const [showImportMenu, setShowImportMenu] = useState(false);

  return (
    <div className="flex items-center justify-between px-6 py-2 border-t border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const prev = Math.max(0, activeStep - 1);
            if (prev !== activeStep) onRunStep(prev);
          }}
          disabled={isRunning || activeStep <= 0}
          className="p-2 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Previous step"
        >
          <SkipBack size={16} />
        </button>

        <button
          onClick={onRunAll}
          disabled={isRunning || allDone}
          className="p-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
          title="Play all"
        >
          <Play size={14} />
          Play all
        </button>

        <button
          onClick={() => {
            if (nextStep >= 0) onRunStep(nextStep);
          }}
          disabled={isRunning || nextStep < 0}
          className="p-2 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Next step"
        >
          <SkipForward size={16} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        {importResult && (
          <span className="text-xs text-emerald-400">
            Imported {importResult.count} scenario{importResult.count !== 1 ? "s" : ""}
          </span>
        )}

        <span className="text-xs text-zinc-500">
          {activeStep >= 0 ? `${activeStep + 1} / ${stepCount}` : `${stepCount} steps`}
        </span>

        <div className="relative">
          <button
            onClick={() => setShowImportMenu(!showImportMenu)}
            disabled={isRunning || importing}
            className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Import CI artifacts"
          >
            {importing ? (
              <div className="w-3.5 h-3.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Download size={14} />
            )}
          </button>

          {showImportMenu && (
            <div className="absolute bottom-full right-0 mb-1 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => {
                  onDownloadArtifacts();
                  setShowImportMenu(false);
                }}
                className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Download size={12} />
                Download from GitHub CI
              </button>
              <button
                onClick={() => {
                  onImportArtifacts("artifacts");
                  setShowImportMenu(false);
                }}
                className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <FolderInput size={12} />
                Import local ./artifacts
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onReset}
          disabled={isRunning}
          className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>

        <button
          onClick={onClearCache}
          disabled={isRunning}
          className="p-1.5 px-2.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
          title="Clear cache"
        >
          <Trash2 size={14} />
          <span className="text-xs">Clear cache</span>
        </button>
      </div>
    </div>
  );
}
