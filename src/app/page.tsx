"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/chat/app-shell";
import { AIMessage, UserMessage } from "@/components/chat/chat-messages";
import { LiveToolCard } from "@/components/chat/live-tool-card";
import { AlertCircle, ArrowDown, ArrowUp, BarChart3, Code2, FileText, Globe, Lightbulb, Sparkles, UserPlus } from "lucide-react";
import { MessageMarkdown } from "@/components/chat/message-markdown";
import { OptionPicker, parseChoice } from "@/components/chat/option-picker";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { AuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth";
import { useChat } from "@/lib/useChat";
import { useSpeech } from "@/lib/useVoice";
import { buildMessage, splitMessage } from "@/lib/attachments";
import { SELECT_CONVERSATION, type Attachment, type Message, type ToolInfo } from "@/lib/types";

function formatUserError(rawError: string): string {
  if (!rawError) return "Something went wrong. Please try again.";
  const lower = rawError.toLowerCase();

  if (
    lower.includes("413") ||
    lower.includes("request too large") ||
    lower.includes("tokens per minute") ||
    lower.includes("context_length") ||
    lower.includes("too large for model")
  ) {
    return "The attached file or conversation is too large for the model's memory limit. Please attach a smaller file or start a new conversation.";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("rate_limit")) {
    return "The AI service is temporarily busy due to rate limits. Please wait a moment and try again.";
  }
  if (lower.includes("401") || lower.includes("api_key") || lower.includes("authentication")) {
    return "API authentication failed. Please verify your GROQ_API_KEY environment variable.";
  }

  try {
    if (rawError.includes("{'") || rawError.includes('{"')) {
      const msgMatch = rawError.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
      if (msgMatch && msgMatch[1]) {
        return msgMatch[1];
      }
    }
  } catch {
    // Ignore regex parsing failures
  }

  return rawError.replace(/^[A-Za-z0-9_]+Error:\s*/, "").replace(/^Error code:\s*\d+\s*-\s*/, "");
}

function Turn({
  message,
  isStreaming,
  isLast,
  onPick,
}: {
  message: Message;
  isStreaming: boolean;
  isLast: boolean;
  onPick: (value: string) => void;
}) {
  if (message.role === "user") {
    // Attached file bodies are in the stored message for the model's benefit;
    // show the user a chip rather than their whole file pasted back at them.
    const { text, files } = splitMessage(message.content);
    return (
      <UserMessage>
        {text}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((name, i) => (
              <span
                key={name + i}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] text-muted-foreground"
              >
                <FileText className="size-3" />
                {name}
              </span>
            ))}
          </div>
        )}
      </UserMessage>
    );
  }

  // Only the newest turn's options are still actionable.
  const choice = isLast ? parseChoice(message.tools) : null;

  return (
    <AIMessage>
      {message.tools?.map((tool, i) => <LiveToolCard key={i} tool={tool} />)}

      {message.error ? (
        <div className="rounded-2xl border border-destructive/20 bg-surface px-4 py-3.5 text-[13.5px] text-foreground space-y-1 shadow-xs animate-in fade-in duration-200">
          <p className="font-semibold text-destructive flex items-center gap-1.5 text-xs">
            <AlertCircle className="size-3.5" /> Notice
          </p>
          <p className="text-muted-foreground leading-relaxed text-[13px]">
            {formatUserError(message.error)}
          </p>
        </div>
      ) : message.content ? (
        <MessageMarkdown>{message.content}</MessageMarkdown>
      ) : isStreaming ? (
        <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-xs border border-border/60 bg-surface px-4 py-2.5 shadow-xs animate-in fade-in duration-200">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-2 animate-bounce rounded-full bg-primary/80"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      ) : null}

      {choice && <OptionPicker choice={choice} onPick={onPick} disabled={isStreaming} />}
    </AIMessage>
  );
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  const quickPills = [
    { label: "Search Web", prompt: "What are the latest tech news and developments today?", icon: Globe },
    { label: "Explain Concept", prompt: "Explain how large language models and tool calling work", icon: Lightbulb },
    { label: "Code Assistant", prompt: "Write a clean Python script to fetch and format API data", icon: Code2 },
    { label: "Analyze Data", prompt: "How do I optimize web application performance?", icon: BarChart3 },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center max-w-2xl mx-auto px-4 text-center py-6 sm:py-8 my-auto animate-in fade-in zoom-in-95 duration-300">
      {/* Modern Badge */}
      <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary shadow-2xs backdrop-blur-md mb-4 animate-in fade-in duration-500">
        <Sparkles className="size-3.5 text-primary animate-pulse" />
        <span>Nexus AI • Next-Gen Workspace</span>
      </div>

      {/* Main Title */}
      <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-foreground">
        How can I help you <span className="bg-gradient-to-r from-primary via-primary/90 to-amber-500 bg-clip-text text-transparent">today?</span>
      </h2>
      <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground max-w-xs sm:max-w-md leading-relaxed font-normal">
        Ask anything, search real-time web insights, write clean code, or analyze complex data.
      </p>

      {/* Quick Action Chips (Single row on laptop/desktop) */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 max-w-full sm:max-w-2xl lg:max-w-3xl">
        {quickPills.map((pill) => (
          <button
            key={pill.label}
            onClick={() => onPick(pill.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-surface/90 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-elevated transition-all shadow-2xs cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
          >
            <pill.icon className="size-3.5 text-primary" />
            <span>{pill.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Chat() {
  const { user } = useSession();
  const { messages, isLoading, send, conversationId, open, reset } = useChat();
  const [input, setInput] = useState("");
  const [scrollMode, setScrollMode] = useState<"up" | "down">("up");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const speech = useSpeech();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const guestPromptsCount = messages.filter((m) => m.role === "user").length;
  const isGuestLimitReached = !user && guestPromptsCount >= 10;

  const { enabled: speechEnabled, speak: speechSpeak } = speech;

  // Read the finished reply aloud, once, when the speaker is on. Watching the
  // streaming flag rather than the message list means opening a stored
  // conversation stays silent -- only a turn that just completed gets spoken.
  const wasStreaming = useRef(false);
  useEffect(() => {
    const justFinished = wasStreaming.current && !isLoading;
    wasStreaming.current = isLoading;
    if (!justFinished || !speechEnabled) return;

    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.content && !last.error) speechSpeak(last.content);
  }, [messages, isLoading, speechEnabled, speechSpeak]);

  // Arriving from another page (the sidebar on /voice routes here rather than
  // firing an event nothing over there would hear). Opened once per id, so a
  // later re-render does not yank the view back to it.
  const requested = useSearchParams().get("c");
  const openedFromUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!requested || openedFromUrl.current === requested) return;
    openedFromUrl.current = requested;
    open(requested);
  }, [requested, open]);

  useEffect(() => {
    function handleSelect(e: Event) {
      const customEvent = e as CustomEvent<{ id: string | null }>;
      const targetId = customEvent.detail?.id;
      if (targetId) {
        open(targetId);
      } else {
        reset();
      }
    }

    window.addEventListener(SELECT_CONVERSATION, handleSelect);
    return () => window.removeEventListener(SELECT_CONVERSATION, handleSelect);
  }, [open, reset]);

  // Auto-scroll to latest message if user is near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 250) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Track scroll position cleanly without re-registering on every token update
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      const isScrollable = el.scrollHeight > el.clientHeight + 80;
      setShowScrollButton((prev) => (prev !== isScrollable ? isScrollable : prev));

      if (isScrollable) {
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const nextMode = distanceToBottom < 150 ? "up" : "down";
        setScrollMode((prev) => (prev !== nextMode ? nextMode : prev));
      }
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  function handleScrollAction() {
    const el = scrollRef.current;
    if (!el) return;

    if (scrollMode === "up") {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }

  function handleSend(text: string, attachments: Attachment[] = []) {
    if (isLoading || isGuestLimitReached) return;
    speech.stop(); // a new question cuts off the answer to the old one
    // Attached files are folded into the message; the model reads them directly.
    const content = buildMessage(text, attachments);
    if (!content.trim()) return;
    send(content);
    setInput("");
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto flex flex-col">
        {messages.length === 0 ? (
          <Welcome onPick={handleSend} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-6 px-2.5 sm:px-4 py-4 sm:py-8">
            {messages.map((message, i) => (
              <Turn
                key={i}
                message={message}
                isStreaming={isLoading && i === messages.length - 1}
                isLast={i === messages.length - 1}
                onPick={(value) => handleSend(value)}
              />
            ))}
          </div>
        )}
      </div>

      {messages.length > 0 && showScrollButton && (
        <div className="pointer-events-none absolute bottom-[92px] right-3 sm:bottom-[104px] sm:right-10 z-30 flex justify-end">
          <button
            onClick={handleScrollAction}
            className="pointer-events-auto grid size-9 place-items-center rounded-full border border-border bg-sidebar/95 text-foreground shadow-lg backdrop-blur-md transition-all hover:bg-elevated cursor-pointer hover:scale-110 animate-in fade-in duration-200"
            title={scrollMode === "up" ? "Jump to start of chat" : "Jump to latest message"}
            aria-label={scrollMode === "up" ? "Jump to start of chat" : "Jump to latest message"}
          >
            {scrollMode === "up" ? (
              <ArrowUp className="size-4 text-primary" />
            ) : (
              <ArrowDown className="size-4 text-primary" />
            )}
          </button>
        </div>
      )}

      {isGuestLimitReached ? (
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-primary/40 bg-sidebar/95 p-5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 text-left">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <UserPlus className="size-5 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold font-display uppercase tracking-wider text-primary">
                  Guest Limit Reached (10/10 Prompts Used)
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Create a free account or log in to get <strong>50 free credits</strong>, save your conversation history, and continue chatting.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setAuthModalOpen(true)}
              className="w-full sm:w-auto shrink-0 justify-center gap-2 py-2.5 px-5 text-xs font-semibold cursor-pointer shadow-md shadow-primary/25"
            >
              <Sparkles className="size-3.5 text-amber-300" /> Create Free Account / Log In
            </Button>
          </div>
        </div>
      ) : (
        <PromptComposer
          value={input}
          onChange={setInput}
          onSend={(attachments) => handleSend(input, attachments)}
          speech={speech}
        />
      )}

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialTab="register"
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Chat />
      </Suspense>
    </AppShell>
  );
}
