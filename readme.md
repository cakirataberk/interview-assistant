# Interview Assistant

AI-powered real-time interview copilot for macOS. Listens to your interview audio, transcribes it with Whisper, and generates ready-to-speak answers using Google Gemini — all in real time.

## Features

- **Real-time transcription** — OpenAI Whisper `small` model, runs locally
- **AI suggestions** — Google Gemini 2.5 Flash, answers in seconds
- **Meeting audio capture** — BlackHole 2ch support for Zoom, Google Meet, Teams
- **Teleprompter overlay** — always-on-top floating window to read answers
- **Turkish & English** — transcription and answer language selectable separately
- **CV + Job Description context** — AI answers tailored to your background and the role
- **Adjustable opacity** — blend the window into your screen

## Download

Go to [Releases](https://github.com/cakirataberk/interview-assistant/releases) and download the latest `.dmg`.

### Install

1. Open the `.dmg` file
2. Drag **Interview Assistant.app** to the **Applications** folder
3. Right-click the app → **Open** (required on first launch due to macOS Gatekeeper)
4. Grant microphone permission when prompted
5. On first launch the app installs its Python environment — wait ~1 minute

> If right-click → Open doesn't work, open Terminal and run:
> ```bash
> xattr -cr "/Applications/Interview Assistant.app" && open "/Applications/Interview Assistant.app"
> ```

## Setup

1. Get a free [Gemini API key](https://aistudio.google.com/app/apikey)
2. Open the **Setup** tab and paste your key
3. Select your input device (microphone or BlackHole 2ch for meeting audio)
4. Paste your CV and the job description
5. Hit **Save All**

### Capturing Meeting Audio (Zoom / Meet / Teams)

The app can transcribe what the interviewer says by routing system audio through BlackHole 2ch:

1. In Setup → Meeting Audio, click **Install BlackHole 2ch**
2. Restart your Mac
3. Open **Audio MIDI Setup** → create a **Multi-Output Device** with your speakers + BlackHole 2ch
4. Set system output to the Multi-Output Device
5. Select **BlackHole 2ch** as the Input Device in Setup

## Development

### Requirements

- macOS (Apple Silicon)
- Node.js 20+
- Python 3.11 (`brew install python@3.11`)
- Homebrew

### Run in dev mode

```bash
git clone https://github.com/cakirataberk/interview-assistant.git
cd interview-assistant
cd app && npm install
bash ../start-dev.sh
```

### Build distributable DMG

```bash
cd app
npm run electron:build
# Output: dist/Interview Assistant-x.x.x-arm64.dmg
```

### Project structure

```
interview-assistant/
├── app/                    # Electron + React frontend
│   ├── electron/           # Electron main process & preload
│   ├── src/                # React app (TypeScript + Tailwind)
│   │   ├── components/     # MainPanel, SetupPanel, TeleprompterOverlay
│   │   ├── hooks/          # useBackendWS (WebSocket)
│   │   └── lib/            # API helpers
│   └── build/              # DMG build scripts
├── backend/                # Python FastAPI server (port 7432)
│   ├── server.py           # HTTP + WebSocket endpoints
│   ├── audio.py            # PyAudio + Whisper transcription
│   ├── ai.py               # Gemini API
│   ├── config.py           # Config file management
│   └── setup_env.py        # First-run venv setup
└── start-dev.sh            # Dev mode launcher
```

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron 41 |
| Frontend | React 19, TypeScript, Tailwind CSS 4 |
| Backend | Python FastAPI, WebSocket |
| Transcription | OpenAI Whisper (local) |
| AI | Google Gemini 2.5 Flash |
| Audio capture | PyAudio, SpeechRecognition, BlackHole 2ch |
| Build | electron-builder, Vite 8 |

## License

MIT
