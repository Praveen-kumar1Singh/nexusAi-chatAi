"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Image as ImageIcon, Globe, ListChecks, Wrench } from "lucide-react";
import { AppShell } from "@/components/chat/app-shell";
import type { ToolInfo } from "@/lib/types";

/**
 * The tools hub.
 *
 * Two kinds of thing live here and the split is the point: the cards at the top
 * are tools you open and drive yourself, the list below is what the agent
 * reaches for on its own mid-conversation. That lower list is read from the
 * Python registry, so it cannot drift from what the agent can actually do.
 */

const OPENABLE = [
  {
    href: "/tools/image",
    icon: ImageIcon,
    title: "Image Generator",
    blurb: "Describe a picture and get it back in seconds. Also available in chat -- just ask.",
    tag: "Text to image",
  },
] as const;

const AGENT_ICONS: Record<string, typeof Globe> = {
  web_search: Globe,
  ask_options: ListChecks,
  generate_image: ImageIcon,
};

function Tools() {
  const [agentTools, setAgentTools] = useState<ToolInfo[]>([]);
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/tools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { model?: string; tools?: ToolInfo[] } | null) => {
        if (!data) return;
        setAgentTools(data.tools ?? []);
        setModel(data.model ?? "");
      })
      // Agent offline -- the cards above still work as links.
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8 space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
              <Wrench className="size-4.5" />
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">AI Tools</h1>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Open a tool to use it directly, or just ask for it in chat -- the agent calls the
            same code.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          {OPENABLE.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex flex-col gap-2 rounded-2xl border border-border bg-surface/60 p-4 transition-all hover:border-primary/35 hover:bg-elevated/60 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <div className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                  <tool.icon className="size-4" />
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-display text-[14.5px] font-semibold">{tool.title}</p>
                <p className="text-[12.5px] leading-snug text-muted-foreground">{tool.blurb}</p>
              </div>
              <span className="mt-1 w-fit rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                {tool.tag}
              </span>
            </Link>
          ))}
        </section>

        {agentTools.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Called automatically in chat
              </p>
              {model && <p className="truncate text-[11px] text-muted-foreground/60">{model}</p>}
            </div>
            <div className="divide-y divide-border rounded-2xl border border-border bg-surface/40">
              {agentTools.map((tool) => {
                const Icon = AGENT_ICONS[tool.name] ?? Wrench;
                return (
                  <div key={tool.name} className="flex gap-3 p-3.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div className="min-w-0 space-y-1">
                      <p className="font-mono text-[12.5px] text-foreground">{tool.name}</p>
                      <p className="text-[12.5px] leading-snug text-muted-foreground">
                        {tool.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60">Reads {tool.reads}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  return (
    <AppShell>
      <Tools />
    </AppShell>
  );
}
