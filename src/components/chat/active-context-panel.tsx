"use client";

import { useEffect, useState } from "react";
import { Cpu, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ToolInfo } from "@/lib/types";

export function ActiveContextPanel({ onClose }: { onClose?: () => void }) {
  const [model, setModel] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);

  // Reflects the agent's real registry rather than a hardcoded list.
  useEffect(() => {
    fetch("/api/tools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { model?: string; tools?: ToolInfo[] } | null) => {
        setModel(data?.model ?? null);
        setTools((data?.tools ?? []).filter((t) => t.name !== "ask_options"));
      })
      .catch(() => setTools([]));
  }, []);

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-border bg-sidebar">
      <div className="flex items-center justify-between px-4 py-3.5">
        <p className="font-display text-sm font-semibold">Active Context</p>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={onClose}
            aria-label="Close context panel"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <Separator />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Registered Tools
        </p>

        {tools === null ? (
          <p className="px-1 text-[12px] text-muted-foreground">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="px-1 text-[12px] text-muted-foreground">
            Agent unreachable. Start it with <code className="font-mono">npm run dev:api</code>.
          </p>
        ) : (
          <div className="space-y-2">
            {tools.map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong"
              >
                <div className="flex items-center gap-2.5">
                  <div className="grid size-7 place-items-center rounded-lg bg-elevated text-muted-foreground">
                    <Wrench className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-success" />
                      <p className="truncate font-mono text-[13px] font-medium">{t.name}</p>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{t.reads}</p>
                  </div>
                </div>
                <p className="mt-2 rounded-md bg-elevated/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {t.writes ? "Read / write" : "Read only"}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="px-1 pb-2 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Session
        </p>
        <div className="space-y-2.5 rounded-xl border border-border bg-surface p-3 text-sm">
          <Row label="Model" value={model ?? "—"} />
          <Row label="Registered tools" value={String(tools?.length ?? 0)} />
          <Row label="Storage" value="In-memory" />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-elevated/40 p-3">
          <Cpu className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Conversations live in the agent&apos;s memory and clear when it restarts. Connect a
            database to persist them.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate pl-2 font-mono text-[11px] font-medium">{value}</span>
    </div>
  );
}
