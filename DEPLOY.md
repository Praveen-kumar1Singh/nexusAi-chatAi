# Deploying: Vercel + Render

The app is two processes and they split cleanly along a line that already exists
in the code: the browser only ever talks to Next.js, and Next.js is the only
thing that talks to the Python agent (`src/lib/agent.ts`, over `AGENT_URL`).

```
browser  ->  Vercel (Next.js: UI, /api/*, auth, credits, Razorpay)
                 |  AGENT_URL + x-agent-token
                 v
             Render (FastAPI: LLM calls, tools, conversation store, TTS)
                 |
                 +-- MongoDB Atlas <-- also used directly by Vercel
```

Nothing about local development changes: with `AGENT_TOKEN` unset, the agent
accepts calls exactly as before.

## 1. Render (the Python agent)

`render.yaml` is a blueprint -- **New > Blueprint** in Render, point it at this
repo, and it reads the whole config (`rootDir: server`, build, start command,
health check). Or create a Web Service by hand with:

- Root Directory: `server`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/health`

Environment variables to set on Render:

| Variable | Value |
| --- | --- |
| `LLM_API_KEY` | your Groq/OpenAI/OpenRouter/Anthropic key (comma-separate to rotate) |
| `MONGODB_URI` | the Atlas connection string |
| `MONGODB_DB` | `mantraa_ai` |
| `AGENT_TOKEN` | a long random string -- **the same one goes on Vercel** |
| `LLM_MODEL`, `TOPIC_POLICY`, `ASSISTANT_NAME` | optional, defaults in `render.yaml` |
| `PYTHON_VERSION` | `3.11.9` |

Confirm it came up: `curl https://<service>.onrender.com/health` should report
`"key_loaded": true`, `"auth_required": true`, and

```json
"storage": { "backend": "mongodb-atlas", "durable": true, "database": "mantraa_ai" }
```

**Check that `durable` is `true` before you believe anything is being saved.**
When Atlas cannot be reached, `store.py` falls back to an in-memory dict and
keeps answering normally -- conversations save, list and reload for as long as
the process lives, then vanish at the next restart or free-plan sleep. The
`error` field alongside it says why; the usual answer is section 3 below.

## 2. Vercel (the Next.js app)

Import the same repo; the defaults for a Next.js project are correct and
`.vercelignore` keeps `server/` out of the upload. Environment variables:

| Variable | Value |
| --- | --- |
| `AGENT_URL` | `https://<service>.onrender.com` -- no trailing slash |
| `AGENT_TOKEN` | the same value as on Render |
| `MONGODB_URI`, `MONGODB_DB` | Atlas -- Next.js reads it directly for auth, sessions and credits |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` | payments |

## 3. MongoDB Atlas

Both hosts get dynamic outbound IPs, so Network Access needs `0.0.0.0/0` (or
Atlas' Vercel/Render integrations). An IP allowlist that only has your laptop in
it is the usual cause of a deploy that starts fine and then 500s.

## Things worth knowing before they bite

**`AGENT_TOKEN` is not optional here.** The agent takes the account from the
`x-user-email` header its proxy sends, and once it has a public URL that header
is forgeable by anyone -- reading another user's conversations, or skipping the
credit checks in `/api/chat` entirely. The token is what keeps the Render URL
usable only by Vercel. Set it on both sides, or don't expose the service.

**Render's free plan sleeps** after 15 minutes idle and takes ~50s to wake.
`/api/chat` gives up at 60s (`maxDuration`), so the first message after a quiet
spell can fail outright. The blueprint asks for `starter` for that reason; on
`free`, expect the cold start or ping `/health` on a schedule to stay warm.

**Speech (TTS) is left out of the Render build.** `requirements-tts.txt` pulls
in torch and transformers -- far past what a small instance holds in RAM, and a
slow build. `requirements.txt` alone means `/tts/voices` reports unavailable and
the UI hides the speaker button on its own. To turn it on, move to an instance
with real memory and change the build command to install both files.

**Vercel caps a chat turn at 60s.** Long tool-using turns stream fine, but a turn
that runs past a minute is cut off mid-stream. Raise `maxDuration` in
`src/app/api/chat/route.ts` if your plan allows more.
