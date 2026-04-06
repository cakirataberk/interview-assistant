import contextlib
import io
import os
import threading
import warnings
from pathlib import Path
from typing import Optional

import speech_recognition as sr

os.environ.setdefault("WHISPER_SKIP_CHECKSUM", "1")

TRANSCRIPTION_PROFILES = {
    "English": ("base.en", "en"),
    "Türkçe": ("small", "tr"),
    "TR + ENG (Mixed)": ("small", None),
}
WHISPER_CACHE_ROOT = os.path.expanduser("~/.cache/whisper")
WHISPER_SMALL_PT = Path(WHISPER_CACHE_ROOT) / "small.pt"
WHISPER_SMALL_BYTES_MIN = 430 * 1024 * 1024
WHISPER_SMALL_BYTES_MAX = 500 * 1024 * 1024

_whisper_model_cache: dict = {}
_whisper_model_cache_lock = threading.Lock()


def _trusted_small_pt_file(path) -> bool:
    try:
        p = Path(path)
        if p.name != "small.pt":
            return False
        sz = p.stat().st_size
    except OSError:
        return False
    return WHISPER_SMALL_BYTES_MIN <= sz <= WHISPER_SMALL_BYTES_MAX


def _patched_whisper_download(url: str, root: str, in_memory: bool):
    import hashlib
    import urllib.request
    from tqdm import tqdm

    os.makedirs(root, exist_ok=True)
    expected_sha256 = url.split("/")[-2]
    download_target = os.path.join(root, os.path.basename(url))
    skip = os.environ.get("WHISPER_SKIP_CHECKSUM", "").strip().lower() in ("1", "true", "yes")
    trust_mismatch = skip or _trusted_small_pt_file(download_target)

    if os.path.exists(download_target) and not os.path.isfile(download_target):
        raise RuntimeError(f"{download_target} exists and is not a regular file")

    if os.path.isfile(download_target):
        model_bytes = open(download_target, "rb").read()
        if hashlib.sha256(model_bytes).hexdigest() == expected_sha256 or trust_mismatch:
            return model_bytes if in_memory else download_target

    with urllib.request.urlopen(url) as source, open(download_target, "wb") as output:
        with tqdm(total=int(source.info().get("Content-Length")), ncols=80, unit="iB", unit_scale=True) as loop:
            while True:
                buffer = source.read(8192)
                if not buffer:
                    break
                output.write(buffer)
                loop.update(len(buffer))

    model_bytes = open(download_target, "rb").read()
    if hashlib.sha256(model_bytes).hexdigest() != expected_sha256 and not trust_mismatch:
        raise RuntimeError("Model SHA256 mismatch. Please retry.")
    return model_bytes if in_memory else download_target


def _install_whisper_patch() -> None:
    import whisper
    if getattr(whisper, "_ia_patch", False):
        return
    whisper._download = _patched_whisper_download
    whisper._ia_patch = True


def get_cached_whisper_model(model_name: str):
    _install_whisper_patch()
    with _whisper_model_cache_lock:
        if model_name not in _whisper_model_cache:
            import whisper
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    _whisper_model_cache[model_name] = whisper.load_model(
                        model_name, download_root=WHISPER_CACHE_ROOT
                    )
    return _whisper_model_cache[model_name]


def transcribe_bytes(audio_bytes: bytes, model_name: str, language: Optional[str]) -> str:
    """Transcribe raw audio bytes (webm/opus from browser MediaRecorder)."""
    import subprocess, tempfile, os
    model = get_cached_whisper_model(model_name)

    # Write to temp file and convert to wav via ffmpeg
    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
        f.write(audio_bytes)
        tmp_in = f.name
    tmp_wav = tmp_in.replace('.webm', '.wav')
    try:
        ffmpeg = next((p for p in ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'] if __import__('shutil').which(p)), 'ffmpeg')
        subprocess.run(
            [ffmpeg, '-y', '-i', tmp_in, '-ar', '16000', '-ac', '1', tmp_wav],
            capture_output=True, check=True
        )
        import numpy as np
        import soundfile as sf
        audio_array, _ = sf.read(tmp_wav)
        audio_array = audio_array.astype('float32')
    finally:
        os.unlink(tmp_in)
        if os.path.exists(tmp_wav):
            os.unlink(tmp_wav)

    kwargs = {"fp16": False}
    if language is not None:
        kwargs["language"] = language
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = model.transcribe(audio_array, **kwargs)
    return (result.get("text") or "").strip()


def transcribe_audio(audio_data: sr.AudioData, model_name: str, language: Optional[str]) -> str:
    import soundfile as sf
    import torch

    model = get_cached_whisper_model(model_name)
    wav_bytes = audio_data.get_wav_data(convert_rate=16000)
    wav_stream = io.BytesIO(wav_bytes)
    audio_array, _ = sf.read(wav_stream)
    audio_array = audio_array.astype("float32")
    kwargs = {"fp16": torch.cuda.is_available()}
    if language is not None:
        kwargs["language"] = language
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = model.transcribe(audio_array, **kwargs)
    return (result.get("text") or "").strip()


def list_microphone_devices() -> list[dict]:
    try:
        import pyaudio
        pa = pyaudio.PyAudio()
        devices = []
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            # Only include devices with input channels (actual microphones)
            if info.get("maxInputChannels", 0) > 0:
                devices.append({"index": i, "name": info["name"]})
        pa.terminate()
        return devices
    except Exception as err:
        print(f"Device list error: {err}")
        # Fallback to speech_recognition
        try:
            names = sr.Microphone.list_microphone_names()
            return [{"index": i, "name": name} for i, name in enumerate(names)]
        except Exception:
            return []


def preload_whisper_small(on_status=None) -> None:
    cached_ok = WHISPER_SMALL_PT.exists() and _trusted_small_pt_file(WHISPER_SMALL_PT)
    if not cached_ok and on_status:
        on_status("Downloading Whisper model (~460MB)…")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                get_cached_whisper_model("small")
        if on_status:
            on_status("Whisper model ready")
    except Exception as e:
        if on_status:
            on_status(f"Whisper load error: {e}")
