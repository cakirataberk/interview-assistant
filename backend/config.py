import json
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".interview_assistant"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_CONFIG = {
    "api_key": "",
    "window_alpha": 0.96,
    "microphone_device_index": 0,
    "transcription_mode": "TR + ENG (Mixed)",
    "cv": "",
    "job_description": "",
    "system_prompt": """You are my real-time interview copilot. answering questions live — speed matters.

Language: Answer in Turkish. Use English for technical terms naturally.

Format:
- 4–6 sentences max. I need to read and speak this in seconds.
- No intro, no filler, no "Harika soru" or "Şöyle açıklayayım".
- Start with the answer. Lead with the strongest point.
- Bullet points ONLY if listing 3+ items side by side.
- Numbers and metrics first, explanation second.

Style:
- First person, natural spoken Turkish cadence.
- Confident but not arrogant.

For technical questions: If it's a concept/definition question ("X nedir", "Y'yi açıkla", "Z ne demek"), give a clean textbook-level explanation first.
For "what if" / challenge questions: Acknowledge the concern in one clause, then defend with data.

My background:
--- {cv} ---

Role and job description are all here — use this as the single source of truth for every answer:
--- {job_description} ---

Golden rule: If my answer can be shorter and still land the point, make it shorter.""",
    "user_prompt": 'Interviewer\'s question: "{transcribed_text}". Give me a ready-to-speak answer. Turkish with English technical terms.',
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
    CONFIG_FILE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")


def get_cv_and_jd() -> tuple[str, str]:
    config = load_config()
    cv = config.get("cv", "")
    jd = config.get("job_description", "")
    # fallback to .txt files if config is empty
    if not cv:
        try:
            cv = Path("cv.txt").read_text(encoding="utf-8")
        except FileNotFoundError:
            pass
    if not jd:
        try:
            jd = Path("job_description.txt").read_text(encoding="utf-8")
        except FileNotFoundError:
            pass
    return cv, jd
