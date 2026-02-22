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
    <div ref={containerRef} className="h-full overflow-y-auto p-2 space-y-1">
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
            {/* Widescreen 16:9 thumbnail with overlaid text */}
            <div className="relative" style={{ aspectRatio: "16 / 9" }}>
              {screenshot ? (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt={step.caption}
                  className="absolute inset-0 w-full h-full object-cover rounded-t"
                />
              ) : (
                <div className="absolute inset-0 bg-black rounded-t" />
              )}

              {/* Overlaid caption with black outline for visibility */}
              <div className="absolute inset-x-0 bottom-0 p-1.5 flex items-end justify-between">
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className="text-[10px] font-mono text-white shrink-0"
                    style={{ textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="text-xs text-white truncate"
                    style={{ textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" }}
                  >
                    {step.caption}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {hasAudio && <Volume2 size={10} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" data-testid="audio-icon" />}
                  {state === "running" && (
                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  {state === "fast-forwarding" && (
                    <span className="text-[9px] text-yellow-400 font-bold" style={{ textShadow: "0 0 3px #000" }}>ff</span>
                  )}
                </div>
              </div>
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
