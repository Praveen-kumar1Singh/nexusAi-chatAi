/**
 * Which image model is configured, this account's recent generations, and quota status.
 * Drives the Image Generator page's provider badge, quota card, and gallery.
 */

import { AGENT_URL, agentAuth, userHeader } from "@/lib/agent";
import { getImageQuotaStatus } from "@/lib/credits";
import { sessionEmailOr503 } from "@/lib/route-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  const quota = await getImageQuotaStatus(session.email);

  try {
    const upstream = await fetch(`${AGENT_URL}/images`, {
      headers: {
        ...agentAuth(),
        ...userHeader(session.email),
      },
      cache: "no-store",
    });

    if (upstream.ok) {
      const data = await upstream.json();
      return Response.json({ ...data, quota });
    }
  } catch {
    // Return quota status even if Python agent is offline
  }

  return Response.json({ available: false, quota });
}
