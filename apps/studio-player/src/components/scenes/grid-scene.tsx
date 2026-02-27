/**
 * @description Grid scene — wraps the existing ScenarioGrid (Dockview) component.
 * This is the "grid" scene type and produces the same tab/split behavior as
 * the traditional createGrid() API.
 */
import { useMemo } from "react";
import { ScenarioGrid, type ScenarioGridConfig } from "../scenario-grid";
import type { SceneComponentProps } from "./scene-renderer";

export function GridScene({
  scene,
  resolvedSlots,
  jabtermWsUrl,
  slotOffset,
}: SceneComponentProps) {
  const gridConfig = useMemo<ScenarioGridConfig>(() => {
    const panes = resolvedSlots.slice(slotOffset).map((s) => ({
      type: s.type,
      testId: s.testId,
      title: s.title,
      url: s.url,
      cmd: s.cmd,
    }));
    const grid = (scene.props?.grid as number[][] | undefined) ?? undefined;
    const viewport = (scene.props?.viewport as { width: number; height: number } | undefined)
      ?? { width: 1280, height: 720 };

    return { panes, grid, viewport, jabtermWsUrl };
  }, [scene, resolvedSlots, jabtermWsUrl, slotOffset]);

  return (
    <div data-testid="scene-grid" className="w-full h-full">
      <ScenarioGrid gridConfig={gridConfig} />
    </div>
  );
}
