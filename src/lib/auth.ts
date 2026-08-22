"use client";

import { useEffect, useState } from "react";

export type CurrentUser = {
  email: string;
  name?: string;
  avatar?: string;
  avatarImage?: string;
  plan?: "none" | "free" | "paid";
  credits?: number;
  planActivatedAt?: string;
  planExpiresAt?: string;
};

/** Fired whenever the signed-in account changes, including on logout. */
export const AUTH_CHANGED_EVENT = "auth:changed";
/** Fired whenever credit counts update in real-time. */
export const CREDITS_CHANGED_EVENT = "credits:changed";

const SESSION_STORAGE_KEY = "nexus_user_session";

function getStoredUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredUser(user: CurrentUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Module-level session cache. Seeded from localStorage on startup so page refresh
 * never flashes a logged-out state or loses the session during network delay.
 */
let cached: CurrentUser | null = getStoredUser();
let inFlight: Promise<CurrentUser | null> | null = null;
let loadedOnce = cached !== null;

async function fetchUser(): Promise<CurrentUser | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("/api/auth/me", {
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timer);

    if (res) {
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { user?: CurrentUser | null } | null;
        if (data && "user" in data) {
          cached = data.user ?? null;
          setStoredUser(cached);
        }
      } else if (res.status === 401) {
        // Explicitly unauthorized session
        cached = null;
        setStoredUser(null);
      }
      // On 500/502/503 server errors, keep existing stored user session
    }
  } catch {
    // On network failure or timeout, retain cached localStorage user rather than logging out
  }
  loadedOnce = true;
  return cached;
}

/** Re-read the session from the server and tell every listener about it. */
export async function refreshCurrentUser(): Promise<CurrentUser | null> {
  inFlight = fetchUser();
  const user = await inFlight;
  inFlight = null;
  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
  return user;
}

/** Instantly decrement credits locally for free plan users and notify all UI listeners. */
export function decrementLocalCredit(): void {
  if (cached && cached.plan === "free" && typeof cached.credits === "number" && cached.credits > 0) {
    cached = {
      ...cached,
      credits: cached.credits - 1,
    };
    setStoredUser(cached);
    window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
  }
}

/** End the session server-side, then let the app know. */
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  cached = null;
  loadedOnce = true;
  setStoredUser(null);
  if (typeof window !== "undefined") {
    localStorage.removeItem("nexus_cached_conversations");
  }
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/**
 * The signed-in account, or null.
 *
 * `loading` is true until the first answer arrives; callers should wait rather
 * than render a signed-out state, which would otherwise flash on every load.
 */
export function useSession(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(cached);
  const [loading, setLoading] = useState(!loadedOnce);

  useEffect(() => {
    let active = true;

    function apply(next: CurrentUser | null) {
      if (!active) return;
      setUser(next);
      setLoading(false);
    }

    if (loadedOnce) {
      apply(cached);
    } else {
      (inFlight ??= fetchUser()).then(apply);
    }

    const sync = () => apply(cached);
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener(CREDITS_CHANGED_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener(CREDITS_CHANGED_EVENT, sync);
    };
  }, []);

  return { user, loading };
}
