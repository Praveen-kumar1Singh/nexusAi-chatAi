"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import {
  AlertCircle,
  Box,
  Camera,
  Copy,
  Dices,
  Feather,
  Flame,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/chat/app-shell";
import { GeneratedImageCard } from "@/components/chat/generated-image";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { refreshCurrentUser } from "@/lib/auth";
import type { GeneratedImage, ImageToolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Styles supported by the server with associated icons */
const STYLES = [
  { id: "none", label: "Default", icon: Sparkles },
  { id: "photo", label: "Photoreal", icon: Camera },
  { id: "art", label: "Digital Art", icon: Palette },
  { id: "anime", label: "Anime", icon: Flame },
  { id: "3d", label: "3D Render", icon: Box },
  { id: "sketch", label: "Sketch", icon: Feather },
] as const;

/** Aspect ratios with visual representation indicators */
const SIZES = [
  { id: "square", label: "Square", ratioText: "1:1", aspectClass: "w-3.5 h-3.5" },
  { id: "portrait", label: "Portrait", ratioText: "2:3", aspectClass: "w-3 h-4" },
  { id: "landscape", label: "Landscape", ratioText: "3:2", aspectClass: "w-4 h-3" },
] as const;

/** 7 Curated Daily Prompt Sets (One set per day of week: Sun -> Sat) */
const DAILY_EXAMPLE_SETS = [
  // 0: Sunday - Surreal & Fantasy
  [
    { category: "Fantasy", text: "A majestic floating castle above pink clouds at sunrise, mythical fantasy digital painting" },
    { category: "Surrealism", text: "A giant glowing jellyfish floating through a dark pine forest at night, dreamlike atmosphere" },
    { category: "Architectural", text: "Futuristic eco-friendly skyscraper covered in vertical gardens and waterfall, 8k render" },
    { category: "Portrait", text: "A cyberpunk warrior with glowing blue cybernetic tattoos in heavy rain, cinematic lighting" },
  ],
  // 1: Monday - Cyberpunk & Sci-Fi
  [
    { category: "Cyberpunk", text: "A neon-lit Tokyo alley in the rain, reflections on wet asphalt, cinematic 8k ultra detailed" },
    { category: "Sci-Fi", text: "An astronaut resting on a moss-covered rock on a quiet alien coast at dusk, ethereal glow" },
    { category: "Mecha", text: "Giant retro robot standing in a autumn forest with falling maple leaves, octane render" },
    { category: "Space", text: "A futuristic space station orbiting a ringed purple gas planet, highly detailed sci-fi concept art" },
  ],
  // 2: Tuesday - Minimalist & Design
  [
    { category: "Minimal Logo", text: "A minimal vector logo for a modern coffee roastery, dark emerald green and cream" },
    { category: "Abstract Art", text: "Flowing liquid silk ribbons in gold and deep ocean blue, 3D abstract composition" },
    { category: "Flat Vector", text: "Flat vector illustration of a cozy cabin in snowy mountains under aurora borealis" },
    { category: "Typography", text: "3D glass typography spelling 'CREATIVE' filled with colorful glowing neon liquid" },
  ],
  // 3: Wednesday - 3D Scenes & Interior
  [
    { category: "3D Scene", text: "Isometric 3D render of a tiny cluttered artist workshop, warm golden hour lamplight" },
    { category: "Low Poly", text: "Low poly island with a lighthouse and small sailing boat at sunset, stylized 3D" },
    { category: "Claymation", text: "Cute claymation cat reading a book in a tiny cozy armchair, soft ambient lighting" },
    { category: "Interior", text: "Modern Japandi living room with large glass windows overlooking a serene bamboo forest" },
  ],
  // 4: Thursday - Photorealistic & Nature
  [
    { category: "Photoreal", text: "Close-up macro photo of a dewdrop on a vibrant blue morpho butterfly wing, 8k resolution" },
    { category: "Nature", text: "Mist-covered pine forest at dawn with sun rays beaming through ancient trees" },
    { category: "Wildlife", text: "A majestic snow leopard resting on a cliff in a blizzard, national geographic style" },
    { category: "Landscape", text: "Lush green rolling hills of Iceland with a winding river under dramatic cloudy skies" },
  ],
  // 5: Friday - Cinematic & Retro
  [
    { category: "Cinematic", text: "1970s film photo of a vintage red sports car driving along the California coast at sunset" },
    { category: "Retro Sci-Fi", text: "1980s synthwave sunset with grid highway, palm trees, and glowing neon sun" },
    { category: "Film Noir", text: "Dramatic film noir detective standing under a street lamp in fog, high contrast shadow" },
    { category: "Steampunk", text: "An intricate steampunk pocket watch with visible copper gears and glowing crystal core" },
  ],
  // 6: Saturday - Anime & Pop Art
  [
    { category: "Anime", text: "Anime style girl standing on a train platform with cherry blossom petals blowing in the wind" },
    { category: "Pop Art", text: "Vibrant pop art portrait of a woman with sunglasses reflecting a retro city skyline" },
    { category: "Watercolor", text: "Soft watercolor painting of a sleepy fox curled up under autumn mushrooms" },
    { category: "Pixel Art", text: "16-bit pixel art of a cozy ramen shop on a rainy night, retro video game aesthetic" },
  ],
];

/**
 * Interactive Background Canvas
 * Draws interactive, floating constellation particles that react to mouse position.
 */
function InteractiveConstellationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };

    window.addEventListener("resize", handleResize);

    const mouse = { x: -1000, y: -1000 };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const parent = canvas.parentElement;
    parent?.addEventListener("mousemove", handleMouseMove);
    parent?.addEventListener("mouseleave", handleMouseLeave);

    const particleCount = Math.min(Math.floor((width * height) / 14000), 65);
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      radius: Math.random() * 1.8 + 1.2,
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const isDark = document.documentElement.classList.contains("dark");
      const dotColor = isDark ? "rgba(124, 140, 255, 0.65)" : "rgba(79, 91, 213, 0.55)";
      const lineColor = isDark ? "rgba(124, 140, 255, 0.12)" : "rgba(79, 91, 213, 0.08)";
      const mouseLineColor = isDark ? "rgba(167, 139, 250, 0.25)" : "rgba(79, 91, 213, 0.2)";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1 - dist / 110;
            ctx.stroke();
          }
        }

        const mdx = p.x - mouse.x;
        const mdy = p.y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

        if (mdist < 140) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = mouseLineColor;
          ctx.lineWidth = 1.2 * (1 - mdist / 140);
          ctx.stroke();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      parent?.removeEventListener("mousemove", handleMouseMove);
      parent?.removeEventListener("mouseleave", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 -z-10" />;
}

function StyleChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (buttonRef.current) {
      gsap.fromTo(
        buttonRef.current,
        { scale: 0.94 },
        { scale: 1, duration: 0.25, ease: "power2.out" }
      );
    }
    onClick();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer select-none",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-xs"
          : "border-border/80 bg-background/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground dark:bg-card/60"
      )}
    >
      <Icon
        className={cn(
          "size-3.5 transition-transform duration-150 group-hover:scale-110",
          active ? "text-primary-foreground" : "text-muted-foreground"
        )}
      />
      <span>{children}</span>
    </button>
  );
}

function ShapeChip({
  active,
  onClick,
  label,
  ratioText,
  aspectClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  ratioText: string;
  aspectClass: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (buttonRef.current) {
      gsap.fromTo(
        buttonRef.current,
        { scale: 0.94 },
        { scale: 1, duration: 0.25, ease: "power2.out" }
      );
    }
    onClick();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer select-none",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-xs"
          : "border-border/80 bg-background/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground dark:bg-card/60"
      )}
    >
      <div
        className={cn(
          "rounded-xs border border-current transition-transform duration-150 group-hover:scale-110",
          aspectClass,
          active ? "bg-primary-foreground/30" : "bg-transparent opacity-60"
        )}
      />
      <span>{label}</span>
      <span className="text-[10.5px] font-mono opacity-70">{ratioText}</span>
    </button>
  );
}

function ImageTool() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<string>("none");
  const [size, setSize] = useState<string>("square");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [status, setStatus] = useState<ImageToolStatus | null>(null);
  const [mounted, setMounted] = useState(false);

  // Daily prompt rotation state
  const [dailyIndex, setDailyIndex] = useState(0);
  const [examples, setExamples] = useState(DAILY_EXAMPLE_SETS[0]);

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLHeadElement>(null);
  const studioCardRef = useRef<HTMLDivElement>(null);
  const examplesRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
    // Initialize today's prompt set matching the day of the week
    const todayIndex = new Date().getDay(); // 0-6
    setDailyIndex(todayIndex);
    setExamples(DAILY_EXAMPLE_SETS[todayIndex]);
  }, []);

  const shufflePrompts = () => {
    const nextIndex = (dailyIndex + 1) % DAILY_EXAMPLE_SETS.length;
    setDailyIndex(nextIndex);
    setExamples(DAILY_EXAMPLE_SETS[nextIndex]);

    if (examplesRef.current) {
      gsap.fromTo(
        examplesRef.current.querySelectorAll(".example-card"),
        { opacity: 0, y: 8, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.05, ease: "power2.out" }
      );
    }
  };

  useGSAP(
    () => {
      if (!mounted) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      if (headerRef.current) {
        tl.fromTo(
          headerRef.current.children,
          { y: 15, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, clearProps: "transform,opacity" }
        );
      }

      if (studioCardRef.current) {
        tl.fromTo(
          studioCardRef.current,
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.55, clearProps: "transform,opacity" },
          "-=0.25"
        );
      }

      if (examplesRef.current) {
        const cards = examplesRef.current.querySelectorAll(".example-card");
        if (cards.length > 0) {
          tl.fromTo(
            cards,
            { y: 12, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, clearProps: "transform,opacity" },
            "-=0.2"
          );
        }
      }
    },
    { scope: containerRef, dependencies: [mounted] }
  );

  const loadStatus = useCallback(() => {
    fetch("/api/images", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ImageToolStatus | null) => data && setStatus(data))
      .catch(() => {});
  }, []);

  useEffect(() => loadStatus(), [loadStatus]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 100) / 10),
      100
    );
    return () => clearInterval(id);
  }, [busy]);

  async function generate(text?: string, seed?: number) {
    const value = (text ?? prompt).trim();
    if (!value || busy) return;

    setBusy(true);
    setElapsed(0);
    setError(null);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value, size, style, seed }),
      });

      const data = (await res.json().catch(() => null)) as
        | (GeneratedImage & { error?: string })
        | null;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Generation failed (${res.status})`);
      }

      setResults((prev) => [data, prev].flat().slice(0, 24));
      refreshCurrentUser();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  const recent = (status?.recent ?? []).filter(
    (image) => image.url && !results.some((r) => r.url === image.url)
  );

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-y-auto">
      {/* Interactive Constellation Particle Canvas Background */}
      <InteractiveConstellationCanvas />

      {/* Main Content Container */}
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10 space-y-7">
        {/* Header Section */}
        <header ref={headerRef} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <ImageIcon className="size-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Image Generator
                </h1>
                <p className="text-[13px] text-muted-foreground">
                  Describe an image prompt to render custom visual artwork
                </p>
              </div>
            </div>

            {status && (
              <div className="flex items-center gap-2">
                {status.quota && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-[12px] font-medium text-foreground backdrop-blur-md shadow-xs dark:bg-card/70">
                    <span className={cn("size-2 rounded-full", status.quota.canGenerate ? "bg-emerald-500" : "bg-amber-500")} />
                    <span className="font-semibold">
                      {status.quota.plan === "paid" ? "Pro Plan" : "Free Plan"}:
                    </span>
                    <span className="text-muted-foreground">
                      {status.quota.usedImages}/{status.quota.maxImages} images
                    </span>
                  </div>
                )}

                <div
                  className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-[12px] font-medium text-foreground backdrop-blur-md shadow-xs dark:bg-card/70"
                  title={status.key_loaded ? "Using your configured key" : "Free keyless provider"}
                >
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="capitalize">{status.provider}</span>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Upgrade Pro Plan Banner when Quota is Reached */}
        {status?.quota && !status.quota.canGenerate && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-background to-primary/10 p-4.5 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold text-[14px]">
                <Zap className="size-4 text-amber-500" />
                <span>
                  {status.quota.plan === "paid"
                    ? "Monthly Image Limit Reached (15/15)"
                    : "Free Image Limit Reached (1/1)"}
                </span>
              </div>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                {status.quota.plan === "paid"
                  ? "You have generated 15/15 images this month. Your quota will reset on your next billing cycle."
                  : "Free accounts can generate 1 image. Upgrade to Pro Plan (₹299/month) for 15 image generations per month."}
              </p>
            </div>
            <Link href="/plans" className="shrink-0">
              <Button className="gap-2 bg-gradient-to-r from-amber-500 to-indigo-600 font-semibold text-white shadow-md hover:opacity-95 cursor-pointer">
                <span>Upgrade to Pro (₹299/mo)</span>
              </Button>
            </Link>
          </div>
        )}

        {/* Generator Studio Card */}
        <section
          ref={studioCardRef}
          className="rounded-2xl border border-border/80 bg-background/80 p-5 sm:p-6 shadow-sm backdrop-blur-md dark:bg-card/80"
        >
          <div className="space-y-4">
            <div className="relative">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (status?.quota?.canGenerate !== false) {
                      generate();
                    }
                  }
                }}
                rows={3}
                disabled={status?.quota?.canGenerate === false}
                placeholder={
                  status?.quota?.canGenerate === false
                    ? "Upgrade to Pro Plan (₹299/mo) for 15 image generations per month..."
                    : "A neon-lit Tokyo alley in the rain, reflections on wet asphalt, cinematic..."
                }
                className="w-full resize-none rounded-xl border border-border bg-surface/60 px-4 py-3 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 transition-colors focus:border-primary/60 focus:bg-background disabled:opacity-60 dark:bg-surface/30 dark:focus:border-primary/60"
              />
              {prompt.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrompt("")}
                  className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                  title="Clear prompt"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
            </div>

            {/* Selectors */}
            <div className="grid gap-4 sm:grid-cols-2 pt-1">
              {/* Style Selector */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Palette className="size-3.5 text-primary" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    Style
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STYLES.map((option) => (
                    <StyleChip
                      key={option.id}
                      active={style === option.id}
                      onClick={() => setStyle(option.id)}
                      icon={option.icon}
                    >
                      {option.label}
                    </StyleChip>
                  ))}
                </div>
              </div>

              {/* Shape Selector */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Layers className="size-3.5 text-primary" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    Shape
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SIZES.map((option) => (
                    <ShapeChip
                      key={option.id}
                      active={size === option.id}
                      onClick={() => setSize(option.id)}
                      label={option.label}
                      ratioText={option.ratioText}
                      aspectClass={option.aspectClass}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Action Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/60">
              <p className="text-[11.5px] text-muted-foreground/80">
                Enter to generate · Shift+Enter for a new line
              </p>

              <Button
                onClick={() => generate()}
                disabled={busy || !prompt.trim() || status?.quota?.canGenerate === false}
                className={cn(
                  "gap-2 px-5 font-medium cursor-pointer transition-all duration-200",
                  busy && "animate-pulse ring-2 ring-primary/30 shadow-sm shadow-primary/20"
                )}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Generating {elapsed.toFixed(1)}s...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" />
                    <span>Generate</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </section>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">Generation Issue</p>
              <p className="text-muted-foreground leading-relaxed">{error}</p>
              {/credit|plan|subscription/i.test(error) && (
                <Link href="/plans" className="inline-block text-primary font-medium hover:underline text-[12.5px]">
                  Upgrade plan →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Preset Daily Examples */}
        {results.length === 0 && (
          <div ref={examplesRef} className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="size-3.5 text-amber-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Daily Inspiration — Try one of these
                </p>
              </div>

              <button
                type="button"
                onClick={shufflePrompts}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                title="Shuffle fresh prompt suggestions"
              >
                <RefreshCw className="size-3" />
                <span>Refresh Prompts</span>
              </button>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {examples.map((example) => (
                <button
                  key={example.text}
                  type="button"
                  onClick={() => {
                    setPrompt(example.text);
                    promptRef.current?.focus();
                  }}
                  className="example-card group flex flex-col justify-between rounded-xl border border-border/80 bg-background/80 p-3.5 text-left text-[12.5px] leading-snug text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground cursor-pointer dark:bg-card/60"
                >
                  <span className="w-fit text-[10.5px] font-medium text-primary mb-1">
                    {example.category}
                  </span>
                  <span className="text-foreground/90 group-hover:text-foreground">
                    "{example.text}"
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results Gallery */}
        {results.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Generated Images
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              {results.map((image, i) => (
                <article key={image.url + i} className="flex flex-col space-y-2 rounded-2xl border border-border/80 bg-background/80 p-3 shadow-xs dark:bg-card/80">
                  <GeneratedImageCard image={image} aspectRatio="square" />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground" title={image.prompt}>
                      {image.prompt}
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-[12px] h-7 px-2.5 cursor-pointer"
                        disabled={busy}
                        onClick={() => generate(image.prompt)}
                      >
                        <Dices className="size-3 text-primary" />
                        Vary
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-[12px] h-7 px-2.5 cursor-pointer"
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(image.prompt)
                            .then(() => showToast("Prompt copied", "success"))
                            .catch(() => showToast("Could not copy prompt", "error"));
                        }}
                      >
                        <Copy className="size-3 text-primary" />
                        Copy
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Recent Generations */}
        {recent.length > 0 && (
          <section className="space-y-2.5 pt-2 border-t border-border/50">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              Your recent generations
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 items-start">
              {recent.map((image) => (
                <GeneratedImageCard key={image.url} image={image} aspectRatio="square" />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function ImageToolPage() {
  return (
    <AppShell>
      <ImageTool />
    </AppShell>
  );
}
