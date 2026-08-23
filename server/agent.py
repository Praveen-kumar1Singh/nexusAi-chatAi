"""The tool-calling loop.

Yields newline-delimited JSON events so the UI can render tool activity and
streamed text as they happen:

    {"type": "text",        "value": "..."}       one token
    {"type": "tool_call",   "name": ..., "args": ...}
    {"type": "tool_result", "name": ..., "result": ...}
    {"type": "error",       "value": "..."}
    {"type": "done"}
"""

import json
import time
from typing import Any, Dict, Iterator, List, Optional

import llm
import policy
import store
import tracing
from tools import run_tool, tool_schemas

# Safety net so a model that keeps calling tools can never loop forever.
MAX_TOOL_ROUNDS = 5

# Web search is slow, rate-limited, and rewording a failed query rarely helps --
# so it runs at most once per turn. Image generation is capped for a blunter
# reason: it is the one tool here that costs real money per call on a keyed
# provider, and a model that decides its first attempt was not good enough
# would happily spend all five rounds redrawing it. Everything else is
# deduplicated by arguments.
#
# generate_video is capped hardest of all, because both halves of that argument
# are worse for it: a clip costs cents rather than fractions of one, and takes
# minutes rather than seconds, so a model retrying it twice would bill the user
# twice and stall the turn past any reasonable wait.
ONCE_PER_TURN = {"web_search", "ask_options", "generate_image", "generate_video"}

# How hard gpt-oss thinks before it answers. Groq's default is "medium", which
# costs a second or two of silence per round -- unnoticeable in a written chat,
# but the dominant cost of a spoken turn, where nothing is heard until the whole
# reply is in. A spoken answer is two or three sentences, so the extra thinking
# buys very little; measured on the same prompt, "low" answered in 0.66s where
# the default took 2.18s and sometimes called another tool instead of replying.
VOICE_REASONING_EFFORT = "low"

# Sent once, when a round has asked only for work that was already done. The
# alternative -- refusing the call and letting it try again -- is what used to
# spend every remaining round rewording the same query.
ANSWER_NOW = (
    "You already have everything you are going to be given for this message. "
    "Answer the user now, in plain sentences, using only what is above. Do not "
    "call any tool. If what you have is not enough, say so and say what is missing."
)

# Said in the model's place when it will not stop calling tools long enough to
# write anything. Better than "Stopped after too many tool calls", which reads
# as a crash and tells the person nothing they can act on.
FELL_SHORT = (
    "I could not pull that together from what I found. Could you try asking it a "
    "different way?"
)

SYSTEM_PROMPT = """You are an assistant wired into a set of tools. Who you are and
what you say about yourself is set by the Identity section below.

Use web_search whenever the answer depends on something you do not reliably know:
current events, public facts, documentation, libraries, APIs, error messages,
prices, people or companies, and anything that may have changed since your training
data. Never invent those details -- search, then report what you found and cite the
source URL.

Always format all responses and web search results as clean, normal natural language text using Markdown (lists, headers, bold text, links). NEVER output raw JSON objects, raw tool call parameters, or code blocks containing raw JSON responses unless explicitly asked by the user to return JSON.

When a question is ambiguous and the answer would genuinely differ by choice --
above all, a programming concept with no language named ("what is a for loop") --
call ask_options first with 3 concrete choices instead of guessing or answering
for every option at once. Once the user has chosen, answer for that choice only.

Call generate_image when the user asks for a picture -- drawn, generated, designed,
illustrated, a logo, poster, icon or wallpaper. The image is displayed by the UI
from the tool result, so afterwards write one short line about what you made and
nothing else: never paste the URL and never describe the picture back to them.

If a tool returns an error, tell the user what failed plainly in natural language rather than printing raw JSON.

Answer in plain natural language. Lead with the direct answer, keep it concise
unless the user asks for detail, and add one short insight when it genuinely helps."""


def _event(**payload: Any) -> str:
    return json.dumps(payload) + "\n"


def _json(raw: str, key: str) -> Dict[str, Any]:
    """Tool arguments and results are JSON strings; traces read better parsed."""
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {key: parsed}
    except (ValueError, TypeError):
        return {key: raw}


def _format_error(exc: Exception) -> str:
    raw = str(exc)
    raw_lower = raw.lower()

    if "413" in raw or "request too large" in raw_lower or "tokens per minute" in raw_lower or "context_length" in raw_lower:
        return "The attached file or conversation context is too large for the model's memory limit. Please attach a smaller file or start a new conversation."
    if "429" in raw or "rate_limit" in raw_lower or "too many requests" in raw_lower:
        return "The AI service is temporarily rate limited. Please wait a moment before sending your next message."
    if "401" in raw or "authentication" in raw_lower or "api_key" in raw_lower:
        return "Authentication failed. Please verify your API key environment variable."
    if "500" in raw or "503" in raw or "service_unavailable" in raw_lower:
        return "The AI model service is temporarily unavailable. Please try again in a few moments."

    try:
        import re
        msg_match = re.search(r"['\"]message['\"]:\s*['\"]([^'\"]+)['\"]", raw)
        if msg_match:
            return msg_match.group(1)
    except Exception:
        pass

    return f"Request failed: {raw}"


def stream_chat(
    history: List[Dict[str, str]],
    conversation_id: Optional[str] = None,
    voice: bool = False,
) -> Iterator[str]:
    """Run the conversation to completion, yielding NDJSON event lines.

    `voice` marks a turn that will be spoken rather than displayed; it only
    changes how the answer is written, never what it is allowed to say.
    """
    # Whichever provider the configured key belongs to -- see llm.py.
    try:
        client, provider = llm.client()
    except ValueError as exc:
        yield _event(type="error", value=str(exc))
        yield _event(type="done")
        return

    model = provider.model
    # One trace per turn; a no-op unless LANGSMITH_TRACING is on. See tracing.py.
    turn = tracing.span(
        "Nexus turn",
        "chain",
        {"messages": history},
        conversation_id=conversation_id,
        model=model,
        provider=provider.name,
    )
    # Accumulated across tool rounds so the finished turn can be stored.
    answer = ""
    used_tools: List[Dict[str, Any]] = []
    # Guards against the model retrying the same work within one turn.
    already_run: Dict[str, str] = {}
    call_counts: Dict[str, int] = {}
    # Set when a round asked only for work that had already been done, which
    # means more rounds cannot produce anything new. The next one is made to
    # answer instead. See `extra_args` below.
    force_answer = False
    nudged = False  # ANSWER_NOW is worth saying once, not once per round
    # policy.apply is a temporary, removable restriction -- see policy.py.
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": policy.apply(SYSTEM_PROMPT, voice)}
    ]
    messages.extend({"role": m["role"], "content": m["content"]} for m in history)

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            round_span = turn.child(
                model,
                "llm",
                # Copied: `messages` keeps growing after the span is posted, and
                # the span should record what this round was actually given.
                {"messages": list(messages)},
                ls_provider=provider.name,
                ls_model_name=model,
                ls_model_type="chat",
            )
            # Attempt API call with multi-key and multi-model fallback retry on rate limits or model errors
            completion = None
            # Two constraints decide this list, and they cut it down hard.
            #
            # Every entry must accept a `tools` parameter, because the call below
            # always sends one: groq/compound, compound-mini and allam-2-7b all
            # answer a tools request with a 400 rather than ignoring it, so they
            # cannot stand in here however capable they otherwise are.
            #
            # And every entry must be on Groq's *production* list. qwen/qwen3.6-27b
            # is the other documented replacement for the retired llama-3.3-70b,
            # but it ships as Preview -- "may be discontinued at short notice" --
            # and a preview model in a fallback chain is what lands us back here
            # in six months. It also took a tools request without ever calling one.
            #
            # The previous list had gone dead in its entirety, which is why a
            # failed turn surfaced "qwen-2.5-coder-32b has been decommissioned":
            # the last corpse in the queue, not the cause.
            groq_models = [
                "openai/gpt-oss-120b",
                "openai/gpt-oss-20b",
            ]
            models_to_try = [model]
            if provider.name == "groq":
                for alt_m in groq_models:
                    if alt_m not in models_to_try:
                        models_to_try.append(alt_m)

            # The tools go on every request, including the ones that are meant to
            # stop calling them. Neither `tool_choice="none"` nor leaving `tools`
            # out works on gpt-oss: it emits the call regardless and Groq then
            # fails the whole request with "Tool choice is none, but model called
            # a tool". Saying so in a message is what actually lands -- and the
            # round after it is terminal either way, see `force_answer` below.
            extra_args: Dict[str, Any] = {
                "tools": tool_schemas(),
                "tool_choice": "auto",
            }

            # reasoning_effort is a Groq/gpt-oss parameter; sending it to another
            # provider would 400 the request.
            if voice and provider.name == "groq":
                extra_args["reasoning_effort"] = VOICE_REASONING_EFFORT

            if force_answer and not nudged:
                nudged = True
                messages.append({"role": "system", "content": ANSWER_NOW})

            last_exc = None
            rot_keys = llm.rotating_keys()
            attempts_per_model = max(len(rot_keys) * 2, 4)

            for try_model in models_to_try:
                model_unavailable = False
                # Rate limits are counted separately from other failures: they
                # are worth one try per key and no more. See below.
                rate_limited = 0
                for _attempt in range(attempts_per_model):
                    try:
                        curr_client, curr_provider = llm.client()
                        completion = curr_client.chat.completions.create(
                            model=try_model,
                            messages=messages,
                            temperature=0.6,
                            stream=True,
                            **extra_args,
                        )
                        break
                    except Exception as exc:
                        last_exc = exc
                        exc_str = str(exc).lower()
                        print(f"[agent] Error trying model {try_model}: {exc}", flush=True)

                        # If a model is decommissioned or invalid, skip to the next active model
                        if (
                            "decommissioned" in exc_str
                            or "not_found" in exc_str
                            or "model_not_found" in exc_str
                            or "does not exist" in exc_str
                        ):
                            model_unavailable = True
                            print(
                                f"[agent] Model '{try_model}' is decommissioned or invalid, skipping to next model...",
                                flush=True,
                            )
                            break

                        # A 429 is not worth hammering. Each key gets one try,
                        # in case they belong to different organisations -- but
                        # Groq counts tokens per organisation, so a set of keys
                        # cut from one account shares a single budget and the
                        # rest of the attempts only add delay to an error the
                        # user is going to see anyway. This was costing 10-25s
                        # of silence per turn once the daily limit was close.
                        if "rate_limit" in exc_str or "429" in exc_str:
                            rate_limited += 1
                            if rate_limited >= len(rot_keys):
                                break
                            continue

                        time.sleep(0.2)
                        continue

                if completion is not None:
                    break

            if completion is None:
                if last_exc:
                    raise last_exc
                raise RuntimeError("All API keys and fallback models failed.")

            text = ""
            # Streamed tool calls arrive in fragments keyed by `index`: the name
            # lands in the first fragment, arguments accumulate across many.
            pending: Dict[int, Dict[str, str]] = {}

            # A stream can fail after it has started -- gpt-oss occasionally emits
            # a tool name with its channel marker still attached
            # ("web_search<|channel|>commentary") and Groq rejects the call
            # mid-stream. That is raised here, past the retry loop above, and
            # used to kill the whole turn. Whatever arrived before the break is
            # kept, and the round is retried with tools switched off.
            try:
                for chunk in completion:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta

                    if getattr(delta, "content", None):
                        text += delta.content
                        yield _event(type="text", value=delta.content)

                    for call in getattr(delta, "tool_calls", None) or []:
                        slot = pending.setdefault(call.index, {"id": "", "name": "", "args": ""})
                        if call.id:
                            slot["id"] = call.id
                        if call.function and call.function.name:
                            slot["name"] = call.function.name
                        if call.function and call.function.arguments:
                            slot["args"] += call.function.arguments
            except Exception as exc:
                print(f"[agent] Stream broke mid-round: {exc}", flush=True)
                if text:
                    # Enough of an answer already arrived to stand on its own.
                    pending.clear()
                else:
                    # Nothing usable. Drop the half-built tool calls and let the
                    # next round answer from what it already has.
                    pending.clear()
                    if not force_answer:
                        force_answer = True
                        round_span.end(error=str(exc))
                        continue
                    raise

            answer += text
            calls = [pending[i] for i in sorted(pending)]
            round_span.end(
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": text,
                                "tool_calls": [
                                    {"name": c["name"], "arguments": c["args"]} for c in calls
                                ],
                            }
                        }
                    ]
                }
            )

            if not pending:
                # No tools requested -- the text we just streamed is the answer.
                if conversation_id:
                    store.append_message(conversation_id, "assistant", answer, used_tools)
                turn.end({"output": answer})
                yield _event(type="done")
                return

            if force_answer:
                # It was told to answer and asked for a tool anyway. Repeating
                # that is exactly the loop this guard exists to stop, so the turn
                # ends here on whatever it did manage to write.
                if not answer.strip():
                    answer = FELL_SHORT
                    yield _event(type="text", value=answer)
                if conversation_id:
                    store.append_message(conversation_id, "assistant", answer, used_tools)
                turn.end({"output": answer})
                yield _event(type="done")
                return

            messages.append(
                {
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["args"]},
                        }
                        for c in calls
                    ],
                }
            )

            # A round that only replays cached results or reads back refusals has
            # learned nothing, and letting it run again just spends another
            # round arriving at the same place.
            did_work = False

            for call in calls:
                name, args = call["name"], call["args"]
                signature = name + args

                # Already ran this exact call -- reuse it instead of paying for it twice.
                repeat = already_run.get(signature)
                capped = (
                    name in ONCE_PER_TURN and call_counts.get(name, 0) >= 1
                )

                if repeat is not None:
                    messages.append(
                        {"role": "tool", "tool_call_id": call["id"], "content": repeat}
                    )
                    continue

                if capped:
                    # Tell the model to stop rather than silently doing nothing.
                    refusal = json.dumps(
                        {
                            "error": "{} already ran for this message. Do not call it again -- "
                            "answer using what you have, or tell the user it "
                            "failed.".format(name)
                        }
                    )
                    messages.append(
                        {"role": "tool", "tool_call_id": call["id"], "content": refusal}
                    )
                    continue

                yield _event(type="tool_call", name=name, args=args)

                step = turn.child(name, "tool", _json(args, "input"))
                started = time.monotonic()
                result = run_tool(name, args)
                duration_ms = int((time.monotonic() - started) * 1000)

                already_run[signature] = result
                call_counts[name] = call_counts.get(name, 0) + 1

                # run_tool reports failures as {"error": ...} rather than raising.
                ok = '"error"' not in result[:20]
                step.end(_json(result, "output"), None if ok else result)
                store.record_tool_call(name, args, result, ok, duration_ms)
                used_tools.append({"name": name, "args": args, "result": result})

                yield _event(type="tool_result", name=name, result=result)
                messages.append(
                    {"role": "tool", "tool_call_id": call["id"], "content": result}
                )
                did_work = True

            force_answer = not did_work

        turn.end(error="Stopped after too many tool calls.")
        yield _event(type="error", value="Stopped after too many tool calls.")
        yield _event(type="done")

    except Exception as exc:
        user_err = _format_error(exc)
        turn.end(error=user_err)
        yield _event(type="error", value=user_err)
        yield _event(type="done")

    finally:
        # Closes the trace when the browser disconnects mid-stream. Ending a span
        # twice is a no-op, so the paths above still own their own outcome.
        turn.end({"output": answer})
