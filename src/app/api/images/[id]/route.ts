/**
 * Serves one generated image from the agent's store.
 *
 * The id is minted per generation and never reused, so the bytes are immutable
 * and cached hard -- reopening a thread full of pictures costs nothing.
 */

import { AGENT_DOWN, AGENT_URL, agentAuth } from "@/lib/agent";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/images/${encodeURIComponent(id)}`, {
      headers: agentAuth(),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: AGENT_DOWN }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "That image is no longer available." },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
