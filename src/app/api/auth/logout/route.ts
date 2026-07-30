import type { NextRequest } from "next/server";

import { logoutResponse } from "@/lib/oidc-session";

export async function GET(request: NextRequest) {
  return logoutResponse(request);
}

export async function POST(request: NextRequest) {
  return logoutResponse(request);
}
