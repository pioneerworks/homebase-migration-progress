/**
 * Pure derivations for the Experiments tab: everything the hub renders is
 * computed here from the Statsig DTOs, with no fetching and no server-only
 * imports, so both the API routes and the client components can use it.
 *
 * See docs/superpowers/specs/2026-10-05-experiments-tab-design.md
 * ("Status mapping" and "Field derivations").
 */
import { experimentDay, experimentTitle, verdictFromPrimary } from "./statsig-pure";
import type { ExperimentPulseResultsDto, ExternalExperimentDto } from "./statsig-types";
import type {
  ArmResults,
  Decision,
  ExperimentListItem,
  ExperimentsNav,
  ExperimentsPage,
  HubStatus,
  Kpi,
  MetricResult,
  ResultsSource,
  Surface,
  Tagline,
  View,
} from "./experiments-types";

export const SURFACE_LABELS: Record<Surface, string> = {
  landing_page: "Landing pages",
  signup_flow: "Signup flow",
  tool_page: "Tool pages",
};

export const SLACK_CHANNEL_URL = "https://homebase.slack.com/app_redirect?channel=ab-testing";
export const STATSIG_EXPERIMENTS_URL = "https://console.statsig.com/experiments";

const VIEW_ORDER: View[] = ["all", "live", "decision", "queued", "draft", "concluded"];
const SURFACES: Surface[] = ["landing_page", "signup_flow", "tool_page"];
const STATUS_ORDER: Record<HubStatus, number> = { live: 0, queued: 1, draft: 2, concluded: 3 };
const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Date helpers (UTC only, so results never depend on the server timezone)
// ---------------------------------------------------------------------------

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** "Fri, Sep 25" — the one date format the hub uses outside of ISO strings. */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Field derivations
// ---------------------------------------------------------------------------

/**
 * Statsig status → hub status, or null when the experiment is excluded from
 * the hub (abandoned/archived). A `setup` experiment is queued when it has a
 * scheduled start or a `queued` tag, otherwise it is a draft.
 */
export function hubStatus(e: ExternalExperimentDto): HubStatus | null {
  switch (e.status) {
    case "active":
      return "live";
    case "setup":
      return e.scheduledStartTime != null || (e.tags ?? []).some((t) => t.toLowerCase() === "queued")
        ? "queued"
        : "draft";
    case "decision_made":
    case "experiment_stopped":
    case "assignment_stopped":
      return "concluded";
    default:
      return null;
  }
}

/** The marketing path under test: description, then sidecar URL, then the control arm's destination_url. */
export function experimentPath(e: ExternalExperimentDto): string | null {
  const described = e.description?.match(/A\/B test on (\/[^\s:]+)/);
  if (described) return described[1];
  return pathnameOf(e.sidecarEditorURL) ?? controlDestination(e);
}

function pathnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    // Only http(s) URLs have a meaningful path; anything else (javascript:,
    // data:, …) is never a marketing page.
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function controlDestination(e: ExternalExperimentDto): string | null {
  const control = controlGroup(e);
  const destination = control?.parameterValues?.destination_url;
  return typeof destination === "string" ? pathnameOf(destination) : null;
}

function controlGroup(e: ExternalExperimentDto): ExternalExperimentDto["groups"][number] | undefined {
  return e.groups.find((g) => (g.id && g.id === e.controlGroupID) || g.isControl) ?? e.groups[0];
}

function testGroup(e: ExternalExperimentDto): ExternalExperimentDto["groups"][number] | undefined {
  const control = controlGroup(e);
  return e.groups.find((g) => g.id && g.id !== control?.id);
}

export function surfaceOf(path: string | null): Surface {
  if (path?.startsWith("/signup")) return "signup_flow";
  if (path?.includes("/tools/")) return "tool_page";
  return "landing_page";
}

/** owner.ownerName, unless empty or a Console API service account; then lastModifierName under the same rule. */
export function ownerOf(e: ExternalExperimentDto): string | null {
  for (const candidate of [e.owner?.ownerName, e.lastModifierName]) {
    if (candidate && candidate.trim() && !candidate.startsWith("CONSOLE API")) return candidate;
  }
  return null;
}

/**
 * Each arm's URL: the arm's `parameterValues.destination_url` when present and
 * a real https URL (anything else — javascript:, data:, … — is dropped), otherwise
 * the marketing path on joinhomebase.com for both arms.
 */
export function armUrls(
  e: ExternalExperimentDto,
  path: string | null,
): { control: string | null; test: string | null } {
  const urlFor = (group: ExternalExperimentDto["groups"][number] | undefined): string | null => {
    const destination = group?.parameterValues?.destination_url;
    if (typeof destination === "string" && destination.startsWith("https://")) return destination;
    return path ? `https://www.joinhomebase.com${path}` : null;
  };
  return { control: urlFor(controlGroup(e)), test: urlFor(testGroup(e)) };
}

/** https URLs only; any other scheme (or empty) is not a link we render. */
function httpsUrl(url: string | null | undefined): string | null {
  return url != null && url.startsWith("https://") ? url : null;
}

function targetSplitOf(e: ExternalExperimentDto): [number, number] {
  return [controlGroup(e)?.size ?? 0, testGroup(e)?.size ?? 0];
}

function metricResult(label: string, row: ExperimentPulseResultsDto["primaryMetrics"][number] | undefined): MetricResult | null {
  if (!row || row.error) return null;
  if (row.controlMean == null || row.testMean == null || row.controlUnits == null || row.testUnits == null) {
    return null;
  }
  return {
    label,
    control: Math.round(row.controlMean * row.controlUnits),
    test: Math.round(row.testMean * row.testUnits),
    controlRate: row.controlMean * 100,
    testRate: row.testMean * 100,
    lift: row.percentChange ?? null,
    source: "statsig",
  };
}

function progressLabelOf(
  status: HubStatus,
  e: ExternalExperimentDto,
  day: number | null,
): string {
  if (status === "live" && day != null) {
    return e.duration != null ? `Day ${day} of ${e.duration}` : `Day ${day}`;
  }
  if (status === "queued" && e.scheduledStartTime != null) return `Starts ${formatDate(e.scheduledStartTime)}`;
  if (status === "concluded" && e.startTime != null && e.duration != null) {
    return `Ended ${formatDate(e.startTime + e.duration * DAY_MS)}`;
  }
  return "Unscheduled";
}

/** One flat row per experiment, ready to render. Excluded statuses are the caller's problem (`hubStatus` → null). */
export function toListItem(
  e: ExternalExperimentDto,
  pulse: ExperimentPulseResultsDto | undefined,
  now: number = Date.now(),
): ExperimentListItem {
  const path = experimentPath(e);
  const status = hubStatus(e) ?? "draft";
  const primaryRow = pulse?.primaryMetrics?.[0];
  const verdict = primaryRow
    ? verdictFromPrimary(primaryRow)
    : { verdict: "no-data" as const, percentChange: null as number | null, pValue: null as number | null };

  const hasRate = primaryRow != null && !primaryRow.error && primaryRow.controlMean != null && primaryRow.testMean != null;

  const results: MetricResult[] = [];
  const signups = metricResult("Sign ups", primaryRow);
  if (signups) results.push(signups);
  const oneDayOne = pulse?.secondaryMetrics?.find((row) => row.metricName === "1D1");
  const oneDayOneResult = metricResult("1D1s", oneDayOne);
  if (oneDayOneResult) results.push(oneDayOneResult);

  const day = experimentDay(e.startTime, now);
  const startMs = e.startTime ?? (status === "queued" ? e.scheduledStartTime ?? null : null);
  const guardrails = (e.secondaryMetrics ?? []).map((m) => m.name).join(" · ");

  return {
    id: e.id,
    name: experimentTitle(e.name),
    path,
    surface: surfaceOf(path),
    status,
    primaryMetric: primaryRow?.metricName ?? e.primaryMetrics?.[0]?.name ?? null,
    owner: ownerOf(e),
    statsigUrl: httpsUrl(e.permalink),
    hypothesis: e.hypothesis || null,
    guardrails: guardrails || "—",
    plannedRun: e.duration != null ? `${e.duration} days` : "—",
    controlRate: hasRate ? primaryRow!.controlMean! * 100 : null,
    testRate: hasRate ? primaryRow!.testMean! * 100 : null,
    lift: verdict.percentChange,
    pValue: verdict.pValue,
    verdict: verdict.verdict,
    controlN: primaryRow?.controlUnits ?? null,
    testN: primaryRow?.testUnits ?? null,
    statsigTestN: primaryRow?.testUnits ?? null,
    alpha: primaryRow?.adjustedAlpha ?? null,
    day,
    totalDays: e.duration ?? null,
    startDate: startMs != null ? isoDate(startMs) : null,
    endDate: startMs != null && e.duration != null ? isoDate(startMs + e.duration * DAY_MS) : null,
    createdTime: e.createdTime ?? null,
    targetSplit: targetSplitOf(e),
    armUrls: armUrls(e, path),
    armNames: { control: controlGroup(e)?.name ?? "Control", test: testGroup(e)?.name ?? "Test" },
    results,
    resultsSource: "statsig",
    tagline: taglineOf(status, verdict.verdict, primaryRow?.metricName ?? null, verdict.percentChange),
    progressLabel: progressLabelOf(status, e, day),
  };
}

// ---------------------------------------------------------------------------
// Amplitude overlay: live sign-up results replacing Statsig's daily sync
// ---------------------------------------------------------------------------

/** Significance threshold for Amplitude results when Statsig gives no adjusted alpha. */
const AMPLITUDE_ALPHA = 0.05;
/** The Amplitude overlay always measures owner sign ups, whatever Statsig's primary metric is. */
const AMPLITUDE_METRIC = "Owner Signups";

/**
 * Two-sided p-value of a two-proportion z-test with pooled variance, or null
 * when either arm has no visitors or nobody converted in either arm.
 */
export function twoProportionPValue(
  controlSignups: number,
  controlVisitors: number,
  testSignups: number,
  testVisitors: number,
): number | null {
  if (controlVisitors <= 0 || testVisitors <= 0) return null;
  const pooled = (controlSignups + testSignups) / (controlVisitors + testVisitors);
  if (pooled <= 0 || pooled >= 1) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / controlVisitors + 1 / testVisitors));
  const z = Math.abs(testSignups / testVisitors - controlSignups / controlVisitors) / se;
  return Math.min(1, erfc(z / Math.SQRT2));
}

/**
 * The Statsig list item with its sign-up results (rates, lift, significance,
 * verdict, samples, tagline) recomputed from live Amplitude funnels. The
 * experiment's metadata and Statsig's other metrics (1D1) are kept as they are.
 * Significance uses Statsig's adjusted alpha for the experiment when known.
 */
export function withAmplitude(item: ExperimentListItem, amp: ArmResults): ExperimentListItem {
  const { control, test } = amp;
  const others = item.results.filter((r) => r.label !== "Sign ups");
  const base = { ...item, resultsSource: "amplitude" as const, controlN: control.visitors, testN: test.visitors };

  // the loader only overlays results with visitors in both arms; keep Statsig's otherwise
  if (control.visitors <= 0 || test.visitors <= 0) return item;

  const controlRate = (control.signups / control.visitors) * 100;
  const testRate = (test.signups / test.visitors) * 100;
  const lift = controlRate > 0 ? ((testRate - controlRate) / controlRate) * 100 : null;
  const pValue = twoProportionPValue(control.signups, control.visitors, test.signups, test.visitors);
  const significant = pValue != null && pValue < (item.alpha ?? AMPLITUDE_ALPHA) && testRate !== controlRate;
  const verdict: ExperimentListItem["verdict"] = significant
    ? testRate > controlRate
      ? "winning"
      : "losing"
    : "no-signal";

  return {
    ...base,
    controlRate,
    testRate,
    lift,
    pValue,
    verdict,
    results: [
      { label: "Sign ups", control: control.signups, test: test.signups, controlRate, testRate, lift, source: "amplitude" },
      ...others,
    ],
    tagline: taglineOf(item.status, verdict, AMPLITUDE_METRIC, lift),
  };
}

// ---------------------------------------------------------------------------
// Table, KPIs, decision banner, nav, filters, CSV
// ---------------------------------------------------------------------------

function byStartDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? 1 : -1;
}

/** live, queued, draft, concluded; newest start first within each group, createdTime breaking ties. */
export function sortExperiments(items: ExperimentListItem[]): ExperimentListItem[] {
  return [...items].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      byStartDesc(a.startDate, b.startDate) ||
      (b.createdTime ?? 0) - (a.createdTime ?? 0),
  );
}

function formatP(p: number): string {
  return p >= 0.001 ? p.toFixed(3) : p.toExponential(1);
}

/** First live experiment with a significant loss, if any — that's the decision banner. */
export function pickDecision(items: ExperimentListItem[]): Decision | null {
  const item = items.find(
    (i) => i.status === "live" && i.verdict === "losing" && i.controlRate != null && i.testRate != null,
  );
  if (!item) return null;

  const rates = `${item.controlRate!.toFixed(2)}% → ${item.testRate!.toFixed(2)}%`;
  const p = item.pValue != null ? formatP(item.pValue) : "—";
  const heavy = item.lift != null && item.lift <= -50;
  const head = heavy
    ? `Test arm converts at less than half of control (${rates}, p = ${p})`
    : `Test arm converts below control (${rates}, p = ${p})`;
  // Statsig's units count every visitor; Amplitude's testN only the consented
  // half, so with no Statsig count the cost is left out rather than halved.
  const testTraffic = item.resultsSource === "amplitude" ? item.statsigTestN : item.testN;
  const dailyCost = item.day != null && item.day > 0 && testTraffic != null
    ? Math.round(((item.controlRate! - item.testRate!) / 100) * testTraffic / item.day)
    : null;
  const body = dailyCost != null
    ? `${head}. Keeping it live costs roughly ${dailyCost} owner sign ups a day.`
    : `${head}.`;

  return {
    experimentId: item.id,
    title: `Needs a decision: stop the ${item.name} test`,
    body,
    statsigUrl: item.statsigUrl,
    slackUrl: SLACK_CHANNEL_URL,
  };
}

/** "Visitors" for Amplitude's consented visitors, "Exposures" for Statsig's. */
export function trafficLabel(source: ResultsSource): "Visitors" | "Exposures" {
  return source === "amplitude" ? "Visitors" : "Exposures";
}

/** Where a number comes from and how fresh it is. */
export function sourceLabel(source: ResultsSource): string {
  return source === "amplitude" ? "Amplitude, live (consented visitors only)" : "Statsig, updated daily";
}

export function formatLift(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function formatRate(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

export function significanceLabel(item: ExperimentListItem): { text: string; tone: "danger" | "success" | "muted" | null } {
  if (item.status === "queued" || item.status === "draft") return { text: "—", tone: null };
  switch (item.verdict) {
    case "losing":
      return { text: "Sig. loss", tone: "danger" };
    case "winning":
      return { text: "Sig. win", tone: "success" };
    case "no-signal":
      return {
        text: item.pValue != null ? `Not yet · p≈${item.pValue.toFixed(2)}` : "Not yet",
        tone: "muted",
      };
    default:
      return { text: "—", tone: null };
  }
}

/**
 * One-line verdict under the experiment name (handoff §6, revised 2026-10-05).
 * The reason is a whole-percent lift against the shortened metric word
 * ("Owner signups" → "sign ups"); queued and draft rows simply haven't started.
 */
export function taglineOf(
  status: HubStatus,
  verdict: ExperimentListItem["verdict"],
  metricName: string | null,
  lift: number | null,
): Tagline {
  if (status === "queued" || status === "draft") {
    return { state: "not_started", text: "Not started yet" };
  }
  if (verdict === "winning") {
    return lift != null
      ? { state: "ahead", text: "Variant is ahead", reason: `+${wholePctMagnitude(lift)} ${metricWord(metricName)}` }
      : { state: "ahead", text: "Variant is ahead" };
  }
  if (verdict === "losing") {
    return lift != null
      ? { state: "losing", text: "Variant is losing", reason: `−${wholePctMagnitude(lift)} ${metricWord(metricName)}` }
      : { state: "losing", text: "Variant is losing" };
  }
  return {
    state: "too_early",
    text: "Too early to tell",
    reason: lift != null ? `${lift >= 0 ? "+" : "−"}${wholePctMagnitude(lift)}, not sig.` : "no data yet",
  };
}

/** Whole percent, magnitude only — the caller supplies the sign. */
function wholePctMagnitude(lift: number): string {
  return `${Math.round(Math.abs(lift))}%`;
}

/**
 * Shorten a primary-metric name for the tagline reason: the team's Owner
 * Signups metric reads as "sign ups"; any other name keeps its own casing.
 */
function metricWord(metricName: string | null): string {
  const name = (metricName ?? "").trim();
  if (/^(owner\s+)?signups?$/i.test(name)) return "sign ups";
  return name || "sign ups";
}

/**
 * Sample-ratio mismatch: chi-square goodness of fit of the observed counts
 * against the target split, 1 degree of freedom. Returns null when either
 * side is degenerate (no observations or an empty split).
 */
export function srm(counts: [number, number], target: [number, number]): { ok: boolean; pValue: number } | null {
  const total = counts[0] + counts[1];
  const targetTotal = target[0] + target[1];
  if (total <= 0 || targetTotal <= 0) return null;

  const chi2 = counts.reduce((sum, observed, i) => {
    const expected = total * (target[i] / targetTotal);
    if (expected <= 0) return sum + (observed > 0 ? Infinity : 0);
    return sum + (observed - expected) ** 2 / expected;
  }, 0);
  const pValue = erfc(Math.sqrt(chi2 / 2));
  return { ok: pValue >= 0.01, pValue };
}

/** Complementary error function, Abramowitz–Stegun 7.1.26 (|ε| < 1.5e-7). */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t
    * (0.254829592
      + t * (-0.284496736
        + t * (1.421413741
          + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
}

/** Per-day deltas of a cumulative series; a negative delta (backfill, dedup) clamps to 0. */
export function dailyFromCumulative(series: { date: string; value: number }[]): { date: string; value: number }[] {
  let previous = 0;
  return series.map(({ date, value }) => {
    const delta = value - previous;
    previous = value;
    return { date, value: Math.max(0, delta) };
  });
}

export function parseFilters(params: { view?: string | null; surface?: string | null }): { view: View; surface: Surface | null } {
  return {
    view: VIEW_ORDER.includes(params.view as View) ? (params.view as View) : "all",
    surface: SURFACES.includes(params.surface as Surface) ? (params.surface as Surface) : null,
  };
}

export function filterItems(items: ExperimentListItem[], f: { view: View; surface: Surface | null }): ExperimentListItem[] {
  return items.filter((item) => {
    if (f.surface && item.surface !== f.surface) return false;
    switch (f.view) {
      case "all":
        return true;
      case "live":
        return item.status === "live";
      case "decision":
        return item.status === "live" && item.verdict === "losing";
      default:
        return item.status === f.view;
    }
  });
}

export function buildNav(items: ExperimentListItem[], sync: { ok: boolean; at: string | null }): ExperimentsNav {
  const counts: Record<View, number> = { all: items.length, live: 0, decision: 0, queued: 0, draft: 0, concluded: 0 };
  const surfaces: Record<Surface, number> = { landing_page: 0, signup_flow: 0, tool_page: 0 };
  const live: ExperimentsNav["live"] = [];

  for (const item of items) {
    counts[item.status] += 1;
    surfaces[item.surface] += 1;
    if (item.status === "live") {
      const losing = item.verdict === "losing";
      if (losing) counts.decision += 1;
      live.push({
        id: item.id,
        name: item.name,
        lift: item.lift,
        losing,
        day: item.day,
        totalDays: item.totalDays,
      });
    }
  }

  return { counts, surfaces, live, sync };
}

const CSV_HEADER
  = "Experiment,Path,Status,Primary metric,Control rate,Test rate,Lift,Significance,Control n,Test n,Results source,Progress,Owner";

function csvField(value: string | number | null): string {
  const text = String(value ?? "");
  // Guard against CSV formula injection: a leading = + - @ tab or CR would be
  // executed by spreadsheet apps, so prefix an apostrophe to defuse it.
  // Numbers are exempt — a numeric cell like -12.5 must stay a real number.
  const guarded = typeof value === "number" ? text : /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(items: ExperimentListItem[]): string {
  const lines = [CSV_HEADER];
  for (const item of items) {
    lines.push(
      [
        item.name,
        item.path ?? "",
        item.status,
        item.primaryMetric ?? "—",
        formatRate(item.controlRate),
        formatRate(item.testRate),
        formatLift(item.lift),
        significanceLabel(item).text,
        item.controlN ?? "",
        item.testN ?? "",
        item.resultsSource === "amplitude" ? "Amplitude (consented visitors)" : "Statsig",
        item.progressLabel,
        item.owner ?? "Unassigned",
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function sumSignups(items: ExperimentListItem[]): {
  control: number;
  test: number;
  any: boolean;
  sources: Set<MetricResult["source"]>;
} {
  let control = 0;
  let test = 0;
  let any = false;
  const sources = new Set<MetricResult["source"]>();
  for (const item of items) {
    for (const result of item.results) {
      if (result.label !== "Sign ups") continue;
      control += result.control;
      test += result.test;
      any = true;
      sources.add(result.source);
    }
  }
  return { control, test, any, sources };
}

/** Where the sign-up KPI's numbers come from, so a mix of sources isn't hidden. */
function signupsSourceNote(sources: Set<MetricResult["source"]>): string {
  if (sources.size > 1) return " · Amplitude + Statsig";
  return sources.has("amplitude") ? " · Amplitude, live" : "";
}

function milestoneKpi(milestone: { progress: number; targetDate: string | null }, today: string): Kpi {
  if (milestone.targetDate == null) {
    return { id: "milestone", label: "M1 · First live experiments", value: `${milestone.progress}%`, context: "—" };
  }
  const due = parseDay(milestone.targetDate);
  const overdue = Math.floor((parseDay(today) - due) / DAY_MS);
  return {
    id: "milestone",
    label: "M1 · First live experiments",
    value: `${milestone.progress}%`,
    context: `Due ${formatDate(due)}${overdue > 0 ? ` · ${overdue} day${overdue === 1 ? "" : "s"} overdue` : ""}`,
    tone: overdue > 0 ? "danger" : undefined,
  };
}

export function buildKpis(
  items: ExperimentListItem[],
  opts: {
    visitors7d: { control: number; test: number } | null;
    milestone: { progress: number; targetDate: string | null } | null;
    today: string;
  },
): Kpi[] {
  const live = items.filter((i) => i.status === "live");
  const landingPages = live.filter((i) => i.surface === "landing_page").length;
  const signupFlows = live.filter((i) => i.surface === "signup_flow").length;
  const losses = live.filter((i) => i.verdict === "losing").length;
  const wins = live.filter((i) => i.verdict === "winning").length;
  const signups = sumSignups(live);

  return [
    {
      id: "live",
      label: "Live tests",
      value: String(live.length),
      context: `${landingPages} landing pages · ${signupFlows} signup flow`,
    },
    {
      id: "significant",
      label: "Significant results",
      value: String(losses + wins),
      context: `${losses} loss${losses === 1 ? "" : "es"} · ${wins} win${wins === 1 ? "" : "s"}`,
    },
    opts.visitors7d
      ? {
          id: "visitors",
          label: "Visitors in test · 7d",
          value: (opts.visitors7d.control + opts.visitors7d.test).toLocaleString("en-US"),
          context: `${opts.visitors7d.control.toLocaleString("en-US")} control · ${opts.visitors7d.test.toLocaleString("en-US")} test`,
        }
      : { id: "visitors", label: "Visitors in test · 7d", value: "—", context: "—" },
    signups.any
      ? {
          id: "signups",
          label: "Owner sign ups in test",
          value: (signups.control + signups.test).toLocaleString("en-US"),
          context: `Control ${signups.control.toLocaleString("en-US")} · Test ${signups.test.toLocaleString("en-US")}${signupsSourceNote(signups.sources)}`,
        }
      : { id: "signups", label: "Owner sign ups in test", value: "—", context: "—" },
    opts.milestone
      ? milestoneKpi(opts.milestone, opts.today)
      : { id: "milestone", label: "M1 · First live experiments", value: "—", context: "—" },
  ];
}
