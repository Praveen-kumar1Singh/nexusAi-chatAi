"use client";

import { useState } from "react";
import { Download, ImageOff, Maximize2, Sparkles, X } from "lucide-react";
import type { GeneratedImage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One generated picture, wherever it appears -- in a chat turn or in the
 * Image Generator's gallery.
 */
export function GeneratedImageCard({
  image,
  className,
  aspectRatio = "square",
}: {
  image: GeneratedImage;
  className?: string;
  aspectRatio?: "auto" | "square" | "portrait" | "landscape";
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const calculatedRatio = image.width && image.height ? image.width / image.height : 1;
  const ratio =
    aspectRatio === "square"
      ? 1
      : aspectRatio === "portrait"
      ? 2 / 3
      : aspectRatio === "landscape"
      ? 3 / 2
      : calculatedRatio;

  if (broken) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface/60 px-4 py-3 text-[12.5px] text-muted-foreground backdrop-blur-md">
        <ImageOff className="size-4 shrink-0 text-muted-foreground/70" />
        <span>That image has expired and is no longer stored.</span>
      </div>
    );
  }

  return (
    <>
      <figure
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-border/70 bg-surface/80 shadow-xs transition-all duration-300 hover:shadow-md hover:border-primary/40 dark:border-white/10 dark:bg-surface/50",
          className
        )}
      >
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: ratio }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/40 animate-pulse">
              <Sparkles className="size-6 text-primary/30 animate-spin" />
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin bytes */}
          <img
            src={image.url}
            alt={image.prompt}
            width={image.width || undefined}
            height={image.height || undefined}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={cn(
              "h-full w-full object-cover transition-all duration-500 group-hover:scale-105",
              loaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
            )}
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 opacity-0 transition-all duration-300 group-hover:opacity-100">
            <p className="pointer-events-none line-clamp-2 text-[11px] font-medium leading-tight text-white/90 drop-shadow-sm">
              {image.provider} · {image.model}
            </p>
            <div className="pointer-events-auto flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                title="View full size"
                aria-label="View full size"
                className="grid size-7.5 place-items-center rounded-lg bg-black/60 text-white backdrop-blur-md transition-all hover:bg-primary hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
              >
                <Maximize2 className="size-3.5" />
              </button>
              <a
                href={image.url}
                download={`nexus-${image.seed ?? "image"}.png`}
                title="Download image"
                aria-label="Download image"
                className="grid size-7.5 place-items-center rounded-lg bg-black/60 text-white backdrop-blur-md transition-all hover:bg-primary hover:scale-105 active:scale-95 shadow-xs"
              >
                <Download className="size-3.5" />
              </a>
            </div>
          </div>
        </div>
      </figure>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full size image"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4 sm:p-8 backdrop-blur-md transition-all duration-200"
        >
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-2xl border border-white/20 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.prompt}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-2xl"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-gradient-to-t from-black/90 to-transparent p-4 text-white">
              <p className="line-clamp-2 text-xs font-medium text-white/90">{image.prompt}</p>
              <a
                href={image.url}
                download={`nexus-${image.seed ?? "image"}.png`}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md hover:bg-white/30 transition-colors"
              >
                <Download className="size-3.5" />
                Download
              </a>
            </div>
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
 * Read a generate_image tool result into a renderable image.
 */
export function parseGeneratedImage(result?: string): GeneratedImage | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as Partial<GeneratedImage> & {
      error?: string;
      duration?: number;
    };
    if (parsed.error || !parsed.url) return null;
    // A generate_video result carries a url too. Duration is the field only a
    // clip has, so it is what tells the two results apart.
    if (typeof parsed.duration === "number") return null;
    return {
      url: parsed.url,
      prompt: parsed.prompt ?? "Generated image",
      width: parsed.width ?? 1024,
      height: parsed.height ?? 1024,
      size: parsed.size ?? "square",
      seed: parsed.seed,
      provider: parsed.provider ?? "image model",
      model: parsed.model ?? "",
    };
  } catch {
    return null;
  }
}
