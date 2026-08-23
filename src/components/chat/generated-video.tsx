"use client";

import { useState } from "react";
import { Download, Film, Maximize2, VideoOff, X } from "lucide-react";
import type { GeneratedVideo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One generated clip, wherever it appears -- in a chat turn or in the Video
 * Generator's gallery.
 *
 * Deliberately not autoplaying. A picture costs nothing to show, but a clip is
 * megabytes over the wire and a thread with several of them would fetch all of
 * them at once, so `preload="metadata"` fetches the poster frame and waits for
 * an actual click.
 */
export function GeneratedVideoCard({
  video,
  className,
}: {
  video: GeneratedVideo;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const ratio = video.aspect === "portrait" ? 9 / 16 : 16 / 9;
  const fileName = `nexus-${video.duration ?? 5}s.mp4`;

  if (broken) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface/60 px-4 py-3 text-[12.5px] text-muted-foreground backdrop-blur-md">
        <VideoOff className="size-4 shrink-0 text-muted-foreground/70" />
        <span>That video has expired and is no longer stored.</span>
      </div>
    );
  }

  return (
    <>
      <figure
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-border/70 bg-surface/80 shadow-xs transition-all duration-300 hover:shadow-md hover:border-primary/40 dark:border-white/10 dark:bg-surface/50",
          className,
        )}
      >
        <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: ratio }}>
          <video
            src={video.url}
            controls
            playsInline
            loop
            preload="metadata"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        </div>

        <figcaption className="flex items-center justify-between gap-2 px-3 py-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Film className="size-3 shrink-0 text-primary" />
            <span className="shrink-0">{video.duration}s</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate">{video.model || video.provider}</span>
          </p>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => setZoomed(true)}
              title="View full size"
              aria-label="View full size"
              className="grid size-7 place-items-center rounded-lg border border-border bg-background/80 text-muted-foreground transition-all hover:border-primary/40 hover:text-primary active:scale-95 cursor-pointer"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <a
              href={video.url}
              download={fileName}
              title="Download video"
              aria-label="Download video"
              className="grid size-7 place-items-center rounded-lg border border-border bg-background/80 text-muted-foreground transition-all hover:border-primary/40 hover:text-primary active:scale-95"
            >
              <Download className="size-3.5" />
            </a>
          </div>
        </figcaption>
      </figure>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full size video"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4 sm:p-8 backdrop-blur-md transition-all duration-200"
        >
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-2xl border border-white/20 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              src={video.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[85vh] max-w-[90vw] rounded-2xl"
            />
          </div>
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close modal"
            className="absolute right-6 top-6 grid size-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 cursor-pointer shadow-lg"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Read a generate_video tool result into a renderable clip.
 */
export function parseGeneratedVideo(result?: string): GeneratedVideo | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as Partial<GeneratedVideo> & { error?: string };
    if (parsed.error || !parsed.url) return null;
    // Only a video result carries a duration -- this is what keeps an image
    // result from being rendered as a clip by the shared tool card.
    if (typeof parsed.duration !== "number") return null;
    return {
      url: parsed.url,
      prompt: parsed.prompt ?? "Generated video",
      duration: parsed.duration,
      aspect: parsed.aspect ?? "landscape",
      aspect_ratio: parsed.aspect_ratio ?? "16:9",
      resolution: parsed.resolution,
      provider: parsed.provider ?? "video model",
      model: parsed.model ?? "",
    };
  } catch {
    return null;
  }
}
