import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { refreshSnapshot } from "@/lib/linear";
import { SNAPSHOT_TAG } from "@/lib/projects";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DASHBOARD_REFRESH_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  revalidateTag(SNAPSHOT_TAG, { expire: 0 });
  try {
    const snapshot = await refreshSnapshot();

    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      source: snapshot.source,
      done: snapshot.overall.done,
      total: snapshot.overall.total,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Linear API error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
