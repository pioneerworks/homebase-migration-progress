import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  createSessionToken,
  developmentSessionUser,
  safeCallbackPath,
  type SessionUser,
  validOidcCallback,
  validOidcNonce,
  verifySessionToken,
} from "@/lib/auth-core";

const sessionCookie = "migration_dashboard_session";
const stateCookie = "migration_dashboard_oidc_state";
const nonceCookie = "migration_dashboard_oidc_nonce";
const verifierCookie = "migration_dashboard_oidc_verifier";
const returnCookie = "migration_dashboard_oidc_return";
const transientMaxAge = 10 * 60;
const sessionMaxAge = 8 * 60 * 60;

type OidcMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
};

type TokenResponse = {
  id_token?: string;
  access_token?: string;
};

let metadataPromise: Promise<OidcMetadata> | null = null;
let jwksPromise: ReturnType<typeof createRemoteJWKSet> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function issuer(): string {
  return requiredEnv("OKTA_ISSUER").replace(/\/+$/, "");
}

function clientId(): string {
  return requiredEnv("OKTA_CLIENT_ID");
}

function clientSecret(): string {
  return requiredEnv("OKTA_CLIENT_SECRET");
}

function authSecret(): string {
  return requiredEnv("AUTH_SECRET");
}

async function metadata(): Promise<OidcMetadata> {
  if (!metadataPromise) {
    metadataPromise = fetch(
      `${issuer()}/.well-known/openid-configuration`,
    ).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Okta metadata request failed: ${response.status}`);
      }

      const body = (await response.json()) as Partial<OidcMetadata>;
      if (
        !body.authorization_endpoint ||
        !body.token_endpoint ||
        !body.jwks_uri
      ) {
        throw new Error("Okta metadata is missing required endpoints");
      }
      return body as OidcMetadata;
    });
  }
  return metadataPromise;
}

async function jwks() {
  if (!jwksPromise) {
    const body = await metadata();
    jwksPromise = createRemoteJWKSet(new URL(body.jwks_uri));
  }
  return jwksPromise;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

async function clearTransientCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const name of [
    stateCookie,
    nonceCookie,
    verifierCookie,
    returnCookie,
  ]) {
    cookieStore.delete(name);
  }
}

function loginErrorRedirect(
  request: NextRequest,
  error: string,
): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl, 302);
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function createLoginRedirect(
  request: NextRequest,
): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const callbackUrl = safeCallbackPath(
    requestUrl.searchParams.get("callbackUrl"),
    requestUrl.origin,
  );
  const body = await metadata();
  const redirectUri = `${requestUrl.origin}/login/callback`;
  const authorizeUrl = new URL(body.authorization_endpoint);

  authorizeUrl.searchParams.set("client_id", clientId());
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const cookieStore = await cookies();
  cookieStore.set(stateCookie, state, cookieOptions(transientMaxAge));
  cookieStore.set(nonceCookie, nonce, cookieOptions(transientMaxAge));
  cookieStore.set(verifierCookie, verifier, cookieOptions(transientMaxAge));
  cookieStore.set(returnCookie, callbackUrl, cookieOptions(transientMaxAge));

  return NextResponse.redirect(authorizeUrl, 302);
}

export async function handleLoginCallback(
  request: NextRequest,
): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(stateCookie)?.value ?? null;
  const expectedNonce = cookieStore.get(nonceCookie)?.value ?? null;
  const verifier = cookieStore.get(verifierCookie)?.value ?? null;
  const callbackUrl = safeCallbackPath(
    cookieStore.get(returnCookie)?.value,
    requestUrl.origin,
  );
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (
    !validOidcCallback({
      code,
      state,
      expectedState,
      expectedNonce,
      verifier,
    })
  ) {
    const providerError = requestUrl.searchParams.get("error");
    await clearTransientCookies();
    return loginErrorRedirect(
      request,
      providerError === "access_denied" ? providerError : "invalid_callback",
    );
  }

  try {
    const body = await metadata();
    const redirectUri = `${requestUrl.origin}/login/callback`;
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      code_verifier: verifier!,
    });
    const tokenResponse = await fetch(body.token_endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${clientId()}:${clientSecret()}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      cache: "no-store",
    });

    if (!tokenResponse.ok) {
      console.error("Okta token exchange failed", tokenResponse.status);
      await clearTransientCookies();
      return loginErrorRedirect(request, "token_exchange_failed");
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokens.id_token) {
      throw new Error("Okta token response did not include an ID token");
    }

    const { payload } = await jwtVerify(tokens.id_token, await jwks(), {
      algorithms: ["RS256"],
      issuer: issuer(),
      audience: clientId(),
    });
    if (!validOidcNonce(payload.nonce, expectedNonce!)) {
      await clearTransientCookies();
      return loginErrorRedirect(request, "invalid_nonce");
    }

    let sub = stringClaim(payload.sub);
    let email =
      stringClaim(payload.email) ?? stringClaim(payload.preferred_username);
    let name = stringClaim(payload.name) ?? email;

    if (
      (!email || !name) &&
      tokens.access_token &&
      body.userinfo_endpoint
    ) {
      const userInfo = await fetch(body.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        cache: "no-store",
      })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as Record<string, unknown>)
            : null,
        )
        .catch(() => null);

      if (userInfo) {
        sub = stringClaim(userInfo.sub) ?? sub;
        email =
          stringClaim(userInfo.email) ??
          stringClaim(userInfo.preferred_username) ??
          email;
        name = stringClaim(userInfo.name) ?? email ?? name;
      }
    }

    if (!sub || !email) {
      await clearTransientCookies();
      return loginErrorRedirect(request, "missing_identity");
    }

    const user: SessionUser = {
      sub,
      email,
      name: name ?? email,
    };
    const session = await createSessionToken(
      user,
      authSecret(),
      sessionMaxAge,
    );

    cookieStore.set(sessionCookie, session, cookieOptions(sessionMaxAge));
    await clearTransientCookies();
    return NextResponse.redirect(
      new URL(callbackUrl, requestUrl.origin),
      302,
    );
  } catch (error) {
    console.error(
      "Okta callback failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    await clearTransientCookies();
    return loginErrorRedirect(request, "callback_failed");
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const developmentUser = developmentSessionUser();
  if (developmentUser) return developmentUser;

  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookie)?.value;
  if (!token) return null;
  return verifySessionToken(token, authSecret());
}

export async function sessionResponse(): Promise<NextResponse> {
  const user = await getSessionUser().catch(() => null);
  return NextResponse.json(
    { user },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export async function logoutResponse(
  request: NextRequest,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookie);
  return NextResponse.redirect(new URL("/login", request.url), 302);
}
