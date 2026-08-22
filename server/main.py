"""FastAPI wrapper around the agent.

Run it with:  uvicorn main:app --reload --port 8000   (from this directory)

The Next.js routes under /api proxy to this service, so the browser never talks
to it directly and the LLM key never leaves the server.

State lives in store.py -- in memory, for now. Every endpoint below returns real
data produced by the running system; there are no fixtures.
"""

import os
from pathlib import Path
from typing import List, Optional

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Header, HTTPException, Request
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse, Response, StreamingResponse
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field

# Locally the key lives in the Next.js .env.local one directory up -- one key,
# one place. Deployed (Render), the platform sets real environment variables and
# neither file exists; load_dotenv is a no-op then, and never overwrites what is
# already in the environment.
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
load_dotenv(Path(__file__).resolve().parent / ".env")

import llm  # noqa: E402
import store  # noqa: E402
import tts  # noqa: E402
from agent import stream_chat  # noqa: E402  (needs env loaded first)
from tools import registry  # noqa: E402

app = FastAPI(title="Nexus AI agent", version="1.0.0")


# Shared secret between the Next.js proxy and this service.
#
# It matters once the two halves are deployed apart: this host is then reachable
# from the open internet, and `x-user-email` below is trusted as given -- so
# without a gate anyone could name someone else's account and read their
# conversations. Unset (local dev, both halves on one machine) the check is
# inert, so nothing about running locally changes.
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "").strip()

# Reachable without the token, so Render's health check and a quick curl work.
OPEN_PATHS = {"/health", "/docs", "/openapi.json"}


@app.middleware("http")
async def require_agent_token(request: Request, call_next):
    if AGENT_TOKEN and request.url.path not in OPEN_PATHS:
        if request.headers.get("x-agent-token", "") != AGENT_TOKEN:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message] = Field(..., min_length=1)
    conversation_id: Optional[str] = None
    # Set by the voice page: the reply will be heard, not read.
    voice: bool = False


# Who the request belongs to. Sent by the Next.js proxy as `x-user-email`, empty
# for a signed-out visitor -- see store._owner for what that buys a guest.
UserEmail = Optional[str]


class AuthRequest(BaseModel):
    email: str
    password_hash: str


class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voice: Optional[str] = None
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class ProfileUpdateRequest(BaseModel):
    email: str
    name: Optional[str] = None
    avatar: Optional[str] = None
    avatarImage: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


@app.get("/health")
def health():
    """Cheap readiness probe -- also tells you whether the key was picked up."""
    provider = llm.describe()
    keys = llm.rotating_keys()
    return {
        "status": "ok",
        "model": provider.model,
        "provider": provider.name,
        "base_url": provider.base_url,
        "key_loaded": bool(keys),
        # Masked, so the rotation is visible without printing a usable secret.
        "keys": [llm.fingerprint(key) for key in keys],
        "storage": "mongodb-atlas",
        "auth_required": bool(AGENT_TOKEN),
        "speech": tts.status(),
    }


@app.post("/auth/register")
def register_user(req: AuthRequest):
    ok = store.register_user(req.email, req.password_hash)
    if not ok:
        raise HTTPException(status_code=400, detail="User already exists or registration failed")
    return {"status": "ok", "email": req.email}


@app.post("/auth/login")
def login_user(req: AuthRequest):
    user = store.login_user(req.email, req.password_hash)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"status": "ok", "user": user}


@app.post("/auth/update-profile")
def update_profile(req: ProfileUpdateRequest):
    if req.current_password:
        existing = store.login_user(req.email, req.current_password)
        if not existing:
            raise HTTPException(status_code=400, detail="Current password is incorrect.")
    
    updated = store.update_user_profile(
        req.email,
        name=req.name,
        avatar=req.avatar,
        avatarImage=req.avatarImage,
        new_password=req.new_password,
    )
    return {"status": "ok", "user": updated}


@app.get("/tools")
def tools():
    """The agent's real capabilities, straight from the tool registry."""
    provider = llm.describe()
    return {"model": provider.model, "provider": provider.name, "tools": registry()}


@app.get("/tts/voices")
def tts_voices():
    """Whether spoken replies are available, and in which voices."""
    return tts.status()


@app.post("/tts")
def tts_speak(req: SpeechRequest):
    """Render text to a WAV with KittenTTS.

    Declared `def`, not `async def`, on purpose: FastAPI runs it in a threadpool,
    so a CPU synthesis never blocks the event loop the chat stream is riding on.
    """
    try:
        audio = tts.synthesize(req.text, req.voice, req.speed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except tts.TTSUnavailable as exc:
        # 503, not 500: the agent is fine, this one optional dependency is not.
        raise HTTPException(status_code=503, detail=str(exc))

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/conversations")
def conversations(x_user_email: UserEmail = Header(default=None)):
    return {"conversations": store.list_conversations(x_user_email)}


@app.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, x_user_email: UserEmail = Header(default=None)):
    found = store.get_conversation(conversation_id, x_user_email)
    if found is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return found


@app.delete("/conversations/{conversation_id}")
def remove_conversation(
    conversation_id: str, x_user_email: UserEmail = Header(default=None)
):
    if not store.delete_conversation(conversation_id, x_user_email):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": conversation_id}


@app.post("/chat")
def chat(req: ChatRequest, x_user_email: UserEmail = Header(default=None)):
    history = [{"role": m.role, "content": m.content} for m in req.messages]

    # Signed in: start a conversation on the first turn, then keep appending to
    # it. Signed out: conversation_id stays None, so nothing below writes to the
    # database and the turn lives only in the browser tab that asked for it.
    conversation_id = req.conversation_id
    if conversation_id and store.get_conversation(conversation_id, x_user_email) is None:
        conversation_id = None
    if conversation_id is None:
        conversation_id = store.create_conversation(history[0]["content"], x_user_email)

    store.append_message(conversation_id, "user", history[-1]["content"])

    def events():
        # Tell the client which conversation this turn belongs to (null for guests).
        yield '{"type": "conversation", "id": %s}\n' % (
            '"%s"' % conversation_id if conversation_id else "null"
        )
        for chunk in stream_chat(history, conversation_id, req.voice):
            yield chunk

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform"},
    )
