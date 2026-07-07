#!/usr/bin/env python3
"""
worker.py - transcription engine for the Electron app.

Emits newline-delimited JSON to stdout so the UI can show progress:
  {"type":"status","msg":"..."}
  {"type":"progress","pct":42}
  {"type":"done","pdf":"/path/to/file.pdf","words":1234,"title":"..."}
  {"type":"error","msg":"..."}

Usage:
  python worker.py '<json-args>'
where json-args = {"url":"...","out":"...","whisperModel":"base","forceWhisper":false}
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


# --- Bundled tools -----------------------------------------------------------
# This file lives in the app's "python" resource dir. yt-dlp is invoked through
# the same interpreter that runs this worker (so it never depends on PATH), and
# ffmpeg ships as a static binary next to us in ./bin.
HERE = Path(__file__).resolve().parent
FFMPEG_DIR = HERE / "bin"
FFMPEG_BIN = FFMPEG_DIR / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")

# Run yt-dlp as a module of the bundled Python — guaranteed present, no PATH.
YTDLP = [sys.executable, "-m", "yt_dlp"]


def ffmpeg_args():
    """Tell yt-dlp where the bundled ffmpeg lives, when we shipped one."""
    return ["--ffmpeg-location", str(FFMPEG_DIR)] if FFMPEG_BIN.exists() else []


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def status(msg):
    emit({"type": "status", "msg": msg})


def progress(pct):
    emit({"type": "progress", "pct": int(pct)})


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def which(tool):
    return subprocess.run(["which", tool], capture_output=True).returncode == 0


def get_video_info(url):
    r = run(YTDLP + ["--no-warnings", "--print", "%(title)s\n%(id)s",
             "--skip-download", url])
    lines = r.stdout.strip().split("\n")
    return lines[0], lines[1]


def clean_filename(name):
    return re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '_')[:80] or "transcript"


def vtt_to_text(vtt_path):
    lines = Path(vtt_path).read_text(encoding="utf-8", errors="ignore").splitlines()
    out = []
    for line in lines:
        line = line.strip()
        if (not line or line == "WEBVTT" or "-->" in line
                or line.startswith(("Kind:", "Language:", "NOTE"))
                or line.isdigit()):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        line = re.sub(r"\[[^\]]*\]", "", line).strip()
        if line and (not out or out[-1] != line):
            out.append(line)
    return re.sub(r"\s+", " ", " ".join(out)).strip()


def try_captions(url, workdir):
    status("Checking for existing captions\u2026")
    try:
        run(YTDLP + ["--no-warnings", "--skip-download",
             "--write-subs", "--write-auto-subs",
             "--sub-langs", "en.*,en", "--sub-format", "vtt",
             "-o", str(Path(workdir) / "cap.%(ext)s"), url])
    except subprocess.CalledProcessError:
        return None
    vtts = list(Path(workdir).glob("*.vtt"))
    if not vtts:
        return None
    status(f"Found captions ({vtts[0].name}). No download needed.")
    return vtt_to_text(vtts[0])


def whisper_transcribe(url, workdir, model_name):
    status("No captions found. Downloading audio only\u2026")
    run(YTDLP + ["--no-warnings", "-f", "bestaudio/best",
         "-x", "--audio-format", "m4a"] + ffmpeg_args() +
         ["-o", str(Path(workdir) / "audio.%(ext)s"), url])
    audio_files = list(Path(workdir).glob("audio.*"))
    if not audio_files:
        raise RuntimeError("Audio download failed.")
    audio = str(audio_files[0])

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper is not installed. Re-run setup.")

    status(f"Transcribing with Whisper ({model_name})\u2026 first run downloads the model.")
    m = WhisperModel(model_name, device="auto", compute_type="int8")
    segments, info = m.transcribe(audio, vad_filter=True)
    total = getattr(info, "duration", 0) or 0
    parts = []
    for seg in segments:
        parts.append(seg.text.strip())
        if total:
            progress(min(99, seg.end / total * 100))
    return " ".join(parts).strip()


def paragraphize(text, sentences_per_para=5):
    sentences = re.split(r'(?<=[.!?])\s+', text)
    paras, cur = [], []
    for s in sentences:
        cur.append(s)
        if len(cur) >= sentences_per_para:
            paras.append(" ".join(cur)); cur = []
    if cur:
        paras.append(" ".join(cur))
    return paras


def make_pdf(title, url, paragraphs, out_path):
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph
    from reportlab.lib.enums import TA_JUSTIFY

    doc = SimpleDocTemplate(str(out_path), pagesize=letter,
                            topMargin=0.9*inch, bottomMargin=0.9*inch,
                            leftMargin=1*inch, rightMargin=1*inch, title=title)
    styles = getSampleStyleSheet()
    h = ParagraphStyle("H", parent=styles["Title"], fontSize=18, leading=22, spaceAfter=6)
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9,
                         textColor="#666666", spaceAfter=18)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11,
                          leading=16, alignment=TA_JUSTIFY, spaceAfter=10)

    def esc(t):
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    story = [Paragraph(esc(title), h), Paragraph(f"Source: {esc(url)}", sub)]
    for p in paragraphs:
        if p.strip():
            story.append(Paragraph(esc(p), body))
    doc.build(story)


def main():
    try:
        args = json.loads(sys.argv[1])
    except Exception:
        emit({"type": "error", "msg": "Bad arguments passed to worker."})
        sys.exit(1)

    url = args["url"]
    out_dir = Path(os.path.expanduser(args.get("out") or "."))
    model = args.get("whisperModel", "base")
    force = args.get("forceWhisper", False)

    try:
        import yt_dlp  # noqa: F401  (bundled with the runtime)
    except ImportError:
        emit({"type": "error", "msg": "The bundled Python runtime is missing yt-dlp. Re-run setup."})
        sys.exit(1)
    if not FFMPEG_BIN.exists() and not which("ffmpeg"):
        emit({"type": "error", "msg": "ffmpeg was not found (bundled copy missing and none on PATH)."})
        sys.exit(1)

    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        status("Reading video info\u2026")
        title, vid = get_video_info(url)
        status(f"Title: {title}")

        with tempfile.TemporaryDirectory() as workdir:
            text = None
            if not force:
                text = try_captions(url, workdir)
            if not text:
                text = whisper_transcribe(url, workdir, model)

        if not text or len(text) < 10:
            emit({"type": "error", "msg": "Got an empty transcript. Try Force Whisper or a larger model."})
            sys.exit(1)

        words = len(text.split())
        status(f"Transcript ready ({words:,} words). Building PDF\u2026")
        paragraphs = paragraphize(text)
        out_file = out_dir / f"{clean_filename(title)}_transcript.pdf"
        make_pdf(title, url, paragraphs, out_file)
        progress(100)
        emit({"type": "done", "pdf": str(out_file), "words": words, "title": title, "text": text})
    except subprocess.CalledProcessError as e:
        emit({"type": "error", "msg": (e.stderr or str(e)).strip()[:400]})
        sys.exit(1)
    except Exception as e:
        emit({"type": "error", "msg": str(e)[:400]})
        sys.exit(1)


if __name__ == "__main__":
    main()
