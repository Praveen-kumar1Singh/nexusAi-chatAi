"""MongoDB Atlas Application State with In-Memory Fallback.

All conversation threads, chat message turns, tool calls, and user accounts
are stored persistently in MongoDB Atlas.
"""

import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

# Load env variables from root .env.local
env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(env_path)

MONGODB_URI = os.environ.get("MONGODB_URI")
MONGODB_DB = os.environ.get("MONGODB_DB", "mantraa_ai")

_lock = threading.Lock()
_mongo_client = None
_db = None
# Why the last connection attempt failed, for /health. Without this the memory
# fallback below is invisible: every write appears to succeed, every read comes
# back, and the data is gone at the next restart.
_last_error: Optional[str] = None

# Fallback in-memory stores if DB connection is unavailable
_memory_conversations: Dict[str, Dict[str, Any]] = {}
_memory_tool_calls: List[Dict[str, Any]] = []
_memory_users: Dict[str, Dict[str, Any]] = {}

MAX_TOOL_CALLS = 500


def _get_db():
    global _mongo_client, _db, _last_error
    if _db is not None:
        return _db

    if MONGODB_URI:
        try:
            # pyrefly: ignore [missing-import]
            from pymongo import MongoClient
            try:
                # pyrefly: ignore [missing-import]
                import certifi
                _mongo_client = MongoClient(
                    MONGODB_URI,
                    serverSelectionTimeoutMS=3000,
                    tlsCAFile=certifi.where(),
                )
                _mongo_client.admin.command("ping")
            except Exception:
                _mongo_client = MongoClient(
                    MONGODB_URI,
                    serverSelectionTimeoutMS=3000,
                    tls=True,
                    tlsAllowInvalidCertificates=True,
                )
                _mongo_client.admin.command("ping")

            _db = _mongo_client[MONGODB_DB]
            _db.conversations.create_index("id", unique=True)
            _db.users.create_index("email", unique=True)
            # Compound so the sidebar's "mine, newest first" query is served
            # straight off the index instead of sorting in memory.
            _db.conversations.create_index([("user_email", 1), ("updated_at", -1)])
            print("[MongoDB] Connected successfully to Atlas database:", MONGODB_DB)
            _last_error = None
            return _db
        except Exception as err:
            print("[MongoDB] Warning: MongoDB Atlas direct PyMongo connection unavailable, using memory fallback:", err)
            _last_error = str(err)
            _db = None
    else:
        _last_error = "MONGODB_URI is not set"

    return None


def status() -> Dict[str, Any]:
    """Where state is actually going, for /health.

    This used to be reported as the constant string "mongodb-atlas", which was
    true of the intent and not of the process: when Atlas is unreachable every
    helper below quietly writes to a dict instead, so conversations look saved
    for as long as the process lives and are gone at the next deploy. The most
    likely cause on a hosted agent is the Atlas IP access list, which does not
    include the host's egress addresses until someone adds them.
    """
    db = _get_db()
    return {
        "backend": "mongodb-atlas" if db is not None else "memory",
        "durable": db is not None,
        "database": MONGODB_DB if db is not None else None,
        "uri_configured": bool(MONGODB_URI),
        "error": _last_error,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_title_text(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"===ATTACHMENT_START:.*?===", "", text, flags=re.DOTALL)
    cleaned = re.sub(r"===ATTACHMENT_END===", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"【.*?】", "", cleaned)
    cleaned = re.sub(r"[\*#_`]", "", cleaned)
    return " ".join(cleaned.strip().split())


def extract_smart_title(user_prompt: str, assistant_reply: Optional[str] = None) -> str:
    """Generate a clean, intelligent topic title from assistant reply or prompt."""
    if assistant_reply and assistant_reply.strip():
        # Look for leading markdown headers (e.g., ### How Emperor Akbar I died)
        match = re.search(r"^(?:#{1,4}|\*\*)\s*(.+?)(?:\*\*|\n|$)", assistant_reply.strip(), flags=re.MULTILINE)
        if match:
            header = _clean_title_text(match.group(1))
            # Ignore generic greetings or meta responses
            if 3 <= len(header) <= 55 and not header.lower().startswith(("here is", "sure", "hello", "yes", "i can", "of course")):
                return header[0].upper() + header[1:]

    cleaned = _clean_title_text(user_prompt)
    if not cleaned:
        return "Attachment File"

    # Strip conversational noise words for clean headline format
    trimmed = re.sub(
        r"^(?:can we|can you|could you|please|tell me|explain|what is|how to|why does|how did|justify|describe|show me)\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    trimmed = re.sub(r"^(?:went|just|about|a|the)\s+", "", trimmed, flags=re.IGNORECASE).strip()

    if not trimmed or len(trimmed) < 3:
        trimmed = cleaned

    words = trimmed.split()
    if len(words) > 6:
        trimmed = " ".join(words[:6]) + "..."
    elif len(trimmed) > 40:
        trimmed = trimmed[:40].rstrip() + "..."

    return trimmed[0].upper() + trimmed[1:]


def _title_from(text: str) -> str:
    return extract_smart_title(text)


def _owner(user_email: Optional[str]) -> Optional[str]:
    """Normalised account email, or None for a guest.

    Guests own nothing: every conversation helper below refuses to read, write
    or list when this is None, which is what keeps a signed-out visitor on a
    single, unsaved chat window.
    """
    if not user_email:
        return None
    cleaned = str(user_email).strip().lower()
    return cleaned or None


def _clean_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    d = dict(doc)
    d.pop("_id", None)
    return d


# --------------------------------------------------------------------------
# Conversations
# --------------------------------------------------------------------------


def create_conversation(first_message: str, user_email: Optional[str] = None) -> Optional[str]:
    """Start a stored thread for a signed-in user. Guests get None -- nothing persists."""
    owner = _owner(user_email)
    if owner is None:
        return None

    conversation_id = uuid.uuid4().hex[:12]
    now_ts = _now()
    doc = {
        "id": conversation_id,
        "user_email": owner,
        "title": _title_from(first_message),
        "created_at": now_ts,
        "updated_at": now_ts,
        "messages": [],
    }

    db = _get_db()
    if db is not None:
        try:
            db.conversations.insert_one(doc)
            return conversation_id
        except Exception as err:
            print("[MongoDB] insert_one error:", err)

    with _lock:
        _memory_conversations[conversation_id] = doc
    return conversation_id


def append_message(
    conversation_id: Optional[str],
    role: str,
    content: str,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> None:
    if not conversation_id:
        return
    new_msg = {
        "id": f"msg_{uuid.uuid4().hex[:10]}",
        "role": role,
        "content": content,
        "tools": tools or [],
        "at": _now(),
    }
    now_ts = _now()

    db = _get_db()
    if db is not None:
        try:
            # Only the tail matters here: the user turn this reply answers was
            # appended moments ago. Pulling the full array would grow the cost
            # of every single turn with the length of the thread.
            doc = db.conversations.find_one(
                {"id": conversation_id},
                {"messages": {"$slice": -6}, "title": 1},
            )
            update_payload: Dict[str, Any] = {
                "$push": {"messages": new_msg},
                "$set": {"updated_at": now_ts},
            }

            if role == "assistant" and doc:
                messages = doc.get("messages", [])
                user_msg = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
                smart_title = extract_smart_title(user_msg, content)
                if smart_title:
                    update_payload["$set"]["title"] = smart_title

            db.conversations.update_one(
                {"id": conversation_id},
                update_payload,
            )
            return
        except Exception as err:
            print("[MongoDB] update_one error:", err)

    with _lock:
        conversation = _memory_conversations.get(conversation_id)
        if conversation:
            conversation["messages"].append(new_msg)
            conversation["updated_at"] = now_ts
            if role == "assistant":
                user_msg = next((m.get("content", "") for m in reversed(conversation["messages"]) if m.get("role") == "user"), "")
                smart_title = extract_smart_title(user_msg, content)
                if smart_title:
                    conversation["title"] = smart_title


def get_conversation(
    conversation_id: str, user_email: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Fetch a thread the caller owns. Another account's id reads as missing."""
    owner = _owner(user_email)
    if owner is None:
        return None

    db = _get_db()
    if db is not None:
        try:
            doc = db.conversations.find_one({"id": conversation_id, "user_email": owner})
            if doc:
                return _clean_doc(doc)
        except Exception as err:
            print("[MongoDB] find_one error:", err)

    with _lock:
        c = _memory_conversations.get(conversation_id)
        return dict(c) if c and c.get("user_email") == owner else None


def list_conversations(user_email: Optional[str] = None) -> List[Dict[str, Any]]:
    """Newest first, without the message bodies -- the sidebar only needs titles.

    Scoped to one account; a guest gets an empty list and so never sees a
    thread picker.
    """
    owner = _owner(user_email)
    if owner is None:
        return []

    db = _get_db()
    if db is not None:
        try:
            # Count the messages server-side. Projecting the array itself would
            # drag every message body of every thread over the wire just to
            # call len() on it -- the sidebar only shows titles.
            cursor = db.conversations.find(
                {"user_email": owner},
                {
                    "_id": 0,
                    "id": 1,
                    "title": 1,
                    "created_at": 1,
                    "updated_at": 1,
                    "message_count": {"$size": {"$ifNull": ["$messages", []]}},
                },
            ).sort("updated_at", -1)
            rows = []
            for c in cursor:
                rows.append({
                    "id": c["id"],
                    "title": c.get("title", "New conversation"),
                    "created_at": c.get("created_at", _now()),
                    "updated_at": c.get("updated_at", _now()),
                    "message_count": c.get("message_count", 0),
                })
            return rows
        except Exception as err:
            print("[MongoDB] list_conversations error:", err)

    with _lock:
        rows = [
            {
                "id": c["id"],
                "title": c["title"],
                "created_at": c["created_at"],
                "updated_at": c["updated_at"],
                "message_count": len(c["messages"]),
            }
            for c in _memory_conversations.values()
            if c.get("user_email") == owner
        ]
    rows.sort(key=lambda c: c["updated_at"], reverse=True)
    return rows


def delete_conversation(conversation_id: str, user_email: Optional[str] = None) -> bool:
    owner = _owner(user_email)
    if owner is None:
        return False

    db = _get_db()
    if db is not None:
        try:
            res = db.conversations.delete_one({"id": conversation_id, "user_email": owner})
            return res.deleted_count > 0
        except Exception as err:
            print("[MongoDB] delete_one error:", err)

    with _lock:
        existing = _memory_conversations.get(conversation_id)
        if existing is None or existing.get("user_email") != owner:
            return False
        del _memory_conversations[conversation_id]
        return True


# --------------------------------------------------------------------------
# User Accounts (Auth Persistence)
# --------------------------------------------------------------------------


def register_user(email: str, password_hash: str) -> bool:
    normalized_email = email.strip().lower()

    with _lock:
        if normalized_email in _memory_users:
            _memory_users[normalized_email]["password_hash"] = password_hash
        else:
            _memory_users[normalized_email] = {
                "email": normalized_email,
                "password_hash": password_hash,
                "createdAt": _now(),
            }

    db = _get_db()
    if db is not None:
        try:
            existing = db.users.find_one({"email": normalized_email})
            if existing:
                db.users.update_one({"email": normalized_email}, {"$set": {"password_hash": password_hash}})
            else:
                doc = {
                    "email": normalized_email,
                    "password_hash": password_hash,
                    "createdAt": _now(),
                }
                db.users.insert_one(doc)
            print(f"[MongoDB] User registered/synced in MongoDB Atlas: {normalized_email}")
            return True
        except Exception as err:
            print("[MongoDB] User registration error:", err)

    return True


def login_user(email: str, password_hash: str) -> Optional[Dict[str, Any]]:
    e = email.strip().lower()
    db = _get_db()
    if db is not None:
        try:
            user = db.users.find_one({"email": e, "password_hash": password_hash})
            if user:
                return _clean_doc(user)
        except Exception as err:
            print("[MongoDB] login_user DB error:", err)

    with _lock:
        user = _memory_users.get(e)
        if user and user.get("password_hash") == password_hash:
            return dict(user)
    return None


def get_user(email: str) -> Optional[Dict[str, Any]]:
    e = email.strip().lower()
    db = _get_db()
    if db is not None:
        try:
            user = db.users.find_one({"email": e})
            if user:
                return _clean_doc(user)
        except Exception as err:
            print("[MongoDB] get_user DB error:", err)

    with _lock:
        user = _memory_users.get(e)
        return dict(user) if user else None


def update_user_profile(
    email: str,
    name: Optional[str] = None,
    avatar: Optional[str] = None,
    avatarImage: Optional[str] = None,
    new_password: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    e = email.strip().lower()
    update_fields: Dict[str, Any] = {}
    if name is not None:
        update_fields["name"] = name
    if avatar is not None:
        update_fields["avatar"] = avatar
    if avatarImage is not None:
        update_fields["avatarImage"] = avatarImage
    if new_password:
        update_fields["password_hash"] = new_password

    update_fields["updatedAt"] = _now()

    with _lock:
        if e not in _memory_users:
            _memory_users[e] = {"email": e, "createdAt": _now()}
        _memory_users[e].update(update_fields)

    db = _get_db()
    if db is not None:
        try:
            db.users.update_one({"email": e}, {"$set": update_fields}, upsert=True)
            user = db.users.find_one({"email": e})
            if user:
                return _clean_doc(user)
        except Exception as err:
            print("[MongoDB] update_user_profile DB error:", err)

    with _lock:
        return dict(_memory_users.get(e, {"email": e, **update_fields}))


# --------------------------------------------------------------------------
# Tool Calls Activity
# --------------------------------------------------------------------------


def record_tool_call(
    name: str, args: str, result: str, ok: bool, duration_ms: int
) -> None:
    entry = {
        "id": uuid.uuid4().hex[:12],
        "tool": name,
        "args": args,
        "result": result,
        "status": "success" if ok else "failed",
        "duration_ms": duration_ms,
        "at": _now(),
    }

    db = _get_db()
    if db is not None:
        try:
            db.tool_calls.insert_one(entry)
            return
        except Exception as err:
            print("[MongoDB] record_tool_call error:", err)

    with _lock:
        _memory_tool_calls.append(entry)
        if len(_memory_tool_calls) > MAX_TOOL_CALLS:
            del _memory_tool_calls[: len(_memory_tool_calls) - MAX_TOOL_CALLS]


def list_tool_calls(limit: int = 100) -> List[Dict[str, Any]]:
    db = _get_db()
    if db is not None:
        try:
            cursor = db.tool_calls.find({}, {"_id": 0}).sort("at", -1).limit(limit)
            return list(cursor)
        except Exception as err:
            print("[MongoDB] list_tool_calls error:", err)

    with _lock:
        return list(reversed(_memory_tool_calls[-limit:]))
