import { NextResponse } from "next/server";
import { currentEmail } from "@/lib/session";

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(req: Request) {
  try {
    if (!KEY_ID || !KEY_SECRET) {
      console.error("[Payment] Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in process.env");
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
        { error: "You must be signed in to purchase a plan." },
        { status: 401 },
      );
    }

    const amount = 29900; // ₹299 in paise (Monthly Subscription)
    const currency = "INR";

    // Call official Razorpay Orders API
    const authHeader = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;

    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt: `rcpt_${Date.now()}`,
        notes: {
          userEmail: email,
          plan: "Pro Unlimited",
        },
      }),
    });

    const rzpData = await rzpRes.json().catch(() => null);

    if (!rzpRes.ok || !rzpData?.id) {
      console.error("[Razorpay API] Order Creation Error:", rzpData);
      return NextResponse.json(
        { error: rzpData?.error?.description || "Failed to create Razorpay payment order." },
        { status: rzpRes.status || 500 },
      );
    }

    console.log("[Razorpay] Created live order:", rzpData.id, "for user:", email);

    return NextResponse.json({
      status: "ok",
      orderId: rzpData.id,
      amount: rzpData.amount,
      currency: rzpData.currency,
      keyId: KEY_ID,
      userEmail: email,
      productName: "Nexus AI Pro Unlimited Plan",
    });
  } catch (err) {
    console.error("[Payment] Create Order Exception:", err);
    return NextResponse.json(
      { error: "Failed to create payment order." },
      { status: 500 },
    );
  }
}
