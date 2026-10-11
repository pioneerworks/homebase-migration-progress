import assert from "node:assert/strict";
import { test } from "node:test";

import {
  armUrls,
  buildKpis,
  buildNav,
  dailyFromCumulative,
  experimentPath,
  filterItems,
  formatLift,
  formatRate,
  hubStatus,
  ownerOf,
  parseFilters,
  pickDecision,
  significanceLabel,
  sortExperiments,
  surfaceOf,
  srm,
  taglineOf,
  toCsv,
  toListItem,
  sourceLabel,
  trafficLabel,
  twoProportionPValue,
  withAmplitude,
} from "../src/lib/experiments-derive";
import type { ArmResults, ExperimentListItem } from "../src/lib/experiments-types";
import type { ExperimentPulseResultsDto, ExternalExperimentDto } from "../src/lib/statsig-types";

function exp(overrides: Partial<ExternalExperimentDto> = {}): ExternalExperimentDto {
  return {
    id: "exp_free_employee_scheduling_app_lp_module",
    name: "exp_free_employee_scheduling_app_lp_module",
    status: "active",
    startTime: Date.UTC(2026, 8, 25),
    duration: 28,
    tags: ["Marketing"],
    description: 'A/B test on /free-employee-scheduling-app-lp: "module" varies between the groups.',
    owner: { ownerName: "CONSOLE API - console-3nfq" },
    lastModifierName: "Meg Jump",
    groups: [
      { name: "control", id: "c1", size: 50, isControl: true, parameterValues: {} },
      { name: "test", id: "t1", size: 50, parameterValues: {} },
    ],
    secondaryMetrics: [
      { name: "1D1", type: "user_warehouse" },
      { name: "Week1-2D7", type: "user_warehouse" },
    ],
    ...overrides,
  };
}

function pulse(
  primary: Partial<ExperimentPulseResultsDto["primaryMetrics"][number]>,
  secondary?: Partial<NonNullable<ExperimentPulseResultsDto["secondaryMetrics"]>[number]>,
): ExperimentPulseResultsDto {
  return {
    primaryMetrics: [
      {
        metricID: "Owner Signups::user_warehouse",
        metricName: "Owner Signups",
        directionality: "increase",
        ...primary,
      },
    ],
    secondaryMetrics: secondary
      ? [
          {
            metricID: "1D1::user_warehouse",
            metricName: "1D1",
            directionality: "increase",
            ...secondary,
          },
        ]
      : undefined,
  };
}

const scheduling = exp();

const schedulingPulse = pulse(
  {
    controlMean: 0.02086981903093987,
    testMean: 0.02024811065164694,
    controlUnits: 6852,
    testUnits: 7013,
    percentChange: -2.9789830873532517,
    pValue: 0.7964795069605728,
    adjustedAlpha: 0.05,
  },
  {
    controlMean: 0.11188811188811189,
    testMean: 0.1347517730496454,
    controlUnits: 143,
    testUnits: 141,
    percentChange: 20.43439716312057,
    pValue: 0.5578,
  },
);

const base: ExperimentListItem = {
  id: "exp_base",
  name: "Base Experiment",
  path: null,
  surface: "landing_page",
  status: "live",
  primaryMetric: null,
  owner: null,
  statsigUrl: null,
  hypothesis: null,
  guardrails: "—",
  plannedRun: "—",
  controlRate: null,
  testRate: null,
  lift: null,
  pValue: null,
  verdict: "no-data",
  controlN: null,
  testN: null,
  statsigTestN: null,
  alpha: null,
  day: null,
  totalDays: null,
  startDate: null,
  endDate: null,
  createdTime: null,
  targetSplit: [50, 50],
  armUrls: { control: null, test: null },
  armNames: { control: "control", test: "test" },
  results: [],
  resultsSource: "statsig",
  tagline: { state: "too_early", text: "Too early to tell" },
  progressLabel: "Unscheduled",
};

test("hubStatus maps Statsig statuses", () => {
  assert.equal(hubStatus(exp({ status: "active" })), "live");
  assert.equal(hubStatus(exp({ status: "setup" })), "draft");
  assert.equal(hubStatus(exp({ status: "setup", tags: ["queued"] })), "queued");
  assert.equal(hubStatus(exp({ status: "setup", scheduledStartTime: Date.UTC(2026, 9, 20) })), "queued");
  for (const s of ["decision_made", "experiment_stopped", "assignment_stopped"] as const)
    assert.equal(hubStatus(exp({ status: s })), "concluded");
  assert.equal(hubStatus(exp({ status: "archived" })), null);
  assert.equal(hubStatus(exp({ status: "abandoned" })), null);
});

test("experimentPath prefers description, then sidecar URL, then destination_url", () => {
  assert.equal(experimentPath(exp({ description: 'A/B test on /free-time-clock-app-lp: "x" varies' })), "/free-time-clock-app-lp");
  assert.equal(experimentPath(exp({ description: "", sidecarEditorURL: "https://www.joinhomebase.com/pricing" })), "/pricing");
  assert.equal(experimentPath(exp({ description: "", groups: [{ name: "control", id: "c", size: 50, isControl: true, parameterValues: { destination_url: "https://www.joinhomebase.com/solutions" } }, { name: "test", id: "t", size: 50, parameterValues: {} }] })), "/solutions");
  assert.equal(experimentPath(exp({ description: "" })), null);
});

test("surfaceOf classifies paths", () => {
  assert.equal(surfaceOf("/signup/owner"), "signup_flow");
  assert.equal(surfaceOf("/tools/overtime"), "tool_page");
  assert.equal(surfaceOf("/free-time-clock-app-lp"), "landing_page");
  assert.equal(surfaceOf(null), "landing_page");
});

test("ownerOf skips CONSOLE API owners", () => {
  assert.equal(ownerOf(exp({ owner: { ownerName: "CONSOLE API - console-3nfq" }, lastModifierName: "Meg Jump" })), "Meg Jump");
  assert.equal(ownerOf(exp({ owner: { ownerName: "Brian Nguyen" } })), "Brian Nguyen");
  assert.equal(ownerOf(exp({ owner: { ownerName: "" }, lastModifierName: "CONSOLE API - x" })), null);
});

test("toListItem flattens the live scheduling experiment", () => {
  const item = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  assert.equal(item.status, "live");
  assert.equal(item.path, "/free-employee-scheduling-app-lp");
  assert.equal(item.owner, "Meg Jump");
  assert.equal(item.controlRate?.toFixed(2), "2.09");
  assert.equal(item.testRate?.toFixed(2), "2.02");
  assert.equal(item.lift?.toFixed(1), "-3.0");
  assert.equal(item.verdict, "no-signal");
  assert.equal(item.controlN, 6852);
  assert.equal(item.day, 10);
  assert.equal(item.progressLabel, "Day 10 of 28");
  assert.equal(item.guardrails, "1D1 · Week1-2D7");
  assert.deepEqual(item.results.map((r) => [r.label, r.control, r.test]), [["Sign ups", 143, 142], ["1D1s", 16, 19]]);
});

test("toListItem handles missing pulse", () => {
  const item = toListItem(scheduling, undefined, Date.UTC(2026, 9, 4));
  assert.equal(item.controlRate, null);
  assert.equal(item.lift, null);
  assert.equal(item.verdict, "no-data");
  assert.equal(significanceLabel(item).text, "—");
  const errored = toListItem(scheduling, { primaryMetrics: [{ metricID: "m", metricName: "Owner Signups", error: "no_data" }] }, Date.UTC(2026, 9, 4));
  assert.equal(errored.lift, null);
  assert.equal(formatLift(errored.lift), "—");
});

test("formatting uses real minus and fixed decimals", () => {
  assert.equal(formatLift(-53.43), "−53.4%");
  assert.equal(formatLift(7.3), "+7.3%");
  assert.equal(formatLift(null), "—");
  assert.equal(formatRate(2.5), "2.50%");
});

test("significanceLabel per verdict", () => {
  assert.deepEqual(significanceLabel({ ...base, status: "live", verdict: "losing", pValue: 0.004 }), { text: "Sig. loss", tone: "danger" });
  assert.deepEqual(significanceLabel({ ...base, status: "live", verdict: "winning", pValue: 0.01 }), { text: "Sig. win", tone: "success" });
  assert.deepEqual(significanceLabel({ ...base, status: "live", verdict: "no-signal", pValue: 0.7964 }), { text: "Not yet · p≈0.80", tone: "muted" });
  assert.deepEqual(significanceLabel({ ...base, status: "queued", verdict: "no-data", pValue: null }), { text: "—", tone: null });
});

test("taglineOf covers the four states (handoff §6, revised)", () => {
  assert.deepEqual(
    taglineOf("live", "losing", "Owner Signups", -53.4),
    { state: "losing", text: "Variant is losing", reason: "−53% sign ups" },
  );
  assert.deepEqual(
    taglineOf("live", "winning", "Owner Signups", 12.4),
    { state: "ahead", text: "Variant is ahead", reason: "+12% sign ups" },
  );
  assert.deepEqual(
    taglineOf("live", "winning", "1D1", 12.4),
    { state: "ahead", text: "Variant is ahead", reason: "+12% 1D1" },
  );
  assert.deepEqual(
    taglineOf("live", "winning", "Owner Signups", null),
    { state: "ahead", text: "Variant is ahead" },
  );
  assert.deepEqual(
    taglineOf("live", "no-signal", "Owner Signups", 7.3),
    { state: "too_early", text: "Too early to tell", reason: "+7%, not sig." },
  );
  assert.deepEqual(
    taglineOf("live", "no-data", null, null),
    { state: "too_early", text: "Too early to tell", reason: "no data yet" },
  );
  assert.deepEqual(taglineOf("queued", "no-data", null, null), { state: "not_started", text: "Not started yet" });
  assert.deepEqual(taglineOf("draft", "no-data", null, null), { state: "not_started", text: "Not started yet" });
});

test("toListItem carries the tagline", () => {
  const item = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  assert.deepEqual(item.tagline, { state: "too_early", text: "Too early to tell", reason: "−3%, not sig." });
});

test("srm matches chi-square goodness of fit", () => {
  assert.equal(srm([6852, 7013], [50, 50])!.pValue.toFixed(2), "0.17");
  assert.equal(srm([6852, 7013], [50, 50])!.ok, true);
  assert.equal(srm([1000, 1200], [50, 50])!.ok, false);
});

test("srm returns null when target split is degenerate", () => {
  assert.equal(srm([0, 0], [50, 50]), null);
  assert.equal(srm([10, 10], [0, 0]), null);
});

test("dailyFromCumulative clamps negative deltas", () => {
  assert.deepEqual(
    dailyFromCumulative([{ date: "d1", value: 566 }, { date: "d2", value: 1075 }, { date: "d3", value: 1070 }]),
    [{ date: "d1", value: 566 }, { date: "d2", value: 509 }, { date: "d3", value: 0 }],
  );
});

test("sortExperiments orders live, queued, draft, concluded", () => {
  const sorted = sortExperiments([{ ...base, id: "c", status: "concluded" }, { ...base, id: "d", status: "draft" }, { ...base, id: "l", status: "live" }, { ...base, id: "q", status: "queued" }]);
  assert.deepEqual(sorted.map((i) => i.id), ["l", "q", "d", "c"]);
});

test("pickDecision picks first losing live experiment", () => {
  assert.equal(pickDecision([{ ...base, status: "live", verdict: "no-signal" }]), null);
  const d = pickDecision([{ ...base, id: "x", name: "Scheduling LP Module", status: "live", verdict: "losing", controlRate: 2.5, testRate: 1.16, lift: -53.6, pValue: 0.004, testN: 1720, day: 4 }]);
  assert.equal(d?.experimentId, "x");
  assert.equal(d?.title, "Needs a decision: stop the Scheduling LP Module test");
  assert.match(d!.body, /^Test arm converts at less than half of control \(2\.50% → 1\.16%, p = 0\.004\)\. Keeping it live costs roughly 6 owner sign ups a day\.$/);
  const mild = pickDecision([{ ...base, status: "live", verdict: "losing", controlRate: 2.5, testRate: 2.0, lift: -20, pValue: 0.03, testN: 1000, day: 5 }]);
  assert.match(mild!.body, /^Test arm converts below control/);
});

test("buildKpis computes the five cells", () => {
  const items = [
    { ...base, status: "live" as const, surface: "landing_page" as const, verdict: "losing" as const, results: [{ label: "Sign ups", control: 42, test: 20, controlRate: 2.5, testRate: 1.16, lift: -53.6, source: "statsig" as const }] },
    { ...base, status: "live" as const, surface: "landing_page" as const, verdict: "no-signal" as const, results: [{ label: "Sign ups", control: 33, test: 38, controlRate: 2.79, testRate: 3.0, lift: 7.3, source: "statsig" as const }] },
    { ...base, status: "queued" as const },
  ];
  const kpis = buildKpis(items, { visitors7d: { control: 2864, test: 2987 }, milestone: { progress: 19, targetDate: "2026-09-25" }, today: "2026-09-28" });
  assert.deepEqual(kpis.map((k) => [k.label, k.value, k.context]), [
    ["Live tests", "2", "2 landing pages · 0 signup flow"],
    ["Significant results", "1", "1 loss · 0 wins"],
    ["Visitors in test · 7d", "5,851", "2,864 control · 2,987 test"],
    ["Owner sign ups in test", "133", "Control 75 · Test 58"],
    ["M1 · First live experiments", "19%", "Due Fri, Sep 25 · 3 days overdue"],
  ]);
  assert.equal(kpis[4].tone, "danger");
  assert.equal(buildKpis([], { visitors7d: null, milestone: null, today: "2026-09-28" })[2].value, "—");
});

test("parseFilters ignores unknown values", () => {
  assert.deepEqual(parseFilters({ view: "bogus", surface: "x" }), { view: "all", surface: null });
  assert.deepEqual(parseFilters({ view: "decision", surface: "tool_page" }), { view: "decision", surface: "tool_page" });
});

test("filterItems combines view and surface", () => {
  const items = [{ ...base, id: "a", status: "live" as const, surface: "landing_page" as const, verdict: "losing" as const }, { ...base, id: "b", status: "live" as const, surface: "tool_page" as const }, { ...base, id: "c", status: "draft" as const, surface: "tool_page" as const }];
  assert.deepEqual(filterItems(items, { view: "live", surface: "tool_page" }).map((i) => i.id), ["b"]);
  assert.deepEqual(filterItems(items, { view: "decision", surface: null }).map((i) => i.id), ["a"]);
});

test("buildNav counts views and surfaces", () => {
  const nav = buildNav([{ ...base, status: "live", verdict: "losing" }, { ...base, status: "queued" }, { ...base, status: "draft", surface: "tool_page" }], { ok: true, at: "2026-10-05T12:00:00Z" });
  assert.deepEqual(nav.counts, { all: 3, live: 1, decision: 1, queued: 1, draft: 1, concluded: 0 });
  assert.deepEqual(nav.surfaces, { landing_page: 2, signup_flow: 0, tool_page: 1 });
  assert.equal(nav.live.length, 1);
  assert.equal(nav.live[0].losing, true);
});

test("toCsv quotes fields and has one row per experiment", () => {
  const csv = toCsv([{ ...base, name: 'Has "quotes", commas', status: "live", lift: -3 }]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Experiment,Path,Status,Primary metric,Control rate,Test rate,Lift,Significance,Control n,Test n,Results source,Progress,Owner");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^"Has ""quotes"", commas",/);
});

test("toCsv defuses formula-leading values", () => {
  const csv = toCsv([{ ...base, name: '=HYPERLINK("https://evil.example","x")' }]);
  assert.match(csv, /"'=HYPERLINK/);
  for (const prefix of ["+", "-", "@", "\t", "\r"]) {
    const row = toCsv([{ ...base, name: `${prefix}cmd` }]);
    assert.ok(row.includes(`"'${prefix}cmd"`), prefix);
  }
  // numeric cells bypass the guard: a negative number stays a real number
  const numericRow = toCsv([{ ...base, name: "Numeric cells", controlN: -12.5 }]);
  assert.match(numericRow, /,"-12\.5",/);
  assert.ok(!numericRow.includes(`"'-12.5"`));
});

test("armUrls and paths reject non-https destination URLs", () => {
  const dto = exp({
    description: "",
    groups: [
      { name: "control", id: "c1", size: 50, isControl: true, parameterValues: { destination_url: "javascript:alert(1)" } },
      { name: "test", id: "t1", size: 50, parameterValues: { destination_url: "javascript:alert(2)" } },
    ],
  });
  assert.deepEqual(armUrls(dto, null), { control: null, test: null });
  // the javascript: URL never becomes a marketing path either
  assert.equal(experimentPath(dto), null);
  assert.equal(experimentPath(exp({ description: "", sidecarEditorURL: "javascript:alert(1)" })), null);
});

test("statsigUrl drops non-https permalinks", () => {
  assert.equal(toListItem(exp({ permalink: "javascript:alert(1)" }), undefined).statsigUrl, null);
  assert.equal(
    toListItem(exp({ permalink: "https://console.statsig.com/experiments/x" }), undefined).statsigUrl,
    "https://console.statsig.com/experiments/x",
  );
});

test("progressLabel handles a live experiment without a duration", () => {
  const item = toListItem(exp({ duration: null }), undefined, Date.UTC(2026, 9, 4, 12));
  assert.equal(item.day, 10);
  assert.equal(item.progressLabel, "Day 10");
  assert.equal(toListItem(exp({ startTime: null, duration: null }), undefined).progressLabel, "Unscheduled");
});

test("sortExperiments breaks startDate ties with createdTime", () => {
  const sorted = sortExperiments([
    { ...base, id: "old", startDate: "2026-09-25", createdTime: 1000 },
    { ...base, id: "new", startDate: "2026-09-25", createdTime: 2000 },
    { ...base, id: "nodate", startDate: null, createdTime: 9999 },
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ["new", "old", "nodate"]);
});

test("armUrls falls back to the joinhomebase path", () => {
  assert.deepEqual(armUrls(scheduling, "/free-employee-scheduling-app-lp"), {
    control: "https://www.joinhomebase.com/free-employee-scheduling-app-lp",
    test: "https://www.joinhomebase.com/free-employee-scheduling-app-lp",
  });
  assert.deepEqual(
    armUrls(exp({ groups: [
      { name: "control", id: "c1", size: 50, isControl: true, parameterValues: { destination_url: "https://www.joinhomebase.com/free-time-clock-app-lp?arm=c" } },
      { name: "test", id: "t1", size: 50, parameterValues: { destination_url: "https://www.joinhomebase.com/free-time-clock-app-lp?arm=t" } },
    ] }), null),
    {
      control: "https://www.joinhomebase.com/free-time-clock-app-lp?arm=c",
      test: "https://www.joinhomebase.com/free-time-clock-app-lp?arm=t",
    },
  );
});

// ---------------------------------------------------------------------------
// Amplitude overlay (live results instead of Statsig's daily sync)
// ---------------------------------------------------------------------------

function arms(control: [number, number], test: [number, number]): ArmResults {
  return {
    control: { visitors: control[0], signups: control[1], daily: [] },
    test: { visitors: test[0], signups: test[1], daily: [] },
  };
}

test("twoProportionPValue matches a two-sided z-test with pooled variance", () => {
  // 200/10000 vs 260/10000 → z ≈ 2.83, p ≈ 0.0047
  assert.equal(twoProportionPValue(200, 10000, 260, 10000)!.toFixed(4), "0.0047");
  // identical rates → p = 1
  assert.ok(Math.abs(twoProportionPValue(20, 1000, 20, 1000)! - 1) < 1e-6);
  // no traffic or no conversions anywhere → no test
  assert.equal(twoProportionPValue(0, 0, 5, 100), null);
  assert.equal(twoProportionPValue(0, 100, 0, 100), null);
});

test("withAmplitude replaces rates, lift, verdict and sign ups, keeps Statsig's 1D1", () => {
  const statsig = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  const item = withAmplitude(statsig, arms([10000, 200], [10000, 260]));
  assert.equal(item.resultsSource, "amplitude");
  assert.equal(item.controlRate, 2);
  assert.equal(item.testRate, 2.6);
  assert.equal(item.lift!.toFixed(1), "30.0");
  assert.equal(item.pValue!.toFixed(4), "0.0047");
  assert.equal(item.verdict, "winning");
  assert.equal(item.controlN, 10000);
  assert.equal(item.testN, 10000);
  assert.deepEqual(item.tagline, { state: "ahead", text: "Variant is ahead", reason: "+30% sign ups" });
  assert.deepEqual(
    item.results.map((r) => [r.label, r.control, r.test, r.source]),
    [
      ["Sign ups", 200, 260, "amplitude"],
      ["1D1s", 16, 19, "statsig"],
    ],
  );
});

test("withAmplitude calls a significant drop a loss and a noisy gap no signal", () => {
  const statsig = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  assert.equal(withAmplitude(statsig, arms([10000, 260], [10000, 200])).verdict, "losing");
  assert.equal(withAmplitude(statsig, arms([1000, 20], [1000, 24])).verdict, "no-signal");
});

test("withAmplitude leaves the Statsig item alone when an arm has no visitors", () => {
  const statsig = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  assert.equal(withAmplitude(statsig, arms([0, 0], [0, 0])), statsig);
  assert.equal(withAmplitude(statsig, arms([100, 2], [0, 0])), statsig);
});

test("toListItem marks Statsig as the results source", () => {
  const item = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  assert.equal(item.resultsSource, "statsig");
  assert.ok(item.results.every((r) => r.source === "statsig"));
});

test("withAmplitude uses Statsig's adjusted alpha when the pulse has one", () => {
  const statsig = { ...toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12)), alpha: 0.001 };
  // p ≈ 0.0047: significant at 0.05, not at 0.001
  assert.equal(withAmplitude(statsig, arms([10000, 200], [10000, 260])).verdict, "no-signal");
});

test("withAmplitude calls a win when control has no sign ups but test clearly does", () => {
  const statsig = toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12));
  const item = withAmplitude(statsig, arms([5000, 0], [5000, 40]));
  assert.equal(item.lift, null);
  assert.equal(item.verdict, "winning");
});

test("pickDecision prices the daily cost on Statsig's full traffic, not Amplitude's consented visitors", () => {
  const statsig = { ...toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12)), statsigTestN: 20000, day: 10 };
  const losing = withAmplitude(statsig, arms([10000, 260], [10000, 200]));
  // (2.6% − 2.0%) × 20,000 / 10 days = 12 a day (Amplitude's 10,000 would say 6)
  assert.match(pickDecision([losing])!.body, /roughly 12 owner sign ups a day/);
});

test("buildKpis says where the sign-up numbers come from", () => {
  const amp = { ...base, status: "live" as const, results: [{ label: "Sign ups", control: 1, test: 2, controlRate: 1, testRate: 2, lift: 100, source: "amplitude" as const }] };
  const sig = { ...base, status: "live" as const, results: [{ label: "Sign ups", control: 3, test: 4, controlRate: 1, testRate: 2, lift: 100, source: "statsig" as const }] };
  const opts = { visitors7d: null, milestone: null, today: "2026-10-09" };
  const ctx = (items: ExperimentListItem[]) => buildKpis(items, opts).find((k) => k.id === "signups")!.context;
  assert.equal(ctx([amp]), "Control 1 · Test 2 · Amplitude, live");
  assert.equal(ctx([amp, sig]), "Control 4 · Test 6 · Amplitude + Statsig");
  assert.equal(ctx([sig]), "Control 3 · Test 4");
});

test("trafficLabel and sourceLabel name the source", () => {
  assert.equal(trafficLabel("amplitude"), "Visitors");
  assert.equal(trafficLabel("statsig"), "Exposures");
  assert.match(sourceLabel("amplitude"), /Amplitude, live/);
  assert.match(sourceLabel("statsig"), /updated daily/);
});

test("withAmplitude's tagline speaks of sign ups whatever Statsig's primary metric is", () => {
  const statsig = { ...toListItem(scheduling, schedulingPulse, Date.UTC(2026, 9, 4, 12)), primaryMetric: "1D1" };
  assert.equal(withAmplitude(statsig, arms([10000, 200], [10000, 260])).tagline.reason, "+30% sign ups");
});

test("pickDecision leaves the daily cost out when Amplitude has no Statsig traffic count", () => {
  const statsig = { ...toListItem(scheduling, undefined, Date.UTC(2026, 9, 4, 12)), statsigTestN: null, day: 10 };
  const losing = withAmplitude(statsig, arms([10000, 260], [10000, 200]));
  assert.doesNotMatch(pickDecision([losing])!.body, /a day/);
});

test("toCsv says where each row's results come from", () => {
  const csv = toCsv([{ ...base, resultsSource: "amplitude" }, base]);
  assert.match(csv.split("\n")[0], /Test n,Results source,Progress/);
  assert.match(csv.split("\n")[1], /"Amplitude \(consented visitors\)"/);
  assert.match(csv.split("\n")[2], /"Statsig"/);
});
