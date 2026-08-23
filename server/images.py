"""Text-to-image generation: swap the key, the provider follows.

The chat model and the image model are two different services -- Groq serves no
image model at all -- so this resolves its own provider rather than riding on
llm.py. The arrangement is otherwise the same one: an env key picks the provider,
which picks the endpoint and a default model.

    (no key at all)             -> Pollinations / FLUX   free, nothing to set up
    IMAGE_API_KEY=hf_...        -> Hugging Face          FLUX.1-schnell
    IMAGE_API_KEY=tgp_v1_...    -> Together AI           FLUX.1-schnell-Free
    IMAGE_API_KEY=sk-...        -> OpenAI                gpt-image-1
    IMAGE_API_KEY=AIza...       -> Google                gemini-2.5-flash-image

Pollinations is the default precisely because it needs no account: the feature
works on a fresh clone, and a key only ever buys better output. IMAGE_PROVIDER
forces one by name, IMAGE_MODEL overrides the model, and IMAGE_BASE_URL points
the OpenAI shape at any compatible endpoint.

Every provider hands back raw bytes here. Nothing returns a third-party URL to
the browser: the bytes are stored once (store.save_image) and served from our own
origin, so a saved conversation still renders after the provider's temporary link
has expired, and one generation is paid for exactly once.
"""

import base64
import os
import random
from typing import Any, Dict, NamedTuple, Optional, Tuple
from urllib.parse import quote

# pyrefly: ignore [missing-import]
import httpx


class Provider(NamedTuple):
    name: str
    prefix: str
    base_url: str
    model: str


# Ordered longest-prefix first, same reason as llm.py: `sk-` is a prefix of
# nothing else here, but `tgp_v1_` and `hf_` must be tested before it.
PROVIDERS = [
    Provider("huggingface", "hf_", "https://router.huggingface.co/hf-inference", "black-forest-labs/FLUX.1-schnell"),
    Provider("together", "tgp_", "https://api.together.xyz/v1", "black-forest-labs/FLUX.1-schnell-Free"),
    Provider("google", "AIza", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-flash-image"),
    Provider("openai", "sk-", "https://api.openai.com/v1", "gpt-image-1"),
]

# The keyless default. Reached whenever no image key is configured.
POLLINATIONS = Provider("pollinations", "", "https://image.pollinations.ai", "flux")

# Checked in order, so an explicit IMAGE_API_KEY wins over a vendor key that
# happens to be lying around for something else.
KEY_VARS = (
    "IMAGE_API_KEY",
    "HUGGINGFACE_API_KEY",
    "HF_TOKEN",
    "TOGETHER_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "STABILITY_API_KEY",
)

# Named shapes rather than free pixel counts: every provider clamps or rejects
# odd dimensions, and three ratios cover what a chat UI actually displays.
SIZES: Dict[str, Tuple[int, int]] = {
    "square": (1024, 1024),
    "portrait": (832, 1216),
    "landscape": (1216, 832),
}
DEFAULT_SIZE = "square"

# gpt-image-1 accepts only these three, so the ratios above map onto them.
OPENAI_SIZES = {
    "square": "1024x1024",
    "portrait": "1024x1536",
    "landscape": "1536x1024",
}

# Appended to the prompt. Kept here rather than in the UI so the chat tool and
# the Tools page produce the same picture from the same words.
STYLES: Dict[str, str] = {
    "none": "",
    "photo": "photorealistic, 50mm photograph, natural lighting, sharp focus, high detail",
    "art": "digital painting, rich colour, dramatic lighting, highly detailed, artstation quality",
    "anime": "anime illustration, clean line art, cel shading, vibrant colour",
    "3d": "3D render, octane, soft studio lighting, subsurface scattering, high detail",
    "sketch": "pencil sketch, hand drawn, monochrome, fine cross-hatching",
}

# A generation is slow by nature -- 4-step FLUX lands in 2-6s, a diffusion model
# waking up on a shared host can take most of a minute.
TIMEOUT = httpx.Timeout(120.0, connect=15.0)


def api_key() -> Optional[str]:
    """The first configured image key, or None for the keyless default."""
    for var in KEY_VARS:
        value = os.environ.get(var, "").strip()
        if value:
            return value
    return None


def detect(key: Optional[str]) -> Provider:
    """Match a key to its provider by prefix; no key means Pollinations."""
    if not key:
        return POLLINATIONS
    for provider in PROVIDERS:
        if key.startswith(provider.prefix):
            return provider
    # A key in an unknown format is still usable if it is pointed somewhere:
    # IMAGE_BASE_URL below decides, and resolve() reports the miss otherwise.
    return Provider("custom", "", "", "")


def resolve() -> Tuple[Optional[str], Provider]:
    """The key and the provider it implies, after env overrides."""
    key = api_key()

    forced = os.environ.get("IMAGE_PROVIDER", "").strip().lower()
    if forced:
        found = next(
            (p for p in PROVIDERS + [POLLINATIONS] if p.name == forced),
            Provider(forced, "", "", ""),
        )
    else:
        found = detect(key)

    return key, found._replace(
        base_url=os.environ.get("IMAGE_BASE_URL", "").strip() or found.base_url,
        model=os.environ.get("IMAGE_MODEL", "").strip() or found.model,
    )


def describe() -> Provider:
    """Provider details for /health and the Tools page. Never raises."""
    return resolve()[1]


def status() -> Dict[str, Any]:
    """What the image tool will actually call, and whether it can."""
    key, provider = resolve()
    return {
        "available": bool(provider.base_url and provider.model),
        "provider": provider.name,
        "model": provider.model,
        # Pollinations is the only one that works with this false.
        "key_loaded": bool(key),
        "sizes": list(SIZES),
        "styles": list(STYLES),
    }


def _styled(prompt: str, style: Optional[str]) -> str:
    suffix = STYLES.get((style or "none").strip().lower(), "")
    return "{}, {}".format(prompt, suffix) if suffix else prompt


def _dimensions(size: Optional[str]) -> Tuple[str, int, int]:
    name = (size or DEFAULT_SIZE).strip().lower()
    if name not in SIZES:
        name = DEFAULT_SIZE
    width, height = SIZES[name]
    return name, width, height


def _binary(response: httpx.Response) -> Tuple[bytes, str]:
    """Bytes out of a response that is supposed to be an image.

    A provider under load answers a perfectly valid request with a JSON error
    and a 200, so the content type is checked rather than assumed.
    """
    mime = response.headers.get("content-type", "").split(";")[0].strip()
    if not mime.startswith("image/"):
        detail = response.text[:300]
        raise RuntimeError("Provider returned {} instead of an image: {}".format(mime or "no type", detail))
    return response.content, mime


# --------------------------------------------------------------------------
# one function per provider -- each returns (bytes, mime type)
# --------------------------------------------------------------------------

def _pollinations(provider: Provider, prompt: str, width: int, height: int, seed: int, key: Optional[str]):
    url = "{}/prompt/{}".format(provider.base_url, quote(prompt, safe=""))
    params = {
        "width": width,
        "height": height,
        "seed": seed,
        "model": provider.model,
        # Without this the picture comes back with a watermark strip.
        "nologo": "true",
        "referrer": "nexus-ai",
    }
    headers = {"Authorization": "Bearer {}".format(key)} if key else {}
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
        return _binary(client.get(url, params=params, headers=headers))


def _huggingface(provider: Provider, prompt: str, width: int, height: int, seed: int, key: str):
    url = "{}/models/{}".format(provider.base_url, provider.model)
    payload = {
        "inputs": prompt,
        "parameters": {"width": width, "height": height, "seed": seed},
        # Wait for a cold model rather than taking the 503 it answers with while
        # it loads, which would read to the user as a failure it is not.
        "options": {"wait_for_model": True},
    }
    headers = {"Authorization": "Bearer {}".format(key), "Accept": "image/png"}
    with httpx.Client(timeout=TIMEOUT) as client:
        return _binary(client.post(url, json=payload, headers=headers))


def _together(provider: Provider, prompt: str, width: int, height: int, seed: int, key: str):
    payload = {
        "model": provider.model,
        "prompt": prompt,
        "width": width,
        "height": height,
        # schnell is a 4-step model; more steps cost time and change nothing.
        "steps": 4,
        "n": 1,
        "seed": seed,
        "response_format": "b64_json",
    }
    headers = {"Authorization": "Bearer {}".format(key)}
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(provider.base_url + "/images/generations", json=payload, headers=headers)
        return _from_openai_shape(response, client)


def _openai(provider: Provider, prompt: str, size_name: str, key: str):
    payload = {
        "model": provider.model,
        "prompt": prompt,
        "size": OPENAI_SIZES.get(size_name, "1024x1024"),
        "n": 1,
    }
    # dall-e-3 returns a link unless asked otherwise; gpt-image-1 rejects the
    # parameter outright and always returns base64.
    if not provider.model.startswith("gpt-image"):
        payload["response_format"] = "b64_json"
    headers = {"Authorization": "Bearer {}".format(key)}
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(provider.base_url + "/images/generations", json=payload, headers=headers)
        return _from_openai_shape(response, client)


def _from_openai_shape(response: httpx.Response, client: httpx.Client) -> Tuple[bytes, str]:
    """Read the `data[0]` of an OpenAI-shaped images response.

    Together and OpenAI share this wire format, and both may answer with either
    inline base64 or a link to fetch, so both are handled once here.
    """
    if response.status_code >= 400:
        raise RuntimeError(_api_error(response))

    data = (response.json() or {}).get("data") or []
    if not data:
        raise RuntimeError("The image provider returned no image.")

    first = data[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"]), "image/png"
    if first.get("url"):
        return _binary(client.get(first["url"], follow_redirects=True))
    raise RuntimeError("The image provider returned no image data.")


def _google(provider: Provider, prompt: str, key: str):
    url = "{}/models/{}:generateContent".format(provider.base_url, provider.model)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(url, json=payload, headers={"x-goog-api-key": key})
        if response.status_code >= 400:
            raise RuntimeError(_api_error(response))

        for candidate in (response.json() or {}).get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                blob = part.get("inlineData") or part.get("inline_data")
                if blob and blob.get("data"):
                    return base64.b64decode(blob["data"]), blob.get("mimeType") or "image/png"
    raise RuntimeError("Gemini returned text but no image for that prompt.")


def _api_error(response: httpx.Response) -> str:
    """The provider's own wording, so the UI can show something actionable."""
    try:
        body = response.json()
        error = body.get("error") if isinstance(body, dict) else None
        if isinstance(error, dict):
            return "{}: {}".format(response.status_code, error.get("message") or error)
        if error:
            return "{}: {}".format(response.status_code, error)
        return "{}: {}".format(response.status_code, str(body)[:300])
    except ValueError:
        return "{}: {}".format(response.status_code, response.text[:300])


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

MAX_PROMPT = 1200


def generate(
    prompt: str,
    size: Optional[str] = None,
    style: Optional[str] = None,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """Render one image and return its bytes plus what produced them.

    Raises ValueError for a bad request and RuntimeError for a provider that
    failed, so callers can tell a fixable mistake from an outage.
    """
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required")
    if len(prompt) > MAX_PROMPT:
        prompt = prompt[:MAX_PROMPT]

    key, provider = resolve()
    if not provider.base_url or not provider.model:
        raise ValueError(
            "No image provider configured -- set IMAGE_API_KEY, or IMAGE_BASE_URL "
            "and IMAGE_MODEL for an OpenAI-compatible endpoint."
        )
    if provider.name != "pollinations" and not key:
        raise ValueError("IMAGE_PROVIDER is set to {} but no image API key is configured.".format(provider.name))

    size_name, width, height = _dimensions(size)
    # A fixed seed makes a prompt reproducible; a random one keeps two identical
    # prompts from returning the same picture out of a provider's cache.
    seed = int(seed) if seed is not None else random.randint(1, 2_147_483_646)
    full_prompt = _styled(prompt, style)

    if provider.name == "pollinations":
        data, mime = _pollinations(provider, full_prompt, width, height, seed, key)
    elif provider.name == "huggingface":
        data, mime = _huggingface(provider, full_prompt, width, height, seed, key)
    elif provider.name == "together":
        data, mime = _together(provider, full_prompt, width, height, seed, key)
    elif provider.name == "google":
        data, mime = _google(provider, full_prompt, key)
    else:
        # openai, and any custom OpenAI-compatible endpoint.
        data, mime = _openai(provider, full_prompt, size_name, key)

    if not data:
        raise RuntimeError("The image provider returned an empty image.")

    return {
        "data": data,
        "mime": mime,
        "prompt": prompt,
        "full_prompt": full_prompt,
        "style": (style or "none").lower(),
        "size": size_name,
        "width": width,
        "height": height,
        "seed": seed,
        "provider": provider.name,
        "model": provider.model,
        "bytes": len(data),
    }
