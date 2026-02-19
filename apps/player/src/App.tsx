import { usePlayer } from "./hooks/use-player";
import { StepGraph } from "./components/step-graph";
import { Preview } from "./components/preview";
import { Controls } from "./components/controls";
import { ScenarioPicker } from "./components/scenario-picker";

const WS_URL = `ws://${window.location.host}/ws`;

export default function App() {
  const { state, loadScenario, runStep, runAll, reset, clearCache, setViewMode } = usePlayer(WS_URL);
  const { scenario, scenarioFiles, stepStates, screenshots, activeStep, liveFrame, connected, error, stepDurations, stepHasAudio, viewMode, paneLayout, videoPath } = state;

  const activeScreenshot = activeStep >= 0 ? screenshots[activeStep] : null;
  const activeCaption = activeStep >= 0 && scenario ? scenario.steps[activeStep]?.caption : undefined;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <ScenarioPicker
        onLoad={loadScenario}
        connected={connected}
        scenarioName={scenario?.name ?? null}
        scenarioFiles={scenarioFiles}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {scenario ? (
          <>
            <div className="w-72 border-r border-zinc-800 flex-shrink-0">
              <StepGraph
                steps={scenario.steps}
                stepStates={stepStates}
                screenshots={screenshots}
                activeStep={activeStep}
                stepDurations={stepDurations}
                stepHasAudio={stepHasAudio}
                onStepClick={runStep}
              />
            </div>
            <div className="flex-1">
              <Preview
                screenshot={activeScreenshot}
                liveFrame={liveFrame}
                activeStep={activeStep}
                stepCaption={activeCaption}
                viewMode={viewMode}
                stepState={activeStep >= 0 ? stepStates[activeStep] : undefined}
                paneLayout={paneLayout}
                videoPath={videoPath}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600">
            <div className="text-center max-w-md">
              <h1 className="text-2xl font-bold text-zinc-400 mb-4">b2v Player</h1>
              <p className="text-sm leading-relaxed">
                Select a scenario file from the dropdown above to get started.
                <br />
                Scenarios use{" "}
                <code className="text-blue-400">defineScenario()</code> format.
              </p>
              <p className="text-xs text-zinc-700 mt-4">
                Steps run in human mode with full recording.
                <br />
                Click any step — previous steps fast-forward automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      {scenario && (
        <Controls
          stepCount={scenario.steps.length}
          activeStep={activeStep}
          stepStates={stepStates}
          onRunStep={runStep}
          onRunAll={runAll}
          onReset={reset}
          onClearCache={clearCache}
        />
      )}
    </div>
  );
}
