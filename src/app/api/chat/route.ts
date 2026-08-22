/**
 * Thin proxy to the Python agent service.
 *
 * All Groq and tool-calling logic lives in `server/` (FastAPI). Keeping a Next
 * route in front means the browser only ever talks to its own origin -- no CORS,
 * and the agent host stays private to the server.
 */

import { agentAuth, userHeader } from "@/lib/agent";
import { sessionEmailOr503 } from "@/lib/route-session";

export const runtime = "nodejs";
export const maxDuration = 60;

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // A guest never touches the session store, so signed-out chat keeps working
  // even when the database is down. A signed-in caller is told plainly instead,
  // rather than being downgraded to an unsaved thread behind their back.
  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  // Guest limit check (max 10 prompts for unauthenticated sessions)
  if (!session.email && typeof body === "object" && body !== null && "messages" in body) {
    const rawMessages = (body as { messages?: unknown }).messages;
    if (Array.isArray(rawMessages)) {
      const userPromptsCount = rawMessages.filter((m: { role?: string }) => m?.role === "user").length;
      if (userPromptsCount > 10) {
        return Response.json(
          {
            error:
              "You have reached the guest limit of 10 prompts. Create a free account or log in to receive 50 free credits, save your conversation history, and continue chatting.",
            code: "GUEST_LIMIT_REACHED",
          },
          { status: 402 },
        );
      }
    }
  }

  // Credit & Plan Enforcement for signed-in users
  if (session.email) {
    try {
      const { getDb } = await import("@/lib/mongodb");
      const db = await getDb();
      const users = db.collection("users");
      const user = await users.findOne({ email: session.email });

      if (user) {
        const userPlan = user.plan ?? "none";
        const userCredits = typeof user.credits === "number" ? user.credits : 0;
        const isPaidExpired =
          userPlan === "paid" &&
          user.planExpiresAt &&
          new Date(user.planExpiresAt).getTime() < Date.now();

        if (isPaidExpired) {
          return Response.json(
            {
              error:
                "Your monthly Pro subscription of ₹299/month has expired. Please top up / renew your plan to continue accessing your account.",
              code: "SUBSCRIPTION_EXPIRED",
            },
            { status: 402 },
          );
        }

        if (userPlan === "none") {
          return Response.json(
            {
              error:
                "Please activate your Free Plan (50 credits) or subscribe to Pro Monthly (₹299/month) to continue chatting.",
              code: "PLAN_REQUIRED",
            },
            { status: 402 },
          );
        }

        if (userPlan === "free" && userCredits <= 0) {
          return Response.json(
            {
              error:
                "You have used all 50 free credits. Please top up by subscribing to the Pro Monthly Plan (₹299/month) to continue.",
              code: "OUT_OF_CREDITS",
            },
            { status: 402 },
          );
        }

        // Decrement credit for free plan user
        if (userPlan === "free" && userCredits > 0) {
          await users.updateOne({ email: session.email }, { $inc: { credits: -1 } });
        }
      }
    } catch (planErr) {
      console.warn("[Chat] Credit check warning:", planErr);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_URL}/chat`, {
      method: "POST",
      // The account header decides whether this turn is stored at all.
      headers: {
        "Content-Type": "application/json",
        ...agentAuth(),
        ...userHeader(session.email),
      },
      body: JSON.stringify(body),
      // Stream the response through instead of buffering it.
      // @ts-expect-error -- `duplex` is required by undici for streaming bodies.
      duplex: "half",
    });
  } catch {
    return Response.json(
      {
        error:
          `Cannot reach the Python agent at ${AGENT_URL}. ` +
          `Start it with: cd server && ./.venv/bin/uvicorn main:app --port 8000`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `Agent returned ${upstream.status}. ${detail}`.trim() },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
