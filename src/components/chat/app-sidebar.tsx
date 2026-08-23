"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AudioLines,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProfileAvatarMenu } from "@/components/auth/profile-avatar-menu";
import { AuthModal } from "@/components/auth/auth-modal";
import { showToast } from "@/components/ui/toast";
import { AUTH_CHANGED_EVENT, useSession } from "@/lib/auth";
import { CONVERSATIONS_CHANGED, SELECT_CONVERSATION, type Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Bucket a conversation by how long ago it was last touched. */
function groupOf(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 7) return "Previous 7 Days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 Days", "Older"];

/** Main navigation links in the sidebar. */
const SECTIONS = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/voice", label: "AI Voice Chat", icon: AudioLines },
  { href: "/tools/image", label: "Image Generator", icon: ImageIcon },
] as const;

function cleanTitle(rawTitle: string): string {
  if (!rawTitle) return "New Conversation";
  let cleaned = rawTitle
    .replace(/===ATTACHMENT_START:[\s\S]*?===/g, "")
    .replace(/===ATTACHMENT_END===/g, "")
    .replace(/【.*?】/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();

  cleaned = cleaned.replace(/\s+/g, " ");

  if (!cleaned) return "Attachment File";

  if (cleaned.length > 38) {
    cleaned = cleaned.slice(0, 38).trim() + "...";
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const CACHED_CONVERSATIONS_KEY = "nexus_cached_conversations";

function getStoredConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHED_CONVERSATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredConversations(conversations: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHED_CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage quota errors
  }
}

export function AppSidebar({
  collapsed,
  onToggle,
  onItemClick,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onItemClick?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const onChatPage = pathname === "/";

  useEffect(() => {
    setMounted(true);
    setConversations(getStoredConversations());
  }, []);

  const { user, loading: sessionLoading } = useSession();
  const signedIn = Boolean(user);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");

  function selectThread(id: string | null) {
    setActiveId(id);
    onItemClick?.();
    if (onChatPage) {
      window.dispatchEvent(new CustomEvent(SELECT_CONVERSATION, { detail: { id } }));
    } else {
      router.push(id ? `/?c=${encodeURIComponent(id)}` : "/");
    }
  }

  const load = useCallback(
    () =>
      fetch("/api/conversations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { conversations?: Conversation[] } | null) => {
          if (data?.conversations) {
            setConversations(data.conversations);
            setStoredConversations(data.conversations);
          }
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    if (!signedIn) return;
    load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, [load, signedIn]);

  useEffect(() => {
    function onAuthChange() {
      setActiveId(null);
      setConversations([]);
      if (typeof window !== "undefined") {
        localStorage.removeItem(CACHED_CONVERSATIONS_KEY);
      }
    }
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
  }, []);

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (id === activeId) selectThread(null);
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== id);
          setStoredConversations(next);
          return next;
        });
        load();
        showToast("Conversation deleted successfully", "success");
      } else {
        showToast("Failed to delete conversation", "error");
      }
    } catch {
      showToast("Error deleting conversation", "error");
    }
  }

  return (
    <aside
      className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground overflow-hidden"
    >
      <div className="flex items-center justify-between px-3.5 py-4">
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="mx-auto size-8 text-sidebar-foreground hover:bg-sidebar-accent"
            title="Expand sidebar"
          >
            <ChevronsRight className="size-4" />
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground font-bold text-xs shrink-0">
                <Hexagon className="size-4 fill-current" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-display font-bold text-sm tracking-tight text-sidebar-foreground truncate">
                  Nexus AI
                </span>
                <span className="text-[10px] text-muted-foreground/70 font-mono tracking-wider uppercase">
                  Environment
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="size-7 text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
              title="Collapse sidebar"
            >
              <ChevronsLeft className="size-4" />
            </Button>
          </>
        )}
      </div>

      <nav className="space-y-0.5 px-3 pb-3">
        {SECTIONS.map((section) => {
          const current = pathname === section.href;
          return (
            <Link
              key={section.href}
              href={section.href}
              onClick={() => onItemClick?.()}
              title={collapsed ? section.label : undefined}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                current
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <section.icon className={cn("size-4 shrink-0", current && "text-primary")} />
              {!collapsed && section.label}
            </Link>
          );
        })}
      </nav>

      {mounted && !sessionLoading && signedIn && (
        <div className="px-3 pb-3">
          <Button
            variant="secondary"
            onClick={() => selectThread(null)}
            className={cn(
              "w-full justify-start gap-2 border border-border bg-elevated/70 text-sm hover:bg-elevated cursor-pointer",
              collapsed && "justify-center px-0",
            )}
          >
            <Plus className="size-4 text-primary" />
            {!collapsed && "New Conversation"}
          </Button>
        </div>
      )}

      <div className="px-3 pt-1">
        <Separator className="bg-sidebar-border" />
      </div>

      {mounted && !collapsed && !sessionLoading && !signedIn && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <div className="rounded-xl border border-border bg-surface/60 p-2.5 space-y-1">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground">
              <MessageSquare className="size-3 text-primary shrink-0" />
              Guest Chat (Unsaved)
            </p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Temporary window.{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthTab("login");
                  setAuthModalOpen(true);
                }}
                className="font-medium text-primary hover:text-primary/80 transition-colors no-underline cursor-pointer"
              >
                Log in / Register
              </button>{" "}
              to save history &amp; unlock 50 free credits.
            </p>
          </div>

          <AuthModal
            open={authModalOpen}
            onClose={() => setAuthModalOpen(false)}
            initialTab={authTab}
          />
        </div>
      )}

      {mounted && !collapsed && !sessionLoading && signedIn && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {conversations.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-muted-foreground/70">
              No conversations yet. Ask something to start one.
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = conversations.filter((c) => groupOf(c.updated_at) === group);
              if (!rows.length) return null;
              return (
                <div key={group} className="mb-4">
                  <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {rows.map((c) => (
                      <div
                        key={c.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          c.id === activeId && "bg-sidebar-accent text-sidebar-accent-foreground",
                        )}
                      >
                        <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                        <button
                          onClick={() => selectThread(c.id)}
                          className="min-w-0 flex-1 truncate text-left cursor-pointer"
                          title={cleanTitle(c.title)}
                        >
                          {cleanTitle(c.title)}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(c.id);
                          }}
                          className="opacity-0 transition-opacity group-hover:opacity-100 rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive cursor-pointer"
                          title="Delete conversation"
                          aria-label={`Delete ${cleanTitle(c.title)}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="mt-auto border-t border-sidebar-border">
        <ProfileAvatarMenu collapsed={collapsed} onNavigate={onItemClick ?? onToggle} />
      </div>
    </aside>
  );
}
