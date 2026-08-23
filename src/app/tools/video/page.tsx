"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Box,
  Clapperboard,
  Clock,
  Film,
  Flame,
  Loader2,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Timer,
  Video as VideoIcon,
  Wand2,
} from "lucide-react";
import { AppShell } from "@/components/chat/app-shell";
import { GeneratedVideoCard } from "@/components/chat/generated-video";
import { Button } from "@/components/ui/button";
import { refreshCurrentUser } from "@/lib/auth";
import type { GeneratedVideo, VideoToolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Styles supported by the server, with icons. Mirrors video.STYLES. */
const STYLES = [
  { id: "none", label: "Default", icon: Sparkles },
  { id: "cinematic", label: "Cinematic", icon: Clapperboard },
  { id: "realistic", label: "Realistic", icon: Film },
  { id: "anime", label: "Anime", icon: Flame },
  { id: "3d", label: "3D", icon: Box },
  { id: "timelapse", label: "Timelapse", icon: Timer },
] as const;

const ASPECTS = [
  { id: "landscape", label: "Landscape", ratioText: "16:9", icon: RectangleHorizontal },
  { id: "portrait", label: "Portrait", ratioText: "9:16", icon: RectangleVertical },
] as const;

const EXAMPLES = [
  "A paper boat drifting down a rain-soaked gutter, water rushing past, overcast afternoon light",
  "Neon signs flickering to life along a wet Tokyo alley as steam rises from a noodle stall",
  "A hummingbird hovering at a red flower in slow motion, wings blurred, soft morning backlight",
  "Waves crashing against black volcanic rock, spray catching low golden sunset light",
];

/** The rungs we can offer at all. What the configured model can reach is a
 *  subset, and it comes from the server -- see video.durations(). */
const FALLBACK_DURATIONS = [5, 10];

function VideoTool() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState<string>("landscape");
  const [style, setStyle] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedVideo[]>([]);
  const [status, setStatus] = useState<VideoToolStatus | null>(null);

  const loadStatus = useCallback(() => {
    fetch("/api/videos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VideoToolStatus | null) => data && setStatus(data))
      .catch(() => {});
  }, []);

  useEffect(() => loadStatus(), [loadStatus]);

  // A clip takes minutes, so the counter is the difference between "working"
  // and "hung" for someone watching a spinner.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 100) / 10),
      100,
    );
    return () => clearInterval(id);
  }, [busy]);

  const durations = status?.durations?.length ? status.durations : FALLBACK_DURATIONS;
  const chosen = duration && durations.includes(duration) ? duration : durations[0];
  const perSecond = status?.cost_per_second ?? 0;
  const quota = status?.quota;
  const offline = status !== null && !status.available;

  async function generate() {
    const value = prompt.trim();
    if (!value || busy) return;

    setBusy(true);
    setElapsed(0);
    setError(null);
    try {
      const res = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value, duration: chosen, aspect, style }),
      });

      const data = (await res.json().catch(() => null)) as
        | (GeneratedVideo & { error?: string })
        | null;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Generation failed (${res.status})`);
      }

      setResults((prev) => [data, ...prev].slice(0, 12));
      refreshCurrentUser();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  const recent = (status?.recent ?? []).filter(
    (clip) => clip.url && !results.some((r) => r.url === clip.url),
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10 space-y-7">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <VideoIcon className="size-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Video Generator
                </h1>
                <p className="text-[13px] text-muted-foreground">
                  Describe a scene and get a short clip back
                </p>
              </div>
            </div>

            {status && (
              <div className="flex items-center gap-2">
                {quota && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-[12px] font-medium text-foreground backdrop-blur-md shadow-xs dark:bg-card/70">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        quota.canGenerate ? "bg-emerald-500" : "bg-amber-500",
                      )}
                    />
                    <span className="font-semibold">
                      {quota.plan === "paid" ? "Pro Plan" : "Free Plan"}:
                    </span>
                    <span className="text-muted-foreground">
                      {quota.usedVideos}/{quota.maxVideos} videos
                    </span>
                  </div>
                )}
                <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-[12px] font-medium text-foreground backdrop-blur-md shadow-xs dark:bg-card/70">
                  <Sparkles className="size-3.5 text-primary" />
                  <span>{status.model || status.provider}</span>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Studio Card Form (Disabled for Coming Soon) */}
        <section className="relative space-y-4 rounded-2xl border border-border/80 bg-background/80 p-5 sm:p-6 shadow-sm backdrop-blur-md dark:bg-card/80">
          {/* Coming Soon Notice Banner */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs font-semibold text-primary">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 animate-pulse text-primary shrink-0" />
              <span>AI Video Studio is coming soon...</span>
            </div>
            <span className="rounded-full bg-primary/20 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider">
              Under Development
            </span>
          </div>

          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled
              rows={3}
              placeholder="AI Video Studio is coming soon! Motion clip generation will be enabled in the upcoming release..."
              className="w-full resize-none rounded-xl border border-border bg-surface/40 px-4 py-3 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface/20"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 opacity-60">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled
                className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] text-muted-foreground cursor-not-allowed"
              >
                {example.slice(0, 44)}...
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 opacity-60">
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Length
              </p>
              <div className="flex flex-wrap gap-1.5">
                {durations.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    disabled
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium cursor-not-allowed",
                      chosen === seconds
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    <Clock className="size-3.5" />
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Orientation
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium cursor-not-allowed",
                      aspect === option.id
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    <option.icon className="size-3.5" />
                    {option.label}
                    <span className="text-[10.5px] opacity-60">{option.ratioText}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 opacity-60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Style
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium cursor-not-allowed",
                    style === option.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  <option.icon className="size-3.5" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3.5">
            <p className="text-[11.5px] text-muted-foreground">
              Feature currently under development
            </p>
            <Button
              disabled
              className="gap-2 font-medium cursor-not-allowed opacity-60"
            >
              <Wand2 className="size-4" />
              <span>Coming Soon</span>
            </Button>
          </div>

          {busy && (
            <p className="rounded-xl border border-border bg-background/60 px-3 py-2 text-[12px] text-muted-foreground">
              Rendering {chosen} seconds of video. This holds one request open for
              a minute or more -- leaving the page cancels it.
            </p>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-[12.5px] text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </section>

        {results.length > 0 && (
          <section className="grid gap-3 sm:grid-cols-2">
            {results.map((clip) => (
              <GeneratedVideoCard key={clip.url} video={clip} />
            ))}
          </section>
        )}

        {recent.length > 0 && (
          <section className="space-y-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Earlier clips
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {recent.map((clip) => (
                <GeneratedVideoCard key={clip.url} video={clip} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function VideoToolPage() {
  return (
    <AppShell>
      <VideoTool />
    </AppShell>
  );
}
