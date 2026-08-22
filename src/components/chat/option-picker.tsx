"use client";

import type { ToolEvent } from "@/lib/types";

type Choice = { question: string; options: string[] };

/**
 * Reads the payload the agent produced when it called `ask_options`.
 * Returns null for anything else, including a failed call.
 */
export function parseChoice(tools: ToolEvent[] | undefined): Choice | null {
  const call = tools?.find((t) => t.name === "ask_options" && t.result);
  if (!call?.result) return null;
  try {
    const parsed = JSON.parse(call.result) as Partial<Choice>;
    if (!parsed.question || !parsed.options?.length) return null;
    return { question: parsed.question, options: parsed.options };
  } catch {
    return null;
  }
}

/**
 * The choices the agent offered, as buttons. Picking one sends it as the next
 * message; anything not listed can just be typed into the composer.
 */
export function OptionPicker({
  choice,
  onPick,
  disabled,
}: {
  choice: Choice;
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <p className="text-[13px] font-medium">{choice.question}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {choice.options.map((option) => (
          <button
            key={option}
            onClick={() => onPick(option)}
            disabled={disabled}
            className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {option}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-[11.5px] text-muted-foreground">
        Or type something else below.
      </p>
    </div>
  );
}
