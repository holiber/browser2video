import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import { usePlayerStore } from "./stores/context";
import { StepGraph } from "./components/step-graph";
import { Preview } from "./components/preview";
import { Controls } from "./components/controls";
import { ScenarioPicker } from "./components/scenario-picker";
import { ScenePanel } from "./components/scene-panel";

export default observer(function App() {
  const store = usePlayerStore();

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
    if (!store.connected) return;

    store.loadScenario(auto.file);
    if (auto.autoplay) store.runAll();

    autoRunRef.current = null;
  }, [store.connected, store]);

  const { scenario } = store;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <ScenarioPicker
        onLoad={(f) => store.loadScenario(f)}
        connected={store.connected}
        scenarioName={scenario?.name ?? null}
        scenarioFiles={store.scenarioFiles}
        viewMode={store.viewMode}
        onViewModeChange={(m) => store.setViewMode(m)}
        onClearScenarioCache={() => store.clearScenarioCache()}
        onClearGlobalCache={() => store.clearGlobalCache()}
        scenarioCacheSize={store.scenarioCacheSize}
        globalCacheSize={store.globalCacheSize}
      />

      {store.error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-sm">
          {store.error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-zinc-800 flex-shrink-0">
          {scenario ? (
            <StepGraph
              steps={scenario.steps}
              stepStates={store.stepStates}
              screenshots={store.screenshots}
              activeStep={store.activeStep}
              stepDurationsFast={store.stepDurationsFast}
              stepDurationsHuman={store.stepDurationsHuman}
              stepHasAudio={store.stepHasAudio}
              runMode={store.runMode}
              onStepClick={(i) => store.runStep(i)}
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
            screenshot={store.activeScreenshot}
            liveFrame={store.liveFrame}
            liveFrames={store.liveFrames}
            studioFrames={store.studioFrames}
            activeStep={store.activeStep}
            stepCaption={store.activeCaption}
            viewMode={store.viewMode}
            stepState={store.activeStep >= 0 ? store.stepStates[store.activeStep] : undefined}
            paneLayout={store.paneLayout}
            terminalServerUrl={store.terminalServerUrl}
            showStudio={!scenario}
            videoPath={store.videoPath}
            cursor={store.cursor}
            sendStudioEvent={(msg) => store.sendStudioEvent(msg)}
            sceneActionStates={store.sceneActionStates}
            onSceneAction={(name, id, payload) => store.dispatchSceneAction(name, id, payload)}
          />
          {store.showOverlay && (
            <div
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center"
              data-testid={store.buildProgress ? "build-overlay" : undefined}
            >
              <div className="flex flex-col items-center gap-3 max-w-md px-4">
                <div className="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-zinc-300 font-medium">{store.overlayLabel}</span>
                {store.buildProgress && (
                  <>
                    <span className="text-xs text-zinc-400">{store.buildProgress.step} / {store.buildProgress.total}</span>
                    <span className="text-xs text-zinc-500 text-center truncate w-full" data-testid="build-progress-msg">
                      {store.buildProgress.message}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ScenePanel
        paneLayout={store.paneLayout}
        sceneActionStates={store.sceneActionStates}
        onDispatch={(name, id, payload) => store.dispatchSceneAction(name, id, payload)}
      />

      {scenario && (
        <Controls
          stepCount={scenario.steps.length}
          activeStep={store.activeStep}
          stepStates={store.stepStates}
          connected={store.connected}
          executing={store.executing}
          importing={store.importing}
          importResult={store.importResult}
          audioSettings={store.audioSettings}
          detectedProvider={store.detectedProvider}
          onRunStep={(i) => store.runStep(i)}
          onRunAll={() => store.runAll()}
          onReset={() => store.reset()}
          onCancel={() => store.cancel()}
          onImportArtifacts={(d) => store.importArtifacts(d)}
          onDownloadArtifacts={(r) => store.downloadArtifacts(r)}
          onAudioSettingsChange={(s) => store.setAudioSettings(s)}
        />
      )}
    </div>
  );
});
