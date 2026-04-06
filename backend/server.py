"""
Interview Assistant – FastAPI backend
Runs on http://localhost:7432
"""
import os
import queue
import threading
import time
import wave
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import speech_recognition as sr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from audio import (
    TRANSCRIPTION_PROFILES,
    list_microphone_devices,
    preload_whisper_small,
    transcribe_audio,
)
from config import load_config, save_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    import asyncio
    _main_loop = asyncio.get_event_loop()
    def _preload():
        preload_whisper_small(on_status=lambda msg: _broadcast_sync({"type": "status", "text": msg}))
    threading.Thread(target=_preload, daemon=True).start()
    yield


app = FastAPI(title="Interview Assistant API", lifespan=lifespan)

_main_loop = None  # set once the event loop starts

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── State ─────────────────────────────────────────────────────────────────────

_ws_clients: list[WebSocket] = []
_ws_lock = threading.Lock()

_recognizer = sr.Recognizer()
_recognizer.pause_threshold = 0.8
_recognizer.dynamic_energy_threshold = False
_recognizer.energy_threshold = 300

_stop_listening = None
_listening_lock = threading.Lock()

_transcription_queue: queue.Queue = queue.Queue()
_current_mode = "TR + ENG (Mixed)"
_current_device_index = 0

_is_recording = False
_recording_thread: Optional[threading.Thread] = None
_recording_file: Optional[str] = None
_recording_start: Optional[float] = None
_pyaudio_instance = None
_audio_stream = None

_conversation_history: list[tuple[str, str]] = []
_max_history = 5


# ── WebSocket broadcast ────────────────────────────────────────────────────────

async def _broadcast(payload: dict) -> None:
    dead = []
    with _ws_lock:
        clients = list(_ws_clients)
    for ws in clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    with _ws_lock:
        for ws in dead:
            if ws in _ws_clients:
                _ws_clients.remove(ws)


def _broadcast_sync(payload: dict) -> None:
    import asyncio
    loop = _main_loop
    if loop is None or not loop.is_running():
        return
    dead = []
    with _ws_lock:
        clients = list(_ws_clients)
    for ws in clients:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_json(payload), loop)
        except Exception:
            dead.append(ws)
    with _ws_lock:
        for ws in dead:
            if ws in _ws_clients:
                _ws_clients.remove(ws)


# ── Transcription worker ───────────────────────────────────────────────────────

def _transcription_worker():
    while True:
        item = _transcription_queue.get()
        if item is None:
            break
        audio, model_name, lang = item
        try:
            text = transcribe_audio(audio, model_name, lang)
            if text.strip():
                _broadcast_sync({"type": "transcription", "text": text})
            else:
                _broadcast_sync({"type": "status", "text": "silence"})
        except Exception as err:
            _broadcast_sync({"type": "status", "text": f"transcription error: {err}"})


threading.Thread(target=_transcription_worker, daemon=True).start()


def _audio_callback(recognizer, audio):
    print(f"[audio] callback fired, {len(audio.frame_data)} bytes, threshold={recognizer.energy_threshold:.0f}", flush=True)
    mode = _current_mode
    if mode not in TRANSCRIPTION_PROFILES:
        mode = "TR + ENG (Mixed)"
    model_name, lang = TRANSCRIPTION_PROFILES[mode]
    _transcription_queue.put((audio, model_name, lang))
    _broadcast_sync({"type": "status", "text": "transcribing…"})


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/config")
def get_config():
    config = load_config()
    saved_idx = config.get("microphone_device_index", 0)
    devices = list_microphone_devices()
    if not devices:
        return config
    # If saved device is not a valid input, auto-select best device:
    # Priority: BlackHole > first virtual/loopback > first input device
    if not any(d["index"] == saved_idx for d in devices):
        preferred = _pick_preferred_device(devices)
        config["microphone_device_index"] = preferred
    return config


def _pick_preferred_device(devices: list[dict]) -> int:
    for d in devices:
        if "blackhole" in d["name"].lower():
            return d["index"]
    for d in devices:
        n = d["name"].lower()
        if any(k in n for k in ("virtual", "loopback", "multi")):
            return d["index"]
    return devices[0]["index"]


@app.post("/config")
def post_config(data: dict):
    save_config(data)
    return {"ok": True}


@app.get("/devices")
def get_devices():
    return list_microphone_devices()


@app.post("/suggest")
def suggest(body: dict):
    from ai import get_ai_suggestion

    question: str = body.get("question", "").strip()
    api_key: str = body.get("api_key", "").strip()
    cv: str = body.get("cv", "")
    jd: str = body.get("job_description", "")
    system_prompt_template: str = body.get("system_prompt", "")
    user_prompt_template: str = body.get("user_prompt", '"{transcribed_text}"')
    use_history: bool = body.get("use_history", True)

    if not question:
        return {"error": "question is empty"}
    if not api_key:
        return {"error": "api_key is required"}

    try:
        final_system = system_prompt_template.format(cv=cv, job_description=jd)
        final_user = user_prompt_template.format(transcribed_text=question)
    except KeyError as e:
        return {"error": f"Template placeholder missing: {e}"}

    history = _conversation_history if use_history else None
    result = get_ai_suggestion(final_user, final_system, api_key, history)

    _conversation_history.append((question, result))
    if len(_conversation_history) > _max_history:
        _conversation_history.pop(0)

    return {"suggestion": result, "history_count": len(_conversation_history)}


@app.post("/history/clear")
def clear_history():
    _conversation_history.clear()
    return {"ok": True}


@app.post("/listen/start")
def start_listening(body: dict):
    global _stop_listening, _current_mode, _current_device_index

    device_index = int(body.get("device_index", 0))
    mode = body.get("transcription_mode", "TR + ENG (Mixed)")
    _current_mode = mode
    _current_device_index = device_index

    with _listening_lock:
        if _stop_listening is not None:
            _stop_listening(wait_for_stop=False)
            _stop_listening = None
        try:
            # Calibrate ambient noise (best-effort — skip on output-only devices)
            try:
                cal_src = sr.Microphone(device_index=device_index)
                with cal_src as s:
                    if s is not None:
                        _recognizer.adjust_for_ambient_noise(s, duration=0.5)
                        _recognizer.energy_threshold = max(150, int(_recognizer.energy_threshold * 0.7))
            except Exception:
                pass  # Calibration failed — proceed with default energy threshold

            mic = sr.Microphone(device_index=device_index)
            _stop_listening = _recognizer.listen_in_background(mic, _audio_callback, phrase_time_limit=20)
            return {"ok": True}
        except Exception as err:
            return {"error": str(err)}


@app.post("/listen/stop")
def stop_listening():
    global _stop_listening
    with _listening_lock:
        if _stop_listening:
            _stop_listening(wait_for_stop=False)
            _stop_listening = None
    return {"ok": True}


@app.post("/record/start")
def start_recording(body: dict):
    global _is_recording, _recording_thread, _recording_file, _recording_start
    global _pyaudio_instance, _audio_stream

    import pyaudio

    if _is_recording:
        return {"error": "already recording"}

    device_index = int(body.get("device_index", 0))
    recordings_dir = Path.home() / ".interview_assistant" / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    _recording_file = str(recordings_dir / f"recording_{timestamp}.wav")

    try:
        _pyaudio_instance = pyaudio.PyAudio()
        _audio_stream = _pyaudio_instance.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=44100,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=1024,
        )
        _is_recording = True
        _recording_start = time.time()
        _recording_thread = threading.Thread(target=_record_audio_loop, daemon=True)
        _recording_thread.start()
        return {"ok": True, "file": _recording_file}
    except Exception as err:
        return {"error": str(err)}


@app.post("/record/stop")
def stop_recording():
    global _is_recording, _recording_start
    _is_recording = False
    if _recording_thread:
        _recording_thread.join(timeout=2)
    _recording_start = None
    return {"ok": True, "file": _recording_file}


def _record_audio_loop():
    global _pyaudio_instance, _audio_stream
    frames = []
    try:
        while _is_recording and _audio_stream:
            data = _audio_stream.read(1024, exception_on_overflow=False)
            frames.append(data)
    finally:
        if frames and _recording_file:
            try:
                wf = wave.open(_recording_file, "wb")
                wf.setnchannels(1)
                if _pyaudio_instance:
                    import pyaudio
                    wf.setsampwidth(_pyaudio_instance.get_sample_size(pyaudio.paInt16))
                else:
                    wf.setsampwidth(2)
                wf.setframerate(44100)
                wf.writeframes(b"".join(frames))
                wf.close()
            except Exception as err:
                print(f"Save recording error: {err}")
        if _audio_stream:
            try:
                _audio_stream.stop_stream()
                _audio_stream.close()
            except Exception:
                pass
        if _pyaudio_instance:
            try:
                _pyaudio_instance.terminate()
            except Exception:
                pass
        _pyaudio_instance = None
        _audio_stream = None


# ── WebSocket ──────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    with _ws_lock:
        _ws_clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("cmd") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        with _ws_lock:
            if websocket in _ws_clients:
                _ws_clients.remove(websocket)



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7432, log_level="warning")
