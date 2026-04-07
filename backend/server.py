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
    transcribe_pcm,
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

_stop_event: Optional[threading.Event] = None
_stream_thread: Optional[threading.Thread] = None
_listening_lock = threading.Lock()

_current_mode = "TR + ENG (Mixed)"
_current_device_index = 0

# ── Streaming constants ────────────────────────────────────────────────────────
SAMPLE_RATE   = 16000
CHUNK_FRAMES  = 512                                   # ~32 ms per chunk
ENERGY_THRESH = 300                                   # RMS silence threshold
# after this many speech chunks, fire a partial transcription
PARTIAL_CHUNKS = int(1.5 * SAMPLE_RATE / CHUNK_FRAMES)   # ~1.5 s
# this many silent chunks = end of phrase
SILENCE_END_CHUNKS = int(0.55 * SAMPLE_RATE / CHUNK_FRAMES)  # ~0.55 s

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


# ── Streaming audio worker ────────────────────────────────────────────────────

def _do_transcribe(pcm: bytes, model_name: str, lang, is_final: bool):
    """Run in a thread — transcribe PCM and broadcast result."""
    try:
        text = transcribe_pcm(pcm, SAMPLE_RATE, model_name, lang)
        if text.strip():
            msg_type = "transcription" if is_final else "partial"
            _broadcast_sync({"type": msg_type, "text": text})
        elif is_final:
            _broadcast_sync({"type": "status", "text": "silence"})
    except Exception as err:
        _broadcast_sync({"type": "status", "text": f"transcription error: {err}"})


def _stream_worker(device_index: int, mode: str, stop_evt: threading.Event):
    import pyaudio, numpy as np

    model_name, lang = TRANSCRIPTION_PROFILES.get(mode, TRANSCRIPTION_PROFILES["TR + ENG (Mixed)"])

    pa = pyaudio.PyAudio()
    try:
        stream = pa.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=SAMPLE_RATE,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=CHUNK_FRAMES,
        )
    except Exception as err:
        _broadcast_sync({"type": "status", "text": f"audio open error: {err}"})
        pa.terminate()
        return

    speech_buf: list[bytes] = []   # full current phrase
    window_buf: list[bytes] = []   # rolling partial window
    silence_count = 0
    speaking = False

    print(f"[stream] started device={device_index} mode={mode}", flush=True)

    while not stop_evt.is_set():
        try:
            raw = stream.read(CHUNK_FRAMES, exception_on_overflow=False)
        except Exception:
            break

        chunk = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        energy = float(np.sqrt(np.mean(chunk ** 2)))

        if energy > ENERGY_THRESH:
            silence_count = 0
            speaking = True
            speech_buf.append(raw)
            window_buf.append(raw)

            # Partial transcription every PARTIAL_CHUNKS chunks
            if len(window_buf) >= PARTIAL_CHUNKS:
                pcm = b"".join(window_buf)
                window_buf = []
                _broadcast_sync({"type": "status", "text": "transcribing…"})
                threading.Thread(
                    target=_do_transcribe,
                    args=(pcm, model_name, lang, False),
                    daemon=True,
                ).start()
        else:
            if speaking:
                silence_count += 1
                speech_buf.append(raw)
                if silence_count >= SILENCE_END_CHUNKS:
                    # End of phrase — transcribe full buffer as final
                    pcm = b"".join(speech_buf)
                    speech_buf = []
                    window_buf = []
                    silence_count = 0
                    speaking = False
                    _broadcast_sync({"type": "status", "text": "transcribing…"})
                    threading.Thread(
                        target=_do_transcribe,
                        args=(pcm, model_name, lang, True),
                        daemon=True,
                    ).start()

    stream.stop_stream()
    stream.close()
    pa.terminate()
    print("[stream] stopped", flush=True)


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
    global _stop_event, _stream_thread, _current_mode, _current_device_index

    device_index = int(body.get("device_index", 0))
    mode = body.get("transcription_mode", "TR + ENG (Mixed)")
    _current_mode = mode
    _current_device_index = device_index

    with _listening_lock:
        # Stop existing stream if running
        if _stop_event is not None:
            _stop_event.set()
            if _stream_thread and _stream_thread.is_alive():
                _stream_thread.join(timeout=2)

        _stop_event = threading.Event()
        _stream_thread = threading.Thread(
            target=_stream_worker,
            args=(device_index, mode, _stop_event),
            daemon=True,
        )
        _stream_thread.start()
    return {"ok": True}


@app.post("/listen/stop")
def stop_listening():
    global _stop_event
    with _listening_lock:
        if _stop_event is not None:
            _stop_event.set()
            _stop_event = None
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
