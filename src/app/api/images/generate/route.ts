/**
 * Image generation proxy.
 *
 * Same arrangement as /api/chat: the provider key lives in the Python service,
 * the browser only ever talks to its own origin. Credits are charged here
 * rather than in the agent, because the account record is on this side.
 */

import { AGENT_DOWN, AGENT_URL, agentAuth, userHeader } from "@/lib/agent";
import { chargeImageQuota } from "@/lib/credits";
import { sessionEmailOr503 } from "@/lib/route-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold model on a shared provider can take most of a minute.
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  // Charge Image quota: 1 image for free users, 15 images/month for ₹299 Pro subscribers
  const charge = await chargeImageQuota(session.email);
  if (charge) return charge;

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/images/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...agentAuth(),
        ...userHeader(session.email),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: AGENT_DOWN }, { status: 502 });
  }

  if (!upstream.ok) {
    // A 404 means the agent predates this route rather than that the image is
    // missing, which would send someone hunting the wrong thing entirely.
    if (upstream.status === 404) {
      return Response.json(
        {
          error:
            "The Python agent has no /images route -- it is running a build from " +
            "before image generation was added. Restart it: npm run dev:api",
        },
        { status: 502 },
      );
    }

    const detail = (await upstream.json().catch(() => null)) as { detail?: string } | null;
    return Response.json(
      { error: detail?.detail ?? `Image generation failed (${upstream.status}).` },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
