"""One-off: move accounts and sessions out of the `test` database.

The Next.js half calls `client.db(process.env.MONGODB_DB)`. Where that variable
is unset -- Vercel, which never sees .env.local -- the driver does not fail: it
falls back to the database named in the connection string, and this URI names
none, so it silently uses `test`. The Python agent meanwhile defaults to
`mantraa_ai`. The result is one app on two databases: real accounts, sessions
and payments in `test`, conversations expected in `mantraa_ai`.

Run this after setting MONGODB_DB=mantraa_ai everywhere, from server/:

    ./.venv/bin/python merge_test_db.py            # show what would move
    ./.venv/bin/python merge_test_db.py --apply    # actually move it

Documents already in the target are updated only where `test` holds the newer
copy, judged by `updatedAt`/`createdAt`. Nothing is deleted from `test`.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
load_dotenv(Path(__file__).resolve().parent / ".env")

APPLY = "--apply" in sys.argv
TARGET = os.environ.get("MONGODB_DB", "mantraa_ai")

uri = os.environ.get("MONGODB_URI")
if not uri:
    raise SystemExit("MONGODB_URI is not set -- check .env.local")

if TARGET == "test":
    raise SystemExit("MONGODB_DB is 'test' -- set it to the real database first.")

try:
    import certifi

    client = MongoClient(uri, serverSelectionTimeoutMS=8000, tlsCAFile=certifi.where())
    client.admin.command("ping")
except Exception:
    client = MongoClient(uri, serverSelectionTimeoutMS=8000, tls=True)
    client.admin.command("ping")

source = client["test"]
target = client[TARGET]

print(f"{'MOVING' if APPLY else 'DRY RUN -- would move'}  test  ->  {TARGET}\n")


def stamp(doc: dict) -> str:
    """Whichever timestamp the document actually carries."""
    return str(doc.get("updatedAt") or doc.get("createdAt") or "")


moved = kept = 0
for user in source.users.find({}):
    user.pop("_id", None)
    email = user.get("email")
    if not email:
        continue

    existing = target.users.find_one({"email": email})
    if existing and stamp(existing) >= stamp(user):
        print(f"  user  {email}: target copy is newer or equal, left alone")
        kept += 1
        continue

    verb = "update" if existing else "insert"
    print(f"  user  {email}: {verb} (plan={user.get('plan')}, credits={user.get('credits')})")
    if APPLY:
        target.users.update_one({"email": email}, {"$set": user}, upsert=True)
    moved += 1

sessions = 0
for session in source.sessions.find({}):
    session.pop("_id", None)
    token = session.get("token")
    if not token or target.sessions.find_one({"token": token}):
        continue
    if APPLY:
        target.sessions.insert_one(session)
    sessions += 1

print(f"\nusers moved: {moved}   users left alone: {kept}   sessions carried over: {sessions}")
if not APPLY:
    print("\nNothing was written. Re-run with --apply to do it.")
else:
    print("\nDone. `test` was not modified -- drop it by hand once you are satisfied.")
