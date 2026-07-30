import { NextResponse } from "next/server";

import { getSnapshot } from "@/lib/linear";

export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
