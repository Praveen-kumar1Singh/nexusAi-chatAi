import { NextResponse } from "next/server";
import { DB_UNREACHABLE } from "@/lib/mongodb";
import { SessionStoreDown, currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ user: await currentUser() });
  } catch (err) {
    if (err instanceof SessionStoreDown) {
      console.error("[Auth Me] Database unreachable:", err.message);
      return NextResponse.json({ error: DB_UNREACHABLE }, { status: 503 });
    }
    console.error("[Auth Me] Unexpected error:", err);
    return NextResponse.json({ user: null });
  }
}
