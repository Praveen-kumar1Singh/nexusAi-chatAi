"""One-off: give existing accounts the Free Starter plan.

Accounts created before the register route granted a plan have no `plan` field
at all. /api/chat reads that as "none" and answers 402 PLAN_REQUIRED, so the
turn never reaches the agent and no conversation is ever stored.

Run once, from the server directory:

    ./.venv/bin/python backfill_plans.py

Accounts that already have a plan are left exactly as they are.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

FREE_PLAN_CREDITS = 50

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
load_dotenv(Path(__file__).resolve().parent / ".env")

uri = os.environ.get("MONGODB_URI")
if not uri:
    raise SystemExit("MONGODB_URI is not set -- check .env.local")

try:
    import certifi

    client = MongoClient(uri, serverSelectionTimeoutMS=8000, tlsCAFile=certifi.where())
    client.admin.command("ping")
except Exception:
    client = MongoClient(uri, serverSelectionTimeoutMS=8000, tls=True)
    client.admin.command("ping")

db = client[os.environ.get("MONGODB_DB", "mantraa_ai")]
now = datetime.now(timezone.utc).isoformat()

result = db.users.update_many(
    {"plan": {"$exists": False}},
    {
        "$set": {
            "plan": "free",
            "credits": FREE_PLAN_CREDITS,
            "planActivatedAt": now,
            "updatedAt": now,
        }
    },
)

print(f"accounts given the Free Starter plan: {result.modified_count}")
for user in db.users.find({}, {"_id": 0, "password_hash": 0}):
    print("  ", user.get("email"), "->", user.get("plan"), user.get("credits"), "credits")
