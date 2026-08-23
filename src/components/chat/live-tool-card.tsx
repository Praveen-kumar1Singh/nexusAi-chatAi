"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { GeneratedImageCard, parseGeneratedImage } from "@/components/chat/generated-image";
import { GeneratedVideoCard, parseGeneratedVideo } from "@/components/chat/generated-video";
import type { ToolEvent } from "@/lib/types";

/** What each tool is doing, shown while it runs. */
const RUNNING_VERB: Record<string, string> = {
  web_search: "Searching the web",
  ask_options: "Preparing options",
  generate_image: "Generating the image",
  // Minutes, not seconds -- the verb says so, so the wait does not read as a hang.
  generate_video: "Rendering the video (this takes a minute)",
};

/** Cycles "" → "." → ".." → "..." so the label reads as live activity. */
function Ellipsis() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 400);
    return () => clearInterval(id);
  }, []);

  // Fixed width so the text beside it doesn't jitter as dots come and go.
  return <span className="inline-block w-3 text-left">{".".repeat(step)}</span>;
}

/** A tool result is a failure when the payload is an {"error": ...} object. */
function isFailure(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null && "error" in parsed;
  } catch {
    return false;
  }
}

/** Pull the message out of an {"error": ...} payload. */
function errorText(result: string): string {
  try {
    const parsed = JSON.parse(result) as { error?: unknown };
    return String(parsed.error ?? "That step failed.");
  } catch {
    return "That step failed.";
  }
}

/**
 * Transient status for one tool call.
 *
 * While the tool runs it shows what the agent is doing; once it succeeds it
 * disappears and the answer speaks for itself. Failures stay visible, otherwise
 * the assistant would appear to answer normally after a step silently broke.
 * The full arguments and results of every call are on the Activity page.
 *
 * generate_image and generate_video are the exceptions to "succeeds, then
 * disappears": their result IS the answer, so the picture or clip is rendered
 * here and stays with the stored turn.
 */
export function LiveToolCard({ tool }: { tool: ToolEvent }) {
  const running = tool.result === undefined;

  if (running) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        <span>
          {RUNNING_VERB[tool.name] ?? "Working"}
          <Ellipsis />
        </span>
      </p>
    );
  }

  if (isFailure(tool.result!)) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-[12.5px] text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>{errorText(tool.result!)}</span>
      </p>
    );
  }

  // The picture or clip is the result -- everything else only reports on itself.
  //
  // Video is tested first because a clip's result also carries a `url`, which is
  // all parseGeneratedImage needs to claim it -- image-first would render an mp4
  // into an <img> and show a broken picture.
  const video = parseGeneratedVideo(tool.result);
  if (video) {
    return <GeneratedVideoCard video={video} className="max-w-md" />;
  }

  const image = parseGeneratedImage(tool.result);
  if (image) {
    return <GeneratedImageCard image={image} className="max-w-md" />;
  }

  // Succeeded -- nothing to show; the answer follows.
  return null;
}
