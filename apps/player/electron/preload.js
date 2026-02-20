const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  scenarioView: {
    create: (url, bounds) =>
      ipcRenderer.invoke("scenario:createView", url, bounds),
    destroy: () => ipcRenderer.invoke("scenario:destroyView"),
    resize: (bounds) =>
      ipcRenderer.invoke("scenario:resizeView", bounds),
    openDevTools: () => ipcRenderer.invoke("scenario:openDevTools"),
  },
  onScenarioViewReady: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("scenario:viewReady", handler);
    return () => ipcRenderer.removeListener("scenario:viewReady", handler);
  },
  isElectron: true,
});
