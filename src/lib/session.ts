/**
 * Cookie-backed sessions.
 *
 * The browser only ever holds an opaque token in an httpOnly cookie; the email
 * behind it is resolved here, on the server. Nothing about the account is
 * readable or forgeable from client code.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/mongodb";
import type { Db } from "mongodb";

export const SESSION_COOKIE = "mantraa_session";

const SESSION_DAYS = 30;

export type SessionUser = {
  email: string;
  name: string;
  avatar: string;
  avatarImage: string;
  plan: "none" | "free" | "paid";
  credits: number;
  planActivatedAt?: string;
};

/**
 * Raised when the session store itself is unavailable, as opposed to absent.
 * The original failure is kept as `cause` so callers can tell a misconfigured
 * deployment from an unreachable one -- see `dbErrorMessage`.
 */
export class SessionStoreDown extends Error {}

let indexes: Promise<void> | null = null;

function ensureIndexes(db: Db): Promise<void> {
  // Mongo expires sessions on `expiresAt` for us, so nothing sweeps them.
  indexes ??= Promise.all([
    db.collection("sessions").createIndex({ token: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
    .then(() => undefined)
    .catch((err) => {
      indexes = null; // let a later request try again
      throw err;
    });
  return indexes;
}

async function store(): Promise<Db> {
  try {
    return await getDb();
  } catch (err) {
    throw new SessionStoreDown(String(err), { cause: err });
  }
}

/** Mint a session for `email` and set it on the outgoing response. */
export async function startSession(email: string): Promise<void> {
  const db = await store();
  await ensureIndexes(db);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.collection("sessions").insertOne({
    token,
    email,
    createdAt: new Date(),
    expiresAt,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * The signed-in email, or null when there is no usable session.
 * Throws SessionStoreDown if the database cannot be reached, so callers can
 * report an outage instead of silently downgrading someone to a guest.
 */
export async function currentEmail(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await store();
  const session = await db.collection("sessions").findOne({ token });
  if (!session) return null;
  // Belt and braces: the TTL index removes these, but only every 60s or so.
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;

  return String(session.email);
}

/** The full profile behind the session, for rendering the account menu. */
export async function currentUser(): Promise<SessionUser | null> {
  const email = await currentEmail();
  if (!email) return null;

  const db = await store();
  const user = await db.collection("users").findOne({ email });
  if (!user) return null;

  return {
    email: String(user.email),
    name: user.name ?? "",
    avatar: user.avatar ?? "",
    avatarImage: user.avatarImage ?? "",
    plan: user.plan ?? "none",
    credits: typeof user.credits === "number" ? user.credits : 0,
    planActivatedAt: user.planActivatedAt ?? "",
  };
}

/** Drop the session server-side and clear the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);

  if (!token) return;
  try {
    const db = await store();
    await db.collection("sessions").deleteOne({ token });
  } catch {
    // The cookie is already gone, so the browser is signed out either way.
  }
}
