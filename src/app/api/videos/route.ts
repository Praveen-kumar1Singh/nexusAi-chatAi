/**
 * Which video model is configured, this account's recent clips, and quota status.
 * Drives the Video Generator page's provider badge, duration ladder and gallery.
 */

import { AGENT_URL, agentAuth, userHeader } from "@/lib/agent";
import { getVideoQuotaStatus } from "@/lib/credits";
import { sessionEmailOr503 } from "@/lib/route-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  const quota = await getVideoQuotaStatus(session.email);

  try {
    const upstream = await fetch(`${AGENT_URL}/videos`, {
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
    // Return quota status even if the Python agent is offline.
  }

  return Response.json({ available: false, quota });
}
