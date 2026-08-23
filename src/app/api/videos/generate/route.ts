/**
 * Video generation proxy.
 *
 * Same arrangement as /api/images/generate -- the provider key lives in the
 * Python service, the browser only ever talks to its own origin, and the quota
 * is charged here because the account record is on this side.
 */

import { AGENT_DOWN, AGENT_URL, agentAuth, userHeader } from "@/lib/agent";
import { chargeVideoQuota } from "@/lib/credits";
import { sessionEmailOr503 } from "@/lib/route-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Video is not image-fast: the provider takes one to three minutes for a short
// clip. This is the ceiling Vercel allows on a Pro plan; on Hobby the cap is 60s
// and a 10s clip will time out here long before the agent gives up on it.
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  const charge = await chargeVideoQuota(session.email);
  if (charge) return charge;

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/videos/generate`, {
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
    // A 404 means the agent predates this route rather than that a clip is
    // missing, which would send someone hunting the wrong thing entirely.
    if (upstream.status === 404) {
      return Response.json(
        {
          error:
            "The Python agent has no /videos route -- it is running a build from " +
            "before video generation was added. Restart it: npm run dev:api",
        },
        { status: 502 },
      );
    }

    const detail = (await upstream.json().catch(() => null)) as { detail?: string } | null;
    return Response.json(
      { error: detail?.detail ?? `Video generation failed (${upstream.status}).` },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
