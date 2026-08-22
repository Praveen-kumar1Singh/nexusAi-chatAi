import { proxyJson } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyJson("/tools");
}
