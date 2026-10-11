/**
 * Page model for the Experiments (A/B testing) tab. These types are the
 * contract between the pure derivations (experiments-derive.ts), the server
 * loaders, and the client UI — none of them import server-only modules.
 */

export type HubStatus = "live" | "queued" | "draft" | "concluded";
/** Where an experiment's sign-up results come from. */
export type ResultsSource = "amplitude" | "statsig";

export type ArmDay = { date: string; visitors: number; signups: number };
/** One arm's Amplitude funnel: unique visitors over the range and those who signed up within the window. */
export type ArmFunnel = { visitors: number; signups: number; daily: ArmDay[] };
export type ArmResults = { control: ArmFunnel; test: ArmFunnel };
export type Surface = "landing_page" | "signup_flow" | "tool_page";
export type View = "all" | "live" | "decision" | "queued" | "draft" | "concluded";
export type Verdict = "winning" | "losing" | "no-signal" | "no-data";

export type MetricResult = {
  label: string;
  control: number;
  test: number;
  controlRate: number;
  testRate: number;
  lift: number | null;
  source: ResultsSource;
};

export type TaglineState = "ahead" | "losing" | "too_early" | "not_started";
export type Tagline = { state: TaglineState; text: string; reason?: string };

export type ExperimentListItem = {
  id: string;
  name: string;
  path: string | null;
  surface: Surface;
  status: HubStatus;
  primaryMetric: string | null;
  owner: string | null;
  statsigUrl: string | null;
  hypothesis: string | null;
  guardrails: string;
  plannedRun: string;
  /** % values, e.g. 2.09 */
  controlRate: number | null;
  testRate: number | null;
  lift: number | null;
  pValue: number | null;
  verdict: Verdict;
  controlN: number | null;
  testN: number | null;
  /** Statsig's test-arm units: all visitors, unlike Amplitude's consented-only count. */
  statsigTestN: number | null;
  /** Statsig's adjusted alpha for the primary metric, when the pulse has one. */
  alpha: number | null;
  day: number | null;
  totalDays: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Statsig createdTime (ms), for the within-group sort tiebreak. */
  createdTime: number | null;
  targetSplit: [number, number];
  armUrls: { control: string | null; test: string | null };
  armNames: { control: string; test: string };
  /** [Sign ups, 1D1s] when present */
  results: MetricResult[];
  /** Rates, lift, significance and sign ups: live Amplitude, or Statsig's daily sync. */
  resultsSource: ResultsSource;
  /** One-line verdict under the name (handoff §6): ahead / losing / too early / not started. */
  tagline: Tagline;
  /** "Day 10 of 28" | "Starts Oct 20" | "Unscheduled" | "Ended Oct 1" */
  progressLabel: string;
};

export type Kpi = {
  id: string;
  label: string;
  value: string;
  context: string;
  tone?: "danger";
};

export type Decision = {
  experimentId: string;
  title: string;
  body: string;
  statsigUrl: string | null;
  slackUrl: string;
};

export type ExperimentsNav = {
  counts: Record<View, number>;
  surfaces: Record<Surface, number>;
  live: {
    id: string;
    name: string;
    lift: number | null;
    losing: boolean;
    day: number | null;
    totalDays: number | null;
  }[];
  sync: { ok: boolean; at: string | null };
};

export type ExperimentsPage = {
  today: string;
  week: { start: string; end: string };
  sync: { ok: boolean; at: string | null };
  experiments: ExperimentListItem[];
  kpis: Kpi[];
  decision: Decision | null;
};

export type DailyPoint = {
  date: string;
  exposures: { control: number; test: number };
  signups: { control: number; test: number };
};

export type ExperimentDetail = {
  id: string;
  exposures: { control: number; test: number } | null;
  srm: { ok: boolean; pValue: number } | null;
  daily: DailyPoint[] | null;
  /** amplitude: daily visitors + sign ups from Amplitude; statsig: exposures + dated pulses. */
  dailySource: ResultsSource;
  /**
   * Amplitude only: unique visitors and sign ups over the whole run, for the
   * rate table's total (summing daily uniques would count returning visitors twice).
   */
  totals?: { control: { visitors: number; signups: number }; test: { visitors: number; signups: number } };
};
