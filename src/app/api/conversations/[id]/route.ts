import { proxyJson, userHeader } from "@/lib/agent";
import { sessionEmailOr503 } from "@/lib/route-session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  const { id } = await params;
  return proxyJson(`/conversations/${encodeURIComponent(id)}`, {
    headers: userHeader(session.email),
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await sessionEmailOr503();
  if (session.response) return session.response;

  const { id } = await params;
  return proxyJson(`/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: userHeader(session.email),
  });
}
