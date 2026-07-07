const $ = (id) => document.getElementById(id);
const urlEl = $("url"), goEl = $("go"), msgEl = $("msg");
const statusEl = $("status"), barEl = $("bar"), barFill = $("barFill");
const resultEl = $("result"), outPathEl = $("outPath");
let chosenFolder = null;
let lastPdf = null;
let lastText = null;
let lastMeta = null;
let startedUrl = null;
let running = false;
const VENMO_URL = "https://venmo.com/u/Caleb-Arzie";
const sendRow = $("sendRow"), sendMsg = $("sendMsg");

$("pick").addEventListener("click", async () => {
  const f = await window.api.pickFolder();
  if (f) { chosenFolder = f; outPathEl.textContent = f; }
});

function setIndeterminate(on) {
  if (on) barEl.classList.add("indet"); else barEl.classList.remove("indet");
}
function setProgress(pct) {
  setIndeterminate(false);
  barFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function start() {
  if (running) return;
  lastText = null;
  const url = urlEl.value.trim();
  if (!/youtu\.?be/i.test(url)) {
    statusEl.classList.add("show");
    resultEl.classList.remove("show");
    msgEl.innerHTML = '<span class="err-line">That doesn\'t look like a YouTube link.</span>';
    setProgress(0);
    return;
  }
  running = true;
  startedUrl = url;
  lastMeta = null;
  sendRow.classList.remove("show");
  sendMsg.textContent = "";
  lastPdf = null;
  goEl.disabled = true;
  goEl.textContent = "Working…";
  statusEl.classList.add("show");
  resultEl.classList.remove("show");
  msgEl.textContent = "Starting…";
  setIndeterminate(true);

  window.api.transcribe({
    url,
    out: chosenFolder || "~/Desktop",
    whisperModel: $("model").value,
    forceWhisper: $("force").checked,
  });
}

function finish() {
  running = false;
  goEl.disabled = false;
  goEl.textContent = "Transcribe → PDF";
}

goEl.addEventListener("click", start);
urlEl.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });

$("openPdf").addEventListener("click", () => { if (lastPdf) window.api.openFile(lastPdf); });
$("reveal").addEventListener("click", () => { if (lastPdf) window.api.revealInFolder(lastPdf); });

const copyBtn = $("copyText");
copyBtn.addEventListener("click", async () => {
  if (!lastText) return;
  await window.api.copyText(lastText);
  const prev = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  copyBtn.disabled = true;
  setTimeout(() => { copyBtn.textContent = prev; copyBtn.disabled = false; }, 1400);
});

$("coffee").addEventListener("click", () => window.api.openExternal(VENMO_URL));

const updateBtn = $("checkUpdate"), updateMsg = $("updateMsg");
updateBtn.addEventListener("click", async () => {
  updateBtn.disabled = true;
  updateMsg.textContent = "Checking…";
  const r = await window.api.checkUpdate();
  if (r.error) {
    updateMsg.innerHTML = `<span class="err-line">Couldn't check for updates.</span>`;
  } else if (r.updateAvailable) {
    updateMsg.innerHTML = `Update available: <b>v${escapeHtml(r.latest)}</b> — <a id="dl">Download</a>`;
    $("dl").addEventListener("click", () => window.api.openExternal(r.url));
  } else {
    updateMsg.innerHTML = `<span class="ok">You're up to date (v${escapeHtml(r.current)}).</span>`;
  }
  updateBtn.disabled = false;
});

// Show the running version in the footer on load.
window.api.appVersion().then((v) => { $("version").textContent = "v" + v; });

window.api.onEvent((data) => {
  switch (data.type) {
    case "status":
      msgEl.textContent = data.msg;
      break;
    case "progress":
      setProgress(data.pct);
      break;
    case "done":
      setProgress(100);
      lastPdf = data.pdf;
      lastText = data.text || null;
      lastMeta = { url: startedUrl, title: data.title, words: data.words, text: data.text || "" };
      msgEl.innerHTML = `<div class="done-line">Done — ${data.words.toLocaleString()} words</div>`;
      resultEl.classList.add("show");
      sendRow.classList.add("show");
      finish();
      break;
    case "error":
      setIndeterminate(false);
      setProgress(0);
      msgEl.innerHTML = `<span class="err-line">Error: ${escapeHtml(data.msg)}</span>`;
      finish();
      break;
    case "closed":
      if (running) {
        msgEl.innerHTML = `<span class="err-line">Process exited unexpectedly (code ${data.code}).</span>`;
        finish();
      }
      break;
    case "log":
      // quiet; useful for debugging only
      break;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// --- Destinations (Obsidian + Notion) -------------------------------------
const modal = $("settingsModal");
let vaultSel = null;

async function openSettings() {
  const s = await window.api.getSettings();
  vaultSel = s.obsidianVault || null;
  $("vaultPath").textContent = s.obsidianVault || "Not set";
  $("vaultSub").value = s.obsidianSubfolder || "";
  $("notionToken").value = s.notionToken || "";
  $("notionType").value = s.notionParentType || "page";
  $("notionParent").value = s.notionParentId || "";
  modal.classList.add("show");
}
$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", () => modal.classList.remove("show"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("show"); });
$("notionHelp").addEventListener("click", () => window.api.openExternal("https://www.notion.so/my-integrations"));

$("pickVault").addEventListener("click", async () => {
  const f = await window.api.pickFolder();
  if (f) { vaultSel = f; $("vaultPath").textContent = f; }
});
$("saveSettings").addEventListener("click", async () => {
  await window.api.saveSettings({
    obsidianVault: vaultSel,
    obsidianSubfolder: $("vaultSub").value.trim(),
    notionToken: $("notionToken").value.trim(),
    notionParentType: $("notionType").value,
    notionParentId: $("notionParent").value.trim(),
  });
  modal.classList.remove("show");
});

async function doSend(dest) {
  if (!lastMeta) return;
  const btn = dest === "obsidian" ? $("toObsidian") : $("toNotion");
  const name = dest === "obsidian" ? "Obsidian" : "Notion";
  btn.disabled = true;
  sendMsg.innerHTML = `Sending to ${name}…`;
  const r = dest === "obsidian"
    ? await window.api.sendObsidian(lastMeta)
    : await window.api.sendNotion(lastMeta);
  btn.disabled = false;
  if (!r || !r.ok) {
    sendMsg.innerHTML = `<span class="err-line">${escapeHtml((r && r.error) || "Send failed.")}</span>`;
    return;
  }
  if (dest === "obsidian") {
    sendMsg.innerHTML = `<span class="ok">Saved to your vault.</span> <a id="openObs">Open in Obsidian</a>`;
    $("openObs").addEventListener("click", () => window.api.openObsidian(r.uri));
  } else {
    sendMsg.innerHTML = `<span class="ok">Added to Notion.</span> <a id="openNot">Open in Notion</a>`;
    $("openNot").addEventListener("click", () => window.api.openExternal(r.url));
  }
}
$("toObsidian").addEventListener("click", () => doSend("obsidian"));
$("toNotion").addEventListener("click", () => doSend("notion"));
