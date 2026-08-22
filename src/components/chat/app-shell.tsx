"use client";

import { Suspense, useState, type ReactNode } from "react";
import { PanelRight, Menu } from "lucide-react";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ActiveContextPanel } from "@/components/chat/active-context-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  rightPanel = false,
}: {
  children: ReactNode;
  rightPanel?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [context, setContext] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div
        className={cn(
          "hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out lg:block shrink-0 overflow-hidden",
          collapsed ? "w-[68px]" : "w-[260px]",
        )}
      >
        <Suspense fallback={null}>
          <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        </Suspense>
      </div>

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" showCloseButton={false} className="w-[70vw] max-w-[280px] border-sidebar-border p-0">
          <Suspense fallback={null}>
            <AppSidebar collapsed={false} onToggle={() => setMobileNav(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2 lg:hidden">
            <Button variant="ghost" size="icon" onClick={() => setMobileNav(true)} aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
            <span className="font-display text-sm font-semibold">Nexus AI</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {rightPanel && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => setContext((v) => !v)}
                title="Toggle Active Context"
              >
                <PanelRight className="size-4 text-primary" />
                <span className="hidden sm:inline">Active Context</span>
              </Button>
            )}
          </div>
        </div>
        {children}
      </div>

      {rightPanel && (
        <aside
          className={cn(
            "h-full overflow-hidden transition-[width,opacity] duration-300 ease-in-out border-l border-sidebar-border bg-sidebar shrink-0",
            context ? "w-[300px] opacity-100" : "w-0 opacity-0 border-l-0"
          )}
        >
          <div className="w-[300px] h-full">
            <ActiveContextPanel onClose={() => setContext(false)} />
          </div>
        </aside>
      )}
    </div>
  );
}