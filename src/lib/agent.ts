/**
 * Server-side helper for talking to the Python agent.
 * Only ever imported from route handlers, so AGENT_URL stays off the client.
 */

const AGENT_URL = (process.env.AGENT_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export const AGENT_DOWN =
  `Cannot reach the Python agent. Start it with: npm run dev:api`;

/**
 * Proves the call came from this app and not from the open internet.
 *
 * Only needed once the agent is deployed on its own host (Render) while this
 * runs on Vercel: the agent takes the account from `x-user-email`, so its URL
 * has to be closed to everyone but us. Must match AGENT_TOKEN on the agent;
 * unset on both sides locally, where the agent is only on 127.0.0.1.
 */
export function agentAuth(): Record<string, string> {
  const token = process.env.AGENT_TOKEN;
  return token ? { "x-agent-token": token } : {};
}

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
    upstream = await fetch(`${AGENT_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...agentAuth(), ...(init?.headers as Record<string, string>) },
    });
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
    const res = await fetch(`${AGENT_URL}${path}`, {
      cache: "no-store",
      headers: agentAuth(),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export function getTools() {
  return getJson<{ model: string; tools: import("@/lib/types").ToolInfo[] }>("/tools");
}
