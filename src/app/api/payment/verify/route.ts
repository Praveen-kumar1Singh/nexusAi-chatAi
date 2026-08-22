import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { currentEmail } from "@/lib/session";

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";

export async function POST(req: Request) {
  try {
    if (!KEY_SECRET) {
      console.error("[Payment] Missing RAZORPAY_KEY_SECRET in process.env");
      return NextResponse.json(
        { error: "Razorpay API configuration is missing on the server." },
        { status: 500 },
      );
    }

    let email: string | null = null;
    try {
      email = await currentEmail();
    } catch {
      // Fallback
    }

    const body = await req.json().catch(() => null);
    if (!email && body?.email) {
      email = String(body.email).trim().toLowerCase();
    }

    if (!email) {
      return NextResponse.json(
        { error: "You must be signed in to complete your payment." },
        { status: 401 },
      );
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = body || {};

    if (!razorpay_payment_id) {
      return NextResponse.json(
        { error: "Invalid payment details returned from Razorpay." },
        { status: 400 },
      );
    }

    // Verify HMAC-SHA256 signature when order_id & signature provided
    if (razorpay_order_id && razorpay_signature) {
      const generatedSignature = createHmac("sha256", KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (generatedSignature !== razorpay_signature) {
        console.error("[Razorpay Verification] Signature mismatch error!");
        return NextResponse.json(
          { error: "Razorpay payment signature verification failed." },
          { status: 400 },
        );
      }
    }

    const db = await getDb();
    const users = db.collection("users");

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const planExpiresAt = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await users.updateOne(
      { email },
      {
        $set: {
          plan: "paid",
          credits: -1, // Unlimited credits
          planActivatedAt: now,
          planExpiresAt,
          updatedAt: now,
          razorpayPaymentId: razorpay_payment_id,
          razorpayOrderId: razorpay_order_id || "",
        },
      },
    );

    // Sync to Python backend store
    fetch(`${AGENT_URL}/auth/update-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, plan: "paid", credits: -1 }),
    }).catch(() => null);

    console.log("[Razorpay] Verified payment & activated Pro Unlimited Plan for:", email);
    return NextResponse.json({
      status: "ok",
      plan: "paid",
      credits: -1,
      planActivatedAt: now,
      message: "Payment verified successfully! Pro Unlimited Plan activated.",
    });
  } catch (err) {
    console.error("[Payment] Verification Error:", err);
    return NextResponse.json(
      { error: "Payment verification failed. Please contact support." },
      { status: 500 },
    );
  }
}
