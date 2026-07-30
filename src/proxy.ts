import { NextRequest, NextResponse } from "next/server";

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Homebase migration", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/refresh") {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }
  if (!password) return unauthorized();

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    const username = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);
    const expectedUsername = process.env.DASHBOARD_USERNAME || "migration";

    if (username !== expectedUsername || suppliedPassword !== password) {
      return unauthorized();
    }
  } catch {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
