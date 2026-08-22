/**
 * Speech proxy.
 *
 * The KittenTTS model lives in the Python service; this route only carries the
 * WAV back, so the browser keeps talking to its own origin and AGENT_URL stays
 * off the client -- same arrangement as /api/chat.
 */

import { AGENT_DOWN, AGENT_URL, proxyJson } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold model load plus a long reply can take a while on CPU.
export const maxDuration = 60;

/** Is speech available, and in which voices? Drives the composer's speaker button. */
export async function GET() {
  return proxyJson("/tts/voices");
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: AGENT_DOWN }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // A 404 is not a speech failure: it means the agent process is older than
    // this route. Saying "Not Found" would send someone hunting the wrong thing.
    if (upstream.status === 404) {
      return Response.json(
        {
          error:
            "The Python agent has no /tts route -- it is running a build from " +
            "before speech was added. Restart it: npm run dev:api",
        },
        { status: 502 },
      );
    }

    // Otherwise FastAPI puts the reason in `detail` -- including the pip line to
    // run when KittenTTS simply is not installed (503).
    const detail = (await upstream.json().catch(() => null)) as { detail?: string } | null;
    return Response.json(
      { error: detail?.detail ?? `Speech failed (${upstream.status}).` },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
}
