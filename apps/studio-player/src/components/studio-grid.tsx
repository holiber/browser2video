import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview";
import { Globe, Plus, TerminalSquare, X } from "lucide-react";

interface StudioContextValue {
  studioFrames: Record<string, string>;
  sendStudioEvent: (msg: Record<string, unknown>) => void;
}

const StudioContext = createContext<StudioContextValue>({
  studioFrames: {},
  sendStudioEvent: () => {},
});

type PaneKind = "placeholder" | "browser" | "browser-playwright" | "terminal";
type LayoutPresetId =
  | "1x1"
  | "side-by-side"
  | "top-bottom"
  | "1-left-2-right"
  | "3-cols"
  | "2x2";

const STUDIO_PANEL_COMPONENT = "studio-pane";
const DEFAULT_BROWSER_URL = "https://github.com/nicedoc/browser2video";

type StudioPaneParams = {
  kind: PaneKind;
  panelId: string;
  src?: string;
  onOpenAdd?: (panelId?: string) => void;
};

const LAYOUT_PRESETS: Array<{ id: LayoutPresetId; label: string }> = [
  { id: "1x1", label: "Single (1x1)" },
  { id: "side-by-side", label: "One left / one right" },
  { id: "top-bottom", label: "One top / one bottom" },
  { id: "1-left-2-right", label: "One left / two right" },
  { id: "3-cols", label: "Three columns" },
  { id: "2x2", label: "2x2 quad" },
];

function normalizeBrowserUrl(input: string): string {
  const raw = input.trim() || DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function buildTerminalSrc(terminalServerUrl: string, testId: string, title = "Shell"): string {
  const params = new URLSearchParams({ testId, title });
  return `${terminalServerUrl}/terminal?${params.toString()}`;
}

function layoutSlots(layout: LayoutPresetId): Array<{ id: string; position?: { referencePanel: string; direction: "within" | "below" | "above" | "right" | "left" } }> {
  switch (layout) {
    case "1x1":
      return [{ id: "slot-0" }];
    case "side-by-side":
      return [
        { id: "slot-0" },
        { id: "slot-1", position: { referencePanel: "slot-0", direction: "right" } },
      ];
    case "top-bottom":
      return [
        { id: "slot-0" },
        { id: "slot-1", position: { referencePanel: "slot-0", direction: "below" } },
      ];
    case "1-left-2-right":
      return [
        { id: "slot-0" },
        { id: "slot-1", position: { referencePanel: "slot-0", direction: "right" } },
        { id: "slot-2", position: { referencePanel: "slot-1", direction: "below" } },
      ];
    case "3-cols":
      return [
        { id: "slot-0" },
        { id: "slot-1", position: { referencePanel: "slot-0", direction: "right" } },
        { id: "slot-2", position: { referencePanel: "slot-1", direction: "right" } },
      ];
    case "2x2":
      return [
        { id: "slot-0" },
        { id: "slot-1", position: { referencePanel: "slot-0", direction: "right" } },
        { id: "slot-2", position: { referencePanel: "slot-0", direction: "below" } },
        { id: "slot-3", position: { referencePanel: "slot-1", direction: "below" } },
      ];
  }
}

function PlaywrightBrowserPane({ paneId }: { paneId: string }) {
  const { studioFrames, sendStudioEvent } = useContext(StudioContext);
  const frameSrc = studioFrames[paneId];
  const containerRef = useRef<HTMLDivElement>(null);

  const toViewport = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = toViewport(e);
    if (pos) sendStudioEvent({ type: "studioMouseEvent", paneId, action: "move", ...pos });
  }, [paneId, sendStudioEvent, toViewport]);

  const onClick = useCallback((e: React.MouseEvent) => {
    const pos = toViewport(e);
    if (pos) sendStudioEvent({ type: "studioMouseEvent", paneId, action: "click", ...pos, button: e.button === 2 ? "right" : "left" });
  }, [paneId, sendStudioEvent, toViewport]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    sendStudioEvent({ type: "studioMouseEvent", paneId, action: "wheel", x: 0, y: 0, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [paneId, sendStudioEvent]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    sendStudioEvent({ type: "studioKeyEvent", paneId, action: "press", key: e.key });
  }, [paneId, sendStudioEvent]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative bg-black cursor-pointer outline-none"
      tabIndex={0}
      onMouseMove={onMouseMove}
      onClick={onClick}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => { e.preventDefault(); onClick(e); }}
      data-testid="studio-playwright-browser"
    >
      {frameSrc ? (
        <img
          src={`data:image/jpeg;base64,${frameSrc}`}
          alt="Browser pane"
          className="w-full h-full object-contain"
          draggable={false}
          data-testid="studio-playwright-frame"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">
          Loading page...
        </div>
      )}
    </div>
  );
}

function DirectBrowserPane({ src }: { src: string }) {
  return (
    <iframe
      src={src}
      className="w-full h-full border-none bg-white"
      title="Studio browser pane"
      data-testid="studio-browser-iframe"
    />
  );
}

function StudioPane({ params }: IDockviewPanelProps<StudioPaneParams>) {
  if (params.kind === "placeholder") {
    return (
      <div className="h-full w-full flex items-center justify-center bg-zinc-900">
        <button
          type="button"
          data-testid="studio-placeholder-add"
          className="w-24 h-24 rounded-xl border border-dashed border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-zinc-400 hover:text-white text-4xl transition-colors"
          onClick={() => params.onOpenAdd?.(params.panelId)}
          title="Add pane"
        >
          +
        </button>
      </div>
    );
  }

  if (params.kind === "browser") {
    return <DirectBrowserPane src={params.src ?? normalizeBrowserUrl(DEFAULT_BROWSER_URL)} />;
  }

  if (params.kind === "browser-playwright") {
    return <PlaywrightBrowserPane paneId={params.panelId} />;
  }

  return (
    <iframe
      src={params.src}
      className="w-full h-full border-none"
      title="Studio terminal pane"
      data-testid="studio-terminal-iframe"
    />
  );
}

interface StudioGridProps {
  terminalServerUrl: string;
  studioFrames: Record<string, string>;
  sendStudioEvent: (msg: Record<string, unknown>) => void;
}

export function StudioGrid({ terminalServerUrl, studioFrames, sendStudioEvent }: StudioGridProps) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const [layout, setLayout] = useState<LayoutPresetId>("1x1");
  const [paneKinds, setPaneKinds] = useState<Record<string, PaneKind>>({});
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [addPaneOpen, setAddPaneOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [usePlaywrightBrowser, setUsePlaywrightBrowser] = useState(false);
  const [pendingTargetPanel, setPendingTargetPanel] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState(DEFAULT_BROWSER_URL);

  const nextDynamicPanelRef = useRef(1);
  const nextTerminalRef = useRef(1);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  const components = useMemo(() => ({ [STUDIO_PANEL_COMPONENT]: StudioPane }), []);

  const setPaneKind = useCallback((panelId: string, kind: PaneKind) => {
    setPaneKinds((prev) => ({ ...prev, [panelId]: kind }));
  }, []);

  const removePaneKind = useCallback((panelId: string) => {
    setPaneKinds((prev) => {
      if (!(panelId in prev)) return prev;
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }, []);

  const openAddPopup = useCallback((panelId?: string) => {
    setPendingTargetPanel(panelId ?? null);
    setAddPaneOpen(true);
  }, []);

  const closeDialogs = useCallback(() => {
    setAddPaneOpen(false);
    setUrlDialogOpen(false);
    setPendingTargetPanel(null);
  }, []);

  const applyLayoutToApi = useCallback((dockApi: DockviewApi, nextLayout: LayoutPresetId) => {
    for (const [panelId, kind] of Object.entries(paneKinds)) {
      if (kind === "browser-playwright") {
        sendStudioEvent({ type: "studioCloseBrowser", paneId: panelId });
      }
    }
    dockApi.clear();
    setPaneKinds({});
    setActivePanelId(null);
    nextDynamicPanelRef.current = 1;

    const slots = layoutSlots(nextLayout);
    for (const slot of slots) {
      const panel = dockApi.addPanel({
        id: slot.id,
        component: STUDIO_PANEL_COMPONENT,
        title: "Add pane",
        params: {
          kind: "placeholder",
          panelId: slot.id,
          onOpenAdd: openAddPopup,
        } satisfies StudioPaneParams,
        position: slot.position,
      });
      setPaneKind(panel.id, "placeholder");
    }
  }, [openAddPopup, paneKinds, sendStudioEvent, setPaneKind]);

  const resolveTargetPanel = useCallback((): string | null => {
    if (pendingTargetPanel && paneKinds[pendingTargetPanel] === "placeholder") {
      return pendingTargetPanel;
    }
    for (const [panelId, kind] of Object.entries(paneKinds)) {
      if (kind === "placeholder") return panelId;
    }
    return null;
  }, [pendingTargetPanel, paneKinds]);

  const addPane = useCallback((kind: "browser" | "terminal", rawUrl?: string, usePlaywright = false) => {
    if (!api) return;

    const targetPanelId = resolveTargetPanel();
    const panelId = `studio-pane-${nextDynamicPanelRef.current++}`;
    const position = targetPanelId
      ? { referencePanel: targetPanelId, direction: "within" as const }
      : (api.activePanel ? { referencePanel: api.activePanel.id, direction: "right" as const } : undefined);

    if (kind === "browser") {
      const url = normalizeBrowserUrl(rawUrl ?? DEFAULT_BROWSER_URL);
      const panel = api.addPanel({
        id: panelId,
        component: STUDIO_PANEL_COMPONENT,
        title: "Browser",
        params: usePlaywright
          ? ({ kind: "browser-playwright", panelId } satisfies StudioPaneParams)
          : ({ kind: "browser", panelId, src: url } satisfies StudioPaneParams),
        position,
      });
      setPaneKind(panel.id, usePlaywright ? "browser-playwright" : "browser");

      if (usePlaywright) {
        sendStudioEvent({ type: "studioOpenBrowser", paneId: panel.id, url });
      }

      if (targetPanelId) {
        const placeholder = api.getPanel(targetPanelId);
        placeholder?.api.close();
        removePaneKind(targetPanelId);
      }
      closeDialogs();
      return;
    }

    const title = "Shell";
    let src = "";
    const testId = `studio-term-${nextTerminalRef.current++}`;
    src = buildTerminalSrc(terminalServerUrl, testId, title);

    const panel = api.addPanel({
      id: panelId,
      component: STUDIO_PANEL_COMPONENT,
      title,
      params: { kind: "terminal", panelId, src } satisfies StudioPaneParams,
      position,
    });

    setPaneKind(panel.id, "terminal");

    if (targetPanelId) {
      const placeholder = api.getPanel(targetPanelId);
      placeholder?.api.close();
      removePaneKind(targetPanelId);
    }

    closeDialogs();
  }, [api, closeDialogs, removePaneKind, resolveTargetPanel, sendStudioEvent, setPaneKind, terminalServerUrl]);

  const addTerminalTab = useCallback((referencePanelId?: string) => {
    if (!api) return;
    const reference = referencePanelId ?? activePanelId ?? api.activePanel?.id;
    if (!reference) return;
    if (paneKinds[reference] !== "terminal") return;

    const panelId = `studio-pane-${nextDynamicPanelRef.current++}`;
    const testId = `studio-term-${nextTerminalRef.current++}`;
    const title = "Shell";
    const src = buildTerminalSrc(terminalServerUrl, testId, title);

    const panel = api.addPanel({
      id: panelId,
      component: STUDIO_PANEL_COMPONENT,
      title,
      params: { kind: "terminal", panelId, src } satisfies StudioPaneParams,
      position: { referencePanel: reference, direction: "within" },
    });
    setPaneKind(panel.id, "terminal");
  }, [activePanelId, api, paneKinds, setPaneKind, terminalServerUrl]);

  const closeActivePanel = useCallback(() => {
    if (!api?.activePanel) return;
    const panel = api.activePanel;
    const kind = paneKinds[panel.id];
    if (kind === "browser-playwright") {
      sendStudioEvent({ type: "studioCloseBrowser", paneId: panel.id });
    }
    panel.api.close();
    removePaneKind(panel.id);
  }, [api, paneKinds, removePaneKind, sendStudioEvent]);

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api);

    disposablesRef.current.forEach((d) => d.dispose());
    disposablesRef.current = [
      event.api.onDidActivePanelChange((panel) => setActivePanelId(panel?.id ?? null)),
      event.api.onDidRemovePanel((panel) => removePaneKind(panel.id)),
    ];

    applyLayoutToApi(event.api, "1x1");
  }, [applyLayoutToApi, removePaneKind]);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
    };
  }, []);

  const contextValue = useMemo<StudioContextValue>(() => ({
    studioFrames,
    sendStudioEvent,
  }), [studioFrames, sendStudioEvent]);

  const onLayoutChange = useCallback((nextLayout: LayoutPresetId) => {
    setLayout(nextLayout);
    if (!api) return;
    applyLayoutToApi(api, nextLayout);
  }, [api, applyLayoutToApi]);

  const activeKind = activePanelId ? paneKinds[activePanelId] : undefined;

  const HeaderActions = useCallback(({ activePanel }: IDockviewHeaderActionsProps) => {
    if (!activePanel || paneKinds[activePanel.id] !== "terminal") return null;
    return (
      <button
        type="button"
        data-testid="studio-add-tab"
        className="w-5 h-5 rounded border border-zinc-600 text-zinc-300 hover:text-white hover:border-zinc-400 flex items-center justify-center"
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          addTerminalTab(activePanel.id);
        }}
        title="Add terminal tab"
      >
        +
      </button>
    );
  }, [addTerminalTab, paneKinds]);

  return (
    <StudioContext.Provider value={contextValue}>
    <div className="h-full flex flex-col bg-zinc-950 relative">
      <div className="h-9 px-2 border-b border-zinc-800 flex items-center gap-2 text-xs">
        <label htmlFor="studio-layout-picker" className="text-zinc-500">Layout</label>
        <select
          id="studio-layout-picker"
          data-testid="studio-layout-picker"
          className="h-7 px-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          value={layout}
          onChange={(e) => onLayoutChange(e.target.value as LayoutPresetId)}
        >
          {LAYOUT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <button
          type="button"
          data-testid="studio-add-pane-toolbar"
          className="h-7 px-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 inline-flex items-center gap-1"
          onClick={() => openAddPopup()}
          title="Add pane"
        >
          <Plus size={13} />
          Add pane
        </button>

        <button
          type="button"
          data-testid="studio-add-tab-toolbar"
          className="h-7 px-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 inline-flex items-center gap-1 disabled:opacity-40"
          onClick={() => addTerminalTab()}
          disabled={activeKind !== "terminal"}
          title="Add terminal tab"
        >
          <Plus size={13} />
          Add tab
        </button>

        <button
          type="button"
          data-testid="studio-close-active"
          className="h-7 px-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 inline-flex items-center gap-1 disabled:opacity-40"
          onClick={closeActivePanel}
          disabled={!activePanelId}
          title="Close active tab"
        >
          <X size={13} />
          Close active
        </button>
      </div>

      <div className="flex-1 min-h-0 dockview-theme-dark">
        <DockviewReact
          components={components}
          rightHeaderActionsComponent={HeaderActions}
          onReady={handleReady}
          disableFloatingGroups
          disableDnd
          locked
          defaultRenderer="always"
          singleTabMode="fullwidth"
        />
      </div>

      {addPaneOpen && (
        <div
          data-testid="studio-add-pane-popup"
          className="absolute inset-0 bg-black/55 z-20 flex items-center justify-center"
          onClick={() => setAddPaneOpen(false)}
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex gap-4" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              data-testid="studio-add-browser"
              className="w-28 h-28 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setAddPaneOpen(false);
                setBrowserUrl(DEFAULT_BROWSER_URL);
                setUsePlaywrightBrowser(false);
                setUrlDialogOpen(true);
              }}
            >
              <Globe size={28} />
              <span>Browser</span>
            </button>
            <button
              type="button"
              data-testid="studio-add-terminal"
              className="w-28 h-28 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex flex-col items-center justify-center gap-2"
              onClick={() => addPane("terminal")}
            >
              <TerminalSquare size={28} />
              <span>Terminal</span>
            </button>
          </div>
        </div>
      )}

      {urlDialogOpen && (
        <div
          data-testid="studio-browser-url-dialog"
          className="absolute inset-0 bg-black/55 z-30 flex items-center justify-center"
          onClick={() => closeDialogs()}
        >
          <div
            className="w-[560px] max-w-[calc(100vw-24px)] bg-zinc-900 border border-zinc-700 rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm text-zinc-200 font-medium mb-2">Open browser pane</div>
            <label className="text-xs text-zinc-500 mb-1 block" htmlFor="studio-browser-url-input">URL</label>
            <input
              id="studio-browser-url-input"
              data-testid="studio-browser-url-input"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              className="w-full h-8 rounded border border-zinc-700 bg-zinc-950 text-zinc-200 px-2 text-xs outline-none focus:border-blue-500"
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={usePlaywrightBrowser}
                onChange={(e) => setUsePlaywrightBrowser(e.target.checked)}
                data-testid="studio-open-dedicated-checkbox"
              />
              Use Playwright screencast mode (for Actor automation control)
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 px-3 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs"
                data-testid="studio-browser-url-cancel"
                onClick={() => closeDialogs()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-8 px-3 rounded border border-blue-600 bg-blue-600 text-white text-xs"
                data-testid="studio-browser-url-confirm"
                onClick={() => addPane("browser", browserUrl, usePlaywrightBrowser)}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </StudioContext.Provider>
  );
}
