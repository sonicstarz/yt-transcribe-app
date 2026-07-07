const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  transcribe: (args) => ipcRenderer.send("transcribe", args),
  onEvent: (cb) => ipcRenderer.on("worker-event", (_e, data) => cb(data)),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  revealInFolder: (p) => ipcRenderer.invoke("open-path", p),
  openFile: (p) => ipcRenderer.invoke("open-file", p),
});
