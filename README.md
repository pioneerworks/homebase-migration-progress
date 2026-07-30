# Homebase migration progress

An internal, read-only dashboard for the joinhomebase.com Webflow-to-Next.js
migration. It converts Linear URL tickets and migration-decision issues into:

- overall and per-pillar completion;
- recent page activity and work in progress;
- a searchable inventory of completed routes with live-page and Linear links;
- recent decisions, learnings, and open questions.

The dashboard is designed for Vercel Hobby during exploration. GitHub Actions
invalidates the cached Linear snapshot every 15 minutes, while connected browsers
check for a changed snapshot every 60 seconds.

## Data and security model

```text
GitHub Actions ──POST /api/refresh──▶ Vercel
                                         │
                                         ├── invalidates the tagged cache
                                         └── reads Linear server-side

Browser ──GET /api/snapshot──▶ Vercel cached snapshot
```

- `LINEAR_API_KEY` exists only in Vercel.
- GitHub stores only the refresh URL and refresh secret.
- Dashboard pages and the browser snapshot endpoint use app-level Basic Auth.
- The refresh endpoint uses its own bearer secret.
- Search engines are blocked through page metadata.

## Local development

```bash
npm install
npm run dev
```

Without `LINEAR_API_KEY`, the app renders the last verified snapshot included in
the repository. Copy `.env.example` to `.env.local` to test live data and auth.

## Vercel environment variables

| Variable | Purpose |
| --- | --- |
| `LINEAR_API_KEY` | Read-only Linear personal API key |
| `DASHBOARD_USERNAME` | Basic Auth username; defaults to `migration` |
| `DASHBOARD_PASSWORD` | Basic Auth password |
| `DASHBOARD_REFRESH_SECRET` | Bearer token accepted by `/api/refresh` |

## GitHub Actions secrets

| Secret | Purpose |
| --- | --- |
| `DASHBOARD_REFRESH_URL` | Production URL ending in `/api/refresh` |
| `DASHBOARD_REFRESH_SECRET` | Same refresh secret configured in Vercel |

The scheduled workflow can also be run manually from the Actions tab.

## What counts toward progress

Only unique page-port tickets with a route are included. Duplicate route tickets,
quality work, decisions, and infrastructure issues do not inflate the denominator.
If the same route appears more than once, the most advanced Linear state wins.

“Done” reflects the ticket workflow state. It does not by itself mean that a page
has been cut over to production.
