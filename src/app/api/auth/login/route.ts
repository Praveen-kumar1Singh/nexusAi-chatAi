import { NextResponse } from "next/server";
import { DB_UNREACHABLE, dbErrorMessage, getDb } from "@/lib/mongodb";
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

  // Same rule as registration: the database is the only account store, so a
  // database that is down is an outage, not a failed password.
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error("[Auth Login] Database unavailable:", err);
    return NextResponse.json(
      {
        error: dbErrorMessage(err).replace(
          "your account was not saved",
          "you cannot be signed in",
        ),
      },
      { status: 503 },
    );
  }

  try {
    const user = await db.collection("users").findOne({
      email: normalizedEmail,
      password_hash: passwordHash,
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password. Please check your credentials." },
        { status: 401 },
      );
    }

    await startSession(String(user.email));

    console.log("[Auth Login] Signed in:", normalizedEmail);
    return NextResponse.json({
      status: "ok",
      user: {
        email: user.email,
        name: user.name || "",
        avatar: user.avatar || "",
        avatarImage: user.avatarImage || "",
      },
    });
  } catch (err) {
    console.error("[Auth Login] Query failed:", err);
    return NextResponse.json({ error: DB_UNREACHABLE }, { status: 503 });
  }
}
