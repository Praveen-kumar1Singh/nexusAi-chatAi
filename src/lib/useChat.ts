"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_CHANGED_EVENT, decrementLocalCredit, refreshCurrentUser } from "@/lib/auth";
import { CONVERSATIONS_CHANGED, type Message } from "@/lib/types";

type StreamEvent = {
  type: string;
  value?: string;
  name?: string;
  args?: string;
  result?: string;
  id?: string;
};

/**
 * Owns the conversation and the streaming request to /api/chat.
 * The UI just renders `messages` and calls `send`.
 */
export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Assigned by the agent on the first turn; sent back on every later turn so
  // the whole thread lands in one stored conversation.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // True between clicking a thread in the sidebar and its turns arriving, so
  // the view can show a placeholder instead of sitting on the previous thread.
  const [isOpening, setIsOpening] = useState(false);

  // Threads already fetched this session. Reopening one paints from here
  // immediately and the network copy just refreshes it underneath.
  const cache = useRef(new Map<string, Message[]>());
  // The thread the user last asked for. A slow response for an earlier click
  // must not overwrite a later one.
  const wanted = useRef<string | null>(null);

  /** Load a stored conversation into the view. */
  const open = useCallback(async (id: string) => {
    wanted.current = id;
    setConversationId(id);

    const cached = cache.current.get(id);
    if (cached) {
      setMessages(cached);
      setIsOpening(false);
    } else {
      setMessages([]);
      setIsOpening(true);
    }

    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: { role: Message["role"]; content: string; tools?: Message["tools"] }[];
      };
      const loaded = data.messages.map((m) => ({ ...m, tools: m.tools ?? [] }));
      cache.current.set(id, loaded);
      if (wanted.current === id) setMessages(loaded);
    } catch {
      // Leave whatever is on screen rather than blanking it on a network blip.
    } finally {
      if (wanted.current === id) setIsOpening(false);
    }
  }, []);

  /** Clear the view and start a fresh thread on the next send. */
  const reset = useCallback(() => {
    wanted.current = null;
    setIsOpening(false);
    setConversationId(null);
    setMessages([]);
  }, []);

  // Keep the cache current so switching away and back does not refetch a thread
  // whose newest turns this window already has.
  useEffect(() => {
    if (!conversationId || isLoading || messages.length === 0) return;
    cache.current.set(conversationId, messages);
  }, [conversationId, isLoading, messages]);

  // Signing in or out empties the window: a guest's turns are never stored
  // anywhere, so leaving them on screen would show the next account a thread it
  // has no way to reopen.
  useEffect(() => {
    function onAuthChange() {
      cache.current.clear();
      reset();
    }
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
  }, [reset]);

  async function send(text: string, opts?: { voice?: boolean }) {
    const prompt = text.trim();
    if (!prompt || isLoading) return;

    const history = [...messages, { role: "user" as const, content: prompt }];
    const initialTurn: Message[] = [...history, { role: "assistant", content: "" }];
    // A thread still being fetched must not land on top of the turn just typed.
    wanted.current = null;
    setIsOpening(false);
    setMessages(initialTurn);
    setIsLoading(true);
    decrementLocalCredit();

    // Helper to safely patch the last assistant message
    const updateLast = (patch: (m: Message) => Message) => {
      setMessages((prev) => {
        const base = prev.length >= initialTurn.length ? prev : initialTurn;
        const lastIdx = base.length - 1;
        const updated = patch(base[lastIdx]);
        const next = [...base];
        next[lastIdx] = updated;
        return next;
      });
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          messages: history.map(({ role, content }) => ({ role, content })),
          // Shapes the reply for the ear rather than the screen -- see
          // VOICE_PROMPT in server/policy.py.
          voice: opts?.voice ?? false,
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // trailing element is an incomplete line

        if (lines.length > 0) {
          setMessages((prev) => {
            const base = prev.length >= initialTurn.length ? prev : initialTurn;
            const lastIdx = base.length - 1;
            let lastMsg = { ...base[lastIdx] };
            let updatedTools = lastMsg.tools ? [...lastMsg.tools] : [];
            let updatedContent = lastMsg.content || "";
            let updatedError = lastMsg.error;
            let hasChanges = false;

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const event = JSON.parse(line) as StreamEvent;
                if (event.type === "conversation") {
                  if (event.id) setConversationId(event.id);
                } else if (event.type === "text") {
                  updatedContent += event.value || "";
                  hasChanges = true;
                } else if (event.type === "tool_call") {
                  updatedTools.push({ name: event.name!, args: event.args ?? "" });
                  hasChanges = true;
                } else if (event.type === "tool_result") {
                  if (updatedTools.length > 0) {
                    updatedTools[updatedTools.length - 1] = {
                      ...updatedTools[updatedTools.length - 1],
                      result: event.result,
                    };
                    hasChanges = true;
                  }
                } else if (event.type === "error") {
                  updatedError = event.value;
                  hasChanges = true;
                }
              } catch {
                // Ignore invalid JSON lines
              }
            }

            if (!hasChanges) return prev;

            lastMsg.content = updatedContent;
            lastMsg.tools = updatedTools;
            if (updatedError) lastMsg.error = updatedError;

            const next = [...base];
            next[lastIdx] = lastMsg;
            return next;
          });
        }
      }
    } catch (error) {
      updateLast((m) => ({
        ...m,
        error: error instanceof Error ? error.message : "Something went wrong",
      }));
    } finally {
      setIsLoading(false);
      refreshCurrentUser();
      // The sidebar keeps its own copy of the conversation list; tell it to refetch.
      window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
    }
  }

  return { messages, isLoading, isOpening, send, conversationId, open, reset };
}
