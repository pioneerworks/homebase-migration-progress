import type { NextRequest } from "next/server";

import { handleLoginCallback } from "@/lib/oidc-session";

export async function GET(request: NextRequest) {
  return handleLoginCallback(request);
}
