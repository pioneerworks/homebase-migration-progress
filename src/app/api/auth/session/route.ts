import { sessionResponse } from "@/lib/oidc-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return sessionResponse();
}
