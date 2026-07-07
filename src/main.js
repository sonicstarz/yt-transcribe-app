const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require("electron");
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

// Copy the transcript to the system clipboard.
ipcMain.handle("copy-text", async (_e, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

// Open an external https link (Venmo, GitHub) in the default browser.
ipcMain.handle("open-external", async (_e, url) => {
  if (typeof url === "string" && /^https:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle("app-version", async () => app.getVersion());

// Compare dotted versions; true when `a` is strictly newer than `b`.
function isNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Ask GitHub for the latest release and compare to the running version.
const UPDATE_REPO = "sonicstarz/yt-transcribe-app";
ipcMain.handle("check-update", async () => {
  const current = app.getVersion();
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json", "User-Agent": "yt-transcribe-app" } }
    );
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const data = await res.json();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const url = data.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`;
    return { current, latest, url, updateAvailable: isNewer(latest, current) };
  } catch (err) {
    return { current, error: err.message };
  }
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
