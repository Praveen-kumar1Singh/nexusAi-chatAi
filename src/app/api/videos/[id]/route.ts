/**
 * Serves one generated clip from the agent's store.
 *
 * The id is minted per generation and never reused, so the bytes are immutable
 * and cached hard. The range headers are passed straight through: without them
 * the <video> element cannot seek, and Safari refuses to play at all.
 */

import { AGENT_DOWN, AGENT_URL, agentAuth } from "@/lib/agent";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;

  const range = req.headers.get("range");

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/videos/${encodeURIComponent(id)}`, {
      headers: { ...agentAuth(), ...(range ? { Range: range } : {}) },
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: AGENT_DOWN }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "That video is no longer available." },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  for (const key of ["content-length", "content-range"]) {
    const value = upstream.headers.get(key);
    if (value) headers[key === "content-length" ? "Content-Length" : "Content-Range"] = value;
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
