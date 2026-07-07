const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 620,
    height: 640,
    resizable: true,
    minWidth: 480,
    minHeight: 560,
    title: "YouTube \u2192 PDF Transcript",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}

// Resolve the Python interpreter to run the worker with, in priority order:
//   1. Bundled self-contained runtime (python/runtime) — what ships in the DMG.
//   2. A local dev venv (python/.venv), if you built one for development.
//   3. System python3 as a last resort.
function pythonPath() {
  const isWin = process.platform === "win32";
  // When packaged, resources sit alongside the app in process.resourcesPath.
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  const candidates = isWin
    ? [
        path.join(base, "python", "runtime", "python.exe"),
        path.join(base, "python", ".venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(base, "python", "runtime", "bin", "python3"),
        path.join(base, "python", ".venv", "bin", "python3"),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return isWin ? "python" : "python3";
}

function workerPath() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(base, "python", "worker.py");
}

ipcMain.handle("pick-folder", async () => {
  const res = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("open-path", async (_e, p) => {
  shell.showItemInFolder(p);
});

ipcMain.handle("open-file", async (_e, p) => {
  shell.openPath(p);
});

ipcMain.on("transcribe", (evt, args) => {
  const py = pythonPath();
  const worker = workerPath();
  const child = spawn(py, [worker, JSON.stringify(args)], { cwd: path.dirname(worker) });

  let buf = "";
  const send = (obj) => evt.sender.send("worker-event", obj);

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try { send(JSON.parse(line)); }
      catch { send({ type: "status", msg: line }); }
    }
  });

  child.stderr.on("data", (chunk) => {
    // Surface stderr only as soft status; real errors come through JSON.
    const s = chunk.toString().trim();
    if (s) send({ type: "log", msg: s });
  });

  child.on("close", (code) => {
    if (code !== 0) send({ type: "closed", code });
  });

  child.on("error", (err) => {
    send({ type: "error", msg: "Could not start Python: " + err.message });
  });
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
