# AI Hub · Experiments (A/B testing) tab — design

**Date:** 2026-10-05 · **Owner:** Brian Nguyen · **Design handoff:** `~/ai-accel/handoffs/ai-hub-experiments-2026-10-04/` (`HANDOFF.md`, `_export/XrNZp.png`, `experiments.html`, `experiments.sample.json`)

## Goal

An "A/B testing" item sits under Overview in the AI Hub sidebar. Clicking it opens `/experiments`. That route swaps the sidebar for the Experiments sidebar and shows every Statsig experiment in one table — with a tagline verdict per row, expandable detail rows, program KPIs under the header and a decision banner at the bottom — following `XrNZp.png` at 1440 wide. All data is live from the Statsig Console API, read server-side only.

> **Amended 2026-10-09 (AIA-4022):** Statsig's results lag a day (daily Databricks sync), so live experiments now take their sign-up results (rates, lift, significance, samples, sign-up KPI, decision banner, daily chart) from Amplitude funnels per arm. Statsig still provides everything else. See the README's Experiments section and `src/lib/experiment-amplitude.ts`. The "Rates and lift" rules below describe the Statsig fallback.

## What the live Statsig API gives us (probed 2026-10-05, key from Vercel prod env)

| Need | Endpoint | Result |
| --- | --- | --- |
| Every experiment, all statuses | `GET /experiments?limit=100` | 13 experiments: 3 `active`, 6 `setup`, 3 `experiment_stopped`, 1 `decision_made`. Includes `owner`, `creatorName`, `lastModifierName`, `secondaryMetrics` (`1D1`, `Week1-2D7`), `duration`, `scheduledStartTime` (always unset today), `description` (e.g. `A/B test on /free-time-clock-app-lp: …`), `groups[].parameterValues` (e.g. `destination_url`), `sidecarEditorURL`, `healthChecks`. |
| Headline results | `GET /experiments/{id}/pulse_results?control&test` | Owner Signups (primary) plus **1D1** and Week1-2D7 (secondary). Each has `controlMean`, `testMean`, `controlUnits`, `testUnits`, `pValue`, `adjustedAlpha` and `percentChange`. For the 1D1 metric, units are signed-up users, so its counts are `mean × units`. |
| Results as of a past day | `pulse_results?…&date=YYYY-MM-DD` | Works. It returns cumulative units and means as of that day: Sep 26 gave signups 26/10 on 1075/1087 units, Sep 27 gave 42/20 on 1507/1549. Subtracting each day from the next gives **daily signups per arm**. |
| Daily exposures per arm | `GET /experiments/{id}/cumulative_exposures` | Cumulative unique exposures per group per day. The last value equals pulse units (6852/7013). Subtracting each day from the next gives **daily exposures per arm**. |
| Device split | `GET /experiments/{id}/dimensional_exposures` | **Empty** (`dimensions: []`) for all 3 live experiments with every `dimension_type` tried (`os_name`, `device_type`, `browser_name`, `metadata.*`, `user.*`). On this (non-warehouse-native) project, Statsig only fills it for flagged dimension imbalances, so it can't feed a device split. |

**Decision on `dimensional_exposures`:** don't build on it. Statsig gives us everything per arm and per day, but not per device. The mobile + tablet vs desktop split (the split card's "By device" rows, the per-device stacking in the charts, and the per-device rate-table rows) is **out of v1** and becomes a follow-up that sources device from Amplitude. v1 keeps the layout slots and shows a one-line note in their place. We will not compute a device split from anything else.

**Note on the mock's numbers:** live data has moved on. Today the Scheduling LP module reads Owner Signups −3.0%, p = 0.80, not significant. The mock shows −53.4%, a significant loss. With no live experiment losing, the decision banner is hidden today, which is the correct behaviour.

## Answers to the handoff's open questions (defaults Brian can override)

1. **Daily-by-device source:** Statsig has no device data (above). v1 ships daily per arm from Statsig, and device comes later from Amplitude.
2. **Sign ups vs Owner signups:** they are the same metric. "Sign ups" in the results line is the Statsig primary `Owner Signups`. "1D1s" is the Statsig secondary metric `1D1`.
3. **Queued vs Draft:** `setup` with a `scheduledStartTime` or the tag `Queued` (case-insensitive) is **Queued**. Any other `setup` is **Draft**. `abandoned` and `archived` are hidden.
4. **Stop & keep control — removed 2026-10-05 at Brian's request.** The button and its confirm dialog are gone from the detail bar and the decision banner; the banner's action is now "Open in Statsig" (deep link to the experiment). The app makes no Statsig write calls.
5. **Sidebar "Live now":** kept.
6. **KPIs and banner below the table:** kept, as in the mock.
7. **Timezone:** day buckets use Statsig's own `date`/`ds` strings, as returned. "Today" (calendar line, eyebrow week) uses `torontoToday()` from `src/lib/standup.ts`. "Day n of N" uses the existing `experimentDay()`.
8. **Screenshots:** none in v1. Both arms show the placeholder frame and link to the arm URL.

## Status mapping

| Statsig `status` | Hub status |
| --- | --- |
| `active` | live |
| `setup` + (`scheduledStartTime` or tag `Queued`) | queued |
| `setup` otherwise | draft |
| `decision_made`, `experiment_stopped`, `assignment_stopped` | concluded |
| `abandoned`, `archived` | excluded |

Table order: live, then queued, then draft, then concluded. Within each group, newest `startTime` (or `createdTime`) comes first.

## Field derivations

- **Name:** `experimentTitle(id)` (existing).
- **Path:** first match of `/A\/B test on (\/[^\s:]+)/` in `description`. Otherwise the pathname of `sidecarEditorURL`. Otherwise the pathname of the control arm's `parameterValues.destination_url`. Otherwise `null`.
- **Surface:** path starts with `/signup` → `signup_flow`. Path contains `/tools/` → `tool_page`. Anything else, including no path, → `landing_page`. Labels: "Landing pages", "Signup flow", "Tool pages".
- **Owner:** `owner.ownerName`, unless it is empty or starts with `CONSOLE API`. Then `lastModifierName` under the same rule. Otherwise `null`, shown as "Unassigned".
- **Arm URLs:** `parameterValues.destination_url` when it is present. Otherwise `https://www.joinhomebase.com{path}` for both arms.
- **Rates and lift** (from the primary pulse row):
  - Rates: `controlMean`/`testMean` × 100.
  - Lift: Statsig's `percentChange`. Don't recompute it.
  - Verdict: `verdictFromPrimary`.
  - Display: lift has one decimal and a real minus sign (`−3.0%`). Rates have two decimals.
- **Tagline** (revised handoff §6): a one-line verdict under each name, derived with the verdict:
  - live/concluded + `winning` → "Variant is ahead" · `+N% sign ups` (`TrendingUp`, success)
  - live/concluded + `losing` → "Variant is losing" · `−N% sign ups` (`TrendingDown`, danger)
  - live/concluded + `no-signal`/`no-data` → "Too early to tell" · `±N%, not sig.` or "no data yet" (`Hourglass`, ink text/muted icon)
  - queued/draft → "Not started yet" (`CircleDashed`, ink text/muted icon)
  - Lift in the reason is a whole percent; "Owner signups" shortens to "sign ups". The reason truncates with an ellipsis before the verdict wraps. (Deviation from the handoff's literal conditions: concluded no-signal rows also get "Too early to tell" — the handoff only names live ones, but a concluded row saying "not started" would be wrong.)
- **Significance label:** `losing` → "Sig. loss" (danger). `winning` → "Sig. win" (success). `no-signal` → `Not yet · p≈${p.toFixed(2)}` (muted). `no-data`, queued and draft → "—".
- **Guardrails:** the `secondaryMetrics` names joined with " · ", or "—". **MDE:** "—". **Planned run:** `${duration} days`, or "—".
- **Results line:**
  - "Sign ups" is the primary pulse row.
  - "1D1s" is the secondary row named `1D1`.
  - Counts are `round(mean × units)`.
  - Rates are relative to that row's units, and each comes with Statsig's `percentChange`.
  - A missing row shows "—".
- **Daily series** (detail only):
  - Exposures: per-day deltas of `cumulative_exposures` per arm.
  - Signups: per-day deltas of `round(mean × units)` from `pulse_results&date=` for each day from the start up to the last `ds`, capped at the most recent 28 days.
  - A day whose delta is negative is clamped to 0.
- **Rate table:** one row each for Control and Test. Each daily cell is that day's signups ÷ that day's exposures. The "N-day" column is total signups ÷ total exposures (not the mean of the daily rates).
- **SRM:** a chi-square goodness-of-fit test with 1 degree of freedom. It compares the latest cumulative exposures `[c, t]` with the target split from `groups[].size`. `p = erfc(sqrt(χ²/2))`. If `p ≥ 0.01`, show "No sample-ratio mismatch · p = 0.17". Otherwise show the danger text "Sample-ratio mismatch · p = …".
- **Decision banner:** shows the first live experiment whose verdict is `losing`. Otherwise it is hidden.
  - If the lift is ≤ −50%, the body reads: "Test arm converts at less than half of control (2.50% → 1.16%, p = 0.004). Keeping it live costs roughly N owner sign ups a day."
  - For other negative lifts it reads: "Test arm converts below control (… , p = …). Keeping it live costs roughly N owner sign ups a day."
  - N = `round((controlRate − testRate) × testUnits / day)`.
- **KPIs** (5 cells):
  1. Live tests: the count, with context counting landing pages and signup flow.
  2. Significant results: the count of live experiments that are winning or losing, with context "x loss · y wins".
  3. Visitors in test · 7d: the sum, over live experiments, of the cumulative-exposure increase over the last 7 days, with context "control · test".
  4. Owner sign ups in test: the sum of live primary-metric counts since start, with context "Control X · Test Y". This deviates from the handoff's 7-day window because the list view doesn't fetch daily pulses.
  5. M1 · First live experiments: `nextMilestone()` of the Linear `ab-testing` project (`linearSlugId d9f5d074ffc1`). The value is its `progress%`. Context is "Due {date}", turning danger with "· N days overdue" when the date has passed. Shows "—" when Linear is unavailable.
- **Calendar — removed 2026-10-05 at Brian's request** after the first live build; the section doesn't ship in v1. The notes below are kept only as the record of what was designed, in case it returns.
  - Window: 6 weeks, starting on the Monday on or before `today − 14d`.
  - Live and concluded bars: `startTime` → `startTime + duration`.
  - Queued bars: `scheduledStartTime` → plus `duration`, or "Unscheduled" when there is none.
  - Drafts: an "Unscheduled" italic row.
  - Bar label: live shows the lift text plus the verdict text. Queued shows "Queued". Draft shows "Unscheduled · {hypothesis ? 'Hypothesis set' : 'Hypothesis in review'}".
  - Tone: `losing` when the verdict is losing. Otherwise the status.

## Layout and interactions

Follow `HANDOFF.md` §3, §4, §7 and §8, with these changes:

- **The device rows aren't shown.** The split card says "Device split isn't available from Statsig yet." The charts draw two bars per day (control `--exp-control` #9A82E6, test `--exp-test` #B3262B), each with a total label on top. The legend has two entries, and the rate table has two rows.
- **The page screenshots aren't shown.** Both arms show the placeholder overlay.
- **The sidebar:**
  - `AppShell` renders `ExperimentsSidebar` when `pathname.startsWith("/experiments")`, and the hub sidebar otherwise.
  - The hub sidebar adds "A/B testing" (`FlaskConical`) directly under Overview.
  - The Experiments sidebar's counts come from a promise the `(authed)` layout passes down, which resolves to `ExperimentsNav | null`. It is shared with the page through the same cache, and it streams so it never blocks the shell.
- **State in the URL:** `?view=all|live|decision|queued|draft|concluded` and `?surface=landing_page|signup_flow|tool_page`. The tabs, the sidebar and the table all read the same params. "Needs a decision" appears only in the sidebar. The tabs mark no tab as current for it.
- **Expanding rows:**
  - Several rows can be open at once.
  - The first time a row opens, it fetches `GET /api/experiments/{id}` and shows a skeleton while it loads.
  - Queued and draft rows open a slim panel with the hypothesis and facts only.
- **Errors:**
  - The list call fails: the table shows "Couldn't reach Statsig · retry" (a link that reloads), the KPIs show "—", and the sync box turns amber with "Statsig sync failed".
  - The detail call fails: an inline error inside that panel.
  - Daily data fails or is empty: a one-line empty state in block 04.
- **Export results:** the browser builds a CSV of the rows that are currently filtered, with every table column.
- **Responsive:** the table always scrolls sideways inside its card (`overflow-x: auto`), and the detail panel's Hypothesis | Split row wraps via `flex-wrap` when the fixed-width split block no longer fits. Below 900px the page header stacks and the KPI strip becomes a column. Nothing else changes.

## Caching and limits

- **List and pulse data:** an hourly `ttlCache`, with a 5-minute retry when only some calls succeed and a 2-minute failure TTL, using the same constants as `statsig.ts`.
- **Detail:** the same TTL, keyed by experiment id. One detail costs one `cumulative_exposures` call plus up to 28 dated pulse calls, run 6 at a time. Even with all three live experiments cold, that is far under ~900 requests per 15 minutes.
- **Keys:** `STATSIG_CONSOLE_API_KEY` stays server-side, read through `statsigConfig()`.

## Out of scope (v1)

Device split from Amplitude, page screenshots, Statsig write calls, any mobile-specific design, changes to the Overview page beyond the new nav item.
