import { usePlayer } from "./hooks/use-player";
import { StepGraph } from "./components/step-graph";
import { Preview } from "./components/preview";
import { Controls } from "./components/controls";
import { ScenarioPicker } from "./components/scenario-picker";

const WS_URL = `ws://${window.location.host}/ws`;

export default function App() {
  const { state, cursor, loadScenario, runStep, runAll, reset, cancel, clearCache, setViewMode, importArtifacts, downloadArtifacts, sendStudioEvent } = usePlayer(WS_URL);
  const {
    scenario,
    scenarioFiles,
    stepStates,
    screenshots,
    activeStep,
    liveFrame,
    liveFrames,
    studioFrames,
    connected,
    error,
    stepDurations,
    stepHasAudio,
    viewMode,
    paneLayout,
    terminalServerUrl,
    videoPath,
    importing,
    importResult,
    cacheSize,
  } = state;

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
        onClearCache={clearCache}
        cacheSize={cacheSize}
      />

      {error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-zinc-800 flex-shrink-0">
          {scenario ? (
            <StepGraph
              steps={scenario.steps}
              stepStates={stepStates}
              screenshots={screenshots}
              activeStep={activeStep}
              stepDurations={stepDurations}
              stepHasAudio={stepHasAudio}
              onStepClick={runStep}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 px-6">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-zinc-400 mb-3">b2v Player Studio</h1>
                <p className="text-xs leading-relaxed">
                  Select a scenario to record and replay.
                  <br />
                  Or use the studio grid on the right to compose panes.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1">
          <Preview
            screenshot={activeScreenshot}
            liveFrame={liveFrame}
            liveFrames={liveFrames}
            studioFrames={studioFrames}
            activeStep={activeStep}
            stepCaption={activeCaption}
            viewMode={viewMode}
            stepState={activeStep >= 0 ? stepStates[activeStep] : undefined}
            paneLayout={paneLayout}
            terminalServerUrl={terminalServerUrl}
            showStudio={!scenario}
            videoPath={videoPath}
            cursor={cursor}
            sendStudioEvent={sendStudioEvent}
          />
        </div>
      </div>

      {scenario && (
        <Controls
          stepCount={scenario.steps.length}
          activeStep={activeStep}
          stepStates={stepStates}
          connected={connected}
          importing={importing}
          importResult={importResult}
          onRunStep={runStep}
          onRunAll={runAll}
          onReset={reset}
          onCancel={cancel}
          onClearCache={clearCache}
          onImportArtifacts={importArtifacts}
          onDownloadArtifacts={downloadArtifacts}
        />
      )}
    </div>
  );
}
