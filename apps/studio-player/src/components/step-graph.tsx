import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import type { StepState, StepInfo } from "../hooks/use-player";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const stateStyles: Record<StepState, string> = {
  pending: "border-zinc-700/60 bg-zinc-900/40",
  "fast-forwarding": "border-yellow-600/60 bg-yellow-950/30",
  running: "border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40",
  done: "border-emerald-600/60 bg-emerald-950/20",
};

const TEXT_SHADOW = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000";

interface StepGraphProps {
  steps: StepInfo[];
  stepStates: StepState[];
  screenshots: (string | null)[];
  activeStep: number;
  stepDurationsFast: (number | null)[];
  stepDurationsHuman: (number | null)[];
  stepHasAudio: boolean[];
  runMode: "human" | "fast";
  onStepClick: (index: number) => void;
}

export function StepGraph({
  steps,
  stepStates,
  screenshots,
  activeStep,
  stepDurationsFast,
  stepDurationsHuman,
  stepHasAudio,
  runMode,
  onStepClick,
}: StepGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeStep]);

  const activeDurations = runMode === "fast" ? stepDurationsFast : stepDurationsHuman;
  const effectiveDurations = activeDurations.map((d, i) =>
    (d !== null && d > 0) ? d : ((runMode === "fast" ? stepDurationsHuman[i] : stepDurationsFast[i]) ?? null),
  );
  const maxDuration = Math.max(1, ...effectiveDurations.filter((d): d is number => d !== null && d > 0));

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-2 space-y-1">
      {steps.map((step, i) => {
        const state = stepStates[i] ?? "pending";
        const isActive = i === activeStep;
        const screenshot = screenshots[i];
        const fastDur = stepDurationsFast[i];
        const humanDur = stepDurationsHuman[i];
        const activeDur = activeDurations[i];
        const barDur = effectiveDurations[i];
        const hasAudio = stepHasAudio[i] ?? false;
        const hasAnyDuration = (humanDur !== null && humanDur > 0) || (fastDur !== null && fastDur > 0);

        const humanLabel = humanDur !== null && humanDur > 0 ? formatDuration(humanDur) : "N/A";
        const fastLabel = fastDur !== null && fastDur > 0 ? formatDuration(fastDur) : "N/A";

        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            onClick={() => onStepClick(i)}
            className={`cursor-pointer rounded border transition-all ${stateStyles[state]} ${isActive ? "shadow-md shadow-blue-500/20" : "hover:border-zinc-500"}`}
            data-testid={`step-card-${i}`}
          >
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

              <div className="absolute inset-x-0 bottom-0 p-1.5 flex items-end justify-between">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-mono text-white shrink-0" style={{ textShadow: TEXT_SHADOW }}>
                    {i + 1}
                  </span>
                  <span className="text-xs text-white truncate" style={{ textShadow: TEXT_SHADOW }}>
                    {step.caption}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasAudio && <Volume2 size={10} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" data-testid="audio-icon" />}

                  {hasAnyDuration && (
                    <span
                      className="text-[9px] font-mono text-zinc-300"
                      style={{ textShadow: TEXT_SHADOW }}
                      data-testid={`step-duration-${i}`}
                    >
                      <span className={humanDur !== null && humanDur > 0 ? (runMode === "human" ? "text-blue-300" : "text-zinc-300") : "text-zinc-500"}>
                        {humanLabel}
                      </span>
                      <span className="text-zinc-500"> / </span>
                      <span className={fastDur !== null && fastDur > 0 ? (runMode === "fast" ? "text-yellow-300" : "text-zinc-300") : "text-zinc-500"}>
                        {fastLabel}
                      </span>
                    </span>
                  )}

                  {state === "running" && (
                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  {state === "fast-forwarding" && (
                    <span className="text-[9px] text-yellow-400 font-bold" style={{ textShadow: "0 0 3px #000" }}>ff</span>
                  )}
                </div>
              </div>
            </div>

            {barDur !== null && barDur > 0 && (
              <div className="h-1 bg-zinc-800/80 rounded-b overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500/60 to-blue-400/40"
                  style={{ width: `${Math.round((barDur / maxDuration) * 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
