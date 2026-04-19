"""
Interview Assistant – FastAPI backend (server-first rewrite)
Runs on http://localhost:7432

Auth flow:
  1. Desktop app gets a long-lived `device_token` from basvur.ai (deep link)
  2. `POST /session/start` exchanges the device_token for a short-lived session JWT,
     plus CV + JD context from the server.
  3. All AI calls (`/suggest/stream`, WS cmd=suggest) use the session JWT.
  4. Heartbeat thread pings `/api/interview/session/heartbeat` every 30s while
     listening so FREE tier seconds are decremented and sessions can be force-stopped.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
import wave
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from audio import (
    TRANSCRIPTION_PROFILES,
    list_microphone_devices,
    preload_whisper_small,
    transcribe_pcm,
)
from config import load_config, save_config


# ── Lifecycle ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_event_loop()

    def _preload():
        preload_whisper_small(
            on_status=lambda msg: _broadcast_sync({"type": "status", "text": msg})
        )

    threading.Thread(target=_preload, daemon=True).start()
    yield
    # Make sure any active session is ended cleanly on shutdown
    _stop_heartbeat()
    _end_active_session_sync()


app = FastAPI(title="Interview Assistant API", lifespan=lifespan)

_main_loop: Optional[asyncio.AbstractEventLoop] = None

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

# Streaming audio constants
SAMPLE_RATE = 16000
CHUNK_FRAMES = 512
ENERGY_THRESH = 300
PARTIAL_CHUNKS = int(1.5 * SAMPLE_RATE / CHUNK_FRAMES)
SILENCE_END_CHUNKS = int(0.55 * SAMPLE_RATE / CHUNK_FRAMES)

_is_recording = False
_recording_thread: Optional[threading.Thread] = None
_recording_file: Optional[str] = None
_recording_start: Optional[float] = None
_pyaudio_instance = None
_audio_stream = None

# Session state (one active session at a time)
_session_lock = threading.Lock()
_active_session: Optional[dict] = None  # {sessionJwt, sessionId, cv, jd, ...}
_heartbeat_stop: Optional[threading.Event] = None
_heartbeat_thread: Optional[threading.Thread] = None
_heartbeat_last = 0.0
_listening_since: Optional[float] = None

_conversation_history: list[tuple[str, str]] = []
_MAX_HISTORY = 5


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
    import pyaudio
    import numpy as np

    model_name, lang = TRANSCRIPTION_PROFILES.get(
        mode, TRANSCRIPTION_PROFILES["TR + ENG (Mixed)"]
    )

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

    speech_buf: list[bytes] = []
    window_buf: list[bytes] = []
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


# ── Session helpers ────────────────────────────────────────────────────────────

def _get_api_base() -> str:
    return load_config().get("api_base", "").rstrip("/")


def _get_device_token() -> str:
    return load_config().get("device_token", "")


def _get_session_jwt() -> Optional[str]:
    with _session_lock:
        if _active_session:
            return _active_session.get("sessionJwt")
    return None


def _set_active_session(data: dict) -> None:
    global _active_session
    with _session_lock:
        _active_session = data


def _clear_active_session() -> None:
    global _active_session
    with _session_lock:
        _active_session = None


def _heartbeat_loop(stop_evt: threading.Event):
    """Send /session/heartbeat every ~30s while listening."""
    global _heartbeat_last, _listening_since
    while not stop_evt.is_set():
        stop_evt.wait(30)
        if stop_evt.is_set():
            return
        jwt = _get_session_jwt()
        if not jwt or _listening_since is None:
            continue
        now = time.time()
        seconds = int(now - max(_heartbeat_last, _listening_since))
        if seconds <= 0:
            continue
        _heartbeat_last = now

        try:
            r = httpx.post(
                f"{_get_api_base()}/api/interview/session/heartbeat",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"secondsElapsed": seconds},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                _broadcast_sync(
                    {
                        "type": "quota",
                        "secondsRemaining": data.get("secondsRemaining"),
                        "shouldStop": bool(data.get("shouldStop")),
                    }
                )
                if data.get("shouldStop"):
                    _broadcast_sync(
                        {"type": "status", "text": "Trial süresi bitti"}
                    )
                    # Auto-stop listening
                    _stop_listening_internal()
            elif r.status_code == 401:
                _broadcast_sync({"type": "session_expired"})
                _stop_listening_internal()
            else:
                print(f"[heartbeat] status={r.status_code}", flush=True)
        except Exception as err:
            print(f"[heartbeat] error: {err}", flush=True)


def _start_heartbeat():
    global _heartbeat_thread, _heartbeat_stop, _heartbeat_last, _listening_since
    _heartbeat_last = time.time()
    _listening_since = time.time()
    _heartbeat_stop = threading.Event()
    _heartbeat_thread = threading.Thread(
        target=_heartbeat_loop, args=(_heartbeat_stop,), daemon=True
    )
    _heartbeat_thread.start()


def _stop_heartbeat():
    global _heartbeat_stop, _heartbeat_thread, _listening_since
    if _heartbeat_stop is not None:
        _heartbeat_stop.set()
    _heartbeat_thread = None
    _heartbeat_stop = None
    _listening_since = None


def _stop_listening_internal():
    global _stop_event
    with _listening_lock:
        if _stop_event is not None:
            _stop_event.set()
            _stop_event = None
    _stop_heartbeat()


def _end_active_session_sync():
    jwt = _get_session_jwt()
    if not jwt:
        return
    try:
        httpx.post(
            f"{_get_api_base()}/api/interview/session/end",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=5,
        )
    except Exception:
        pass
    _clear_active_session()


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/config")
def get_config():
    config = load_config()
    # Redact token from GET response — renderer only needs a boolean
    config["has_device_token"] = bool(config.get("device_token"))
    config.pop("device_token", None)
    saved_idx = config.get("microphone_device_index", 0)
    devices = list_microphone_devices()
    if devices and not any(d["index"] == saved_idx for d in devices):
        config["microphone_device_index"] = _pick_preferred_device(devices)
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
    # Never accept arbitrary device_token overwrites through this endpoint;
    # device_token is written by main process after deep-link exchange.
    data.pop("device_token", None)
    save_config(data)
    return {"ok": True}


@app.post("/auth/token")
def auth_token(body: dict):
    """Main process writes device_token here after deep-link exchange."""
    token = (body.get("device_token") or "").strip()
    if not token:
        return {"error": "missing token"}
    save_config({"device_token": token})
    return {"ok": True}


@app.post("/auth/logout")
def auth_logout():
    _end_active_session_sync()
    _stop_listening_internal()
    save_config({"device_token": ""})
    return {"ok": True}


@app.get("/devices")
def get_devices():
    return list_microphone_devices()


@app.get("/jobs")
async def list_jobs():
    token = _get_device_token()
    if not token:
        return {"error": "unauthorized"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{_get_api_base()}/api/interview/jobs",
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code != 200:
            return {"error": "proxy", "status": r.status_code}
        return r.json()


@app.post("/session/start")
async def session_start(body: dict):
    token = _get_device_token()
    if not token:
        return {"error": "unauthorized"}

    payload = {
        "jobMatchId": body.get("jobMatchId") or None,
        "customJdSnippet": body.get("customJdSnippet") or None,
        "customJdTitle": body.get("customJdTitle") or None,
        "customJdCompany": body.get("customJdCompany") or None,
        "locale": load_config().get("locale", "tr"),
    }

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{_get_api_base()}/api/interview/session/start",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        if r.status_code == 401:
            return {"error": "unauthorized"}
        if r.status_code == 403:
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            return {"error": "trial_expired", **data}
        if r.status_code != 200:
            return {"error": "proxy", "status": r.status_code}
        data = r.json()

    # Cache session
    _set_active_session(
        {
            "sessionJwt": data["sessionJwt"],
            "sessionId": data["sessionId"],
            "cv": data.get("cv", ""),
            "jobDescription": data.get("jobDescription", ""),
            "jobTitle": data.get("jobTitle", ""),
            "company": data.get("company", ""),
            "plan": data.get("plan"),
            "secondsRemaining": data.get("secondsRemaining"),
            "locale": data.get("locale", "tr"),
        }
    )
    _conversation_history.clear()
    return {
        "ok": True,
        "sessionId": data["sessionId"],
        "plan": data.get("plan"),
        "secondsRemaining": data.get("secondsRemaining"),
        "jobTitle": data.get("jobTitle", ""),
        "company": data.get("company", ""),
    }


@app.post("/session/end")
async def session_end():
    _stop_listening_internal()
    _end_active_session_sync()
    return {"ok": True}


# ── AI suggest endpoints ──────────────────────────────────────────────────────

@app.post("/suggest/stream")
async def suggest_stream(body: dict):
    from ai import AIProxyError

    question: str = (body.get("question") or "").strip()
    if not question:
        return {"error": "question is empty"}

    jwt = _get_session_jwt()
    if not jwt:
        return {"error": "no_active_session"}

    locale = (_active_session or {}).get("locale", "tr")
    history = list(_conversation_history)

    async def generate():
        from ai import async_stream_ai_suggestion
        collected: list[str] = []
        try:
            async for text in async_stream_ai_suggestion(
                question=question,
                session_jwt=jwt,
                api_base=_get_api_base(),
                conversation_history=history,
                locale=locale,
            ):
                collected.append(text)
                yield f"data: {json.dumps({'text': text})}\n\n"
        except AIProxyError as err:
            yield f"data: {json.dumps({'error': err.code, 'detail': err.detail})}\n\n"
            if err.code in ("unauthorized", "trial_expired"):
                _stop_listening_internal()
            return
        except Exception as err:
            yield f"data: {json.dumps({'error': 'ai_failed', 'detail': str(err)})}\n\n"
            return

        full_text = "".join(collected)
        if full_text:
            _conversation_history.append((question, full_text))
            if len(_conversation_history) > _MAX_HISTORY:
                _conversation_history.pop(0)
        yield f"data: {json.dumps({'done': True, 'history_count': len(_conversation_history)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/history/clear")
def clear_history():
    _conversation_history.clear()
    return {"ok": True}


@app.get("/session")
def get_session():
    with _session_lock:
        if not _active_session:
            return {"active": False}
        return {
            "active": True,
            "sessionId": _active_session["sessionId"],
            "plan": _active_session.get("plan"),
            "secondsRemaining": _active_session.get("secondsRemaining"),
            "jobTitle": _active_session.get("jobTitle", ""),
            "company": _active_session.get("company", ""),
            "locale": _active_session.get("locale", "tr"),
        }


# ── Listening ─────────────────────────────────────────────────────────────────

@app.post("/listen/start")
def start_listening(body: dict):
    global _stop_event, _stream_thread, _current_mode, _current_device_index

    if not _get_session_jwt():
        return {"error": "no_active_session"}

    device_index = int(body.get("device_index", 0))
    mode = body.get("transcription_mode", "TR + ENG (Mixed)")
    _current_mode = mode
    _current_device_index = device_index

    with _listening_lock:
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

    _start_heartbeat()
    return {"ok": True}


@app.post("/listen/stop")
def stop_listening():
    _stop_listening_internal()
    return {"ok": True}


# ── Recording (unchanged) ──────────────────────────────────────────────────────

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
    frames: list[bytes] = []
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
            cmd = data.get("cmd")
            if cmd == "ping":
                await websocket.send_json({"type": "pong"})
            elif cmd == "suggest":
                await _ws_suggest(websocket, data)
    except WebSocketDisconnect:
        pass
    finally:
        with _ws_lock:
            if websocket in _ws_clients:
                _ws_clients.remove(websocket)


async def _ws_suggest(websocket: WebSocket, body: dict):
    from ai import async_stream_ai_suggestion, AIProxyError

    question: str = (body.get("question") or "").strip()
    if not question:
        await websocket.send_json(
            {"type": "suggestion_error", "text": "missing question"}
        )
        return

    jwt = _get_session_jwt()
    if not jwt:
        await websocket.send_json(
            {"type": "suggestion_error", "text": "no_active_session"}
        )
        return

    locale = (_active_session or {}).get("locale", "tr")
    full_chunks: list[str] = []
    try:
        async for chunk in async_stream_ai_suggestion(
            question=question,
            session_jwt=jwt,
            api_base=_get_api_base(),
            conversation_history=list(_conversation_history),
            locale=locale,
        ):
            full_chunks.append(chunk)
            await websocket.send_json({"type": "suggestion_chunk", "text": chunk})
    except AIProxyError as err:
        await websocket.send_json(
            {"type": "suggestion_error", "text": err.code, "detail": err.detail}
        )
        if err.code in ("unauthorized", "trial_expired"):
            _stop_listening_internal()
        return
    except Exception as err:
        await websocket.send_json(
            {"type": "suggestion_error", "text": f"AI error: {err}"}
        )
        return

    full_text = "".join(full_chunks)
    if full_text:
        _conversation_history.append((question, full_text))
        if len(_conversation_history) > _MAX_HISTORY:
            _conversation_history.pop(0)
    await websocket.send_json(
        {"type": "suggestion_done", "history_count": len(_conversation_history)}
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=7432, log_level="warning")
