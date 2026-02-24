export interface ScenarioViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScenarioViewResult {
  webContentsId: number;
  cdpPort: number;
  targetUrl: string;
}

export interface ElectronAPI {
  scenarioView: {
    create: (url: string, bounds: ScenarioViewBounds) => Promise<ScenarioViewResult | { error: string }>;
    destroy: () => Promise<void>;
    resize: (bounds: ScenarioViewBounds) => Promise<void>;
    openDevTools: () => Promise<void>;
  };
  onScenarioViewReady: (callback: () => void) => () => void;
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
