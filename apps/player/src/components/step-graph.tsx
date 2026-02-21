import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import type { StepState, StepInfo } from "../hooks/use-player";

const stateStyles: Record<StepState, string> = {
  pending: "border-zinc-700/60 bg-zinc-900/40",
  "fast-forwarding": "border-yellow-600/60 bg-yellow-950/30",
  running: "border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40",
  done: "border-emerald-600/60 bg-emerald-950/20",
};

interface StepGraphProps {
  steps: StepInfo[];
  stepStates: StepState[];
  screenshots: (string | null)[];
  activeStep: number;
  stepDurations: (number | null)[];
  stepHasAudio: boolean[];
  onStepClick: (index: number) => void;
}

export function StepGraph({
  steps,
  stepStates,
  screenshots,
  activeStep,
  stepDurations,
  stepHasAudio,
  onStepClick,
}: StepGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeStep]);

  const maxDuration = Math.max(1, ...stepDurations.filter((d): d is number => d !== null));

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-2 space-y-1.5">
      {steps.map((step, i) => {
        const state = stepStates[i] ?? "pending";
        const isActive = i === activeStep;
        const screenshot = screenshots[i];
        const duration = stepDurations[i];
        const hasAudio = stepHasAudio[i] ?? false;

        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            onClick={() => onStepClick(i)}
            className={`cursor-pointer rounded border transition-all ${stateStyles[state]} ${isActive ? "shadow-md shadow-blue-500/20" : "hover:border-zinc-500"}`}
          >
            <div className="px-2 py-1 flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-mono text-zinc-500 shrink-0 w-4 text-right">{i + 1}</span>
              <span className="text-xs text-zinc-300 truncate flex-1">{step.caption}</span>
              {hasAudio && <Volume2 size={11} className="text-zinc-500 shrink-0" data-testid="audio-icon" />}
              {state === "running" && (
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              )}
              {state === "fast-forwarding" && (
                <span className="text-[9px] text-yellow-500 shrink-0">ff</span>
              )}
            </div>
            <div className="relative h-[72px] bg-black rounded-b overflow-hidden">
              {screenshot ? (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt={step.caption}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 bg-black" />
              )}
              {state === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {duration !== null && (
              <div className="h-0.5 bg-zinc-800 rounded-b overflow-hidden">
                <div
                  className="h-full bg-blue-500/50"
                  style={{ width: `${Math.round((duration / maxDuration) * 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
