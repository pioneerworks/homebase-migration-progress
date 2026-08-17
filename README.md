# Homebase migration progress

An internal, read-only dashboard for the joinhomebase.com Webflow-to-Next.js
migration. It converts Linear URL tickets and migration-decision issues into:

- overall and per-pillar completion;
- external-stakeholder recaps for the current Toronto day and week;
- recent page activity and work in progress;
- a searchable inventory of completed routes with live-page and Linear links;
- recent decisions, learnings, and open questions.
- a Hosting cutover tab with milestone progress, the labeled Phase 1 cohort, and
  the complete Webflow-to-Vercel cutover ticket inventory.

Page-parity progress spans five Linear tracks: Product/content, Repeatable SEO,
Blog CMS, Foundations/special cases, and Webflow Cloud pages.

The dashboard is designed for Vercel Hobby during exploration. GitHub Actions
invalidates the cached Linear snapshot hourly, while connected browsers check for
a changed snapshot every 60 seconds. Linear projects are fetched and paginated
separately so each request stays below Linear's query-complexity limit.

## Data and security model

```text
GitHub Actions ──POST /api/refresh──▶ Vercel
                                         │
                                         ├── invalidates the tagged cache
                                         └── reads Linear server-side

Browser ──Okta OIDC──▶ /login/callback
                           │
                           └── signed HttpOnly session cookie

Browser + session ──GET /api/snapshot──▶ Vercel cached snapshot
```

- `LINEAR_API_KEY` exists only in Vercel.
- GitHub stores only the refresh URL and refresh secret.
- Dashboard pages and the browser snapshot endpoint require an Okta-backed
  session.
- The Okta access and ID tokens are handled server-side and are not stored in
  browser JavaScript.
- Dashboard sessions expire after a fixed eight hours; the lifetime is not
  environment-configurable.
- The refresh endpoint uses its own bearer secret.
- Search engines are blocked through page metadata.

## Local development

```bash
npm install
npm run dev
```

Without `LINEAR_API_KEY`, the app renders the last verified snapshot included in
the repository. Copy `.env.example` to `.env.local` to test live data and auth.

For local development without a registered Okta callback, set
`DASHBOARD_DEV_USER` to your email address. The bypass is ignored when
`NODE_ENV=production` or the app is running on Vercel.

## Okta application setup

Use an Okta OIDC web application with the authorization-code flow enabled.
Assign the people or groups that should have dashboard access and register these
sign-in redirect URIs:

```text
http://localhost:3000/login/callback
https://<production-domain>/login/callback
```

The callback URI is exact. Vercel preview deployments need their own registered
redirect URI if Okta sign-in must work on ephemeral preview domains.

## Vercel environment variables

| Variable | Purpose |
| --- | --- |
| `LINEAR_API_KEY` | Read-only Linear personal API key |
| `OKTA_ISSUER` | Okta authorization server, normally `https://joinhomebase.okta.com/oauth2/default` |
| `OKTA_CLIENT_ID` | Client ID for the dashboard's Okta OIDC web application |
| `OKTA_CLIENT_SECRET` | Client secret used only by the server-side token exchange |
| `AUTH_SECRET` | At least 32 random bytes used to sign dashboard sessions |
| `DASHBOARD_REFRESH_SECRET` | Bearer token accepted by `/api/refresh` |

## GitHub Actions secrets

| Secret | Purpose |
| --- | --- |
| `DASHBOARD_REFRESH_URL` | Production URL ending in `/api/refresh` |
| `DASHBOARD_REFRESH_SECRET` | Same refresh secret configured in Vercel |

The scheduled workflow can also be run manually from the Actions tab.
The refresh endpoint returns an error when Linear cannot produce live data, so a
successful workflow run confirms a live snapshot rather than a fallback.

## What counts toward progress

Only unique page-port tickets with a route are included. Duplicate route tickets,
quality work, decisions, and infrastructure issues do not inflate the denominator.
If the same route appears more than once, the most advanced Linear state wins.

Page parity treats both Done and Canceled/Duplicate route tickets as resolved.
Canceled routes stay visible in activity with their actual Linear status, but they
do not remain in the outstanding migration count. Remaining work is Active plus
Backlog only, and the seven-day metric reports routes resolved through either
completion or cancellation. Archived route tickets are included so a cancellation
does not disappear from parity when Linear archives it.

“Done” reflects the ticket workflow state. It does not by itself mean that a page
has been cut over to production.

The Hosting cutover view reads every ticket in the dedicated Hosting Migration
project. Canceled tickets remain visible but are excluded from its completion
percentage. The Phase 1 cohort is derived from the Linear `Phase 1` label.

Both dashboard tabs open with a stakeholder recap generated from the same Linear
snapshot as the detailed tracker. Page Migration only uses the five page-pillar
projects and migration decisions. Hosting Cutover only uses the dedicated Hosting
Migration project. A main-project update can override either recap by including a
matching `### Page migration` or `### Hosting cutover` section with `#### Today`,
`#### This week`, `#### Working on now`, and `#### Next steps` bullet lists. Each
tab reads only its matching section and falls back to its own ticket activity when
a subsection is missing. “Today” follows the Toronto calendar date and
“This week” starts on Monday. Each recap also identifies current work and the
next rollout steps without requiring stakeholders to interpret individual ticket
states. Recap copy combines status timing with a short excerpt from the relevant
ticket description. It also reads the latest weekly project update when one is
available. Long or formal wording is shortened into plain language, and every
statement links back to its supporting Linear ticket or project update.

The Blog pillar is an explicit exception: `/blog` is one URL ticket, while the
article corpus is tracked separately. The dashboard surfaces the active bulk-import
issue and its remaining post estimate so a completed hub cannot be mistaken for a
completed CMS migration.
