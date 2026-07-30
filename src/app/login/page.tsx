import type { Metadata } from "next";

import { getSessionUser } from "@/lib/oidc-session";

export const metadata: Metadata = {
  title: "Sign in · Homebase migration progress",
};

const errorMessages: Record<string, string> = {
  access_denied: "Okta did not grant access to this dashboard.",
  callback_failed: "The Okta sign-in could not be completed. Please try again.",
  invalid_callback: "The sign-in request expired or was invalid. Please try again.",
  invalid_nonce: "The sign-in response could not be verified. Please try again.",
  missing_identity: "Okta did not return an email address for this account.",
  token_exchange_failed:
    "The dashboard could not complete sign-in with Okta. Please try again.",
};

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = firstValue(params.callbackUrl) || "/";
  const error = firstValue(params.error);
  const user = await getSessionUser();
  const loginHref = `/api/auth/login?callbackUrl=${encodeURIComponent(
    callbackUrl,
  )}`;

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <a className="login-brand" href="/" aria-label="Homebase migration home">
          <span className="login-brand-mark" aria-hidden="true" />
          <span>Homebase</span>
        </a>
        <div className="login-kicker">Internal dashboard</div>
        <h1 id="login-title">Migration progress</h1>
        <p>
          Sign in with your Homebase Okta account to view migration progress,
          page activity, and implementation decisions.
        </p>

        {error ? (
          <p className="login-error" role="alert">
            {errorMessages[error] || errorMessages.callback_failed}
          </p>
        ) : null}

        {user ? (
          <div className="login-actions">
            <p className="login-user">
              Signed in as <strong>{user.email}</strong>
            </p>
            <a className="login-button" href="/">
              Open dashboard
            </a>
            <form action="/api/auth/logout" method="post">
              <button className="login-button login-button-secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <a className="login-button" href={loginHref}>
            Sign in with Okta
            <span aria-hidden="true">→</span>
          </a>
        )}

        <p className="login-help">
          Access is managed through this application&apos;s Okta assignment.
        </p>
      </section>
    </main>
  );
}
