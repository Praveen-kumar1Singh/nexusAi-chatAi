"use client";

import { Hexagon } from "lucide-react";

export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] sm:max-w-[80%] space-y-2 rounded-2xl rounded-br-xs border border-border bg-elevated px-3.5 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-[14.5px] leading-relaxed whitespace-pre-wrap shadow-2xs">
        {children}
      </div>
    </div>
  );
}

export function AIMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-0 sm:gap-3">
      <div className="hidden sm:grid mt-0.5 size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/25">
        <Hexagon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}
