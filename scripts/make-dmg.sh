#!/usr/bin/env bash
#
# make-dmg.sh — build the distributable .dmg (and .zip) into dist/.
#
# Ensures the bundled runtime exists, then runs electron-builder. Two macOS
# quirks are handled here so the build is one command:
#   * electron-builder's DMG step shells out to a bare `python`, which no longer
#     exists on modern macOS — we put a shim (pointing at the bundled runtime)
#     on PATH just for the build.
#   * We build UNSIGNED (identity:null in package.json). Downloaders clear the
#     Gatekeeper quarantine once; see the README.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -x "python/runtime/bin/python3" ]]; then
  echo "-- Runtime missing; building it first..."
  bash scripts/build-runtime.sh
fi

SHIM="$(mktemp -d)"
trap 'rm -rf "$SHIM"' EXIT
printf '#!/bin/sh\nexec "%s/python/runtime/bin/python3" "$@"\n' "$(pwd)" > "$SHIM/python"
chmod +x "$SHIM/python"

echo "-- Building .dmg with electron-builder (unsigned)..."
PATH="$SHIM:$PATH" CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac

echo "Done. Artifacts in dist/:"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true
