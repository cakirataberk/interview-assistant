"""
Local config for the Interview Assistant desktop app.

All AI prompts, CV, and JD now live on the basvur.ai server. This config only
holds device-level preferences and the long-lived device token.
"""
import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".interview_assistant"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_API_BASE = "https://basvur-ai.vercel.app"

DEFAULT_CONFIG = {
    "window_alpha": 0.96,
    "microphone_device_index": 0,
    "transcription_mode": "TR + ENG (Mixed)",
    "device_token": "",
    "api_base": DEFAULT_API_BASE,
    "locale": "tr",
}


def load_config() -> dict:
    try:
        if CONFIG_FILE.exists():
            saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            config = dict(DEFAULT_CONFIG)
            config.update(saved)
            return config
    except Exception as err:
        print(f"Config load error: {err}")
    return dict(DEFAULT_CONFIG)


def save_config(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    current = load_config()
    current.update(data)
    CONFIG_FILE.write_text(
        json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def clear_token() -> None:
    save_config({"device_token": ""})
