#!/usr/bin/env bash
#
# build-runtime.sh — assemble the self-contained Python runtime that ships
# inside the app, so a downloaded build "just works" with no Python, no pip,
# and no ffmpeg installed on the user's machine.
#
# It downloads:
#   1. A relocatable CPython (astral-sh/python-build-standalone) -> python/runtime
#   2. A static ffmpeg binary (eugeneware/ffmpeg-static)         -> python/bin/ffmpeg
# then installs python/requirements.txt into that runtime.
#
# macOS Apple Silicon (arm64) only. Re-run any time to rebuild from scratch.
set -euo pipefail
cd "$(dirname "$0")/.."

PY_TAG="20260623"
PY_VER="3.11.15"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/cpython-${PY_VER}%2B${PY_TAG}-aarch64-apple-darwin-install_only.tar.gz"
FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64"

ARCH="$(uname -m)"
if [[ "$(uname -s)" != "Darwin" || "$ARCH" != "arm64" ]]; then
  echo "!! This script targets macOS Apple Silicon (arm64). Detected: $(uname -s) $ARCH" >&2
  echo "   Swap PY_URL / FFMPEG_URL for your platform to build elsewhere." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "-- Downloading standalone Python ${PY_VER}..."
curl -fSL "$PY_URL" -o "$TMP/python.tar.gz"
rm -rf python/runtime
tar -xzf "$TMP/python.tar.gz" -C "$TMP"     # extracts to $TMP/python
mv "$TMP/python" python/runtime

echo "-- Downloading static ffmpeg..."
mkdir -p python/bin
curl -fSL "$FFMPEG_URL" -o python/bin/ffmpeg
chmod +x python/bin/ffmpeg

echo "-- Installing Python requirements into the runtime..."
python/runtime/bin/python3 -m pip install --upgrade pip -q
python/runtime/bin/python3 -m pip install -r python/requirements.txt

echo "-- Verifying..."
python/runtime/bin/python3 -c "import reportlab, yt_dlp; from faster_whisper import WhisperModel; print('   runtime OK')"
python/bin/ffmpeg -version | head -1

echo "Runtime ready: python/runtime + python/bin/ffmpeg"
