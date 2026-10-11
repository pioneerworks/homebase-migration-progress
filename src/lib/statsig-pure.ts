/**
 * Pure Statsig helpers with no server-only dependency: the derivations here
 * are shared between the server loaders (statsig.ts) and client components
 * (the Experiments tab), so this module must stay importable from both.
 */
import type { ExperimentPulseResultsDto, ExternalExperimentDto } from "./statsig-types";

export type ExperimentVerdict = "winning" | "losing" | "no-signal" | "no-data";

export interface ExperimentCard {
  id: string;
  title: string;
  permalink: string | null;
  hypothesis: string | null;
  started: string | null;
  /** 1-based day of the experiment, or null when unused. */
  day: number | null;
  durationDays: number | null;
  primaryMetric: string | null;
  /** Signed percent change of test vs control, e.g. -53.4 is "test is down 53%". */
  percentChange: number | null;
  /** Percent-change CI bounds, [low, high]. */
  ci: [number, number] | null;
  pValue: number | null;
  /** True when the p-value clears Statsig's adjusted alpha for this experiment. */
  significant: boolean;
  /** Per-unit mean of each arm (conversion rate when the metric is binomial). */
  controlRate: number | null;
  testRate: number | null;
  controlUnits: number | null;
  testUnits: number | null;
  verdict: ExperimentVerdict;
  noDataReason: string | null;
}

/** exp_free_employee_scheduling_app_lp_module -> "Free employee scheduling app LP module". */
export function experimentTitle(id: string): string {
  return id
    .replace(/^exp_/, "")
    .replace(/_/g, " ")
    .replace(/\blp\b/gi, "LP")
    .replace(/\burl\b/gi, "URL")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bapp\b/gi, "App")
    .replace(/\bai\b/gi, "AI")
    .split(" ")
    .map((word) =>
      /^(LP|URL|ID)$/.test(word) || word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * The `count` most recently started experiments, by start day. Same-day starts
 * keep their input order; ones without a start date sort last.
 */
export function latestExperiments(cards: ExperimentCard[], count: number): ExperimentCard[] {
  return [...cards]
    .sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""))
    .slice(0, count);
}

export function experimentDay(
  startTimeMs: number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!startTimeMs) return null;
  // Counts elapsed 24h periods like a stopwatch; Statsig's own day counter can
  // differ by one when an experiment started mid-day UTC (documented like the
  // UTC day bucketing note in amplitude.ts).
  return Math.max(1, Math.floor((now - startTimeMs) / 86400000) + 1);
}

/**
 * Turn the primary-metric pulse row into a dashboard verdict. `directionality`
 * is Statsig's desired direction ("increase" means a positive lift is good).
 */
export function verdictFromPrimary(
  metric: ExperimentPulseResultsDto["primaryMetrics"][number],
): Pick<ExperimentCard, "verdict" | "significant" | "noDataReason" | "percentChange" | "ci" | "pValue"> {
  if (metric.error) {
    return {
      verdict: "no-data",
      significant: false,
      noDataReason: metric.error,
      percentChange: null,
      ci: null,
      pValue: null,
    };
  }
  const ci = metric.percentConfidenceInterval;
  const significant = metric.pValue != null && metric.adjustedAlpha != null
    ? metric.pValue < metric.adjustedAlpha
    : false;
  const desired = metric.directionality === "decrease" ? -1 : 1;
  const lift = metric.percentChange ?? null;
  let verdict: ExperimentVerdict = "no-signal";
  if (significant && lift != null && lift !== 0) {
    verdict = lift * desired > 0 ? "winning" : "losing";
  }
  return {
    verdict,
    significant,
    noDataReason: null,
    percentChange: lift,
    ci: ci && ci.lower != null && ci.upper != null ? [ci.lower, ci.upper] : null,
    pValue: metric.pValue ?? null,
  };
}

/**
 * Pick the control and (first) test group for an experiment's pulse query.
 * Multi-arm experiments: Statsig's pulse endpoint compares one test group
 * against control, so we surface the first non-control arm today rather than
 * issuing one call per arm.
 */
export function pickArms(
  experiment: ExternalExperimentDto,
): { controlId: string | null; testId: string | null } {
  const control =
    experiment.groups.find((g) => g.id && g.id === experiment.controlGroupID) ??
    experiment.groups.find((g) => g.isControl);
  const test = experiment.groups.find((g) => g.id && g.id !== control?.id);
  return { controlId: control?.id ?? null, testId: test?.id ?? null };
}
