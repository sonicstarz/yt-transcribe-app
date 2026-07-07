#!/usr/bin/env bash
# One-time setup for running / building the app from source (macOS Apple Silicon).
# Builds the self-contained Python runtime the app calls into, then installs
# Electron. You do NOT need this just to use the app — grab the .dmg instead.
set -e
cd "$(dirname "$0")"

echo "== YT Transcribe setup =="

# 1) Self-contained Python runtime + static ffmpeg (bundled — nothing to install
#    system-wide; see scripts/build-runtime.sh).
echo "-- Building the bundled Python runtime..."
bash scripts/build-runtime.sh

# 2) Node / Electron deps.
echo "-- Installing Electron..."
npm install

echo ""
echo "Setup complete."
echo "  Run the app:      npm start"
echo "  Build the .dmg:   npm run dist:mac"
