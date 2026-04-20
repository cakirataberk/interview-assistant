# backend.legacy

This directory contains the original **Python FastAPI backend** that powered Interview Assistant v1.x.

It was retired in branch `feat/whisper-cpp-migration` (PR forthcoming) when the app was rewritten to be standalone — no Python, no Homebrew, no pip — using `whisper.cpp` (native binary) and a Node.js HTTP/WS server running directly inside the Electron main process.

## What lives here (archived for reference / easy revert)

| File | Original purpose |
|---|---|
| `server.py` | FastAPI app on `127.0.0.1:7432` — all HTTP routes + WebSocket |
| `audio.py` | PyAudio capture + RMS VAD + openai-whisper transcription |
| `ai.py` | SSE proxy to `basvur.ai/api/interview/suggest` |
| `config.py` | `~/.interview_assistant/config.json` read/write |
| `setup_env.py` | First-run venv + pip install bootstrapper |
| `assistant.py` | Pre-v2 standalone Tkinter GUI (already legacy by v2) |
| `Interview Assistant.spec` | PyInstaller bundle config (never shipped) |
| `setup.py` | py2app bundle config (never shipped) |
| `requirements.txt` | Python deps the user's machine had to install |

## Why we ditched it

- Required Homebrew Python 3.11 on the user's machine
- First-run pip install was a frequent failure point (PortAudio compile, network, pip version)
- ~30 sec startup on cold setup
- Felt unprofessional ("uncertified script bundle" feel)
- Two-runtime maintenance overhead (Python AND Node)

## The Node replacement

Equivalent code now lives in [`app/electron/server/`](../app/electron/server/):

| Python | Node equivalent |
|---|---|
| `server.py` | `app/electron/server/index.js` + `routes/*.js` |
| `audio.py` | `app/electron/server/lib/audio.js` + `vad.js` + `whisper.js` |
| `ai.py` | `app/electron/server/lib/sseProxy.js` + `routes/suggest.js` |
| `config.py` | `app/electron/server/lib/config.js` |
| `setup_env.py` | **Deleted — no first-run setup needed** |

## Reverting

If something goes catastrophically wrong with the Node backend and you need to rollback fast:

```bash
git revert <merge-commit-sha>           # if migration was already merged
# or
git checkout main -- backend/ ...        # if still on the migration branch
```

The Node code is fully isolated under `app/electron/server/`, so reverting it doesn't touch `app/electron/main.cjs` deep-link / window logic — those changes stay.

**Do not import or run any file in this directory.** It exists purely for historical reference and emergency rollback. Once the Node migration is proven stable in production for ≥1 month, this directory can be deleted entirely (the git history will still preserve it).
