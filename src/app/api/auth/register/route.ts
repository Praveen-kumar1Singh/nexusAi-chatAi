import { NextResponse } from "next/server";
import { DB_UNREACHABLE, getDb } from "@/lib/mongodb";
import { startSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !body.email || !body.password_hash) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  const normalizedEmail = String(body.email).trim().toLowerCase();
  const passwordHash = String(body.password_hash);

  // The account only exists once it is in the database. There is deliberately
  // no in-memory fallback here: one used to report "registered successfully"
  // for an account that was never written anywhere durable.
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error("[Auth Register] Database unreachable:", err);
    return NextResponse.json({ error: DB_UNREACHABLE }, { status: 503 });
  }

  try {
    const users = db.collection("users");
    const existing = await users.findOne({ email: normalizedEmail });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in." },
        { status: 409 },
      );
    }

    await users.insertOne({
      email: normalizedEmail,
      password_hash: passwordHash,
      createdAt: new Date().toISOString(),
    });

    await startSession(normalizedEmail);

    console.log("[Auth Register] Stored account in MongoDB:", normalizedEmail);
    return NextResponse.json({
      status: "ok",
      user: { email: normalizedEmail, name: "", avatar: "", avatarImage: "" },
    });
  } catch (err) {
    console.error("[Auth Register] Write failed:", err);
    return NextResponse.json({ error: DB_UNREACHABLE }, { status: 503 });
  }
}
