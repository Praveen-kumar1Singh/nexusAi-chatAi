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

/**
 * The session lives in an httpOnly cookie, so client code cannot read who is
 * signed in -- it has to ask the server. This module-level cache keeps every
 * component that mounts from firing its own request.
 */
let cached: CurrentUser | null = null;
let inFlight: Promise<CurrentUser | null> | null = null;
let loadedOnce = false;

async function fetchUser(): Promise<CurrentUser | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("/api/auth/me", { cache: "no-store", signal: timer ? controller.signal : undefined }).catch(() => null);
    clearTimeout(timer);
    const data = res && res.ok ? await res.json().catch(() => null) : null;
    cached = data?.user ?? null;
  } catch {
    // Offline or the route is down -- treat as signed out rather than throwing
    // inside a render tree.
    cached = null;
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
    window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
  }
}

/** End the session server-side, then let the app know. */
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  cached = null;
  loadedOnce = true;
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
