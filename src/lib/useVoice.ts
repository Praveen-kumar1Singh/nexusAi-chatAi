"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* -------------------------------------------------------------------------- */
/*  Voice in: the browser's Web Speech API                                    */
/* -------------------------------------------------------------------------- */

/**
 * TypeScript's DOM lib still ships no types for SpeechRecognition, and the
 * constructor is prefixed everywhere but Firefox. Only what we touch is typed.
 */
type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; 0: SpeechAlternative };
type SpeechResultList = { length: number; [index: number]: SpeechResult };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Support is fixed for the life of the page, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};
const hasRecognition = () => recognitionCtor() !== null;
const noRecognitionOnServer = () => false;

/**
 * Recognition errors a retry cannot fix. Everything else -- `no-speech` above
 * all, which is just what the recogniser calls a quiet stretch -- is routine and
 * clears the moment the mic is reopened, so a caller running a hands-free loop
 * should reopen rather than give up.
 */
const FATAL_INPUT_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

/** Is this recognition error worth abandoning the session for? */
export function isFatalInputError(code: string | null): boolean {
  return code !== null && FATAL_INPUT_ERRORS.has(code);
}

/** Recognition error codes, in words the person at the keyboard can act on. */
const INPUT_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone blocked. Allow it for this site in your browser settings.",
  "service-not-allowed": "Microphone blocked. Allow it for this site in your browser settings.",
  "audio-capture": "No microphone found.",
  "no-speech": "Didn't catch anything — try again.",
  network: "Speech recognition needs a network connection.",
};

/** Glue a dictated chunk onto whatever is already typed, without doubling spaces. */
export function joinSpoken(existing: string, chunk: string): string {
  const spoken = chunk.trim();
  if (!spoken) return existing;
  if (!existing.trim()) return spoken;
  return /\s$/.test(existing) ? existing + spoken : `${existing} ${spoken}`;
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;

/**
 * Dictation for the composer. `onFinal` fires once per settled phrase; the
 * words still being decided show up in `interim` so the user can see it working.
 */
export function useVoiceInput({
  lang = "en-US",
  onFinal,
  onChunk,
}: {
  lang?: string;
  onFinal: (chunk: string) => void;
  onChunk?: (chunk: string, isFinal: boolean) => void;
}) {
  // Server and first client paint both say "unsupported", so the mic button is
  // absent in the HTML either way and hydration has nothing to reconcile.
  const supported = useSyncExternalStore(noSubscribe, hasRecognition, noRecognitionOnServer);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The raw code behind `error`, for callers that treat some as recoverable. */
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The composer rebuilds callbacks every render. Holding the latest in a ref
  // keeps the recognition instance alive across a whole dictation session.
  const finalHandler = useRef(onFinal);
  const chunkHandler = useRef(onChunk);
  useEffect(() => {
    finalHandler.current = onFinal;
    chunkHandler.current = onChunk;
  }, [onFinal, onChunk]);

  useEffect(() => {
    const Recognition = recognitionCtor();
    if (!Recognition) return;

    const rec = new Recognition();
    rec.lang = lang;
    rec.continuous = true; // stay open for a whole thought, not one phrase
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setError(null);
      setErrorCode(null);
      setListening(true);
    };

    rec.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (text) {
          chunkHandler.current?.(text, result.isFinal);
        }
        if (result.isFinal) finalHandler.current(text);
        else pending += text;
      }
      setInterim(pending);
    };

    rec.onerror = (event) => {
      // `aborted` only ever means we called stop()/abort() ourselves.
      if (event.error === "aborted") return;
      setErrorCode(event.error);
      setError(INPUT_ERRORS[event.error] ?? `Voice input failed (${event.error}).`);
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognition.current = rec;
    return () => {
      recognition.current = null;
      rec.onend = null; // unmounting: no state updates on the way out
      rec.onresult = null;
      rec.onerror = null;
      rec.abort();
    };
  }, [lang]);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    setError(null);
    setErrorCode(null);
    try {
      rec.start();
    } catch {
      // Already running — start() throws rather than no-oping. Nothing to do.
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, interim, error, errorCode, start, stop, toggle };
}

/* -------------------------------------------------------------------------- */
/*  Voice out: KittenTTS, through /api/tts                                    */
/* -------------------------------------------------------------------------- */

/**
 * Markdown read aloud sounds like punctuation soup. Strip it back to prose
 * before handing it to the model.
 */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ". Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // keep the link text, drop the URL
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // tables do not narrate
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, " ")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Break a run of text too long to be one clip, at the best boundary available:
 * a clause break first, then any word gap, then a hard cut.
 */
function splitLong(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const clause = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
      window.lastIndexOf("\u2014"), // em dash, with or without spaces
      window.lastIndexOf("\u2013"),
    );
    const word = window.lastIndexOf(" ");

    // Only honour a boundary that leaves a clip worth synthesising on its own.
    let at = limit;
    if (clause > limit / 3) at = clause + 1;
    else if (word > limit / 3) at = word;

    // A dash left dangling at a clip's end gets voiced as a stray trailing
    // sound; the chunk boundary is already the pause it was standing in for.
    parts.push(rest.slice(0, at).trim().replace(/[\u2014\u2013-]+$/, "").trim());
    rest = rest.slice(at).trim();
  }

  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/**
 * Split prose into chunks worth one synthesis request each.
 *
 * The first chunk is deliberately small: nothing is heard until it comes back,
 * so it alone decides the turn's time-to-first-audio. Later chunks are larger
 * because playback is running by then and there is time in hand.
 */
export function speechChunks(text: string, first = 70, rest = 200): string[] {
  // Keep the terminator with its sentence; the trailing group catches text
  // that never ends in punctuation at all.
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  // One rambling sentence would otherwise set the whole turn's wait on its own.
  const units = sentences.flatMap((sentence) => splitLong(sentence, rest));

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    const limit = chunks.length === 0 ? first : rest;
    if (current && `${current} ${unit}`.length > limit) {
      chunks.push(current);
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current) chunks.push(current);

  // The opening clip is the only one anybody waits on in silence, so break it
  // down further when the reply happened to open with a long sentence.
  if (chunks.length > 0 && chunks[0].length > first) {
    chunks.splice(0, 1, ...splitLong(chunks[0], first));
  }

  return chunks.filter(Boolean);
}

/**
 * A sentence end, in both scripts the call supports.
 *
 * The whitespace has to be there. A bare terminator matches the dot in "3.14"
 * and the one in "Ms. Rao", and cutting a clip there says "Pi is about three."
 * It also makes the match monotonic while a reply streams: once a terminator
 * has a space after it, every longer prefix still has it, so text is only ever
 * released, never taken back.
 */
const SENTENCE_END = /[.!?\u0964](?=\s)/g;

/**
 * How much of a still-arriving reply can be spoken now.
 *
 * Only whole sentences: the tail of a stream is still growing, and synthesising
 * half a clause makes the pause land in the wrong place. Once `done`, the
 * remainder goes out whatever it ends with.
 */
export function readyToSpeak(markdown: string, done: boolean): string {
  let source = markdown;

  // An open code fence is still being written, and `speakable` renders it very
  // differently once it closes -- so hold everything from the fence onward.
  if (!done && (source.split("```").length - 1) % 2 === 1) {
    source = source.slice(0, source.lastIndexOf("```"));
  }

  const prose = speakable(source);
  if (done) return prose;

  let end = -1;
  for (const match of prose.matchAll(SENTENCE_END)) end = match.index;
  return end < 0 ? "" : prose.slice(0, end + 1);
}

/** How long to wait for more text before checking the queue again. */
const STREAM_POLL_MS = 60;

/** One chunk of audio, as an object URL ready to play. */
async function fetchClip(text: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `Speech failed (${res.status}).`);
  }
  return URL.createObjectURL(await res.blob());
}

/** Play one clip to the end. Resolves early, without error, if aborted. */
function playClip(
  url: string,
  signal: AbortSignal,
  hold: (el: HTMLAudioElement | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = new Audio(url);
    hold(el);

    const cleanup = () => {
      el.onended = null;
      el.onerror = null;
      signal.removeEventListener("abort", onAbort);
      hold(null);
    };
    function onAbort() {
      el.pause();
      cleanup();
      resolve(); // stopping is not a failure
    }

    el.onended = () => {
      cleanup();
      resolve();
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("Could not play the generated audio."));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    el.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error("Playback was blocked."));
    });
  });
}

function playBrowserSynthesis(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    signal.addEventListener("abort", () => {
      window.speechSynthesis.cancel();
      resolve();
    }, { once: true });
    window.speechSynthesis.speak(utterance);
  });
}

type SpeechStatus = {
  installed: boolean;
  voice: string;
  voices: string[];
  hint: string | null;
};

/**
 * What we report when the status request itself fails. A 404 means the agent is
 * running a build from before /tts existed -- overwhelmingly a process that was
 * started earlier and never restarted, so say that rather than "Not Found".
 */
function unreachable(status?: number): SpeechStatus {
  return {
    installed: false,
    voice: "",
    voices: [],
    hint:
      status === 404
        ? "The Python agent is running a build without the /tts route. Restart it: npm run dev:api"
        : "Cannot reach the speech service on the Python agent. Is it running? npm run dev:api",
  };
}

/** A reply being synthesised and played while it is still being written. */
type LiveRun = {
  /** Identifies the reply, so a new turn replaces this run instead of extending it. */
  key: string;
  controller: AbortController;
  /** Chunks waiting to be synthesised, in order. */
  queue: string[];
  /** How much of the prose has already been turned into queued chunks. */
  taken: number;
  /** No more text is coming. */
  ended: boolean;
  /** The drain loop is running; `push` only has to start it once. */
  draining: boolean;
  /** Object URLs to revoke when the run finishes. */
  urls: string[];
};

export type Speech = ReturnType<typeof useSpeech>;

/**
 * Plays replies through the Python service's KittenTTS endpoint, or falls back
 * to browser Web Speech API (window.speechSynthesis) when KittenTTS is unavailable.
 *
 * `enabled` is the composer's speaker toggle; the caller decides *when* to
 * speak, this hook only owns the request, the audio element and its cleanup.
 */
export function useSpeech() {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  /** Cancels the in-flight synthesis and playback of the current reply. */
  const run = useRef<AbortController | null>(null);
  /** The reply being spoken as it streams in. See `speakLive`. */
  const live = useRef<LiveRun | null>(null);
  /**
   * The run key `stop()` last cancelled. A reply that is still streaming keeps
   * arriving after the user interrupts it, and without this the next token
   * would start it playing again.
   */
  const cancelled = useRef<string | null>(null);

  // Is speech actually available? Answered once. `status` stays null only while
  // the question is still open -- a failure resolves to an unavailable status
  // carrying the reason, so the UI can explain the silence instead of just
  // being silent.
  useEffect(() => {
    let live = true;
    fetch("/api/tts", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as SpeechStatus) : unreachable(r.status)))
      .catch(() => unreachable())
      .then((data) => {
        if (live) setStatus(data);
      });
    return () => {
      live = false;
    };
  }, []);

  const stop = useCallback(() => {
    if (live.current) {
      cancelled.current = live.current.key;
      live.current.controller.abort();
      live.current = null;
    }
    run.current?.abort();
    run.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    audio.current?.pause();
    audio.current = null;
    setSpeaking(false);
  }, []);

  /**
   * Speak a reply, pipelined via KittenTTS if available, or browser speechSynthesis as fallback.
   */
  const speak = useCallback(
    async (markdown: string) => {
      const text = speakable(markdown);
      if (!text) return;

      stop(); // whatever was playing is now stale
      const controller = new AbortController();
      run.current = controller;
      const { signal } = controller;

      setError(null);
      setSpeaking(true);

      // If KittenTTS is available on server, use backend WAV generation
      if (status?.installed) {
        const played: string[] = [];
        try {
          const chunks = speechChunks(text);
          let upcoming = fetchClip(chunks[0], signal);

          for (let i = 0; i < chunks.length; i++) {
            const url = await upcoming;
            if (signal.aborted) return;
            played.push(url);

            // Kick off the next synthesis before playing this one
            upcoming =
              i + 1 < chunks.length
                ? fetchClip(chunks[i + 1], signal)
                : Promise.reject(new Error("done"));
            upcoming.catch(() => {});

            await playClip(url, signal, (el) => {
              audio.current = el;
            });
            if (signal.aborted) return;
          }
        } catch (err) {
          if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setError(err instanceof Error ? err.message : "Speech failed.");
        } finally {
          for (const url of played) URL.revokeObjectURL(url);
          if (run.current === controller) {
            run.current = null;
            setSpeaking(false);
          }
        }
      } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
        // Fallback: Browser Web Speech API TTS
        try {
          await playBrowserSynthesis(text, signal);
        } catch (err) {
          if (!signal.aborted) {
            setError(err instanceof Error ? err.message : "Speech synthesis failed.");
          }
        } finally {
          if (run.current === controller) {
            run.current = null;
            setSpeaking(false);
          }
        }
      }
    },
    [status?.installed, stop],
  );

  /**
   * Speak a reply while it is still streaming.
   *
   * `speak` above waits for the whole answer before making its first request,
   * which is right for the text chat -- the reply is already on screen. In a
   * hands-free call nothing is on screen, so that wait is dead air on every
   * turn. This takes the reply as it grows: each complete sentence is queued
   * the moment it lands, and playback starts on the first one while the model
   * is still writing the rest.
   *
   * Call it repeatedly with the same `key` and the full text so far; pass
   * `done` on the last call. A different `key` cancels the previous reply.
   *
   * Only the KittenTTS path streams. The browser fallback takes one utterance
   * and paces itself, so it is left to `speak`.
   */
  const speakLive = useCallback(
    (key: string, markdown: string, done: boolean) => {
      if (!status?.installed) {
        // No server speech: fall back to one utterance, once the reply is in.
        if (done) void speak(markdown);
        return;
      }
      if (cancelled.current === key) return; // interrupted; do not resurrect it

      if (live.current && live.current.key !== key) stop();

      if (!live.current) {
        if (!readyToSpeak(markdown, done)) return; // nothing whole to say yet
        cancelled.current = null;
        const controller = new AbortController();
        live.current = {
          key,
          controller,
          queue: [],
          taken: 0,
          ended: false,
          draining: false,
          urls: [],
        };
        setError(null);
        setSpeaking(true);
      }

      const current = live.current;
      const prose = readyToSpeak(markdown, done);
      const fresh = prose.slice(current.taken).trim();

      if (fresh) {
        // Only the very first clip is waited on in silence, so only it is kept
        // short; by the time the rest is needed, audio is already playing.
        const opening = current.taken === 0;
        current.queue.push(...speechChunks(fresh, opening ? undefined : 200));
        current.taken = prose.length;
      }
      if (done) current.ended = true;

      if (current.draining) return;
      current.draining = true;

      void (async () => {
        const { signal } = current.controller;
        /** The next chunk's synthesis, started before the current one plays. */
        let ahead: Promise<string> | null = null;
        try {
          while (!signal.aborted) {
            if (current.queue.length === 0) {
              if (current.ended) break;
              await new Promise((r) => setTimeout(r, STREAM_POLL_MS));
              continue;
            }

            const chunk = current.queue.shift() as string;
            const url = await (ahead ?? fetchClip(chunk, signal));
            ahead = null;
            if (signal.aborted) return;
            current.urls.push(url);

            // Queue the next synthesis before playing this clip, so the gap
            // between clips is playback time rather than waiting time.
            if (current.queue.length > 0) {
              ahead = fetchClip(current.queue[0], signal);
              ahead.catch(() => {});
            }

            await playClip(url, signal, (el) => {
              audio.current = el;
            });
          }
        } catch (err) {
          if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setError(err instanceof Error ? err.message : "Speech failed.");
        } finally {
          for (const url of current.urls) URL.revokeObjectURL(url);
          if (live.current === current) {
            live.current = null;
            setSpeaking(false);
          }
        }
      })();
    },
    [speak, status?.installed, stop],
  );

  // Turning the speaker off silences whatever is mid-sentence.
  const toggle = useCallback(() => {
    setEnabled((on) => {
      if (on) stop();
      return !on;
    });
  }, [stop]);

  useEffect(() => stop, [stop]);

  const hasBrowserTts = typeof window !== "undefined" && "speechSynthesis" in window;
  const isAvailable = status?.installed === true || (status !== null && hasBrowserTts);

  return {
    /** Null until status is fetched; true when KittenTTS server or browser speechSynthesis is available. */
    available: isAvailable ? true : status?.installed ?? null,
    /** Whether browser fallback TTS is being used instead of server KittenTTS */
    isFallback: !status?.installed && hasBrowserTts,
    /** Install instructions from the server, when KittenTTS is not installed and browser TTS is missing. */
    hint: !hasBrowserTts ? status?.hint ?? null : null,
    voice: status?.installed ? status?.voice ?? null : "Browser Voice",
    enabled,
    speaking,
    error,
    speak,
    /** Speak a reply as it streams in, rather than waiting for all of it. */
    speakLive,
    stop,
    toggle,
  };
}
