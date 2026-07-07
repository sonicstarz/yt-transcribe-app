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

// ---------------------------------------------------------------------------
// Destinations: Obsidian (write a Markdown note into a vault folder) and
// Notion (create a page via the Notion API). Settings live in userData.
// ---------------------------------------------------------------------------
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); }
  catch { return {}; }
}
function writeSettings(s) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s || {}, null, 2));
}

ipcMain.handle("get-settings", async () => readSettings());
ipcMain.handle("save-settings", async (_e, s) => { writeSettings(s); return true; });

function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
// Break a wall of text into readable paragraphs (~4 sentences each).
function paragraphize(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  const paras = [];
  let cur = [];
  for (const s of sentences) {
    cur.push(s);
    if (cur.length >= 4) { paras.push(cur.join(" ")); cur = []; }
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.map((p) => p.trim()).filter(Boolean);
}
function safeName(name) {
  return String(name || "transcript")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "transcript";
}

function buildMarkdown(meta) {
  const date = todayISO();
  const title = meta.title || "Transcript";
  const yamlTitle = title.replace(/"/g, '\\"');
  const paras = paragraphize(meta.text);
  return [
    "---",
    `title: "${yamlTitle}"`,
    `source: ${meta.url || ""}`,
    `captured: ${date}`,
    `words: ${meta.words || 0}`,
    "tags: [youtube, transcript]",
    "---",
    "",
    `# ${title}`,
    "",
    `**Source:** ${meta.url || "—"}  `,
    `**Captured:** ${date} · **Words:** ${(meta.words || 0).toLocaleString()}`,
    "",
    "## Transcript",
    "",
    paras.join("\n\n"),
    "",
  ].join("\n");
}

ipcMain.handle("send-obsidian", async (_e, meta) => {
  const s = readSettings();
  if (!s.obsidianVault) {
    return { ok: false, error: "No Obsidian vault set — open Destinations and choose your vault folder." };
  }
  try {
    const dir = s.obsidianSubfolder
      ? path.join(s.obsidianVault, s.obsidianSubfolder)
      : s.obsidianVault;
    fs.mkdirSync(dir, { recursive: true });
    const base = safeName(meta.title);
    let file = path.join(dir, base + ".md");
    let i = 2;
    while (fs.existsSync(file)) { file = path.join(dir, `${base} ${i}.md`); i++; }
    fs.writeFileSync(file, buildMarkdown(meta), "utf8");
    return { ok: true, file, uri: "obsidian://open?path=" + encodeURIComponent(file) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("open-obsidian", async (_e, uri) => {
  if (typeof uri === "string" && uri.startsWith("obsidian://")) {
    await shell.openExternal(uri);
    return true;
  }
  return false;
});

// --- Notion ---------------------------------------------------------------
// Pull a 32-char id out of a raw id or a Notion URL and dash-format it.
function extractNotionId(input) {
  const m = String(input || "").replace(/-/g, "").match(/[0-9a-fA-F]{32}/);
  if (!m) return null;
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function chunkStr(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}
function paragraphBlock(text) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } };
}
// Notion caps rich_text at 2000 chars/block and 100 blocks/request — stay under both.
function transcriptBlocks(meta) {
  const blocks = [];
  const metaLine = `Source: ${meta.url || "—"}  ·  Words: ${(meta.words || 0).toLocaleString()}  ·  Captured: ${todayISO()}`;
  blocks.push(paragraphBlock(metaLine.slice(0, 1900)));
  blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "Transcript" } }] } });
  for (const p of paragraphize(meta.text)) {
    for (const chunk of chunkStr(p, 1900)) blocks.push(paragraphBlock(chunk));
  }
  return blocks;
}
async function notionFetch(token, url, method, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data && data.message ? data.message : `Notion API error ${res.status}`);
  return data;
}

ipcMain.handle("send-notion", async (_e, meta) => {
  const s = readSettings();
  if (!s.notionToken) return { ok: false, error: "No Notion token set — open Destinations and paste your integration token." };
  const parentId = extractNotionId(s.notionParentId);
  if (!parentId) return { ok: false, error: "Couldn't read a Notion page/database ID — paste the page or database link." };
  const title = (meta.title || "Transcript").slice(0, 2000);
  try {
    const blocks = transcriptBlocks(meta);
    let parent, properties;
    if ((s.notionParentType || "page") === "database") {
      const db = await notionFetch(s.notionToken, `https://api.notion.com/v1/databases/${parentId}`, "GET");
      const titleProp = Object.keys(db.properties || {}).find((k) => db.properties[k].type === "title") || "Name";
      parent = { database_id: parentId };
      properties = { [titleProp]: { title: [{ text: { content: title } }] } };
    } else {
      parent = { page_id: parentId };
      properties = { title: { title: [{ text: { content: title } }] } };
    }
    const page = await notionFetch(s.notionToken, "https://api.notion.com/v1/pages", "POST", {
      parent, properties, children: blocks.slice(0, 100),
    });
    for (let i = 100; i < blocks.length; i += 100) {
      await notionFetch(s.notionToken, `https://api.notion.com/v1/blocks/${page.id}/children`, "PATCH", {
        children: blocks.slice(i, i + 100),
      });
    }
    return { ok: true, url: page.url };
  } catch (err) {
    return { ok: false, error: err.message };
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
