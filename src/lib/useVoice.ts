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
}: {
  lang?: string;
  onFinal: (chunk: string) => void;
}) {
  // Server and first client paint both say "unsupported", so the mic button is
  // absent in the HTML either way and hydration has nothing to reconcile.
  const supported = useSyncExternalStore(noSubscribe, hasRecognition, noRecognitionOnServer);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The composer rebuilds `onFinal` every render. Holding the latest in a ref
  // keeps the recognition instance alive across a whole dictation session.
  const finalHandler = useRef(onFinal);
  useEffect(() => {
    finalHandler.current = onFinal;
  }, [onFinal]);

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
      setListening(true);
    };

    rec.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalHandler.current(text);
        else pending += text;
      }
      setInterim(pending);
    };

    rec.onerror = (event) => {
      // `aborted` only ever means we called stop()/abort() ourselves.
      if (event.error === "aborted") return;
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

  return { supported, listening, interim, error, start, stop, toggle };
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
export function speechChunks(text: string, first = 90, rest = 200): string[] {
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

export type Speech = ReturnType<typeof useSpeech>;

/**
 * Plays replies through the Python service's KittenTTS endpoint.
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
    run.current?.abort();
    run.current = null;
    audio.current?.pause();
    audio.current = null;
    setSpeaking(false);
  }, []);

  /**
   * Speak a reply, pipelined.
   *
   * Synthesis runs about 3x faster than playback, so the next chunk is
   * requested while the current one is still playing and the queue stays
   * ahead. Only the first chunk is ever waited on in silence, which is why
   * speechChunks keeps it short -- it alone sets the time to first audio.
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

      const played: string[] = [];
      try {
        const chunks = speechChunks(text);
        let upcoming = fetchClip(chunks[0], signal);

        for (let i = 0; i < chunks.length; i++) {
          const url = await upcoming;
          if (signal.aborted) return;
          played.push(url);

          // Kick off the next synthesis before playing this one, so the
          // request overlaps the audio rather than following it.
          upcoming =
            i + 1 < chunks.length
              ? fetchClip(chunks[i + 1], signal)
              : Promise.reject(new Error("done"));
          upcoming.catch(() => {}); // the sentinel is expected; do not warn

          await playClip(url, signal, (el) => {
            audio.current = el;
          });
          if (signal.aborted) return;
        }
      } catch (err) {
        // Aborting is how stop() works, not a failure worth reporting.
        if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Speech failed.");
      } finally {
        for (const url of played) URL.revokeObjectURL(url);
        if (run.current === controller) {
          run.current = null;
          setSpeaking(false);
        }
      }
    },
    [stop],
  );

  // Turning the speaker off silences whatever is mid-sentence.
  const toggle = useCallback(() => {
    setEnabled((on) => {
      if (on) stop();
      return !on;
    });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    /** Null until the agent answers; false when the wheel is not installed. */
    available: status?.installed ?? null,
    /** Install instructions from the server, when it is not. */
    hint: status?.hint ?? null,
    voice: status?.voice ?? null,
    enabled,
    speaking,
    error,
    speak,
    stop,
    toggle,
  };
}
