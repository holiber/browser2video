/**
 * @description Top-level scene renderer. Given a SceneDescriptor, resolves the
 * `type` string to a React component and renders it recursively. Passes slot
 * content (terminal / browser panes) and action dispatch.
 */
import type { SceneDescriptor, ResolvedSlot } from "browser2video";
import { GridScene } from "./grid-scene";
import { SplitScene } from "./split-scene";
import { IPhoneScene } from "./iphone-scene";
import { LaptopScene } from "./laptop-scene";

type SceneComponent = React.ComponentType<SceneComponentProps>;

export interface SceneComponentProps {
  scene: SceneDescriptor;
  resolvedSlots: ResolvedSlot[];
  jabtermWsUrl: string;
  slotOffset: number;
  sceneActionStates: Record<string, unknown>;
  onDispatch: (sceneName: string, actionId: string, payload?: unknown) => void;
}

const REGISTRY: Record<string, SceneComponent> = {
  grid: GridScene,
  split: SplitScene,
  iphone: IPhoneScene,
  laptop: LaptopScene,
};

function countSlots(scene: SceneDescriptor): number {
  let count = Object.keys(scene.slots ?? {}).length;
  for (const child of scene.children ?? []) {
    count += countSlots(child);
  }
  return count;
}

export function SceneRenderer({
  scene,
  resolvedSlots,
  jabtermWsUrl,
  slotOffset = 0,
  sceneActionStates,
  onDispatch,
}: SceneComponentProps) {
  const Component = REGISTRY[scene.type];
  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Unknown scene type: {scene.type}
      </div>
    );
  }

  return (
    <Component
      scene={scene}
      resolvedSlots={resolvedSlots}
      jabtermWsUrl={jabtermWsUrl}
      slotOffset={slotOffset}
      sceneActionStates={sceneActionStates}
      onDispatch={onDispatch}
    />
  );
}

export { countSlots };
