<div align="center">

<img src="assets/icon_1024.png" width="128" alt="YT Transcribe icon" />

# YT Transcribe

**Paste a YouTube link → get a clean PDF transcript.**
Runs 100% locally. No API key, no account, no sign-up.

[![Download for macOS](https://img.shields.io/badge/Download-macOS%20Apple%20Silicon-ffb627?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/sonicstarz/yt-transcribe-app/releases/latest/download/YT-Transcribe-macOS-arm64.dmg)

<sub>macOS 12+ · Apple Silicon (M1/M2/M3/M4) · ~207 MB</sub>

</div>

---

## Download & install (macOS)

1. **[Download the .dmg](https://github.com/sonicstarz/yt-transcribe-app/releases/latest)** from the latest release.
2. Open it and drag **YT Transcribe** into **Applications**.
3. **First launch:** because the app isn't signed with a paid Apple Developer
   certificate, macOS will warn that it "can't verify the developer." This is
   expected. To open it:
   - **Right-click** the app → **Open** → **Open** again, **or**
   - run this once in Terminal:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/YT Transcribe.app"
     ```

That's it — no Python, no ffmpeg, nothing else to install. Everything the app
needs is bundled inside it.

## How to use

1. Paste a YouTube URL.
2. (Optional) pick an output folder — defaults to your Desktop.
3. Hit **Transcribe → PDF**. When it's done, use **Open PDF**, **Show in folder**,
   or **Copy text** to drop the whole transcript on your clipboard.

The footer has a **Check for updates** button (pings this repo's latest release)
and a ☕ **Buy me a coffee** link if it saved you some time.

- **Captions first:** if the video has captions, you get a transcript instantly
  with no download.
- **Whisper fallback:** no captions? It downloads the audio and transcribes
  locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). The
  **first** Whisper run downloads the model once (~150 MB), then caches it.
- **Force Whisper** skips captions and always transcribes the audio.
- **Model** (tiny → large-v3) only matters when Whisper runs. Bigger = slower,
  more accurate.

## What's inside

A thin Electron UI drives a bundled Python worker. The app ships a fully
self-contained Python runtime + a static `ffmpeg`, so it works on a clean Mac
with nothing installed.

```
src/main.js         Electron main — spawns the Python worker, relays JSON events
src/preload.js      Safe contextIsolation bridge (window.api)
src/index.html      UI
src/renderer.js     UI logic — sends the job, renders progress + result
python/worker.py    The engine — captions/Whisper + PDF, emits JSON progress
python/runtime/     Bundled relocatable CPython + libs   (built, not committed)
python/bin/ffmpeg   Bundled static ffmpeg                 (built, not committed)
```

## Build it yourself

Requires **Node 18+** on macOS Apple Silicon. The heavy runtime is *not* in the
repo — a script fetches and assembles it.

```bash
git clone https://github.com/sonicstarz/yt-transcribe-app.git
cd yt-transcribe-app
./setup.sh          # builds python/runtime + ffmpeg, installs Electron
npm start           # run from source
npm run dist:mac    # produce dist/YT Transcribe-<ver>-arm64.dmg
```

- `npm run build:runtime` — (re)build just the bundled Python runtime + ffmpeg.
- `npm run dist:mac` — build the `.dmg` (handles the unsigned build + macOS
  `python` shim automatically; see `scripts/make-dmg.sh`).

## Notes

- **Apple Silicon only** right now. The Whisper ML libraries don't have a
  practical universal/Intel build here.
- **Unsigned.** Signing away the Gatekeeper warning needs a paid Apple Developer
  ID ($99/yr). The one-time steps above are the workaround until then.
- If YouTube changes something and downloads break, bump `yt-dlp`:
  `python/runtime/bin/python3 -m pip install -U yt-dlp` (or rebuild the runtime).

## License

[MIT](LICENSE) © 2026 Caleb Arzie
