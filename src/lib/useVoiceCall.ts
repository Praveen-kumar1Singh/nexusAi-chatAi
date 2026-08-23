"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isFatalInputError, joinSpoken, useSpeech, useVoiceInput } from "@/lib/useVoice";
import type { Message } from "@/lib/types";

/**
 * Hands-free turn taking for the voice page.
 *
 * The loop is: listen -> the speaker goes quiet -> send -> think -> speak the
 * reply -> listen again. The mic is closed for the whole thinking and speaking
 * stretch, which is what stops the agent's own voice being transcribed straight
 * back in as the next question.
 *
 * Everything is sent through the ordinary `useChat.send`, so a voice call is
 * stored as a normal conversation and shows up in the sidebar like any other.
 */

export type CallPhase = "idle" | "listening" | "thinking" | "speaking";

/**
 * Languages the call can listen in. The Web Speech API takes one language per
 * session and cannot detect it itself, so one of these has to be chosen up
 * front -- but nobody has to choose it by hand; see `spokenLanguage` below.
 *
 * `hi-IN` also copes with the English words Hindi speakers mix in, so it is the
 * right setting for Hinglish rather than a strictly-Hindi one.
 */
export const CALL_LANGUAGES = [
  { code: "en-US", label: "English" },
  { code: "hi-IN", label: "हिन्दी" },
] as const;

export type CallLanguage = (typeof CALL_LANGUAGES)[number]["code"];

const DEVANAGARI = /[\u0900-\u097F]/g;
const LETTERS = /[^\W\d_]/gu;

/** Below this many letters there is not enough to judge. See detectLanguage. */
const ENOUGH_LETTERS = 10;

/**
 * Which language a piece of text is in, or null when it is not worth an
 * opinion. Mirrors `tts.is_hindi` on the server: a share of Devanagari, not its
 * mere presence, so a Hindi reply quoting `list` and `tuple` still reads as
 * Hindi and an English one quoting a single Hindi word still reads as English.
 *
 * Null on anything too short to be evidence -- "ok", a bare code fragment --
 * because the alternative is a two-character reply flipping the microphone to
 * the wrong language for the rest of the conversation. The caller keeps looking
 * further back when it gets null.
 */
export function detectLanguage(text: string): CallLanguage | null {
  const letters = text.match(LETTERS)?.length ?? 0;
  if (letters < ENOUGH_LETTERS) return null;
  return (text.match(DEVANAGARI)?.length ?? 0) / letters >= 0.2 ? "hi-IN" : "en-US";
}

/**
 * Voice commands that automatically cut / end the active call.
 * Supports English and Hindi phrasing ("end call", "exit", "cut call", "call band karo", "bye", etc.)
 */
const EXIT_COMMAND_PATTERN = /(?:^|\s)(?:end\s*(?:the\s*)?call|exit|cut\s*(?:the\s*)?call|stop\s*(?:the\s*)?call|hang\s*up|bye|goodbye|call\s*end|call\s*cut|call\s*band|band\s*karo|exit\s*call|close\s*call|end\s*voice|disconnect)(?:\s|$)/i;

export function isExitCommand(text: string): boolean {
  return EXIT_COMMAND_PATTERN.test(text.trim());
}

/** Support is fixed for the life of the page, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/** What the browser says its owner reads, used until the call knows better. */
function preferredLanguage(): CallLanguage {
  if (typeof navigator === "undefined") return "en-US";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const lower = (tag ?? "").toLowerCase();
    if (lower.startsWith("hi")) return "hi-IN";
    if (lower.startsWith("en")) return "en-US";
  }
  return "en-US";
}

const englishOnServer = (): CallLanguage => "en-US";

/** How long the speaker has to stay quiet before the turn counts as finished. */
const SILENCE_MS = 1200;

/** Recognition stops itself periodically; this is how soon we reopen the mic. */
const REOPEN_MS = 250;

export function useVoiceCall(chat: {
  messages: Message[];
  isLoading: boolean;
  send: (text: string, opts?: { voice?: boolean }) => void;
}) {
  const [active, setActive] = useState(false);
  /** What has been heard so far this turn, shown live under the orb. */
  const [heard, setHeard] = useState("");

  const speech = useSpeech();
  // useSpeech and useVoiceInput return a fresh object every render, but the
  // callbacks inside are stable. Destructuring is what keeps the transitions
  // below stable too, rather than rebuilding on every render.
  const { speakLive, stop: stopSpeech, speaking } = speech;

  /**
   * The phase is derived, never stored. A call is thinking when the stream is
   * open, speaking while audio is playing, and listening the rest of the time --
   * so there is no second copy of the state to get stuck in a phase that has no
   * way out.
   */
  const phase: CallPhase = !active
    ? "idle"
    : speaking
      ? "speaking"
      : chat.isLoading
        ? "thinking"
        : "listening";

  // Read from callbacks that fire outside React's render cycle.
  const activeRef = useRef(active);
  const phaseRef = useRef<CallPhase>(phase);
  useEffect(() => {
    activeRef.current = active;
    phaseRef.current = phase;
  }, [active, phase]);

  // Seeded from the browser's own preferences, so a Hindi-reading visitor is
  // usually understood on the very first sentence rather than the second.
  const preferred = useSyncExternalStore(noSubscribe, preferredLanguage, englishOnServer);

  /**
   * The language to listen in, derived from the conversation rather than asked
   * for. The agent mirrors whatever language it was addressed in, so its last
   * reply is the best available evidence of what the user is speaking.
   *
   * That closes the loop even when the first turn was misheard: the recogniser
   * set to English hears Hindi as rough romanised text, the model reads it
   * perfectly well anyway and answers in Devanagari, and the next turn is
   * listened for in Hindi. One turn to settle, then it stays right -- and it
   * switches back just as readily when the conversation returns to English.
   */
  const lang: CallLanguage = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const message = chat.messages[i];
      if (message.role !== "assistant" || !message.content) continue;
      const guess = detectLanguage(message.content);
      if (guess) return guess;
    }
    return preferred;
  }, [chat.messages, preferred]);

  const pending = useRef("");
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSilence = useCallback(() => {
    if (silence.current) {
      clearTimeout(silence.current);
      silence.current = null;
    }
  }, []);

  // The flush timer and `send` reference each other, so the callback lives in a
  // ref and the timer only ever reads the current one.
  const flushRef = useRef<() => void>(() => {});

  const voice = useVoiceInput({
    lang,
    onChunk: (chunk, isFinal) => {
      if (!activeRef.current) return;
      const trimmed = chunk.trim();
      if (!trimmed) return;

      // The mic is shut for the whole thinking-and-speaking stretch, so anything
      // arriving here is the user -- never the agent's own reply coming back in
      // through the speakers.
      if (phaseRef.current !== "listening") return;

      // Hang up on request: "end call", "cut call", "call band karo", "bye".
      if (isExitCommand(trimmed) || isExitCommand(pending.current + " " + trimmed)) {
        endRef.current();
        return;
      }

      if (isFinal) {
        pending.current = joinSpoken(pending.current, trimmed);
        setHeard(pending.current);
        clearSilence();
        silence.current = setTimeout(() => flushRef.current(), SILENCE_MS);
      }
    },
    onFinal: () => {},
  });

  const { start: startMic, stop: stopMic, listening, error: micError } = voice;

  /**
   * `no-speech` is simply what the recogniser reports for a quiet stretch, and a
   * hands-free call is full of them -- reopening the mic clears it. Only a
   * blocked or missing device is worth dropping the call for, so the rest of
   * this hook keys off `micFatal` rather than the presence of any error at all.
   */
  const micFatal = isFatalInputError(voice.errorCode);

  /** Send whatever has been heard; the stream opening moves us to "thinking". */
  const flush = useCallback(() => {
    clearSilence();
    const text = pending.current.trim();
    pending.current = "";
    setHeard("");
    if (!activeRef.current || !text) return;

    stopMic(); // close the mic before the reply starts playing
    chat.send(text, { voice: true });
  }, [chat, clearSilence, stopMic]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /**
   * Mic follows phase: open while "listening", shut for everything else.
   *
   * It has to stay shut while the agent speaks. There is no echo cancellation
   * between the audio element and the recogniser, so an open mic transcribes the
   * reply coming out of the speakers and feeds it straight back in -- which both
   * cut the answer off mid-sentence and, when the reply happened to contain a
   * word like "bye", hung up the call.
   */
  useEffect(() => {
    if (phase === "listening") {
      if (listening || micFatal) return;
      const timer = setTimeout(startMic, REOPEN_MS);
      return () => clearTimeout(timer);
    }
    if (listening) stopMic();
  }, [phase, listening, micFatal, startMic, stopMic]);

  /**
   * Read each reply out loud as it is written.
   *
   * Waiting for the finished reply put the whole of the model's writing time
   * into a silence the caller sat through, on every single turn. `speakLive`
   * takes the answer as it grows and starts on the first complete sentence, so
   * the rest is composed while audio is already playing.
   */
  const skipIndex = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const index = chat.messages.length - 1;
    const last = chat.messages[index];
    if (!last || last.role !== "assistant" || !last.content || last.error) return;
    if (skipIndex.current === index) return; // already on screen when the call joined
    speakLive(String(index), last.content, !chat.isLoading);
  }, [active, chat.isLoading, chat.messages, speakLive]);

  const end = useCallback(() => {
    setActive(false);
    clearSilence();
    pending.current = "";
    setHeard("");
    stopMic();
    stopSpeech();
  }, [clearSilence, stopMic, stopSpeech]);

  const start = useCallback(() => {
    pending.current = "";
    setHeard("");
    // Joining a thread that already has a reply on screen should not replay it.
    skipIndex.current = chat.messages.length - 1;
    setActive(true);
  }, [chat.messages]);

  /**
   * Cut the agent off. Stopping playback is all that is needed -- the phase
   * falls back to listening on its own, and the mic effect reopens.
   */
  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    stopSpeech();
  }, [stopSpeech]);

  // A blocked mic cannot be recovered by retrying; drop the call so the page can
  // show why instead of sitting in "listening" forever. Recoverable errors are
  // deliberately excluded -- see micFatal.
  useEffect(() => {
    if (micFatal && activeRef.current) end();
  }, [micFatal, end]);

  // Unmount only. Held in a ref so this never depends on `end`'s identity --
  // leaving a call running is not something a re-render should be able to undo.
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  }, [end]);
  useEffect(() => () => endRef.current(), []);

  return {
    phase,
    heard,
    /** Which language the mic is currently listening in, decided automatically. */
    lang,
    /** Words still being decided, straight from the recogniser. */
    interim: voice.interim,
    supported: voice.supported,
    /** Only errors the call cannot recover from; a quiet stretch is not one. */
    micError: micFatal ? micError : null,
    speechError: speech.error,
    /** Null until status is checked; false when neither KittenTTS nor browser TTS is available. */
    speechAvailable: speech.available,
    speechFallback: speech.isFallback,
    speechHint: speech.hint,
    voiceName: speech.voice,
    active,
    start,
    end,
    interrupt,
  };
}
