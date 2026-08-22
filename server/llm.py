"""Provider resolution: swap the API key, the agent follows.

Every provider below speaks the OpenAI `/chat/completions` wire format, so one
client library covers all of them and `agent.py` never learns who it is talking
to. Dropping a different key into `.env.local` is the whole migration:

    LLM_API_KEY=gsk_...     -> Groq
    LLM_API_KEY=sk-or-...   -> OpenRouter
    LLM_API_KEY=sk-ant-...  -> Anthropic (its OpenAI-compatible endpoint)
    LLM_API_KEY=sk-...      -> OpenAI

The key prefix picks the provider, which picks the base URL and a default model.
Anything unrecognised needs LLM_BASE_URL set; anything at all can be overridden
with LLM_BASE_URL and LLM_MODEL, which is also how you reach a local Ollama or
vLLM server.

Several keys for the same provider go in the same variable, comma-separated:

    GROQ_API_KEY=gsk_first,gsk_second

Turns are then handed out round-robin across them, which spreads a burst of
requests over each key's rate limit instead of exhausting one.
"""

import itertools
import os
import threading
from typing import List, NamedTuple, Optional, Tuple

# pyrefly: ignore [missing-import]
from openai import OpenAI


class Provider(NamedTuple):
    name: str
    prefix: str
    base_url: str
    model: str


# Ordered: longer prefixes first, since `sk-ant-` and `sk-or-` both start `sk-`.
PROVIDERS: List[Provider] = [
    Provider("openrouter", "sk-or-", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini"),
    Provider("anthropic", "sk-ant-", "https://api.anthropic.com/v1", "claude-sonnet-4-5"),
    Provider("groq", "gsk_", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"),
    Provider("openai", "sk-", "https://api.openai.com/v1", "gpt-4.1-mini"),
]

UNKNOWN = Provider("custom", "", "", "")

# Checked in order, so an explicit LLM_API_KEY wins over a leftover vendor key.
KEY_VARS = ("LLM_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")

_rotation = itertools.count()
_rotation_lock = threading.Lock()
_warned: set = set()


def api_keys() -> List[str]:
    """Every key configured on the first variable that has one, in order.

    Duplicates are dropped so a copy-pasted repeat does not get double the share
    of traffic.
    """
    for var in KEY_VARS:
        raw = os.environ.get(var, "").strip()
        if not raw:
            continue
        keys: List[str] = []
        for part in raw.split(","):
            key = part.strip()
            if key and key not in keys:
                keys.append(key)
        if keys:
            return keys
    return []


def api_key() -> Optional[str]:
    """The first configured key. Identifies the provider; not used for calls."""
    keys = api_keys()
    return keys[0] if keys else None


def rotating_keys() -> List[str]:
    """The keys eligible for rotation -- those sharing the first key's provider.

    One base URL serves the whole rotation, so a key from a different vendor
    would be sent to the wrong endpoint. Those are dropped with a warning rather
    than silently failing every time they came up.
    """
    keys = api_keys()
    if len(keys) < 2:
        return keys

    primary = detect(keys[0]).name
    same = [key for key in keys if detect(key).name == primary]
    if len(same) != len(keys) and primary not in _warned:
        _warned.add(primary)
        print(
            "[llm] Ignoring {} key(s) that are not {} keys -- rotation needs one "
            "provider.".format(len(keys) - len(same), primary)
        )
    return same


def next_key() -> Optional[str]:
    """The next key in the round-robin. Thread-safe: turns run in a threadpool."""
    keys = rotating_keys()
    if not keys:
        return None
    if len(keys) == 1:
        return keys[0]
    with _rotation_lock:
        turn = next(_rotation)
    return keys[turn % len(keys)]


def fingerprint(key: str) -> str:
    """A masked label for logs and /health -- enough to tell two keys apart."""
    return "{}...{}".format(key[:7], key[-4:]) if len(key) > 15 else "set"


def detect(key: str) -> Provider:
    """Match a key to its provider by prefix."""
    for provider in PROVIDERS:
        if key.startswith(provider.prefix):
            return provider
    return UNKNOWN


def resolve() -> Tuple[Optional[str], Provider]:
    """The key and the provider it implies, after env overrides."""
    key = api_key()
    if key is None:
        return None, UNKNOWN

    found = detect(key)
    return key, found._replace(
        base_url=os.environ.get("LLM_BASE_URL", "").strip() or found.base_url,
        # GROQ_MODEL is still honoured so existing .env.local files keep working.
        model=(
            os.environ.get("LLM_MODEL", "").strip()
            or os.environ.get("GROQ_MODEL", "").strip()
            or found.model
        ),
    )


def describe() -> Provider:
    """Provider details for /health, the UI and trace metadata. Never raises."""
    return resolve()[1]


def client() -> Tuple[OpenAI, Provider]:
    """A configured client, or a ValueError explaining what is missing.

    Each call takes the next key in the rotation, so consecutive turns spread
    across the configured keys.
    """
    key, provider = resolve()
    if key is None:
        raise ValueError(
            "No LLM key found. Set LLM_API_KEY in .env.local (any of {} also work).".format(
                ", ".join(KEY_VARS[1:])
            )
        )
    if not provider.base_url:
        raise ValueError(
            "Unrecognised API key format -- set LLM_BASE_URL to your provider's "
            "OpenAI-compatible endpoint, and LLM_MODEL to a model it serves."
        )
    if not provider.model:
        raise ValueError("No model configured -- set LLM_MODEL in .env.local.")

    key = next_key()
    if len(rotating_keys()) > 1:
        # One line per turn, so the rotation is verifiable from the agent log.
        print("[llm] turn using key {}".format(fingerprint(key)), flush=True)
    return OpenAI(api_key=key, base_url=provider.base_url), provider
