import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/mongodb";
import { SessionStoreDown, currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ user: await currentUser() });
  } catch (err) {
    if (err instanceof SessionStoreDown) {
      console.error("[Auth Me] Session store unavailable:", err.cause ?? err);
      return NextResponse.json({ error: dbErrorMessage(err) }, { status: 503 });
    }
    console.error("[Auth Me] Unexpected error:", err);
    return NextResponse.json({ user: null });
  }
}
