"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crown, Laptop, LogIn, LogOut, Moon, Sparkles, Sun, User, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthModal } from "./auth-modal";
import { PlanActivationModal } from "./plan-activation-modal";
import { logout, useSession } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function formatEmail(email: string, maxLen: number = 12): string {
  if (!email) return "";
  if (email.length <= maxLen) return email;
  return email.slice(0, maxLen) + "...";
}

export function ProfileAvatarMenu({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { user, loading } = useSession();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<"login" | "register">("login");

  // Auto open plan activation modal if logged in user has no active plan
  useEffect(() => {
    if (user && (user.plan === "none" || !user.plan)) {
      setPlanModalOpen(true);
    }
  }, [user]);

  if (loading) {
    return (
      <div className={cn("p-2 flex items-center gap-2.5", collapsed && "justify-center p-1")}>
        <div className="size-8 shrink-0 rounded-full bg-elevated animate-pulse" />
        {!collapsed && (
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="h-3 w-20 rounded-md bg-elevated animate-pulse" />
            <div className="h-2.5 w-14 rounded-md bg-elevated/70 animate-pulse" />
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <div className="p-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setInitialTab("login");
              setModalOpen(true);
            }}
            className={cn(
              "w-full justify-start gap-2 border-border bg-surface text-xs font-medium hover:bg-elevated hover:text-foreground cursor-pointer",
              collapsed && "justify-center px-0",
            )}
            title="Login / Register"
          >
            <LogIn className="size-3.5 text-primary shrink-0" />
            {!collapsed && <span>Login / Register</span>}
          </Button>
        </div>

        <AuthModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          initialTab={initialTab}
        />
      </>
    );
  }

  const initial =
    user.name && user.name.trim()
      ? user.name.trim()[0].toUpperCase()
      : user.email
      ? user.email[0].toUpperCase()
      : "U";
  const displayName =
    user.name && user.name.trim() ? user.name.trim() : formatEmail(user.email, 12);
  const avatarGradient = user.avatar || "from-primary to-indigo-500";
  const currentPlan = user.plan || "none";
  const credits = typeof user.credits === "number" ? user.credits : 0;

  return (
    <>
      <div className="p-2 space-y-1.5">
        {!collapsed && (
          <div className="px-1.5 flex items-center justify-between">
            <button
              onClick={() => setPlanModalOpen(true)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="View Plan Credits"
            >
              <Zap className="size-3 text-primary shrink-0" />
              {currentPlan === "paid" ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Crown className="size-3 text-amber-400" /> Pro Unlimited
                </span>
              ) : currentPlan === "free" ? (
                <span>
                  <strong className="text-foreground">{credits}</strong> / 50 Credits
                </span>
              ) : (
                <span className="text-amber-400">Activate Plan</span>
              )}
            </button>
            <Link
              href="/plans"
              onClick={() => onNavigate?.()}
              className="text-[10.5px] font-semibold text-primary hover:underline cursor-pointer py-0.5 px-1 rounded-sm hover:bg-primary/10 transition-colors"
            >
              Plans &rarr;
            </Link>
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-sidebar-accent group focus:outline-hidden cursor-pointer",
                collapsed && "justify-center p-1",
              )}
              title={user.email}
            >
              <div
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-white font-semibold text-xs shadow-xs ring-2 ring-primary/20 overflow-hidden bg-gradient-to-tr",
                  avatarGradient,
                )}
              >
                {user.avatarImage ? (
                  <img src={user.avatarImage} alt="Avatar" className="size-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-sidebar-foreground">
                    {displayName}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {currentPlan === "paid"
                      ? "Pro Unlimited Plan"
                      : currentPlan === "free"
                      ? `${credits} credits remaining`
                      : "No Active Plan"}
                  </p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 p-1.5">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p
                  className="text-xs font-semibold leading-none text-foreground truncate"
                  title={user.name || user.email}
                >
                  {user.name || displayName}
                </p>
                <p
                  className="text-[10.5px] leading-none text-muted-foreground truncate"
                  title={user.email}
                >
                  {user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="text-xs gap-2 cursor-pointer focus:bg-elevated">
              <Link href="/profile">
                <User className="size-3.5 text-primary" /> Edit Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="text-xs gap-2 cursor-pointer focus:bg-elevated">
              <Link href="/plans">
                <Sparkles className="size-3.5 text-amber-400" /> Pricing &amp; Plans
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between px-2.5 py-1.5 text-xs text-foreground">
              <div className="flex items-center gap-2 font-medium">
                {resolvedTheme === "dark" ? (
                  <Moon className="size-3.5 text-indigo-400 shrink-0" />
                ) : (
                  <Sun className="size-3.5 text-amber-400 shrink-0" />
                )}
                <span>Appearance</span>
              </div>
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-elevated transition-colors duration-200 ease-in-out focus:outline-hidden ring-1 ring-border"
                role="switch"
                aria-checked={resolvedTheme === "dark"}
                title={resolvedTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block size-4 rounded-full bg-primary shadow-xs ring-0 transition duration-200 ease-in-out flex items-center justify-center text-[9px] text-white",
                    resolvedTheme === "dark" ? "translate-x-4" : "translate-x-0",
                  )}
                >
                  {resolvedTheme === "dark" ? (
                    <Moon className="size-2.5 text-white" />
                  ) : (
                    <Sun className="size-2.5 text-white" />
                  )}
                </span>
              </button>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs gap-2 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
              onSelect={() => {
                logout();
              }}
            >
              <LogOut className="size-3.5" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialTab="login"
      />

      <PlanActivationModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
      />
    </>
  );
}
