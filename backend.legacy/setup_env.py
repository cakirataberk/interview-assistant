"""
First-run setup: creates a persistent venv at ~/.interview_assistant/venv
and installs all required packages.
Called by Electron main process on first launch.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

VENV_DIR = Path.home() / ".interview_assistant" / "venv"
MARKER = Path.home() / ".interview_assistant" / ".setup_done"


def find_python311():
    candidates = [
        "/opt/homebrew/bin/python3.11",
        "/opt/homebrew/opt/python@3.11/bin/python3.11",
        "/usr/local/bin/python3.11",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    # Fallback: look for any python3.11
    try:
        result = subprocess.run(
            ["which", "python3.11"], capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return None


def setup(progress_callback=None):
    def report(msg):
        if progress_callback:
            progress_callback(msg)
        print(msg, flush=True)

    if MARKER.exists():
        report("ENV_READY")
        return True

    report("CHECKING_PYTHON")
    python = find_python311()
    if not python:
        report("ERROR: Python 3.11 not found. Install via: brew install python@3.11")
        return False

    report(f"CREATING_VENV:{VENV_DIR}")
    VENV_DIR.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [python, "-m", "venv", str(VENV_DIR)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        report(f"ERROR: Could not create venv: {result.stderr}")
        return False

    pip = str(VENV_DIR / "bin" / "pip")

    report("INSTALLING_PACKAGES")
    packages = [
        "fastapi",
        "uvicorn[standard]",
        "google-genai",
        "SpeechRecognition",
        "openai-whisper",
        "soundfile",
        "pyaudio",
    ]

    # Try to install portaudio first via brew if pip install fails
    env = os.environ.copy()
    env["CFLAGS"] = "-I/opt/homebrew/include"
    env["LDFLAGS"] = "-L/opt/homebrew/lib"

    for i, pkg in enumerate(packages):
        report(f"INSTALLING:{i+1}/{len(packages)}:{pkg}")
        result = subprocess.run(
            [pip, "install", "--quiet", pkg],
            capture_output=True, text=True, env=env
        )
        if result.returncode != 0:
            report(f"WARNING: {pkg} failed: {result.stderr[:100]}")

    MARKER.touch()
    report("SETUP_DONE")
    return True


if __name__ == "__main__":
    def cb(msg):
        print(json.dumps({"status": msg}), flush=True)
    success = setup(progress_callback=cb)
    sys.exit(0 if success else 1)
