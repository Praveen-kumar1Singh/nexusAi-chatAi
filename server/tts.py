"""Spoken replies, in English and Hindi.

Two engines, picked per request by the script the text is written in:

  * English -- KittenTTS, https://github.com/KittenML/KittenTTS
  * Hindi   -- facebook/mms-tts-hin, a 36M VITS checkpoint

They are separate because KittenTTS is English-only and cannot be configured
otherwise: its phonemiser is pinned to en-us, and its token vocabulary has no
Devanagari and no nasalisation mark. Feeding it Hindi does not fail loudly -- it
mispronounces the text and speaks espeak's language-switch markers out loud as
"hi" and "enus".

Original notes on the English engine follow.

KittenTTS -- https://github.com/KittenML/KittenTTS

KittenTTS is text-to-speech only: it turns the agent's answer into audio. The
other half of the voice feature -- turning the user's speech into text -- is the
browser's Web Speech API, in src/lib/useVoice.ts. Nothing here listens.

The checkpoints are 25-80 MB of CPU-only ONNX, so the model loads once on first
use and stays resident; there is no GPU to schedule.

This module is optional. If the wheel is not installed every entry point below
says so plainly instead of raising, and the rest of the agent is unaffected --
see requirements-tts.txt for the one-line install.
"""

from __future__ import annotations

import ctypes.util
import io
import os
import re
import threading
import wave

# The voices the released checkpoints ship with. Listed here so /tts/voices can
# answer without paying for a model load.
VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"]

MODEL = os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-mini-0.8")
VOICE = os.getenv("KITTEN_TTS_VOICE", "Luna")

SAMPLE_RATE = 24_000  # every KittenTTS checkpoint generates at 24 kHz

# Hindi. A 36M VITS checkpoint that takes Devanagari directly -- no
# romanisation step -- and synthesises around 4x faster than realtime on CPU.
HINDI_MODEL = os.getenv("HINDI_TTS_MODEL", "facebook/mms-tts-hin")
HINDI_SAMPLE_RATE = 16_000

HINDI_HINT = (
    "Hindi speech needs transformers. From the server directory run:\n"
    "  ./.venv/bin/pip install -r requirements-tts.txt"
)

# Devanagari. Used to route a request, so it only has to separate Hindi from
# English -- not identify the language precisely.
DEVANAGARI = re.compile(r"[\u0900-\u097F]")
LETTERS = re.compile(r"[^\W\d_]", re.UNICODE)

# Below this share of letters, a stray Devanagari word is not worth switching
# engines for -- the Hindi model would mangle the surrounding English.
HINDI_SHARE = 0.2
MAX_CHARS = 1200      # synthesising more than this on a CPU keeps the user waiting

INSTALL_HINT = (
    "KittenTTS is not installed. From the server directory run:\n"
    "  ./.venv/bin/pip install -r requirements-tts.txt"
)

ESPEAK_HINT = (
    "espeak-ng is missing. KittenTTS phonemises through it, and the copy bundled "
    "in espeakng_loader cannot be used (see _use_espeak). Install the real one:\n"
    "  macOS:  brew install espeak-ng\n"
    "  Debian: sudo apt-get install espeak-ng"
)

# Where a system espeak-ng normally lands. Checked in order.
ESPEAK_PATHS = (
    "/opt/homebrew/lib/libespeak-ng.dylib",          # Homebrew, Apple silicon
    "/usr/local/lib/libespeak-ng.dylib",             # Homebrew, Intel
    "/usr/lib/aarch64-linux-gnu/libespeak-ng.so.1",  # Debian/Ubuntu, arm64
    "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1",   # Debian/Ubuntu, amd64
    "/usr/lib/libespeak-ng.so.1",
    "/usr/local/lib/libespeak-ng.so.1",
)

_model = None
_lock = threading.Lock()  # first request in wins the load; the rest queue behind it

_hindi = None  # (model, tokenizer), loaded the same way
_hindi_lock = threading.Lock()


class TTSUnavailable(RuntimeError):
    """KittenTTS is missing, or its model could not be loaded."""


def espeak_library() -> str | None:
    """Path to a usable system espeak-ng, or None if there is not one.

    PHONEMIZER_ESPEAK_LIBRARY wins when the operator has set it; otherwise the
    usual install prefixes are tried, then the platform's own library search.
    """
    override = os.getenv("PHONEMIZER_ESPEAK_LIBRARY")
    if override and os.path.exists(override):
        return override

    for path in ESPEAK_PATHS:
        if os.path.exists(path):
            return path

    return ctypes.util.find_library("espeak-ng") or ctypes.util.find_library("espeak")


def _use_espeak(library: str) -> None:
    """Point phonemizer at a real espeak-ng.

    This has to run *after* kittentts is imported, because that pulls in
    misaki.espeak, which claims the wrapper for the espeakng_loader build at
    import time and would otherwise win.

    Overriding it is a correctness fix, not a preference: that bundled build
    ignores the data path it is handed, looks for its own at the absolute path
    it was compiled on, and calls exit() when it is not there -- which would
    take this whole API server down mid-request rather than fail one call.
    """
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    EspeakWrapper.set_library(library)
    EspeakWrapper.set_data_path(None)  # a system build knows where its own data is


def installed() -> bool:
    """True when the wheel is importable. Does not load the model."""
    try:
        import kittentts  # noqa: F401  (presence check only)
    except ImportError:
        return False
    return True


def hindi_installed() -> bool:
    """True when the Hindi stack is importable. Does not load the model."""
    try:
        import transformers  # noqa: F401  (presence check only)
    except ImportError:
        return False
    return True


def is_hindi(text: str) -> bool:
    """Should this text go to the Hindi engine?

    A share, not a presence check: one Devanagari word inside an English
    sentence is not worth switching for, because the Hindi model would then
    mispronounce all the English around it.
    """
    letters = LETTERS.findall(text)
    if not letters:
        return False
    return len(DEVANAGARI.findall(text)) / len(letters) >= HINDI_SHARE


def _load_hindi():
    """Import and construct the Hindi model, once, behind its own lock."""
    global _hindi
    if _hindi is not None:
        return _hindi

    with _hindi_lock:
        if _hindi is not None:  # another thread got there while we waited
            return _hindi
        try:
            import torch  # noqa: F401  (needed at generate time)
            from transformers import AutoTokenizer, VitsModel
        except ImportError as exc:
            raise TTSUnavailable(HINDI_HINT) from exc
        try:
            model = VitsModel.from_pretrained(HINDI_MODEL)
            model.eval()
            _hindi = (model, AutoTokenizer.from_pretrained(HINDI_MODEL))
        except Exception as exc:  # noqa: BLE001 -- surfaced to the caller as 503
            raise TTSUnavailable(f"Could not load {HINDI_MODEL}: {exc}") from exc
    return _hindi


def _speak_hindi(text: str):
    """Devanagari in, waveform out. The tokeniser takes the script directly."""
    import torch

    model, tokenizer = _load_hindi()
    inputs = tokenizer(text, return_tensors="pt")
    try:
        with torch.no_grad():
            waveform = model(**inputs).waveform
    except Exception as exc:  # noqa: BLE001 -- surfaced to the caller as 503
        raise TTSUnavailable(f"Hindi speech generation failed: {exc}") from exc
    return waveform.squeeze().cpu().numpy(), HINDI_SAMPLE_RATE


def status() -> dict:
    """What /health and the composer's speaker button need to know, load-free."""
    wheel = installed()
    espeak = espeak_library()

    if not wheel:
        hint = INSTALL_HINT
    elif not espeak:
        hint = ESPEAK_HINT
    else:
        hint = None

    return {
        # Speech only works when both halves are present, so report it as one flag.
        "installed": bool(wheel and espeak),
        "wheel": wheel,
        "espeak": espeak,
        "loaded": _model is not None,
        "model": MODEL,
        "voice": VOICE,
        "voices": VOICES,
        "sample_rate": SAMPLE_RATE,
        "max_chars": MAX_CHARS,
        "hint": hint,
        # Hindi is independent: it needs neither the wheel nor espeak, so it can
        # be available when English is not, and vice versa.
        "hindi": {
            "installed": hindi_installed(),
            "loaded": _hindi is not None,
            "model": HINDI_MODEL,
            "sample_rate": HINDI_SAMPLE_RATE,
            "hint": None if hindi_installed() else HINDI_HINT,
        },
    }


def _load():
    """Import and construct the model, once, behind a lock."""
    global _model
    if _model is not None:
        return _model

    with _lock:
        if _model is not None:  # another thread got there while we waited
            return _model
        # Checked before the import, not after: without a system espeak-ng the
        # first generate() would abort the process instead of raising.
        library = espeak_library()
        if library is None:
            raise TTSUnavailable(ESPEAK_HINT)

        try:
            from kittentts import KittenTTS
        except ImportError as exc:
            raise TTSUnavailable(INSTALL_HINT) from exc

        _use_espeak(library)

        try:
            _model = KittenTTS(MODEL)
        except Exception as exc:  # noqa: BLE001 -- surfaced to the caller as 503
            raise TTSUnavailable(f"Could not load {MODEL}: {exc}") from exc
    return _model


def clip(text: str) -> str:
    """Collapse whitespace and trim to MAX_CHARS on a sentence boundary.

    Cutting mid-word sounds broken; cutting after a full stop sounds finished.
    """
    body = " ".join((text or "").split())
    if len(body) <= MAX_CHARS:
        return body

    head = body[:MAX_CHARS]
    stop = max(head.rfind(". "), head.rfind("! "), head.rfind("? "))
    # Only honour the boundary if it leaves a reply worth listening to.
    return (head[: stop + 1] if stop > MAX_CHARS // 3 else head).strip()


def _to_wav(samples, rate: int = SAMPLE_RATE) -> bytes:
    """Float waveform -> 16-bit PCM WAV, standard library only.

    `soundfile` would do this in one call, as the KittenTTS README shows, but it
    drags in libsndfile as a system package that this service needs for nothing
    else. `wave` writes the same file.
    """
    import numpy as np

    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        raise TTSUnavailable("The model returned no audio.")

    # A hot generation can exceed full scale; scale it down rather than let the
    # int16 cast wrap a loud sample round to the opposite polarity.
    peak = float(np.max(np.abs(audio)))
    if peak > 1.0:
        audio = audio / peak

    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def synthesize(text: str, voice: str | None = None, speed: float = 1.0) -> bytes:
    """Speak `text` and return a WAV file. Raises TTSUnavailable if it cannot.

    The engine is chosen by the script the text is written in. The client sends
    one request per clip, so a reply that switches language mid-way is routed
    clip by clip rather than being forced through one engine.
    """
    body = clip(text)
    if not body:
        raise ValueError("Nothing to speak.")

    if is_hindi(body):
        # `voice` and `speed` are KittenTTS concepts; the Hindi checkpoint has a
        # single speaker and no speed control, so they do not apply here.
        samples, rate = _speak_hindi(body)
        return _to_wav(samples, rate)

    # An unknown voice is a caller mistake, not a reason to fail the request.
    chosen = voice if voice in VOICES else VOICE

    model = _load()
    try:
        audio = model.generate(body, voice=chosen, speed=speed)
    except Exception as exc:  # noqa: BLE001 -- surfaced to the caller as 503
        raise TTSUnavailable(f"Speech generation failed: {exc}") from exc

    return _to_wav(audio, SAMPLE_RATE)
