import { NextRequest } from "next/server";

import { handleLoginCallback } from "@/lib/oidc-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleLoginCallback(request);
}
