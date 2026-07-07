const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  transcribe: (args) => ipcRenderer.send("transcribe", args),
  onEvent: (cb) => ipcRenderer.on("worker-event", (_e, data) => cb(data)),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  revealInFolder: (p) => ipcRenderer.invoke("open-path", p),
  openFile: (p) => ipcRenderer.invoke("open-file", p),
  copyText: (t) => ipcRenderer.invoke("copy-text", t),
  openExternal: (u) => ipcRenderer.invoke("open-external", u),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  appVersion: () => ipcRenderer.invoke("app-version"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
  sendObsidian: (meta) => ipcRenderer.invoke("send-obsidian", meta),
  sendNotion: (meta) => ipcRenderer.invoke("send-notion", meta),
  openObsidian: (uri) => ipcRenderer.invoke("open-obsidian", uri),
});
