const $ = (id) => document.getElementById(id);
const urlEl = $("url"), goEl = $("go"), msgEl = $("msg");
const statusEl = $("status"), barEl = $("bar"), barFill = $("barFill");
const resultEl = $("result"), outPathEl = $("outPath");
let chosenFolder = null;
let lastPdf = null;
let running = false;

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
  const url = urlEl.value.trim();
  if (!/youtu\.?be/i.test(url)) {
    statusEl.classList.add("show");
    resultEl.classList.remove("show");
    msgEl.innerHTML = '<span class="err-line">That doesn\'t look like a YouTube link.</span>';
    setProgress(0);
    return;
  }
  running = true;
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
      msgEl.innerHTML = `<div class="done-line">Done — ${data.words.toLocaleString()} words</div>`;
      resultEl.classList.add("show");
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
