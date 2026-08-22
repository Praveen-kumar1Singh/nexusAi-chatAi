import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { currentEmail } from "@/lib/session";

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";

export async function POST(req: Request) {
  try {
    let email: string | null = null;
    try {
      email = await currentEmail();
    } catch {
      // Fallback to body email
    }

    const body = await req.json().catch(() => null);
    if (!email && body?.email) {
      email = String(body.email).trim().toLowerCase();
    }

    if (!email) {
      return NextResponse.json(
        { error: "You must be signed in to activate a plan." },
        { status: 401 },
      );
    }

    const db = await getDb();
    const users = db.collection("users");

    const existing = await users.findOne({ email });
    if (!existing) {
      return NextResponse.json({ error: "User account not found." }, { status: 404 });
    }

    // Only activate free plan if user doesn't already have paid plan
    if (existing.plan === "paid") {
      return NextResponse.json({
        status: "ok",
        plan: "paid",
        credits: -1,
        message: "You already have the Pro Unlimited Plan active!",
      });
    }

    const now = new Date().toISOString();
    await users.updateOne(
      { email },
      {
        $set: {
          plan: "free",
          credits: 50,
          planActivatedAt: now,
          updatedAt: now,
        },
      },
    );

    // Sync Python store
    fetch(`${AGENT_URL}/auth/update-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, plan: "free", credits: 50 }),
    }).catch(() => null);

    console.log("[Plan] Activated Free Plan (50 Credits) for:", email);
    return NextResponse.json({
      status: "ok",
      plan: "free",
      credits: 50,
      planActivatedAt: now,
      message: "Free Plan activated successfully with 50 credits!",
    });
  } catch (err) {
    console.error("[Plan] Activate Free Plan Error:", err);
    return NextResponse.json(
      { error: "Failed to activate Free Plan. Please try again." },
      { status: 500 },
    );
  }
}
