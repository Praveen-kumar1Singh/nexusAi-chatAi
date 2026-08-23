# Nexus AI

An AI data assistant: a Next.js UI talking to a **Python** agent that runs Groq
with LLM tool calling.

```
browser ──▶ Next.js /api/* (proxy) ──▶ FastAPI :8000 ──▶ Groq + tools
                                            │
                                            └── store.py (in-memory)
```

The Python service owns all model logic and all state. The Next routes are thin
proxies, so the browser only talks to its own origin and `GROQ_API_KEY` never
reaches the client.

**There is no mock data.** Every list in the UI — conversations, activity, tools,
permissions — is real data produced by the running system.

## Setup

1. Put your Groq key in `.env.local` (both sides read this one file):

   ```
   GROQ_API_KEY=gsk_your_key_here
   ```

2. Install the Python agent's dependencies once:

   ```bash
   npm run setup:api
   npm run setup:tts   # optional: spoken replies, needs Python >= 3.10 + espeak-ng
   ```

## Running it

Two processes, two terminals:

```bash
npm run dev:api    # FastAPI agent on :8000
npm run dev        # Next.js UI on :3000
```

Open <http://localhost:3000>. Check the agent alone at
<http://localhost:8000/health>.

## Answering policy

`server/policy.py` holds four sections, composed onto the base prompt by
`policy.apply()`. Three are always on; only the last can be switched off.

| Section | Request | Behaviour |
| --- | --- | --- |
| Secrets | API keys, passwords, tokens, env file contents | Replies exactly `I can't answer these type of questions.` and calls no tool |
| Identity | "who are you", "are you ChatGPT", "which model are you" | Answers as Nexus, built by an independent developer; never names the model or provider |
| Conduct | Rudeness, swearing, insults | Answers the question anyway, in a level tone — see below |
| Topic *(off)* | Anything outside IT / technology | Says it only covers IT topics; calls no tool |

### Identity

One answer, from one place. `ASSISTANT_NAME` (default `Nexus`) is the only copy
of the name — the base prompt in `agent.py` defers to this section rather than
repeating it. The rule holds through the usual pressure: insisting, claiming to
already know, "just between us", framing it as a test, or asking it to ignore
its instructions.

### Conduct

Hostility is treated as noise around the request, not as the request. This
matters most by voice, where recognition mishears ordinary words as crude ones,
so a single crude word in a normal sentence is read as a bad transcription
rather than an insult.

- Never matches the tone, never insults back, never threatens to end the chat.
- No lecture and no opening reprimand — that escalates.
- A question buried in an angry message gets answered **in full**. Being sworn
  at is never a reason to give a worse or shorter answer.
- Pure abuse with no request gets a brief acknowledgement and "what do you
  need?". If that has already happened once in the conversation, it adds one
  calm sentence asking them to keep it civil — said once, then dropped.
- A slur or abuse aimed at a person or group is the one thing never passed over
  in silence: one sentence declining it, then the rest of the answer as normal.

The turn-counting version of that fourth rule did not work — models do not
reliably count "third message running". Triggering on *whether it has happened
before in this conversation* is a presence check they can actually see, and it
fires reliably.

The topic restriction is still isolated enough to lift in one step:

```bash
TOPIC_POLICY=off   # in .env.local, then restart the agent
```

## Tracing (optional)

Turns can be traced to [LangSmith](https://smith.langchain.com). Add to `.env.local`:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_your_key_here
LANGSMITH_PROJECT=Chat-app
```

Restart the agent and each turn appears as a tree:

```
Nexus turn (chain)
├── openai/gpt-oss-120b (llm)   one span per tool round
├── web_search (tool)
└── openai/gpt-oss-120b (llm)
```

`server/tracing.py` is the whole integration. Without the flag and key every call
in it is a no-op, and any LangSmith failure is swallowed — tracing can slow a
turn down but never break one.

## Storage

Conversations and the tool-call log live in `server/store.py` — **in memory**, so
they clear when the agent restarts. That module is the seam for a database:
every read and write goes through its functions, so swapping in real persistence
touches one file.

| In memory today | Becomes |
| --- | --- |
| `_conversations` | `conversations` + `messages` tables |
| `_tool_calls` | `tool_calls` table |

## Layout

| Path | Role |
| --- | --- |
| `src/app/page.tsx` | Chat workspace; reads `?c=<id>` to open a thread |
| `src/app/security/` | Permissions derived from the tool registry + audit log |
| `src/app/activity/` | Real tool-call log, filterable |
| `src/lib/attachments.ts` | Reading and rendering attached text files |
| `src/app/api/` | Proxies: `chat`, `conversations`, `conversations/[id]`, `activity`, `tools` |
| `src/lib/useChat.ts` | Streaming client; owns conversation identity |
| `src/lib/agent.ts` | Server-side helpers for reaching the agent |
| `src/app/voice/page.tsx` | AI Voice Chat: hands-free speak-to-speak call + live transcript |
| `src/lib/useVoice.ts` | Dictation (Web Speech API) and spoken replies (KittenTTS) |
| `src/lib/useVoiceCall.ts` | Turn taking for the voice page: listen -> send -> speak -> listen |
| `server/tts.py` | KittenTTS wrapper: model loading, WAV encoding, espeak-ng lookup |
| `server/main.py` | FastAPI endpoints |
| `server/agent.py` | Groq streaming + tool-calling loop |
| `server/tools.py` | Tool schemas, implementations, and the registry |
| `server/store.py` | In-memory conversations and activity |
| `server/duckduckgo.py` | DuckDuckGo search client |
| `server/images.py` | Text-to-image provider resolution and generation |
| `src/app/tools/` | AI Tools hub and the Image Generator page |
| `src/components/chat/generated-image.tsx` | Renders a generated image in chat or the gallery |

## LLM tools

The agent decides which to call; the UI shows each call as an expandable card,
and every call is recorded to the activity log with its duration.

- **`ask_options`** — ask the user to pick from 3 choices before answering (`question`, `options`); the UI renders them as buttons
- **`web_search`** — search the public web via DuckDuckGo (`query`); returns the single best result, once per message
- **`generate_image`** — draw a picture from a description (`prompt`, `size`, `style`); the image appears in the turn, once per message

While a tool runs the chat shows a one-line status ("Searching the web…"). On
success the line disappears and only the answer remains — raw arguments and
results are never shown in the chat; they live on the Activity page. Failures
stay visible, so a broken step is never silent.

### Clarifying questions

When a question is ambiguous and the answer would differ by choice — "what is a
for loop" with no language named — the agent calls `ask_options` instead of
guessing. The UI turns the options into buttons; clicking one sends it as the
next message, and anything not offered can just be typed. Capped at one call per
turn, like `web_search`.

### File attachments

The paperclip in the composer accepts text files (see `ACCEPTED_EXTENSIONS` in
`src/lib/attachments.ts`). Files are read in the browser, capped at 2 MB and
20,000 characters, and appended to the message so the model reads them directly
— there is no separate parsing step or upload endpoint. Binary files are rejected
by scanning for control bytes rather than trusting the extension.

The stored message keeps the file body because the model needs it; the chat shows
the user a filename chip instead of pasting their file back at them.

### Voice

Two separate halves, both driven from the right-hand side of the composer:

**Mic — talking to it.** Dictation runs entirely in the browser on the Web Speech
API, so there is no audio upload and no speech endpoint. Settled phrases are
appended to whatever is already in the box; the words still being decided show
under the input as you speak. Review, edit, then send — dictation never
auto-submits. The button is absent where the API is not (Firefox, and any
non-secure origin other than localhost).

**Speaker — hearing it back.** Two engines, picked per request by the script
the text is written in: [KittenTTS](https://github.com/KittenML/KittenTTS) for
English, `facebook/mms-tts-hin` for Hindi. Both are CPU-only and small; see
[Hindi](#hindi) below. `server/tts.py` loads the model once on first use and returns a 24 kHz mono
WAV, which `/api/tts` carries to the browser. Markdown is stripped to prose
first (`speakable()`), because asterisks and code fences narrate badly, and long
replies are trimmed to 1200 characters on a sentence boundary so they end
cleanly rather than mid-word. Toggle it off and anything mid-sentence stops; a
new question cuts off the answer to the old one.

Speech is optional. Without it installed the endpoint reports why and the
speaker button renders disabled with the fix in its tooltip — the rest of the
agent is unaffected.

```bash
npm run setup:tts        # the wheel + numpy
brew install espeak-ng   # Debian: sudo apt-get install espeak-ng
```

Both are required. `espeak-ng` is the phonemiser KittenTTS calls, and the copy
bundled in `espeakng_loader` cannot be used: it ignores the data path it is
handed, looks for its own where it was compiled on a CI runner, and calls
`exit()` when that is missing — which would take the API server down mid-request.
`server/tts.py` therefore checks for a system espeak-ng *before* the model is
imported, and re-points phonemizer at it *after* (importing KittenTTS pulls in
`misaki.espeak`, which claims the wrapper for the broken build at import time).

### AI Voice Chat

`/voice` is the hands-free version, reachable from the sidebar. Start the call
and talk: it listens continuously, and 1.2 s of quiet ends your turn and sends
it. The reply is spoken back, then the mic reopens on its own — no button to
hold. Tap the orb while it is talking to cut in.

The mic is closed for the whole thinking and speaking stretch. That is what
keeps the agent's own voice out of the next question, and why the orb's phase
(listening / thinking / speaking) is worth watching.

A call is not a separate kind of thing: it goes through the same `useChat.send`
and `/api/chat` as typed messages, so it is stored as an ordinary conversation,
counts against the same credits, and appears in the sidebar history like any
other. The transcript panel shows the thread as it builds, including the turn
you are part-way through saying.

Selecting a thread from the sidebar while on `/voice` routes to `/?c=<id>`,
which the chat page reads on mount.

#### Latency

KittenTTS synthesises at a steady **~3x faster than realtime** on CPU — one
second of compute per three seconds of audio. That single number drives the
whole design:

| Stage | Cost |
| --- | --- |
| Silence detection (`SILENCE_MS`) | 1.2s, fixed |
| Model reply | ~0.8s |
| First audio chunk | ~2s |
| **Total, to first sound** | **~4s** |

Two things get it there, and removing either puts it back to ~36s:

**Replies are pipelined, not synthesised whole.** `speechChunks()` splits the
answer into clips and `useSpeech` requests the next while the current one plays.
Because synthesis outruns playback 3:1 the queue never runs dry, so only the
*first* clip is ever waited on in silence — which is why it is deliberately the
smallest, and why an over-long opening sentence gets broken at a clause
boundary rather than setting the whole turn's wait on its own.

**Spoken replies are written for the ear.** A voice turn sets `voice: true`,
which adds `VOICE_PROMPT`: two or three sentences, no markdown, no code, no
URLs. The same question answered for the screen ran 1087 characters — 99
seconds of talking; answered for the ear it is 273, or 25 seconds. Markdown is
the worst of it, since it is all stripped by `speakable()` before synthesis and
so costs generation time for nothing.

`SILENCE_MS` in `useVoiceCall.ts` is the one knob left worth touching. Lowering
it shortens every turn, at the risk of cutting people off mid-sentence.

#### Hindi

KittenTTS is English-only and cannot be configured otherwise — its phonemiser is
pinned to `en-us` and its token vocabulary contains no Devanagari. Feeding it
Hindi does not fail loudly; it mispronounces the text *and* speaks espeak's
language-switch markers aloud:

```
आप कैसे हैं?  → phonemes:    (hi)ˌaːp kˈɛːseː hɛ̃(en-us)?
              → model hears: hiˌaːp kˈɛːseː hɛenus?
```

So Hindi goes to a second engine, `facebook/mms-tts-hin` — a 36M VITS
checkpoint at 16 kHz that takes Devanagari directly, needs no romanisation step,
and synthesises around 5x faster than realtime, comfortably inside the latency
budget above.

`tts.is_hindi()` routes on the *share* of Devanagari letters, not their mere
presence: one Hindi word inside an English sentence is not worth switching for,
because the Hindi model would mispronounce the English around it. The client
sends one request per clip, so a reply that changes language part-way is routed
clip by clip.

`LANGUAGE_PROMPT` makes the agent answer in whatever language it was asked in,
**always writing Hindi in Devanagari** — including when the question arrived
romanised. That is a correctness requirement, not a style one: `aap kaise hain`
routes to the English engine and comes out wrong, where `आप कैसे हैं` routes to
Hindi and comes out right.

Speech *input* has no auto-detect — the Web Speech API takes one language per
session and will not guess. There is still nothing to set, because the language
is **derived from the conversation** rather than chosen:

`useVoiceCall` reads back through the thread for the last assistant reply
`detectLanguage()` has an opinion about, and listens in that. This works because
`LANGUAGE_PROMPT` makes the agent mirror whatever language it was addressed in,
so its reply is direct evidence of what the user is speaking.

It closes the loop even when the first turn is misheard. A recogniser set to
English hears Hindi as rough romanised text — but the *model* reads that
perfectly well and answers in Devanagari, so the next turn is listened for in
Hindi. One turn to settle, then it stays right, and it switches back just as
readily when the conversation returns to English. The browser's own
`navigator.languages` seeds the first turn, so a Hindi-reading visitor is
usually understood immediately.

`detectLanguage()` returns null rather than guess when there is too little to go
on — under ten letters, so a bare "ok" or a code fragment cannot flip the
microphone for the rest of the conversation — and the caller keeps looking
further back. `hi-IN` also covers the English words Hindi speakers mix in, so it
is the right setting for Hinglish rather than a strictly-Hindi one.

> **Not the best Hindi available.** [AI4Bharat's Indic-Parler-TTS](https://huggingface.co/ai4bharat/indic-parler-tts)
> is better — trained in India on 1806 h of Indian speakers, MOS 4.5 — but at
> 0.9B parameters it needs a GPU. MMS is the only Hindi model in KittenTTS's
> weight class, which is why it wins here.

Voice and model are set by `KITTEN_TTS_VOICE` and `KITTEN_TTS_MODEL` — see
`.env.example`. The eight voices are Bella, Jasper, Luna, Bruno, Rosie, Hugo,
Kiki and Leo; `GET /api/tts` lists them alongside whether speech is available.

> **Python 3.10 or newer.** KittenTTS 0.8.1 depends on spaCy, whose current
> builds do not support 3.9. `npm run setup:tts` checks this before installing
> anything. To rebuild an older venv:
> `rm -rf server/.venv && python3.10 -m venv server/.venv && npm run setup:api`.

**Restart the agent after installing.** The model itself loads lazily on the
first request, but `/tts` only exists in a process started from the current
`main.py`. An agent left running from before will answer 404, which the UI
reports as "running a build without the /tts route" rather than as a speech
failure.

### Web search

`server/duckduckgo.py` reads DuckDuckGo's `lite` HTML endpoint, falling back to
the classic `html` one. There is no API key and no third-party search package —
`httpx` already ships with the Groq SDK.

DuckDuckGo has no free official search API and rate-limits by IP, answering with
an HTTP 202 anti-bot page when it thinks you are a script. The client detects
that specifically, retries with backoff, and then raises `SearchUnavailable`
rather than returning an empty list — so the assistant reports the failure
instead of quietly answering from memory. Sponsored rows are filtered out.

**One search per message.** Rewording a blocked query never helps, and the model
would otherwise burn three rounds retrying, so `ONCE_PER_TURN` in `agent.py` caps
`web_search` at a single call per turn; further attempts get an error telling it
to answer or report the failure. Identical calls to any tool are also cached
within a turn rather than re-run.

**One result per search.** `MAX_WEB_RESULTS = 1` in `tools.py` clamps it, and the
schema has no `max_results` field so the model cannot widen it. Raise that
constant to get more results back.

If searches start failing, you are being rate-limited; wait a few minutes. For
heavy use, swap in a keyed search API — only `duckduckgo.py` would change.

### Image generation

Ask for a picture in chat ("draw a fox in tall grass") and the agent calls
`generate_image`; the image renders in the turn and stays with the saved thread.
The same tool has its own page under **AI Tools -> Image Generator** in the
sidebar, with style and shape controls and a gallery of what the account has
made.

**No setup required.** `server/images.py` resolves its own provider the way
`llm.py` does, but falls back to a keyless one, so a fresh clone can generate
without an account:

| Key | Provider | Model |
| --- | --- | --- |
| *(none)* | Pollinations | FLUX |
| `hf_...` | Hugging Face | FLUX.1-schnell |
| `tgp_v1_...` | Together AI | FLUX.1-schnell-Free |
| `sk-...` | OpenAI | gpt-image-1 |
| `AIza...` | Google | gemini-2.5-flash-image |

Set `IMAGE_API_KEY` and the provider follows; `IMAGE_PROVIDER`, `IMAGE_MODEL` and
`IMAGE_BASE_URL` override it. Groq is absent because it serves no image model,
which is why this resolves separately from the chat provider.

**Bytes are stored once, never linked.** Every provider hands back an image here,
which goes into MongoDB and is served from `/api/images/<id>` — so a saved
conversation still renders after the provider's temporary link has expired, and
one generation is paid for exactly once. Only the short id travels in the
conversation document; a base64 data URL would put a megabyte into the stream and
into every later read of the thread. Images expire after `IMAGE_RETENTION_DAYS`
(default 30) because a 1024px PNG is over a megabyte and Atlas' free tier is
512 MB.

**One image per message**, via `ONCE_PER_TURN` in `agent.py` — a model that
decides its first attempt was not good enough would otherwise spend every
remaining round redrawing it, on a provider that may bill per call.

### The tool loop

1. The request goes to Groq with all tool schemas attached.
2. If the model asks for a tool, the server runs it, records it, appends the
   result, and calls Groq again.
3. Repeats until the model answers in plain text (capped at `MAX_TOOL_ROUNDS = 5`).

Events stream back as newline-delimited JSON: `conversation`, `text`,
`tool_call`, `tool_result`, `error`, `done`.

### Adding a tool

Add one entry to the `TOOLS` dict in `server/tools.py` — a JSON schema plus the
Python function. The Tools page, the context panel, the permissions list and the
starter prompts all read the registry, so they pick it up with no UI changes.
