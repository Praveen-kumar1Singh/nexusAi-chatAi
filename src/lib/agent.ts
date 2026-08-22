/**
 * Server-side helper for talking to the Python agent.
 * Only ever imported from route handlers, so AGENT_URL stays off the client.
 */

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";

export const AGENT_DOWN =
  `Cannot reach the Python agent. Start it with: npm run dev:api`;

/**
 * Identifies the account to the agent so it can scope conversations. The email
 * comes from the session cookie, resolved server-side -- the browser never
 * supplies it, so it cannot ask for someone else's threads.
 */
export function userHeader(email: string | null): Record<string, string> {
  return email ? { "x-user-email": email } : {};
}

/** Proxy a GET (or DELETE) to the agent and pass its JSON straight through. */
export async function proxyJson(path: string, init?: RequestInit) {
  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}${path}`, { cache: "no-store", ...init });
  } catch {
    return Response.json({ error: AGENT_DOWN }, { status: 502 });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export { AGENT_URL };

/**
 * Fetch JSON from the agent inside a Server Component.
 * Returns null when the agent is unreachable so pages can render an offline state.
 */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${AGENT_URL}${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export function getTools() {
  return getJson<{ model: string; tools: import("@/lib/types").ToolInfo[] }>("/tools");
}
