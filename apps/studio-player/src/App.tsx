import { useEffect, useRef } from "react";
import { usePlayer } from "./hooks/use-player";
import { StepGraph } from "./components/step-graph";
import { Preview } from "./components/preview";
import { Controls } from "./components/controls";
import { ScenarioPicker } from "./components/scenario-picker";

const WS_URL = `ws://${window.location.host}/ws`;

export default function App() {
  const { state, cursor, loadScenario, runStep, runAll, reset, cancel, clearCache, setViewMode, importArtifacts, downloadArtifacts, sendStudioEvent, setAudioSettings } = usePlayer(WS_URL);
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
    loading,
    stepDurationsFast,
    stepDurationsHuman,
    stepHasAudio,
    runMode,
    viewMode,
    paneLayout,
    terminalServerUrl,
    videoPath,
    importing,
    importResult,
    cacheSize,
    audioSettings,
    detectedProvider,
  } = state;

  const isFastForwarding = stepStates.some((s) => s === "fast-forwarding");
  const showOverlay = loading || isFastForwarding;
  const overlayLabel = loading ? "Loading..." : "Replaying slides...";

  const activeScreenshot = activeStep >= 0 ? screenshots[activeStep] : null;
  const activeCaption = activeStep >= 0 && scenario ? scenario.steps[activeStep]?.caption : undefined;

  const autoRunInitRef = useRef(false);
  const autoRunRef = useRef<{ file: string; autoplay: boolean } | null>(null);
  if (!autoRunInitRef.current) {
    autoRunInitRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const file = params.get("scenario") ?? params.get("file");
    if (file) {
      const autoplay = params.get("autoplay") !== "0" && params.get("play") !== "0";
      autoRunRef.current = { file, autoplay };
    }
  }

  useEffect(() => {
    const auto = autoRunRef.current;
    if (!auto) return;
    if (!connected) return;

    loadScenario(auto.file);
    if (auto.autoplay) runAll();

    // Only do this once per app launch.
    autoRunRef.current = null;
  }, [connected, loadScenario, runAll]);

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
              stepDurationsFast={stepDurationsFast}
              stepDurationsHuman={stepDurationsHuman}
              stepHasAudio={stepHasAudio}
              runMode={runMode}
              onStepClick={runStep}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 px-6">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-zinc-400 mb-3">Studio Player</h1>
                <p className="text-xs leading-relaxed">
                  Select a scenario to record and replay.
                  <br />
                  Or use the studio grid on the right to compose panes.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 relative">
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
          {showOverlay && (
            <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-zinc-300 font-medium">{overlayLabel}</span>
              </div>
            </div>
          )}
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
          audioSettings={audioSettings}
          detectedProvider={detectedProvider}
          onRunStep={runStep}
          onRunAll={runAll}
          onReset={reset}
          onCancel={cancel}
          cacheSize={cacheSize}
          onClearCache={clearCache}
          onImportArtifacts={importArtifacts}
          onDownloadArtifacts={downloadArtifacts}
          onAudioSettingsChange={setAudioSettings}
        />
      )}
    </div>
  );
}
