import { Play, SkipForward, SkipBack, RotateCcw, Trash2 } from "lucide-react";
import type { StepState } from "../hooks/use-player";

interface ControlsProps {
  stepCount: number;
  activeStep: number;
  stepStates: StepState[];
  onRunStep: (index: number) => void;
  onRunAll: () => void;
  onReset: () => void;
  onClearCache: () => void;
}

export function Controls({
  stepCount,
  activeStep,
  stepStates,
  onRunStep,
  onRunAll,
  onReset,
  onClearCache,
}: ControlsProps) {
  const isRunning = stepStates.some((s) => s === "running" || s === "fast-forwarding");
  const allDone = stepStates.every((s) => s === "done");
  const nextStep = stepStates.findIndex((s) => s === "pending");

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
        <span className="text-xs text-zinc-500">
          {activeStep >= 0 ? `${activeStep + 1} / ${stepCount}` : `${stepCount} steps`}
        </span>

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
          className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Clear cache"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
