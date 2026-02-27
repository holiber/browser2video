/**
 * @description Scene panel — a bottom bar showing the scene tree with
 * thumbnails and per-scene action controls (like OBS / Prism Studio).
 */
import { observer } from "mobx-react-lite";
import type { SceneDescriptor, SceneAction } from "browser2video";
import type { PaneLayoutInfo } from "../stores/player-store";

interface ScenePanelProps {
  paneLayout: PaneLayoutInfo | null;
  sceneActionStates: Record<string, unknown>;
  onDispatch: (sceneName: string, actionId: string, payload?: unknown) => void;
}

function SceneCard({
  scene,
  sceneActionStates,
  onDispatch,
}: {
  scene: SceneDescriptor;
  sceneActionStates: Record<string, unknown>;
  onDispatch: (sceneName: string, actionId: string, payload?: unknown) => void;
}) {
  const iconMap: Record<string, string> = {
    grid: "⊞",
    split: "◫",
    iphone: "📱",
    laptop: "💻",
  };
  const icon = iconMap[scene.type] ?? "◻";

  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/50 min-w-[90px]">
      <div className="text-lg">{icon}</div>
      <div className="text-[10px] text-zinc-300 font-medium truncate max-w-[80px]">
        {scene.name}
      </div>
      <div className="text-[9px] text-zinc-500">{scene.type}</div>

      {/* Action toggles */}
      {scene.actions?.map((action) => {
        const key = `${scene.name}/${action.id}`;
        const isOn = (sceneActionStates[key] ?? action.defaultState ?? false) === true;

        if (action.type === "toggle") {
          return (
            <button
              key={action.id}
              onClick={() => onDispatch(scene.name, action.id, !isOn)}
              className={`mt-1 px-2 py-0.5 text-[9px] rounded-full border transition-colors ${
                isOn
                  ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-300"
                  : "bg-zinc-700/50 border-zinc-600/50 text-zinc-400"
              }`}
            >
              {action.label}: {isOn ? "ON" : "OFF"}
            </button>
          );
        }

        return (
          <button
            key={action.id}
            onClick={() => onDispatch(scene.name, action.id)}
            className="mt-1 px-2 py-0.5 text-[9px] rounded-full border border-zinc-600/50 bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600/50"
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

function collectScenes(scene: SceneDescriptor): SceneDescriptor[] {
  const result: SceneDescriptor[] = [scene];
  for (const child of scene.children ?? []) {
    result.push(...collectScenes(child));
  }
  return result;
}

function ScenePanelInner({ paneLayout, sceneActionStates, onDispatch }: ScenePanelProps) {
  const sceneConfig = paneLayout?.sceneConfig;
  if (!sceneConfig) return null;

  const allScenes = collectScenes(sceneConfig.scene);

  return (
    <div
      data-testid="scene-panel"
      className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/80 px-3 py-2"
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide mr-1 flex-shrink-0">
          Scenes
        </span>
        {allScenes.map((scene, i) => (
          <SceneCard
            key={scene.name ?? i}
            scene={scene}
            sceneActionStates={sceneActionStates}
            onDispatch={onDispatch}
          />
        ))}
      </div>
    </div>
  );
}

export const ScenePanel = observer(ScenePanelInner);
