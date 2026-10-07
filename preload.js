const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  state: () => ipcRenderer.invoke("data:state"),
  choose: mode => ipcRenderer.invoke("data:choose", mode),          // "open" | "create"
  takeLock: () => ipcRenderer.invoke("data:take-lock"),
  write: projects => ipcRenderer.invoke("data:write", { projects }),
  saveFile: (defaultName, data, filters) => ipcRenderer.invoke("file:save", { defaultName, data, filters }),
  printPdf: opts => ipcRenderer.invoke("pdf:print", opts),
  onDataChanged: cb => ipcRenderer.on("data:changed", (_e, content) => cb(content)),
  onChangeFile: cb => ipcRenderer.on("menu:change-file", () => cb()),
  onSaveAsMenu: cb => ipcRenderer.on("menu:save-as", () => cb()),
  onOpenPath: cb => ipcRenderer.on("menu:open-path", (_e, f) => cb(f)),
  openPath: f => ipcRenderer.invoke("data:open-path", f),
  saveAs: projects => ipcRenderer.invoke("data:save-as", { projects }),
  pdfSave: (name, data) => ipcRenderer.invoke("pdf:save", { name, data }),
  pdfRead: id => ipcRenderer.invoke("pdf:read", id),
  pdfDelete: id => ipcRenderer.invoke("pdf:delete", id),
  pdfOpen: id => ipcRenderer.invoke("pdf:open", id)
});
