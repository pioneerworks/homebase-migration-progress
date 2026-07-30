import type { NextRequest } from "next/server";

import { createLoginRedirect } from "@/lib/oidc-session";

export async function GET(request: NextRequest) {
  return createLoginRedirect(request);
}
