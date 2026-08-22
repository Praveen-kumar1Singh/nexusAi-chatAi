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
    tone: "text-amber-500",
    ring: "border-amber-500/50 bg-amber-500/10",
    label: "Thinking",
    hint: "Working out the answer…",
  },
  speaking: {
    tone: "text-emerald-500",
    ring: "border-emerald-500/50 bg-emerald-500/10",
    label: "Speaking",
    hint: "Speak over me to interrupt or say 'End Call'.",
  },
};

function AudioVisualizer({
  active,
  mode = "listening",
}: {
  active: boolean;
  mode?: CallPhase;
}) {
  const barColors: Record<CallPhase, string> = {
    idle: "bg-muted-foreground/30",
    listening: "bg-gradient-to-t from-primary/60 to-primary",
    thinking: "bg-gradient-to-t from-amber-500/60 to-amber-400 animate-pulse",
    speaking: "bg-gradient-to-t from-emerald-500/60 to-emerald-400",
  };

  const colorClass = barColors[mode];

  return (
    <div className="flex items-center gap-1.5 h-10 justify-center my-3">
      {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 0.6, 0.3].map((heightScale, i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 rounded-full transition-all duration-200 shadow-xs",
            colorClass,
            active ? "animate-pulse" : "h-2 opacity-30",
          )}
          style={{
            height: active ? `${Math.max(14, heightScale * 38)}px` : "6px",
            animationDuration: `${0.35 + (i % 4) * 0.15}s`,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}

function Orb({
  phase,
  hasSpeechInput,
  onInterrupt,
}: {
  phase: CallPhase;
  hasSpeechInput: boolean;
  onInterrupt: () => void;
}) {
  const look = PHASES[phase];
  const live = phase !== "idle";

  return (
    <div className="relative flex flex-col items-center">
      <button
        onClick={phase === "speaking" ? onInterrupt : undefined}
        disabled={phase !== "speaking"}
        className="group relative grid size-44 place-items-center rounded-full disabled:cursor-default sm:size-52 transition-transform duration-300 active:scale-95"
        aria-label={phase === "speaking" ? "Interrupt and speak" : look.label}
      >
        {/* Glow backdrop */}
        {live && (
          <div
            className={cn(
              "absolute -inset-4 rounded-full blur-2xl opacity-40 transition-all duration-700",
              phase === "listening" && "bg-primary/30",
              phase === "thinking" && "bg-amber-500/30",
              phase === "speaking" && "bg-emerald-500/30",
            )}
          />
        )}

        {/* Expanding rings */}
        {live && (
          <>
            <span
              className={cn(
                "absolute inset-0 animate-ping rounded-full border opacity-50",
                look.ring,
              )}
              style={{ animationDuration: "2.5s" }}
            />
            <span
              className={cn(
                "absolute inset-3 animate-pulse rounded-full border opacity-70",
                look.ring,
              )}
            />
          </>
        )}

        <span
          className={cn(
            "absolute inset-6 rounded-full border-2 transition-all duration-500 backdrop-blur-xs shadow-xl",
            look.ring,
          )}
        />

        {/* Center Icon */}
        <span className={cn("relative transition-all duration-500", look.tone)}>
          {phase === "speaking" ? (
            <Volume2 className="size-14 text-emerald-500 animate-pulse" />
          ) : phase === "listening" ? (
            <Mic
              className={cn(
                "size-14 transition-transform duration-300",
                hasSpeechInput && "scale-110 text-primary",
              )}
            />
          ) : phase === "thinking" ? (
            <Hexagon className="size-14 text-amber-500 animate-pulse" />
          ) : (
            <Hexagon className="size-14 text-muted-foreground/60" />
          )}
        </span>
      </button>

      {/* Real-time Audio Waves */}
      {live && (
        <AudioVisualizer
          active={
            phase === "speaking" ||
            phase === "thinking" ||
            (phase === "listening" && hasSpeechInput)
          }
          mode={phase}
        />
      )}
    </div>
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
                <span>
                  Your monthly subscription has expired. Please top up / renew your plan for{" "}
                  <strong>₹299/month</strong> to restore Voice AI Chat access.
                </span>
              ) : (
                <span>
                  Hands-free Voice AI Chat &amp; Speech Synthesis is an exclusive feature for Pro
                  Monthly subscribers. Upgrade your plan for <strong>₹299/month</strong> to unlock
                  unlimited voice calling.
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full">
            <Button
              asChild
              className="w-full sm:w-auto justify-center gap-2 py-2.5 px-5 text-xs font-semibold cursor-pointer shadow-md shadow-primary/25"
            >
              <Link href="/plans">
                <Crown className="size-4 text-amber-300" />{" "}
                {isPaidExpired ? "Top Up / Renew (₹299/mo)" : "Upgrade to Pro (₹299/mo)"}
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
      <div className="flex shrink-0 flex-col items-center justify-center gap-5 px-6 py-8 lg:flex-1 lg:py-0">
        <div className="text-center">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            AI Voice Chat
          </h1>
          <p className="mt-1 text-xs sm:text-[13px] text-muted-foreground">
            Hands-free conversation with real-time voice interruption and auto exit commands.
          </p>
        </div>

        <Orb
          phase={call.phase}
          hasSpeechInput={Boolean(saying)}
          onInterrupt={call.interrupt}
        />

        <div className="min-h-[84px] max-w-md text-center flex flex-col items-center justify-center">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/80 shadow-2xs mb-2">
            <span
              className={cn(
                "size-2 rounded-full",
                call.phase === "speaking"
                  ? "bg-emerald-500 animate-pulse"
                  : call.phase === "thinking"
                    ? "bg-amber-500 animate-ping"
                    : call.phase === "listening"
                      ? "bg-primary animate-pulse"
                      : "bg-muted-foreground",
              )}
            />
            <p className={cn("font-display text-xs font-semibold uppercase tracking-wider", look.tone)}>
              {look.label}
            </p>
          </div>

          {saying ? (
            <div className="mt-1 max-w-sm rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 shadow-xs animate-in fade-in zoom-in-95 duration-200">
              <p className="text-[13.5px] italic leading-relaxed text-foreground font-medium">
                “{saying}”
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {call.phase === "speaking" ? (
                <span className="text-emerald-500 font-medium">
                  AI is speaking... Speak to interrupt or say &ldquo;End Call&rdquo; to cut.
                </span>
              ) : call.phase === "thinking" ? (
                <span className="text-amber-500 font-medium animate-pulse">
                  Thinking and processing your answer...
                </span>
              ) : call.phase === "listening" ? (
                <span>
                  Speak anytime. Say <strong className="text-foreground font-semibold">&ldquo;End Call&rdquo;</strong> or <strong className="text-foreground font-semibold">&ldquo;Exit&rdquo;</strong> to disconnect.
                </span>
              ) : (
                look.hint
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {call.active ? (
            <Button
              variant="destructive"
              onClick={call.end}
              className="gap-2 rounded-full px-6 shadow-md cursor-pointer"
            >
              <PhoneOff className="size-4" /> End call
            </Button>
          ) : (
            <Button
              onClick={call.start}
              disabled={!call.supported}
              className="gap-2 rounded-full px-6 shadow-md cursor-pointer"
            >
              <Mic className="size-4" /> Start call
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
