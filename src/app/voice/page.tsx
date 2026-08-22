"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Crown,
  FileText,
  Hexagon,
  Loader2,
  Lock,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/chat/app-shell";
import { AIMessage, UserMessage } from "@/components/chat/chat-messages";
import { MessageMarkdown } from "@/components/chat/message-markdown";
import { Button } from "@/components/ui/button";
import { useChat } from "@/lib/useChat";
import { CALL_LANGUAGES, useVoiceCall, type CallPhase } from "@/lib/useVoiceCall";
import { useSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** How each phase presents itself: ring colour, label, and the line underneath. */
const PHASES: Record<CallPhase, { tone: string; ring: string; label: string; hint: string }> = {
  idle: {
    tone: "text-muted-foreground",
    ring: "border-border bg-surface",
    label: "Ready when you are",
    hint: "Start the call and just talk — no button to hold.",
  },
  listening: {
    tone: "text-primary",
    ring: "border-primary/50 bg-primary/10",
    label: "Listening",
    hint: "Stop talking for a moment and I'll answer.",
  },
  thinking: {
    tone: "text-warning",
    ring: "border-warning/50 bg-warning/10",
    label: "Thinking",
    hint: "Working out the answer…",
  },
  speaking: {
    tone: "text-success",
    ring: "border-success/50 bg-success/10",
    label: "Speaking",
    hint: "Tap the orb to cut in and talk over me.",
  },
};

function Orb({ phase, onInterrupt }: { phase: CallPhase; onInterrupt: () => void }) {
  const look = PHASES[phase];
  const live = phase !== "idle";

  return (
    <button
      onClick={phase === "speaking" ? onInterrupt : undefined}
      disabled={phase !== "speaking"}
      className="relative grid size-40 place-items-center rounded-full disabled:cursor-default sm:size-48"
      aria-label={phase === "speaking" ? "Interrupt and speak" : look.label}
    >
      {/* Expanding rings, only while a call is actually running. */}
      {live && (
        <>
          <span
            className={cn(
              "absolute inset-0 animate-ping rounded-full border opacity-60",
              look.ring,
            )}
            style={{ animationDuration: "2.4s" }}
          />
          <span
            className={cn("absolute inset-4 animate-pulse rounded-full border", look.ring)}
          />
        </>
      )}

      <span
        className={cn(
          "absolute inset-8 rounded-full border-2 transition-colors duration-500",
          look.ring,
        )}
      />

      <span className={cn("relative transition-colors duration-500", look.tone)}>
        {phase === "thinking" ? (
          <Loader2 className="size-12 animate-spin" />
        ) : phase === "speaking" ? (
          <Volume2 className="size-12" />
        ) : phase === "listening" ? (
          <Mic className="size-12" />
        ) : (
          <Hexagon className="size-12" />
        )}
      </span>
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-surface px-3.5 py-2.5 text-left">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function VoiceCall() {
  const { user, loading: sessionLoading } = useSession();
  const chat = useChat();
  const call = useVoiceCall(chat);
  const look = PHASES[call.phase];
  const [showTranscript, setShowTranscript] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.messages, call.heard, call.interim]);

  const isPaid = user?.plan === "paid";
  const isPaidExpired =
    user?.plan === "paid" &&
    user?.planExpiresAt &&
    new Date(user.planExpiresAt).getTime() < Date.now();

  if (sessionLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  // Voice AI Chat is restricted for non-paid or expired users
  if (!isPaid || isPaidExpired) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
        <div className="max-w-md space-y-6">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-xs">
            <Lock className="size-8 text-primary" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold font-display tracking-tight text-foreground">
              Pro Feature: Voice AI Chat
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {isPaidExpired ? (
                <span>Your monthly subscription has expired. Please top up / renew your plan for <strong>₹299/month</strong> to restore Voice AI Chat access.</span>
              ) : (
                <span>Hands-free Voice AI Chat &amp; Speech Synthesis is an exclusive feature for Pro Monthly subscribers. Upgrade your plan for <strong>₹299/month</strong> to unlock unlimited voice calling.</span>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full">
            <Button
              asChild
              className="w-full sm:w-auto justify-center gap-2 py-2.5 px-5 text-xs font-semibold cursor-pointer shadow-md shadow-primary/25"
            >
              <Link href="/plans">
                <Crown className="size-4 text-amber-300" /> {isPaidExpired ? "Top Up / Renew (₹299/mo)" : "Upgrade to Pro (₹299/mo)"}
              </Link>
            </Button>
            <Button
              variant="outline"
              asChild
              className="w-full sm:w-auto justify-center gap-2 py-2.5 px-5 text-xs font-medium cursor-pointer"
            >
              <Link href="/">Return to Workspace</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // What the recogniser has settled on this turn, plus what it is still deciding.
  const saying = [call.heard, call.interim].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ---- the call itself ---- */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-6 px-6 py-10 lg:flex-1 lg:py-0">
        <div className="text-center">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground">AI Voice Chat</h1>
          <p className="mt-1 text-xs sm:text-[13px] text-muted-foreground">
            Speak to speak. Every call is saved as a normal conversation.
          </p>
        </div>

        <Orb phase={call.phase} onInterrupt={call.interrupt} />

        <div className="min-h-[76px] max-w-sm text-center">
          <p className={cn("font-display text-base font-semibold", look.tone)}>{look.label}</p>
          {saying ? (
            <p className="mt-1.5 text-[13.5px] italic leading-relaxed text-foreground">
              “{saying}”
            </p>
          ) : (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {look.hint}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {call.active ? (
            <Button variant="destructive" onClick={call.end} className="gap-2 rounded-full px-6 shadow-md cursor-pointer">
              <PhoneOff className="size-4" /> End call
            </Button>
          ) : (
            <Button
              onClick={call.start}
              disabled={!call.supported}
              className="gap-2 rounded-full px-6 shadow-md cursor-pointer"
            >
              <Mic className="size-4" /> Start message
            </Button>
          )}

          {/* Transcript Toggle Button */}
          <Button
            variant="outline"
            onClick={() => setShowTranscript((prev) => !prev)}
            className="gap-2 rounded-full px-4 text-xs border-border bg-surface/80 hover:bg-elevated cursor-pointer transition-all shadow-2xs"
          >
            <FileText className="size-3.5 text-primary" />
            <span>{showTranscript ? "Hide Transcript" : "Show Transcript"}</span>
            {chat.messages.length > 0 && (
              <span className="ml-0.5 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                {chat.messages.length}
              </span>
            )}
          </Button>
        </div>

        <div className="w-full max-w-sm space-y-2">
          {!call.supported && (
            <Notice>
              This browser has no Web Speech API, so there is nothing to listen with.
              Chrome, Edge or Safari on a secure origin will work.
            </Notice>
          )}
          {call.micError && <Notice>{call.micError}</Notice>}
          {call.speechAvailable === false && (
            <Notice>
              {call.speechHint ?? "Spoken replies are unavailable."} Until then the
              agent still answers — you will read it rather than hear it.
            </Notice>
          )}
          {call.speechError && <Notice>{call.speechError}</Notice>}
        </div>
      </div>

      {/* ---- transcript side panel (hidden by default until user toggles) ---- */}
      {showTranscript && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border lg:max-w-md lg:border-l lg:border-t-0 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="size-3.5 text-primary" />
              <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                Transcript History
              </p>
            </div>
            <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              {/* Only while a call runs, so the server and first paint agree. */}
              {call.active && (
                <span title="Detected from the conversation — no setting to change">
                  {CALL_LANGUAGES.find((l) => l.code === call.lang)?.label ?? call.lang}
                </span>
              )}
              {call.voiceName && <span>{call.voiceName}</span>}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTranscript(false)}
              className="size-7 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
              title="Hide Transcript"
            >
              <X className="size-4" />
            </Button>
          </div>

          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
            {chat.messages.length === 0 && !saying ? (
              <p className="mt-8 text-center text-[12.5px] text-muted-foreground/70">
                Nothing said yet. Start the call and the conversation appears here as
                you talk.
              </p>
            ) : (
              <>
                {chat.messages.map((message, i) =>
                  message.role === "user" ? (
                    <UserMessage key={i}>{message.content}</UserMessage>
                  ) : (
                    <AIMessage key={i}>
                      {message.error ? (
                        <p className="text-[13px] text-destructive">{message.error}</p>
                      ) : message.content ? (
                        <MessageMarkdown>{message.content}</MessageMarkdown>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">…</span>
                      )}
                    </AIMessage>
                  ),
                )}

                {/* The turn being spoken right now, before it is sent. */}
                {saying && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md border border-dashed border-primary/40 bg-elevated/50 px-4 py-2.5 text-[14.5px] italic leading-relaxed text-muted-foreground">
                      {saying}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VoicePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <VoiceCall />
      </Suspense>
    </AppShell>
  );
}
