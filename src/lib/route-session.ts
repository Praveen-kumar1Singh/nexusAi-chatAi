import { NextResponse } from "next/server";
import { DB_UNREACHABLE } from "@/lib/mongodb";
import { SessionStoreDown, currentEmail } from "@/lib/session";

/**
 * Resolve the caller for a route that proxies to the agent.
 *
 * `email` is null for a guest -- a normal state, not an error. A `response` is
 * returned only when the session store is down, which is an outage worth
 * surfacing rather than quietly treating everyone as a guest.
 */
export async function sessionEmailOr503(): Promise<{
  email: string | null;
  response?: NextResponse;
}> {
  try {
    return { email: await currentEmail() };
  } catch (err) {
    if (err instanceof SessionStoreDown) {
      return {
        email: null,
        response: NextResponse.json({ error: DB_UNREACHABLE }, { status: 503 }),
      };
    }
    throw err;
  }
}
