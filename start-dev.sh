#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Start Electron + Vite (Electron manages Python backend internally)
echo "▶ Starting Electron app (Electron will start Python backend)..."
cd "$DIR/app"
NODE_ENV=development npx concurrently \
    "vite" \
    "npx wait-on http://localhost:5173 && electron ." \
    --kill-others-on-fail
