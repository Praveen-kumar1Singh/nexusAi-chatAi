"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Sparkles,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTR, readAttachment } from "@/lib/attachments";
import { joinSpoken, useVoiceInput, type Speech } from "@/lib/useVoice";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PromptComposer({
  value,
  onChange,
  onSend,
  speech,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void;
  /** Spoken replies, owned by the chat page so it can decide when to speak. */
  speech?: Speech;
}) {
  const [model, setModel] = useState("…");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Dictation appends to whatever is already typed. It reads the box through a
  // ref rather than the `value` prop so two phrases landing in the same frame
  // stack up instead of the second overwriting the first.
  const draft = useRef(value);
  useEffect(() => {
    draft.current = value;
  }, [value]);

  const voice = useVoiceInput();
  const { transcript: spoken, reset: resetSpoken, stop: stopVoice } = voice;

  /**
   * `transcript` is the whole of what has been dictated so far, rewritten in
   * place as the recogniser changes its mind -- so the previous version is
   * lifted back out of the box before the new one goes in. Appending each
   * version instead is what had Chrome on Android stuttering a sentence back
   * word by word.
   */
  const inserted = useRef("");
  useEffect(() => {
    if (spoken === inserted.current) return;
    const head = draft.current.endsWith(inserted.current)
      ? draft.current.slice(0, draft.current.length - inserted.current.length)
      : draft.current;
    inserted.current = spoken;
    const next = joinSpoken(head, spoken);
    draft.current = next;
    onChange(next);
  }, [spoken, onChange]);

  /** Each press of the mic starts a new dictation rather than resuming the last. */
  const toggleDictation = useCallback(() => {
    if (voice.listening) {
      stopVoice();
      return;
    }
    inserted.current = "";
    resetSpoken();
    voice.start();
  }, [resetSpoken, stopVoice, voice]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setFileError(null);

    const added: Attachment[] = [];
    for (const file of Array.from(list)) {
      try {
        added.push(await readAttachment(file));
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "Could not read that file.");
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
  }

  function submit() {
    if (!value.trim() && attachments.length === 0) return;
    stopVoice(); // the thought is finished; stop holding the mic open
    inserted.current = "";
    resetSpoken();
    onSend(attachments);
    setAttachments([]);
    setFileError(null);
  }

  // Everything in this bar reflects the agent's real capabilities.
  useEffect(() => {
    fetch("/api/tools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { model?: string } | null) => {
        if (!data) return;
        if (data.model) setModel(data.model);
      })
      .catch(() => setModel("agent offline"));
  }, []);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  // Dictated text arrives without a keystroke, so the box has to be told to grow.
  useEffect(resize, [value]);

  const speakerOn = speech?.enabled ?? false;

  return (
    <div className="mx-auto w-full max-w-3xl px-2.5 sm:px-4 pb-3 sm:pb-5">
      {(attachments.length > 0 || fileError) && (
        <div className="mb-2 space-y-1.5">
          {attachments.map((file, i) => (
            <span
              key={file.name + i}
              className="mr-1.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] text-muted-foreground"
            >
              <FileText className="size-3" />
              {file.name}
              {file.truncated && <span className="text-warning">truncated</span>}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, x) => x !== i))}
                aria-label={`Remove ${file.name}`}
                className="transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {fileError && <p className="text-[11.5px] text-destructive">{fileError}</p>}
        </div>
      )}

      <div
        className={cn(
          "rounded-2xl border border-border bg-surface shadow-soft transition-colors focus-within:border-primary/40",
          voice.listening && "border-destructive/50 focus-within:border-destructive/50",
        )}
      >
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => {
            onChange(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask anything, or press mic to talk..."
          className="max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 sm:px-4 sm:pt-3.5 text-xs sm:text-[14.5px] leading-snug sm:leading-6 outline-none placeholder:text-xs sm:placeholder:text-[14.5px] placeholder:text-muted-foreground/70 transition-all"
        />

        {/* What the recogniser has heard but not yet settled on. */}
        {voice.listening && (
          <div className="flex items-start gap-2 px-4 pt-1.5" aria-live="polite">
            <span className="mt-[7px] flex shrink-0 gap-[3px]">
              {[0, 140, 280].map((delay) => (
                <span
                  key={delay}
                  className="size-1 animate-bounce rounded-full bg-destructive"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1 text-[13px] italic leading-6 text-muted-foreground">
              {voice.interim || "Listening…"}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ""; // let the same file be picked again
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a text file"
            title="Attach a text file"
          >
            <Paperclip className="size-4" />
          </Button>

          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-muted-foreground font-medium"
            title="Tools are automatically routed"
          >
            <Wrench className="size-3.5" />
            <span>Auto</span>
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="hidden sm:inline-flex items-center gap-1.5 px-2 text-[11.5px] text-muted-foreground font-medium"
              title={`Powered by ${model}`}
            >
              <Sparkles className="size-3 text-primary/70" />
              <span>Optimized Model</span>
            </span>

            {/* Dictation. Absent entirely where the browser has no Web Speech API. */}
            {voice.supported && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative size-8 text-muted-foreground",
                  voice.listening && "bg-destructive/12 text-destructive hover:bg-destructive/20",
                )}
                onClick={toggleDictation}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? "Stop dictation" : "Dictate a message"}
                title={voice.listening ? "Stop listening" : "Speak your message"}
              >
                {voice.listening && (
                  <span className="absolute inset-0 animate-ping rounded-md bg-destructive/20" />
                )}
                <Mic className="relative size-4" />
              </Button>
            )}

            <Button
              size="icon"
              className="size-8 rounded-lg"
              disabled={!value.trim() && attachments.length === 0}
              onClick={submit}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {(voice.error || speech?.error) && (
        <p className="mt-2 text-center text-[11.5px] text-destructive">
          {voice.error ?? speech?.error}
        </p>
      )}

      <p className="mt-2 text-center text-[11.5px] text-muted-foreground/70">
        Nexus AI can make mistakes. Verify important information.
      </p>
    </div>
  );
}
