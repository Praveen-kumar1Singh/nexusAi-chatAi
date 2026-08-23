"""Text-to-video generation.

The sibling of images.py, and deliberately shaped like it: an env key picks the
provider, the provider picks the endpoint and a default model, and every path
ends with raw bytes that we store ourselves rather than a third-party link that
expires.

One thing is genuinely different, and it is worth stating plainly because it
breaks the promise images.py makes. There is no keyless video. Pollinations
serves images anonymously, but every video model -- including the ones its own
registry does not mark `paid_only` -- answers an unauthenticated request with
401. Video costs real money per second of output, so a key is not an upgrade
here, it is the entry fee:

    (no key at all)             -> nothing. status() reports unavailable.
    VIDEO_API_KEY=<pollinations key>  -> gen.pollinations.ai   seedance-pro

Cost is why the default model is the cheap one. Pollinations bills in "pollen"
at 1 pollen = 1 USD, charged per second of finished video, so the model choice
is a price decision before it is a quality decision:

    seedance-pro    $0.025/s   ->  $0.25 for 10s   (default; 2-10s)
    p-video         $0.02/s    ->  $0.20 for 10s   (1-10s)
    grok-video-pro  $0.07/s    ->  $1.05 for 15s   (1-15s, unlocks the 15s rung)
    wan             $0.10/s    ->  $1.50 for 15s   (5/10/15 only, with audio)

VIDEO_MODEL swaps between them without a code change, which is the whole point:
the duration ladder offered to the user is derived from what the configured
model actually advertises, so raising the budget raises the options and nothing
in the UI has to be edited to follow.
"""

import os
import time
from typing import Any, Dict, List, NamedTuple, Optional, Tuple
from urllib.parse import quote

# pyrefly: ignore [missing-import]
import httpx


class Provider(NamedTuple):
    name: str
    base_url: str
    model: str


POLLINATIONS = Provider("pollinations", "https://gen.pollinations.ai", "seedance-pro")

# Checked in order, so an explicit VIDEO_API_KEY wins over a key that happens to
# be lying around for something else. Note IMAGE_API_KEY is NOT consulted: a
# Pollinations image key is the same credential, but every other image provider
# in images.py serves no video at all, and silently pointing this at one would
# fail on the first call with a confusing error.
KEY_VARS = (
    "VIDEO_API_KEY",
    "POLLINATIONS_API_KEY",
    "POLLINATIONS_TOKEN",
)

# The rungs we offer. A model that cannot reach one simply does not show it --
# see durations(). 20s is absent on purpose: no model generates 20 seconds in a
# single call. 15s is the ceiling everywhere except nova-reel, which moves in
# strict multiples of 6 (18 or 24, never 20), so an honest ladder stops at 15.
DURATIONS: Tuple[int, ...] = (5, 10, 15)
DEFAULT_DURATION = 5

# Shape, not pixels -- same reasoning as images.SIZES. Pollinations takes the
# ratio by name for video and ignores width/height.
ASPECTS: Dict[str, str] = {
    "landscape": "16:9",
    "portrait": "9:16",
}
DEFAULT_ASPECT = "landscape"

RESOLUTIONS = ("480p", "720p", "1080p")
# 720p, not 1080p, and the reason is storage rather than taste: a finished clip
# is stored inline in one Mongo document, which BSON caps at 16MB. 720p x 15s
# lands comfortably under that; 1080p can cross it. See store.save_video.
DEFAULT_RESOLUTION = "720p"

# Appended to the prompt, mirroring images.STYLES so the chat tool and the Tools
# page produce the same clip from the same words.
STYLES: Dict[str, str] = {
    "none": "",
    "cinematic": "cinematic film look, shallow depth of field, dramatic lighting, smooth camera movement",
    "realistic": "photorealistic footage, natural lighting, handheld camera, fine detail",
    "anime": "anime animation, clean line art, cel shading, vibrant colour",
    "3d": "3D animated render, soft studio lighting, subsurface scattering, high detail",
    "timelapse": "time-lapse footage, flowing motion, long exposure trails",
}

# What each known model can do, as a fallback for when the live registry cannot
# be reached. Refreshed from /video/models at runtime -- see _capabilities.
#
#   model -> (min, max, allowed or None, step or None, usd per second)
FALLBACK_CAPS: Dict[str, Tuple[int, int, Optional[Tuple[int, ...]], Optional[int], float]] = {
    "seedance-pro": (2, 10, None, None, 0.025),
    "p-video": (1, 10, None, None, 0.02),
    "grok-video-pro": (1, 15, None, None, 0.07),
    "grok-imagine-video-1.5": (1, 15, None, None, 0.14),
    "happyhorse-1.1": (3, 15, None, None, 0.0988),
    "wan": (5, 15, (5, 10, 15), None, 0.10),
    "wan-pro": (2, 15, None, None, 0.10),
    "wan-fast": (5, 5, None, None, 0.01),
    "seedance-2.0": (4, 15, None, None, 0.18),
    "seedance-2.0-mini": (4, 10, None, None, 0.09),
    "veo": (4, 8, (4, 6, 8), None, 0.08),
    "nova-reel": (6, 120, None, 6, 0.08),
    "minimax-h3": (5, 5, None, None, 0.05),
}

# A video is slow by nature: a 10s clip is 1-3 minutes of provider time, and a
# 15s one longer. This is the read timeout for one generation, not a target.
TIMEOUT = httpx.Timeout(600.0, connect=15.0)

MAX_PROMPT = 1200

# The live registry, cached. It is a small public JSON document and it changes
# when models are added, so it is worth refetching occasionally but not per call.
_MODELS_TTL = 3600.0
_models_cache: Dict[str, Any] = {"at": 0.0, "rows": []}


def api_key() -> Optional[str]:
    """The first configured video key, or None if there is none."""
    for var in KEY_VARS:
        value = os.environ.get(var, "").strip()
        if value:
            return value
    return None


def resolve() -> Tuple[Optional[str], Provider]:
    """The key and the provider it implies, after env overrides."""
    key = api_key()
    found = POLLINATIONS
    return key, found._replace(
        base_url=os.environ.get("VIDEO_BASE_URL", "").strip() or found.base_url,
        model=os.environ.get("VIDEO_MODEL", "").strip() or found.model,
    )


def _fetch_models() -> List[Dict[str, Any]]:
    """Every video model the provider advertises, cached for an hour.

    Model discovery needs no key even though generation does, so this works on a
    fresh clone and the Tools page can show what a key would buy. A failure here
    is not an error: FALLBACK_CAPS covers the models we actually name.
    """
    now = time.time()
    if _models_cache["rows"] and now - _models_cache["at"] < _MODELS_TTL:
        return _models_cache["rows"]

    _, provider = resolve()
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0)) as client:
            response = client.get(provider.base_url + "/video/models")
            rows = response.json() if response.status_code < 400 else []
        if isinstance(rows, list) and rows:
            _models_cache.update({"at": now, "rows": rows})
            return rows
    except Exception:
        pass
    return _models_cache["rows"] or []


def _capabilities(model: str) -> Tuple[int, int, Optional[Tuple[int, ...]], Optional[int], float]:
    """What one model can do: (min, max, allowed, step, usd per second).

    The live registry wins when it answers, because a model's limits can change
    under us; the static table is the offline answer for the models we name.
    """
    for row in _fetch_models():
        names = [row.get("name")] + list(row.get("aliases") or [])
        if model in names:
            allowed = row.get("allowed_durations")
            price = (row.get("pricing") or {}).get("completionVideoSeconds")
            return (
                int(row.get("min_duration") or 1),
                int(row.get("max_duration") or 10),
                tuple(int(d) for d in allowed) if allowed else None,
                int(row["duration_step"]) if row.get("duration_step") else None,
                float(price) if price else 0.0,
            )

    return FALLBACK_CAPS.get(model, (1, 10, None, None, 0.0))


def supports(model: str, seconds: int) -> bool:
    """Whether one model can actually produce a clip of exactly this length."""
    low, high, allowed, step, _ = _capabilities(model)
    if allowed:
        return seconds in allowed
    if not low <= seconds <= high:
        return False
    return (seconds - low) % step == 0 if step else True


def durations(model: Optional[str] = None) -> List[int]:
    """The rungs of DURATIONS this model can serve, longest ladder it supports.

    This is what the UI renders, so a model that tops out at 10s never offers a
    15s button that would only come back as a 400 from the provider.
    """
    if model is None:
        model = resolve()[1].model
    return [seconds for seconds in DURATIONS if supports(model, seconds)]


def cost(model: str, seconds: int) -> float:
    """Rough USD for one clip, so the caller can meter before it spends."""
    return round(_capabilities(model)[4] * seconds, 4)


def describe() -> Provider:
    """Provider details for /health and the Tools page. Never raises."""
    return resolve()[1]


def status() -> Dict[str, Any]:
    """What the video tool will actually call, and whether it can."""
    key, provider = resolve()
    available = bool(key and provider.base_url and provider.model)
    options = durations(provider.model)
    return {
        "available": available,
        "provider": provider.name,
        "model": provider.model,
        # Unlike images, false here means the feature is off, not degraded.
        "key_loaded": bool(key),
        "durations": options,
        "default_duration": options[0] if options else DEFAULT_DURATION,
        "aspects": list(ASPECTS),
        "resolutions": list(RESOLUTIONS),
        "styles": list(STYLES),
        "cost_per_second": _capabilities(provider.model)[4],
        # Stated rather than implied: this is the one tool that cannot run on a
        # fresh clone, and /health should say so instead of looking broken.
        "note": (
            ""
            if available
            else "Video needs a funded key -- set VIDEO_API_KEY. There is no free tier for video."
        ),
    }


def _styled(prompt: str, style: Optional[str]) -> str:
    suffix = STYLES.get((style or "none").strip().lower(), "")
    return "{}, {}".format(prompt, suffix) if suffix else prompt


def _duration(model: str, seconds: Optional[int]) -> int:
    """Clamp a requested length onto something the model will accept."""
    options = durations(model)
    if not options:
        # The model is not one we know and the registry is unreachable; send the
        # request through untouched and let the provider be the authority.
        return int(seconds or DEFAULT_DURATION)

    if seconds is None:
        return options[0]

    seconds = int(seconds)
    if seconds in options:
        return seconds
    # Nearest rung it can actually do, rather than a 400 the user cannot act on.
    return min(options, key=lambda option: abs(option - seconds))


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


def _binary(response: httpx.Response) -> Tuple[bytes, str]:
    """Bytes out of a response that is supposed to be a video.

    Same guard as images._binary and for the same reason: a provider under load
    answers a valid request with a JSON error and a 200.
    """
    if response.status_code >= 400:
        raise RuntimeError(_api_error(response))

    mime = response.headers.get("content-type", "").split(";")[0].strip()
    if not mime.startswith("video/"):
        raise RuntimeError(
            "Provider returned {} instead of a video: {}".format(mime or "no type", response.text[:300])
        )
    return response.content, mime


def generate(
    prompt: str,
    duration: Optional[int] = None,
    aspect: Optional[str] = None,
    style: Optional[str] = None,
    resolution: Optional[str] = None,
    audio: bool = False,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """Render one clip and return its bytes plus what produced them.

    Raises ValueError for a bad request and RuntimeError for a provider that
    failed, so callers can tell a fixable mistake from an outage.
    """
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required")
    if len(prompt) > MAX_PROMPT:
        prompt = prompt[:MAX_PROMPT]

    key, provider = resolve()
    if not key:
        raise ValueError(
            "No video provider configured -- set VIDEO_API_KEY. Unlike images, "
            "video has no free tier: every model bills per second of output."
        )
    if not provider.base_url or not provider.model:
        raise ValueError("VIDEO_BASE_URL and VIDEO_MODEL must both be set.")

    seconds = _duration(provider.model, duration)
    aspect_name = (aspect or DEFAULT_ASPECT).strip().lower()
    if aspect_name not in ASPECTS:
        aspect_name = DEFAULT_ASPECT
    resolution_name = (resolution or DEFAULT_RESOLUTION).strip().lower()
    if resolution_name not in RESOLUTIONS:
        resolution_name = DEFAULT_RESOLUTION

    full_prompt = _styled(prompt, style)

    params: Dict[str, Any] = {
        "model": provider.model,
        "duration": seconds,
        "aspectRatio": ASPECTS[aspect_name],
        "resolution": resolution_name,
    }
    if audio:
        params["audio"] = "true"
    if seed is not None:
        params["seed"] = int(seed)

    url = "{}/video/{}".format(provider.base_url, quote(full_prompt, safe=""))
    headers = {"Authorization": "Bearer {}".format(key)}

    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
        data, mime = _binary(client.get(url, params=params, headers=headers))

    if not data:
        raise RuntimeError("The video provider returned an empty file.")

    return {
        "data": data,
        "mime": mime,
        "prompt": prompt,
        "full_prompt": full_prompt,
        "style": (style or "none").lower(),
        "duration": seconds,
        "aspect": aspect_name,
        "aspect_ratio": ASPECTS[aspect_name],
        "resolution": resolution_name,
        "audio": bool(audio),
        "seed": seed,
        "provider": provider.name,
        "model": provider.model,
        "bytes": len(data),
        "cost_usd": cost(provider.model, seconds),
    }
