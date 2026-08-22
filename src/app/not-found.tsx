import Link from "next/link";
import { ArrowLeft, Compass, Hexagon, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "404 — Page Not Found | Nexus AI",
  description: "The page you are looking for does not exist or has been moved.",
};

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background text-foreground p-6 selection:bg-primary/20">
      {/* Ambient background glow effects */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[500px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-primary/30 via-indigo-500/20 to-purple-600/10 blur-3xl opacity-60 animate-pulse duration-1000" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 size-[400px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      {/* Decorative Grid Overlay */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:36px_36px]" />

      <div className="relative flex max-w-lg flex-col items-center text-center animate-in fade-in zoom-in-95 duration-500 space-y-6">
        {/* 404 Large Gradient Text */}
        <div className="space-y-1">
          <h1 className="font-display text-7xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-indigo-400 to-purple-400 bg-clip-text text-transparent sm:text-8xl">
            404
          </h1>
          <h2 className="text-xl font-semibold font-display text-foreground sm:text-2xl">
            Lost in the AI Grid
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
            The page or conversation thread you requested doesn&apos;t exist, may have been moved, or cleared from memory.
          </p>
        </div>

        {/* Floating Action Glass Card */}
        <div className="w-full rounded-2xl border border-border/80 bg-surface/60 p-4 backdrop-blur-md shadow-lg space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center justify-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" />
            Where would you like to go next?
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button
              asChild
              className="flex-1 justify-center gap-2 py-2.5 text-xs font-medium cursor-pointer shadow-md"
            >
              <Link href="/">
                <ArrowLeft className="size-3.5" /> Return to Workspace
              </Link>
            </Button>
            <Button
              variant="outline"
              asChild
              className="flex-1 justify-center gap-2 py-2.5 text-xs font-medium border-border bg-surface hover:bg-elevated cursor-pointer"
            >
              <Link href="/">
                <Plus className="size-3.5 text-primary" /> Start New Chat
              </Link>
            </Button>
          </div>
        </div>

        {/* Bottom subtle status label */}
        <div className="pt-2 text-[11px] text-muted-foreground/60 flex items-center gap-2">
          <span className="size-2 rounded-full bg-success animate-pulse" />
           Nexus AI Agent System · All Services Operational
        </div>
      </div>
    </div>
  );
}
