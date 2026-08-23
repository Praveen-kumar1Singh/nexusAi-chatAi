"""LLM tool definitions and their implementations.

Each entry pairs the JSON schema Groq sees with the Python function that runs
when the model calls it. Add a tool here and the agent picks it up -- the Tools
page, context panel, permissions list and starter prompts all read this registry,
so nothing in the UI needs changing.
"""

import json
from typing import Any, Callable, Dict, List

import duckduckgo
import images
import store

# --------------------------------------------------------------------------
# implementations
# --------------------------------------------------------------------------

# How many results one search returns.
#
# This was 1, and one result is not enough to answer with. The model would read
# the single hit, decide it had not found the answer, and search again -- but
# ONCE_PER_TURN then handed it a refusal instead of results, which it did not
# accept either. It spent every remaining round rewording the query and the turn
# ended on "Stopped after too many tool calls" 15-40s later, in silence, because
# a capped call emits no event for the UI to show.
#
# Five results cost the same one HTTP round trip (~0.9s) and let the first
# search actually answer the question.
MAX_WEB_RESULTS = 5


def web_search(query: str, max_results: int = MAX_WEB_RESULTS) -> Dict[str, Any]:
    """Search the public web through DuckDuckGo."""
    query = str(query or "").strip()
    if not query:
        raise ValueError("A search query is required")

    limit = max(1, min(int(max_results), MAX_WEB_RESULTS))
    results = duckduckgo.search(query, limit)

    return {
        "query": query,
        "result_count": len(results),
        "results": results,
        "source": "duckduckgo.com",
    }


MAX_OPTIONS = 4


def ask_options(question: str, options: List[str]) -> Dict[str, Any]:
    """Present a short multiple-choice question to the user.

    Nothing is computed here -- the UI renders the options as buttons and the
    user's click comes back as their next message.
    """
    question = str(question or "").strip()
    if not question:
        raise ValueError("A question is required")

    cleaned = [str(o).strip() for o in (options or []) if str(o).strip()]
    if len(cleaned) < 2:
        raise ValueError("Give at least two options")
    cleaned = cleaned[:MAX_OPTIONS]

    return {
        "question": question,
        "options": cleaned,
        "status": "presented",
        "instruction": (
            "The options are now shown to the user as buttons, alongside a free-text "
            "box. Reply with one short line inviting them to choose. Do not answer the "
            "original question yet, do not repeat the options as text, and do not call "
            "any more tools."
        ),
    }


# Where the browser fetches a stored image. The Next.js route of the same shape
# proxies to this service, so the picture arrives from our own origin -- see
# images.py for why nothing hands the provider's own link to the page.
IMAGE_PATH = "/api/images/{}"


def generate_image(prompt: str, size: str = "square", style: str = "none") -> Dict[str, Any]:
    """Draw a picture from a written description.

    The bytes are stored on the way through and only the id comes back: a data
    URL would put a megabyte of base64 into the conversation document, the
    stream and every later read of the thread.
    """
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("Describe what the image should show")

    result = images.generate(prompt, size=size, style=style)
    image_id = store.save_image(
        result["data"],
        result["mime"],
        {
            "prompt": result["prompt"],
            "style": result["style"],
            "size": result["size"],
            "width": result["width"],
            "height": result["height"],
            "seed": result["seed"],
            "provider": result["provider"],
            "model": result["model"],
            "bytes": result["bytes"],
        },
    )

    return {
        "status": "generated",
        "url": IMAGE_PATH.format(image_id),
        "prompt": result["prompt"],
        "size": result["size"],
        "width": result["width"],
        "height": result["height"],
        "provider": result["provider"],
        "model": result["model"],
        "instruction": (
            "The image is already on screen -- the UI rendered it from this result. "
            "Reply with one short line about what you made. Do not paste the URL, do "
            "not describe the picture in detail, and do not call any more tools."
        ),
    }


# --------------------------------------------------------------------------
# schemas sent to Groq
# --------------------------------------------------------------------------

TOOLS: Dict[str, Dict[str, Any]] = {
    "ask_options": {
        "fn": ask_options,
        "reads": "nothing -- asks the user to choose",
        # Not a route the user picks: the model reaches for it on its own when a
        # question is too generic to answer, so it stays out of the routing menu.
        "routable": False,
        "schema": {
            "type": "function",
            "function": {
                "name": "ask_options",
                "description": (
                    "Ask the user to pick from a short list before you answer. Use this "
                    "whenever the question is ambiguous and the answer would differ by "
                    "choice -- most often the programming language for a concept question "
                    "like 'what is a for loop', but also framework, version, OS or "
                    "database. Offer 3 concrete options; the UI adds a free-text box for "
                    "anything else, so do not add an 'Other' option yourself. Skip this "
                    "and answer directly when the user already said which one they mean."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "The short question to show, e.g. 'Which language?'",
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "2-4 short, concrete choices, e.g. ['Python','JavaScript','Java'].",
                        },
                    },
                    "required": ["question", "options"],
                },
            },
        },
    },
    "generate_image": {
        "fn": generate_image,
        "reads": "an image model -- see server/images.py",
        "writes": True,
        "schema": {
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": (
                    "Create an image from a written description. Use this whenever the "
                    "user asks you to draw, generate, design, illustrate or picture "
                    "something, or asks for a logo, poster, icon, wallpaper or concept "
                    "art. Write the prompt yourself: expand what they said into one "
                    "vivid sentence naming the subject, setting, lighting and mood. You "
                    "get one image per message, so do not call this twice."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "One vivid sentence describing the picture: subject, setting, lighting, mood.",
                        },
                        "size": {
                            "type": "string",
                            "enum": ["square", "portrait", "landscape"],
                            "description": "Shape of the image. Square unless the subject suggests otherwise.",
                        },
                        "style": {
                            "type": "string",
                            "enum": ["none", "photo", "art", "anime", "3d", "sketch"],
                            "description": "Visual treatment. Use 'none' unless the user named a look.",
                        },
                    },
                    "required": ["prompt"],
                },
            },
        },
    },
    "web_search": {
        "fn": web_search,
        "reads": "the public web via DuckDuckGo",
        "schema": {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": (
                    "Search the public web with DuckDuckGo and return the top "
                    "results. Use this for anything you do not reliably know: current "
                    "events, public facts, documentation, libraries, APIs, error "
                    "messages, prices, people or companies, and anything after your "
                    "training cutoff. You get exactly one search per message, so make "
                    "the query specific and then answer from what comes back -- "
                    "rewording it and searching again is refused. Always cite the URL "
                    "you used."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query, phrased as you would type it into a search box.",
                        },
                    },
                    "required": ["query"],
                },
            },
        },
    },
}


def tool_schemas() -> List[Dict[str, Any]]:
    """The `tools` payload for the Groq request."""
    return [entry["schema"] for entry in TOOLS.values()]


def run_tool(name: str, raw_args: str) -> str:
    """Execute one tool call and return its JSON result.

    Failures come back as data rather than raising, so the model can read the
    error and correct itself on the next turn.
    """
    entry = TOOLS.get(name)
    if entry is None:
        return json.dumps({"error": "Unknown tool: {}".format(name)})

    try:
        args = json.loads(raw_args) if raw_args else {}
        if not isinstance(args, dict):
            raise ValueError("tool arguments must be a JSON object")
        fn: Callable[..., Any] = entry["fn"]
        return json.dumps(fn(**args))
    except Exception as exc:
        # This message reaches both the model and the tool status in the UI, so
        # use the exception's own wording, falling back to its type if it has none.
        return json.dumps({"error": str(exc) or type(exc).__name__})


def registry() -> List[Dict[str, Any]]:
    """Describe every tool the agent can call.

    The /tools page renders this, so the UI always reflects what the agent can
    genuinely do rather than a hand-maintained list.
    """
    rows = []
    for name, entry in TOOLS.items():
        fn = entry["schema"]["function"]
        params = fn.get("parameters", {}).get("properties", {})
        rows.append(
            {
                "name": name,
                "description": fn.get("description", ""),
                "parameters": [
                    {
                        "name": key,
                        "type": spec.get("type", "string"),
                        "description": spec.get("description", ""),
                        "options": spec.get("enum"),
                    }
                    for key, spec in params.items()
                ],
                "reads": entry.get("reads", "unspecified"),
                "writes": bool(entry.get("writes", False)),
                "routable": entry.get("routable", True),
            }
        )
    return rows
