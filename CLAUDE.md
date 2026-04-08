# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A real-time interview copilot for macOS. Listens to interview audio via microphone (or BlackHole virtual audio), transcribes with OpenAI Whisper locally, and generates suggested answers using Google Gemini. Ships as an Electron + React desktop app with a Python FastAPI backend.

## Architecture

Two separate codebases communicate over HTTP/WebSocket on `localhost:7432`:

**Python Backend** (`backend/`)
- `server.py` — FastAPI server (uvicorn on port 7432). REST endpoints + WebSocket for real-time transcription streaming. Manages audio capture threads, conversation history (last 5 Q&A pairs), and recording.
- `audio.py` — Whisper model loading (with SHA256 checksum patching), PCM/WAV transcription, microphone device enumeration via PyAudio. Models cached in `~/.cache/whisper/`.
- `ai.py` — Google Gemini integration. Tries models in order: `gemini-2.5-flash` > `gemini-2.0-flash` > `gemini-2.0-flash-lite` > `gemini-flash-latest`. Both streaming and non-streaming generation.
- `config.py` — JSON config stored at `~/.interview_assistant/config.json`. Merges saved values over defaults.
- `setup_env.py` — First-run bootstrap: creates a venv at `~/.interview_assistant/venv`, installs all Python deps. Called by Electron on first launch.

**Electron + React Frontend** (`app/`)
- `electron/main.cjs` — Electron main process. Spawns the Python backend, manages first-run setup, BlackHole audio driver installation, IPC for window opacity/always-on-top.
- `electron/preload.cjs` — Context bridge exposing `electronAPI` to renderer.
- `src/App.tsx` — Root component with tab switching (Assistant/Setup) and config state.
- `src/components/MainPanel.tsx` — Main UI: transcription display, AI suggestion panel, teleprompter mode, keyboard shortcuts.
- `src/components/SetupPanel.tsx` — Configuration: API key, microphone selection, prompt templates, CV/JD.
- `src/components/TeleprompterOverlay.tsx` — Translucent always-on-top overlay for reading suggestions.
- `src/hooks/useBackendWS.ts` — WebSocket hook for real-time transcription/suggestion events.
- `src/lib/api.ts` — HTTP client for backend REST endpoints (base URL `http://127.0.0.1:7432`).

**Legacy Python-only app** (`assistant.py`) — Original tkinter version, kept at root but superseded by the Electron app.

## Communication Flow

1. Frontend calls `POST /listen/start` to begin streaming audio capture
2. Backend opens PyAudio stream, detects speech via energy threshold (RMS > 300)
3. Partial transcriptions sent over WebSocket (`type: "partial"`) every ~1.5s of speech
4. Final transcription sent (`type: "transcription"`) after ~0.55s of silence
5. User triggers suggestion via `POST /suggest/stream` (SSE) or WebSocket `cmd: suggest`
6. Gemini response streams back as chunks

## Development Commands

```bash
# Backend (Python 3.11 required)
cd backend
python -m venv ../.venv && source ../.venv/bin/activate
pip install fastapi "uvicorn[standard]" google-genai SpeechRecognition openai-whisper soundfile pyaudio
python server.py                    # Runs on http://127.0.0.1:7432

# Frontend
cd app
npm install
npm run dev                         # Vite dev server on http://localhost:5173
npm run electron:dev                # Vite + Electron together (use this for full app dev)

# Build & package
cd app
npm run electron:build              # Vite build + electron-builder + create-dmg.sh

# Lint
cd app
npx eslint .

# Type check
cd app
npx tsc -b
```

## Key Details

- **Python 3.11** is required (hardcoded paths in `setup_env.py` and `electron/main.cjs` look for `python3.11` via Homebrew)
- **BlackHole 2ch** virtual audio driver is needed to capture system audio (not just mic). The app can install it via Homebrew cask + `osascript` privilege escalation.
- **Whisper checksum patching**: `audio.py` monkey-patches `whisper._download` to skip SHA256 verification when the env var `WHISPER_SKIP_CHECKSUM=1` is set (default). This works around stale hashes in older whisper releases.
- Transcription profiles: English (`base.en`), Turkish (`small`), Mixed TR+EN (`small`, no language hint)
- User config persists at `~/.interview_assistant/config.json`; venv at `~/.interview_assistant/venv`
- Frontend uses **Tailwind CSS v4** (via `@tailwindcss/vite` plugin), **React 19**, **Vite 8**
- Electron main process is CommonJS (`.cjs` files), frontend is ESM
- CI: GitHub Actions builds macOS ARM64 DMG on tag push (`v*`) — see `.github/workflows/build.yml`
- Keyboard shortcuts in MainPanel: `Cmd+L` toggle listening, `Cmd+Enter` get suggestion, `Cmd+Backspace` clear
