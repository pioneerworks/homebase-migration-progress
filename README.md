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
| `STATSIG_CONSOLE_API_KEY` | Read-only Statsig Console API key powering the overview Experiments section; omit to hide the section |
| `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET` | Amplitude project API key + secret key (Cross-Platform project 677513). Power the Overview signup funnel and the Experiments tab's live sign-up results; omit to use the captured snapshot and Statsig's results |
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

The dashboard also polls the five Linear projects carrying the next phase of
site work (Marketing Site Execution agents, internal linking, the marketing
context layer, the landing-page feedback tool, and the Payload admin rebuild).
Each hourly refresh
pulls their full issue inventory, latest project updates, and project
descriptions into the “Active projects” section.

The AI project tracker (overview and `/projects/[key]`) reads each tracked
project's name, summary, lead, health, link, completion date, and Linear
project milestones. `src/lib/tracker-projects.ts` lists only which projects to
track (key, Linear slug id, impact-chart repos): don't add display copy there,
rename or edit the project in Linear instead. When Linear is unavailable a row
shows its key rather than stale text. Sidebar dots show the health the lead set
in Linear; an overdue milestone is flagged in the Overview table and "Needs
attention" instead. Cards show the owner,
health, and the next open milestone with its due date; project pages list every
milestone with its progress and issues (state and assignee). A project with no
update posted yet shows its full Linear brief (the project overview document).
The overview also opens with yesterday's signups for daily standup, compared
with the day before and the same weekday last week. Today's partial day is
skipped. The impact chart opens on the last 7 days and has a date range picker
(presets or custom dates). A dashed line shows a straight-line signup trend over
the selected range, leaving out today's partial day. PR bars use their own scale.

A Statsig-driven "Experiments" section sits between the standup and shipped-work
bands when `STATSIG_CONSOLE_API_KEY` is configured. It lists experiments in
`active` status with their elapsed day count, exposures, control-vs-test
conversion rates of binomial primary metrics (per-unit means otherwise), and the primary metric's percent change with significance
verdict (winning / losing / no-signal / no-data), each linking to its Statsig
console permalink.

On the Experiments tab, Statsig's results only refresh once a day (its
Databricks sync), so live experiments take their sign-up results from
Amplitude when `AMPLITUDE_API_KEY` and `AMPLITUDE_SECRET` are set
(`src/lib/experiment-amplitude.ts`). One funnel per arm: `Page Viewed` with
`product_area` contains `mw_`, device not `Linux`, and the event property named
after the experiment id (`0` control, `1` test, stamped by the marketing site's
`hb-exp-<id>` cookie) → `Owner Account Created` within 7 days, from the
experiment's start through today (UTC, the Amplitude project's timezone).
Rates, lift, a two-proportion z-test (at Statsig's adjusted alpha when the
primary metric is Owner Signups, otherwise 0.05), the sign-up KPI and the
detail panel's daily series come from it;
the experiment list, schedule, traffic split (exposures and SRM) and 1D1 stay
on Statsig. Amplitude only sees visitors who accept cookies (about half of
Statsig's), equally in both arms, so its rates are comparable and its visitor
counts are not Statsig's exposures. Amplitude results are cached for 15
minutes. An experiment shows Statsig's numbers when Amplitude fails, when it
takes longer than 10 seconds with no result from the last day cached (1.5
seconds for the Experiments sidebar counts, which every page load starts), or
when Amplitude sees no visitors in one of
its arms (a page that doesn't stamp the arm property). The daily sign-up chart
counts each sign up on the day of the visit that led to it.

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
