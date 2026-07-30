import { NextResponse } from "next/server";

import { getSnapshot } from "@/lib/linear";
import { getSessionUser } from "@/lib/oidc-session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
