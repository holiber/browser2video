/**
 * @description Split scene — renders two child scenes side by side.
 * Configurable ratio via `props.ratio` (default 0.5 = 50/50).
 */
import type { SceneComponentProps } from "./scene-renderer";
import { SceneRenderer, countSlots } from "./scene-renderer";

export function SplitScene({
  scene,
  resolvedSlots,
  jabtermWsUrl,
  slotOffset,
  sceneActionStates,
  onDispatch,
}: SceneComponentProps) {
  const children = scene.children ?? [];
  const ratio = (scene.props?.ratio as number) ?? 0.5;
  const direction = (scene.props?.direction as "row" | "column") ?? "row";

  let currentOffset = slotOffset;

  return (
    <div
      data-testid="scene-split"
      className="w-full h-full flex"
      style={{ flexDirection: direction }}
    >
      {children.map((child, i) => {
        const childOffset = currentOffset;
        currentOffset += countSlots(child);
        const flex = i === 0 ? ratio : 1 - ratio;

        return (
          <div key={child.name ?? i} style={{ flex }} className="min-w-0 min-h-0 overflow-hidden">
            <SceneRenderer
              scene={child}
              resolvedSlots={resolvedSlots}
              jabtermWsUrl={jabtermWsUrl}
              slotOffset={childOffset}
              sceneActionStates={sceneActionStates}
              onDispatch={onDispatch}
            />
          </div>
        );
      })}
    </div>
  );
}
