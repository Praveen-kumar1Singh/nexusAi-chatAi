import { NextResponse } from "next/server";
import { DbConfigError, getDb } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this deployment can actually reach, so a 503 in the UI can be diagnosed
 * from the deployed URL instead of guessed at.
 *
 * It answers the question the user-facing message cannot: is the database
 * unreachable, or was this deployment never told where it is? Those look
 * identical from the chat window and have completely different fixes.
 *
 * Nothing secret is returned -- variables are reported as present/absent, and
 * the URI only ever appears as its host.
 */
export async function GET() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  const database: Record<string, unknown> = {
    MONGODB_URI: uri ? "set" : "MISSING",
    MONGODB_DB: dbName || "MISSING",
    // The failure this whole guard exists for: unset MONGODB_DB used to route
    // Next.js to `test` while the Python agent used `mantraa_ai`.
    host: uri ? hostOf(uri) : null,
  };

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    database.connected = true;
    database.database = db.databaseName;
  } catch (err) {
    database.connected = false;
    database.reason = err instanceof DbConfigError ? "misconfigured" : "unreachable";
    database.error = err instanceof Error ? err.message : String(err);
    if (database.reason === "unreachable") {
      database.hint =
        "Atlas refused or timed out. Check the cluster is not paused and that " +
        "Network Access allows 0.0.0.0/0 -- Vercel's outbound IPs are dynamic.";
    }
  }

  const agent = {
    AGENT_URL: process.env.AGENT_URL ? "set" : "MISSING",
    AGENT_TOKEN: process.env.AGENT_TOKEN ? "set" : "MISSING",
  };

  const ok = database.connected === true;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", database, agent },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

/** The cluster host alone -- never the credentials in front of it. */
function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}
