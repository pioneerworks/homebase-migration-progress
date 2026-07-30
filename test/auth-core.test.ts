import assert from "node:assert/strict";
import test from "node:test";

import { decodeJwt } from "jose";

import {
  createSessionToken,
  developmentSessionUser,
  safeCallbackPath,
  tokensMatch,
  validOidcCallback,
  validOidcNonce,
  verifySessionToken,
  type SessionUser,
} from "../src/lib/auth-core";

const authSecret = "a-development-secret-that-is-at-least-32-bytes";
const otherSecret = "another-development-secret-at-least-32-bytes";
const user: SessionUser = {
  sub: "00u123",
  email: "person@joinhomebase.com",
  name: "Homebase Person",
};

test("safeCallbackPath keeps same-origin paths and rejects open redirects", () => {
  const origin = "https://migration.example.com";

  assert.equal(
    safeCallbackPath("/?view=active#pages", origin),
    "/?view=active#pages",
  );
  assert.equal(
    safeCallbackPath("https://migration.example.com/activity", origin),
    "/activity",
  );
  assert.equal(safeCallbackPath("https://attacker.example/path", origin), "/");
  assert.equal(safeCallbackPath("//attacker.example/path", origin), "/");
  assert.equal(
    safeCallbackPath(
      "https://user:password@migration.example.com/path",
      origin,
    ),
    "/",
  );
  assert.equal(safeCallbackPath("http://[", origin), "/");
});

test("tokensMatch compares complete, non-empty values", () => {
  assert.equal(tokensMatch("state-value", "state-value"), true);
  assert.equal(tokensMatch("state-value", "other-value"), false);
  assert.equal(tokensMatch("short", "longer"), false);
  assert.equal(tokensMatch(null, "state-value"), false);
});

test("OIDC callback validation requires state, nonce, code, and verifier", () => {
  const validInput = {
    code: "authorization-code",
    state: "expected-state",
    expectedState: "expected-state",
    expectedNonce: "expected-nonce",
    verifier: "pkce-verifier",
  };

  assert.equal(validOidcCallback(validInput), true);
  assert.equal(validOidcCallback({ ...validInput, code: null }), false);
  assert.equal(
    validOidcCallback({ ...validInput, state: "unexpected-state" }),
    false,
  );
  assert.equal(
    validOidcCallback({ ...validInput, expectedNonce: null }),
    false,
  );
  assert.equal(validOidcNonce("expected-nonce", "expected-nonce"), true);
  assert.equal(validOidcNonce("unexpected-nonce", "expected-nonce"), false);
});

test("development user bypass is disabled in production and on Vercel", () => {
  assert.deepEqual(
    developmentSessionUser({
      DASHBOARD_DEV_USER: "developer@joinhomebase.com",
      DASHBOARD_DEV_NAME: "Developer",
      NODE_ENV: "development",
    }),
    {
      sub: "dev:developer@joinhomebase.com",
      email: "developer@joinhomebase.com",
      name: "Developer",
    },
  );
  assert.equal(
    developmentSessionUser({
      DASHBOARD_DEV_USER: "developer@joinhomebase.com",
      NODE_ENV: "production",
    }),
    null,
  );
  assert.equal(
    developmentSessionUser({
      DASHBOARD_DEV_USER: "developer@joinhomebase.com",
      NODE_ENV: "development",
      VERCEL: "1",
    }),
    null,
  );
});

test("session tokens round-trip and reject a different signing secret", async () => {
  const token = await createSessionToken(user, authSecret, 60);
  const payload = decodeJwt(token);
  assert.deepEqual(await verifySessionToken(token, authSecret), user);
  assert.equal(payload.exp! - payload.iat!, 60);
  await assert.rejects(() => verifySessionToken(token, otherSecret));
});

test("session secrets and lifetimes must meet minimum requirements", async () => {
  await assert.rejects(() => createSessionToken(user, "too-short", 60));
  await assert.rejects(() => createSessionToken(user, authSecret, 0));
});
