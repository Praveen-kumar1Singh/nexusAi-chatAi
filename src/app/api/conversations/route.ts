import { proxyJson, userHeader } from "@/lib/agent";
import { sessionEmailOr503 } from "@/lib/route-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await sessionEmailOr503();
  if (session.response) return session.response;
  return proxyJson("/conversations", { headers: userHeader(session.email) });
}
