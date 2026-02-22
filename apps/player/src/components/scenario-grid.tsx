/**
 * @description ScenarioGrid — renders a dockview grid of terminal and browser
 * panes for a running scenario. Terminal panes use jabterm's <JabTerm> React
 * component connected to a jabterm WS server. Browser panes use iframes.
 *
 * Unlike StudioGrid (interactive, user-composed), this component is driven
 * entirely by the scenario's grid config received from the session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { JabTerm } from "jabterm/react";
import "@xterm/xterm/css/xterm.css";

export interface ScenarioGridConfig {
  panes: Array<{
    type: "terminal" | "browser";
    cmd?: string;
    testId?: string;
    title: string;
    url?: string;
    allowAddTab?: boolean;
  }>;
  grid?: number[][];
  viewport: { width: number; height: number };
  jabtermWsUrl: string;
}

const PANEL_COMPONENT = "scenario-pane";

type ScenarioPaneParams = {
  type: "terminal" | "browser";
  testId: string;
  title: string;
  wsUrl?: string;
  browserUrl?: string;
};

function TerminalPane({ testId, wsUrl }: { testId: string; wsUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log(`[TerminalPane] ${testId} connecting to ${wsUrl}`);
  }, [testId, wsUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      window.dispatchEvent(new Event("resize"));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!wsUrl) {
    return (
      <div data-testid={testId} className="w-full h-full flex items-center justify-center text-red-400 text-sm bg-zinc-900">
        Terminal WebSocket URL is missing
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className="w-full h-full"
      style={{ background: "#1e1e1e" }}
    >
      <JabTerm
        wsUrl={wsUrl}
        fontSize={13}
        theme={{ background: "#1e1e1e" }}
      />
    </div>
  );
}

function BrowserPane({ url, testId }: { url: string; testId: string }) {
  return (
    <div data-testid={testId} className="w-full h-full">
      <iframe
        name={testId}
        src={url}
        className="w-full h-full border-none"
        title="Scenario browser pane"
      />
    </div>
  );
}

function ScenarioPane({ params }: IDockviewPanelProps<ScenarioPaneParams>) {
  if (params.type === "browser" && params.browserUrl) {
    return <BrowserPane url={params.browserUrl} testId={params.testId} />;
  }
  if (params.type === "terminal" && params.wsUrl) {
    return <TerminalPane testId={params.testId} wsUrl={params.wsUrl} />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm bg-zinc-900">
      Loading...
    </div>
  );
}

/**
 * Convert a grid layout (number[][]) to dockview addPanel positions.
 * Determines placement direction based on cell adjacency.
 */
function gridToPositions(
  grid: number[][],
  paneCount: number,
  viewportW: number,
  viewportH: number,
): Array<{
  index: number;
  position?: { referencePanel: string; direction: string };
  initialWidth?: number;
  initialHeight?: number;
}> {
  if (paneCount <= 0 || grid.length === 0) return [];
  const gridRows = grid.length;
  const gridCols = Math.max(...grid.map((r) => r.length));
  if (!Number.isFinite(gridCols) || gridCols <= 0) return [];

  const boxes = new Map<number, { minRow: number; maxRow: number; minCol: number; maxCol: number }>();
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const idx = grid[r][c];
      const box = boxes.get(idx);
      if (!box) {
        boxes.set(idx, { minRow: r, maxRow: r, minCol: c, maxCol: c });
      } else {
        box.minRow = Math.min(box.minRow, r);
        box.maxRow = Math.max(box.maxRow, r);
        box.minCol = Math.min(box.minCol, c);
        box.maxCol = Math.max(box.maxCol, c);
      }
    }
  }

  const cellW = Math.round(viewportW / gridCols);
  const cellH = Math.round(viewportH / gridRows);

  const indices = [...boxes.keys()].sort((a, b) => {
    const ba = boxes.get(a)!;
    const bb = boxes.get(b)!;
    return ba.minRow !== bb.minRow ? ba.minRow - bb.minRow : ba.minCol - bb.minCol;
  });

  const result: Array<{
    index: number;
    position?: { referencePanel: string; direction: string };
    initialWidth?: number;
    initialHeight?: number;
  }> = [];
  const placed = new Set<number>();

  for (const idx of indices) {
    if (idx >= paneCount) continue;
    const box = boxes.get(idx)!;
    const spanCols = box.maxCol - box.minCol + 1;
    const spanRows = box.maxRow - box.minRow + 1;
    const targetW = spanCols * cellW;
    const targetH = spanRows * cellH;

    if (placed.size === 0) {
      result.push({ index: idx });
      placed.add(idx);
      continue;
    }

    let bestRef: number | undefined;
    let bestDir: string | undefined;
    let bestScore = -1;

    for (const placedIdx of placed) {
      const pBox = boxes.get(placedIdx)!;
      const refSpanRows = pBox.maxRow - pBox.minRow + 1;
      const refSpanCols = pBox.maxCol - pBox.minCol + 1;
      const candidates: Array<{ dir: string; score: number }> = [];

      if (box.minCol === pBox.maxCol + 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
        const overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
        const maxOverlap = box.maxRow - box.minRow + 1;
        const perpSim = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
        candidates.push({ dir: "right", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.minRow === pBox.maxRow + 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
        const overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
        const maxOverlap = box.maxCol - box.minCol + 1;
        const perpSim = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
        candidates.push({ dir: "below", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.maxCol === pBox.minCol - 1 && box.minRow <= pBox.maxRow && box.maxRow >= pBox.minRow) {
        const overlap = Math.min(box.maxRow, pBox.maxRow) - Math.max(box.minRow, pBox.minRow) + 1;
        const maxOverlap = box.maxRow - box.minRow + 1;
        const perpSim = Math.min(spanRows, refSpanRows) / Math.max(spanRows, refSpanRows);
        candidates.push({ dir: "left", score: (overlap / maxOverlap) * perpSim });
      }
      if (box.maxRow === pBox.minRow - 1 && box.minCol <= pBox.maxCol && box.maxCol >= pBox.minCol) {
        const overlap = Math.min(box.maxCol, pBox.maxCol) - Math.max(box.minCol, pBox.minCol) + 1;
        const maxOverlap = box.maxCol - box.minCol + 1;
        const perpSim = Math.min(spanCols, refSpanCols) / Math.max(spanCols, refSpanCols);
        candidates.push({ dir: "above", score: (overlap / maxOverlap) * perpSim });
      }

      for (const c of candidates) {
        if (c.score > bestScore) {
          bestScore = c.score;
          bestRef = placedIdx;
          bestDir = c.dir;
        }
      }
    }

    const sizeForDirection = (dir: string) =>
      dir === "right" || dir === "left" ? { initialWidth: targetW } : { initialHeight: targetH };

    if (bestRef !== undefined && bestDir) {
      result.push({
        index: idx,
        position: { referencePanel: `panel-${bestRef}`, direction: bestDir },
        ...sizeForDirection(bestDir),
      });
    } else {
      result.push({
        index: idx,
        position: { referencePanel: `panel-${indices[0]}`, direction: "right" },
        initialWidth: targetW,
      });
    }
    placed.add(idx);
  }

  return result;
}

function buildWsUrl(baseWsUrl: string, pane: ScenarioGridConfig["panes"][number]): string {
  const terminalId = pane.cmd ? `cmd:${pane.cmd}` : (pane.testId ?? "shell");
  return `${baseWsUrl}/${encodeURIComponent(terminalId)}`;
}

export function ScenarioGrid({ gridConfig }: { gridConfig: ScenarioGridConfig }) {
  const [api, setApi] = useState<DockviewApi | null>(null);

  const components = useMemo(() => ({ [PANEL_COMPONENT]: ScenarioPane }), []);

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api);
  }, []);

  useEffect(() => {
    if (!api) return;

    // Clear old panels before building new ones so grid switches work
    for (const panel of [...api.panels]) {
      panel.api.close();
    }

    const { panes, grid, viewport, jabtermWsUrl } = gridConfig;
    const effectiveGrid = grid ?? [panes.map((_, i) => i)];
    const positions = gridToPositions(effectiveGrid, panes.length, viewport.width, viewport.height);

    for (const entry of positions) {
      const pane = panes[entry.index];
      if (!pane) continue;

      const testId = pane.testId ?? `pane-${entry.index}`;
      const params: ScenarioPaneParams = {
        type: pane.type,
        testId,
        title: pane.title,
        wsUrl: pane.type === "terminal" ? buildWsUrl(jabtermWsUrl, pane) : undefined,
        browserUrl: pane.type === "browser" ? pane.url : undefined,
      };

      const panelOpts: any = {
        id: `panel-${entry.index}`,
        component: PANEL_COMPONENT,
        title: pane.title,
        params,
      };
      if (entry.position) panelOpts.position = entry.position;
      const panel = api.addPanel(panelOpts);

      if (entry.initialWidth || entry.initialHeight) {
        const sz: any = {};
        if (entry.initialWidth) sz.width = entry.initialWidth;
        if (entry.initialHeight) sz.height = entry.initialHeight;
        panel.api.setSize(sz);
      }
    }

    for (const group of api.groups) {
      if (!group.locked) group.locked = "no-drop-target";
    }
  }, [api, gridConfig]);

  return (
    <div className="w-full h-full dockview-theme-dark" style={{ background: "#1e1e1e" }}>
      <DockviewReact
        components={components}
        onReady={handleReady}
        disableFloatingGroups
        disableDnd
        locked
        defaultRenderer="always"
        singleTabMode="fullwidth"
      />
    </div>
  );
}
