import { timingSafeEqual } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

const sessionIssuer = "homebase-migration-progress";
const sessionAudience = "homebase-migration-progress-dashboard";

export type SessionUser = {
  sub: string;
  email: string;
  name: string;
};

function secretKey(secret: string): Uint8Array {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) {
    throw new Error("AUTH_SECRET must be at least 32 bytes");
  }
  return key;
}

export function tokensMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function safeCallbackPath(
  value: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  if (!value) return fallback;

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function validOidcCallback(input: {
  code: string | null;
  state: string | null;
  expectedState: string | null;
  expectedNonce: string | null;
  verifier: string | null;
}): boolean {
  return Boolean(
    input.code &&
      input.expectedNonce &&
      input.verifier &&
      tokensMatch(input.state, input.expectedState),
  );
}

export function validOidcNonce(
  actualNonce: unknown,
  expectedNonce: string,
): boolean {
  return (
    typeof actualNonce === "string" &&
    tokensMatch(actualNonce, expectedNonce)
  );
}

export function developmentSessionUser(
  env: NodeJS.ProcessEnv = process.env,
): SessionUser | null {
  const email = env.DASHBOARD_DEV_USER?.trim();
  if (!email) return null;
  if (env.NODE_ENV === "production" || env.VERCEL) return null;

  return {
    sub: `dev:${email}`,
    email,
    name: env.DASHBOARD_DEV_NAME?.trim() || email,
  };
}

export async function createSessionToken(
  user: SessionUser,
  secret: string,
  maxAgeSeconds: number,
): Promise<string> {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("Session lifetime must be a positive integer");
  }

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(sessionIssuer)
    .setAudience(sessionAudience)
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(secretKey(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
    issuer: sessionIssuer,
    audience: sessionAudience,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.name !== "string"
  ) {
    throw new Error("Session token is missing user claims");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}
