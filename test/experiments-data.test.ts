import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  amplitudeBudget,
  getExperimentDetail,
  getExperimentsPage,
  loadExperimentsNav,
  resetExperimentsCacheForTests,
} from "../src/lib/experiments";
import { resetArmResultsCacheForTests } from "../src/lib/experiment-amplitude";
import { handleDetail } from "../src/lib/experiments-route";
import type { ExperimentDetail } from "../src/lib/experiments-types";
import type {
  CumulativeExposuresDto,
  ExperimentPulseResultsDto,
  ExternalExperimentDto,
} from "../src/lib/statsig-types";

// Env is always explicit here — the test never reads .env.local, and the
// Linear milestone lookup sees LINEAR_API_KEY unset (restored in afterEach).
const ENV = { STATSIG_CONSOLE_API_KEY: "console-test" };
const NOW = Date.UTC(2026, 9, 5, 12); // Mon 2026-10-05 12:00 UTC

const originalFetch = globalThis.fetch;
const originalLinearKey = process.env.LINEAR_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLinearKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = originalLinearKey;
  resetExperimentsCacheForTests();
  resetArmResultsCacheForTests();
});

// ---------------------------------------------------------------------------
// fetch router: records every Statsig request, routes by URL path. The Linear
// relay (no LINEAR_API_KEY) is stubbed to fail without being recorded, so the
// milestone KPI degrades to "—" and only Statsig traffic shows up in requests.
// ---------------------------------------------------------------------------

let requests: { method: string; url: string }[] = [];
let router: (url: URL) => Response = () => new Response("no route", { status: 404 });

function installFetch() {
  requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://statsigapi.net") {
      requests.push({ method: init?.method ?? "GET", url: url.toString() });
    }
    return router(url);
  };
}

function data(payload: unknown, status = 200): Response {
  return Response.json({ data: payload }, { status });
}

// --- fixtures --------------------------------------------------------------

const SCHEDULING_ID = "exp_free_employee_scheduling_app_lp_module";

function schedulingDto(): ExternalExperimentDto {
  return {
    id: SCHEDULING_ID,
    name: SCHEDULING_ID,
    status: "active",
    startTime: Date.UTC(2026, 8, 25),
    duration: 28,
    description:
      'A/B test on /free-employee-scheduling-app-lp: "module" varies between the groups.',
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
  };
}

/** The Task 1 pulse values for the scheduling experiment. */
const schedulingPulse: ExperimentPulseResultsDto = {
  ds: "2026-10-05",
  primaryMetrics: [
    {
      metricID: "Owner Signups::user_warehouse",
      metricName: "Owner Signups",
      directionality: "increase",
      controlMean: 0.02086981903093987,
      testMean: 0.02024811065164694,
      controlUnits: 6852,
      testUnits: 7013,
      percentChange: -2.9789830873532517,
      pValue: 0.7964795069605728,
      adjustedAlpha: 0.05,
    },
  ],
  secondaryMetrics: [
    {
      metricID: "1D1::user_warehouse",
      metricName: "1D1",
      directionality: "increase",
      controlMean: 0.11188811188811189,
      testMean: 0.1347517730496454,
      controlUnits: 143,
      testUnits: 141,
      percentChange: 20.43439716312057,
      pValue: 0.5578,
    },
  ],
};

function gooseDto(): ExternalExperimentDto {
  return {
    id: "exp_goose_h1",
    name: "exp_goose_h1",
    status: "setup",
    groups: [
      { name: "control", id: "gc", size: 50, isControl: true, parameterValues: {} },
      { name: "test", id: "gt", size: 50, parameterValues: {} },
    ],
  };
}

const archivedDto: ExternalExperimentDto = {
  id: "archived_one",
  name: "archived_one",
  status: "archived",
  groups: [],
};

function listDtos(): ExternalExperimentDto[] {
  return [schedulingDto(), gooseDto(), archivedDto];
}

function pageCumulative(): CumulativeExposuresDto[] {
  return [
    {
      groupID: "c1",
      groupName: "control",
      results: [
        { date: "2026-09-27", exposures: 1507 },
        { date: "2026-10-04", exposures: 6852 },
      ],
    },
    {
      groupID: "t1",
      groupName: "test",
      results: [
        { date: "2026-09-27", exposures: 1549 },
        { date: "2026-10-04", exposures: 7013 },
      ],
    },
  ];
}

function detailCumulative(): CumulativeExposuresDto[] {
  return [
    {
      groupID: "c1",
      groupName: "control",
      results: [
        { date: "2026-09-25", exposures: 566 },
        { date: "2026-09-26", exposures: 1075 },
        { date: "2026-09-27", exposures: 1507 },
      ],
    },
    {
      groupID: "t1",
      groupName: "test",
      results: [
        { date: "2026-09-25", exposures: 587 },
        { date: "2026-09-26", exposures: 1087 },
        { date: "2026-09-27", exposures: 1549 },
      ],
    },
  ];
}

/** Cumulative signups per date, built as mean = n/units with that day's units. */
const detailDays: Record<string, { control: number; test: number; controlUnits: number; testUnits: number }> = {
  "2026-09-25": { control: 10, test: 5, controlUnits: 566, testUnits: 587 },
  "2026-09-26": { control: 26, test: 10, controlUnits: 1075, testUnits: 1087 },
  "2026-09-27": { control: 42, test: 20, controlUnits: 1507, testUnits: 1549 },
};

function datedPulse(date: string): ExperimentPulseResultsDto {
  const day = detailDays[date];
  if (!day) throw new Error(`no fixture for ${date}`);
  return {
    ds: date,
    primaryMetrics: [
      {
        metricID: "Owner Signups::user_warehouse",
        metricName: "Owner Signups",
        directionality: "increase",
        controlMean: day.control / day.controlUnits,
        testMean: day.test / day.testUnits,
        controlUnits: day.controlUnits,
        testUnits: day.testUnits,
      },
    ],
  };
}

function standardRouter(opts: { listStatus?: number; cumulative?: CumulativeExposuresDto[] } = {}) {
  router = (url) => {
    const path = url.pathname;
    if (path === "/console/v1/experiments") {
      return data(listDtos(), opts.listStatus ?? 200);
    }
    const pulse = path.match(/^\/console\/v1\/experiments\/([^/]+)\/pulse_results$/);
    if (pulse) {
      if (pulse[1] !== SCHEDULING_ID) return new Response("unknown experiment", { status: 404 });
      const date = url.searchParams.get("date");
      return date ? data(datedPulse(date)) : data(schedulingPulse);
    }
    if (path === `/console/v1/experiments/${SCHEDULING_ID}/cumulative_exposures`) {
      return data(opts.cumulative ?? pageCumulative());
    }
    // Linear relay with no LINEAR_API_KEY: unavailable, so the milestone is "—".
    if (path.startsWith("/api/projects/")) {
      return new Response("linear unavailable", { status: 503 });
    }
    return new Response(`no route for ${path}`, { status: 404 });
  };
}

// --- tests -----------------------------------------------------------------

test("getExperimentsPage returns null without a key", async () => {
  installFetch();
  router = () => {
    throw new Error("no fetch expected without a key");
  };
  assert.equal(await getExperimentsPage({}, NOW), null);
  assert.equal(requests.length, 0);
});

test("getExperimentsPage builds the model", async () => {
  installFetch();
  standardRouter();
  const page = await getExperimentsPage(ENV, NOW);
  assert.ok(page);

  // archived dropped, live before draft
  assert.deepEqual(
    page.experiments.map((i) => i.id),
    [SCHEDULING_ID, "exp_goose_h1"],
  );
  assert.equal(page.experiments[0].status, "live");
  assert.equal(page.experiments[0].controlN, 6852);
  assert.equal(page.experiments[0].verdict, "no-signal");
  assert.equal(page.experiments[1].status, "draft");

  // visitors in test · 7d: (6852−1507) + (7013−1549) = 5345 + 5464
  assert.equal(page.kpis[2].value, "10,809");
  // Linear unavailable → milestone shows "—"
  assert.equal(page.kpis[4].value, "—");
  // nothing is losing → no decision banner
  assert.equal(page.decision, null);

  assert.deepEqual(page.sync, { ok: true, at: "2026-10-05T12:00:00.000Z" });
  assert.equal(page.today, "2026-10-05");
  assert.deepEqual(page.week, { start: "2026-10-05", end: "2026-10-11" });
});

test("only GET requests reach Statsig", async () => {
  installFetch();
  standardRouter();
  await getExperimentsPage(ENV, NOW);
  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.match(request.url, /^https:\/\/statsigapi\.net\/console\/v1\//);
    assert.ok(request.method === "GET" || request.method === undefined, request.method);
  }
});

test("getExperimentsPage throws when the list fails cold, serves cache when warm", async () => {
  installFetch();
  standardRouter({ listStatus: 500 });
  await assert.rejects(getExperimentsPage(ENV, NOW), /500/);

  // past the 2-minute failure TTL, a good list populates the cache
  standardRouter();
  const warm = await getExperimentsPage(ENV, NOW + 3 * 60 * 1000);
  assert.ok(warm);

  // 61 minutes later the entry is stale; a failing list still serves it
  standardRouter({ listStatus: 500 });
  const cached = await getExperimentsPage(ENV, NOW + 64 * 60 * 1000);
  assert.deepEqual(cached, warm);
});

test("a failed cumulative call is retried after 5 minutes, not served for an hour", async () => {
  installFetch();
  let cumulativeOk = false;
  router = (url) => {
    const path = url.pathname;
    if (path === "/console/v1/experiments") return data(listDtos());
    if (path === `/console/v1/experiments/${SCHEDULING_ID}/pulse_results`) {
      return data(schedulingPulse);
    }
    if (path === `/console/v1/experiments/${SCHEDULING_ID}/cumulative_exposures`) {
      return cumulativeOk
        ? data(pageCumulative())
        : new Response("cumulative failed", { status: 500 });
    }
    // Linear relay with no LINEAR_API_KEY: unavailable, so the milestone is "—".
    if (path.startsWith("/api/projects/")) {
      return new Response("linear unavailable", { status: 503 });
    }
    return new Response(`no route for ${path}`, { status: 404 });
  };
  const listCalls = () => requests.filter((r) => r.url.endsWith("experiments?limit=100")).length;

  // list + pulse succeed, cumulative fails → visitors7d "—" and the page is partial
  const partial = await getExperimentsPage(ENV, NOW);
  assert.ok(partial);
  assert.equal(partial.kpis[2].value, "—");
  assert.equal(listCalls(), 1);

  // within the 5-minute window the cached partial page is served as-is
  const withinWindow = await getExperimentsPage(ENV, NOW + 60 * 1000);
  assert.ok(withinWindow);
  assert.equal(withinWindow.kpis[2].value, "—");
  assert.equal(listCalls(), 1);

  // past the window the page is retried; cumulative still fails
  const retried = await getExperimentsPage(ENV, NOW + 6 * 60 * 1000);
  assert.ok(retried);
  assert.equal(retried.kpis[2].value, "—");
  assert.equal(listCalls(), 2);

  // once cumulative recovers, the next retry picks it up
  cumulativeOk = true;
  const recovered = await getExperimentsPage(ENV, NOW + 12 * 60 * 1000);
  assert.ok(recovered);
  assert.equal(recovered.kpis[2].value, "10,809");
  assert.equal(listCalls(), 3);
});

test("getExperimentDetail builds daily series and SRM", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  const detail = await getExperimentDetail(SCHEDULING_ID, ENV, NOW);
  assert.ok(detail);
  assert.deepEqual(detail.exposures, { control: 1507, test: 1549 });
  assert.equal(detail.srm?.ok, true);
  assert.ok(detail.daily);
  assert.deepEqual(
    detail.daily.map((d) => d.date),
    ["2026-09-25", "2026-09-26", "2026-09-27"],
  );
  assert.deepEqual(
    detail.daily.map((d) => d.exposures.control),
    [566, 509, 432],
  );
  assert.deepEqual(
    detail.daily.map((d) => d.signups.control),
    [10, 16, 16],
  );
  assert.deepEqual(
    detail.daily.map((d) => d.signups.test),
    [5, 5, 10],
  );
});

test("getExperimentDetail returns daily null when a dated pulse fails", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  const base = router;
  router = (url) => {
    if (url.pathname.endsWith("/pulse_results") && url.searchParams.get("date") === "2026-09-26") {
      return new Response("pulse failed", { status: 500 });
    }
    return base(url);
  };
  const detail = await getExperimentDetail(SCHEDULING_ID, ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.daily, null);
  assert.deepEqual(detail.exposures, { control: 1507, test: 1549 });
  assert.equal(detail.srm?.ok, true);
});

test("getExperimentDetail keeps srm null when one arm's cumulative series is empty", async () => {
  installFetch();
  standardRouter({ cumulative: [detailCumulative()[0]] }); // test arm missing entirely
  const detail = await getExperimentDetail(SCHEDULING_ID, ENV, NOW);
  assert.ok(detail);
  // no usable pair: exposures and SRM stay null instead of judging [0, N]
  assert.equal(detail.exposures, null);
  assert.equal(detail.srm, null);
  // the daily series still renders; the missing arm reads as 0 exposures
  assert.ok(detail.daily);
  assert.deepEqual(
    detail.daily.map((d) => d.exposures),
    [
      { control: 566, test: 0 },
      { control: 509, test: 0 },
      { control: 432, test: 0 },
    ],
  );
  assert.deepEqual(
    detail.daily.map((d) => d.signups.test),
    [5, 5, 10],
  );
});

test("getExperimentDetail keeps srm null when an arm's last exposure is 0", async () => {
  installFetch();
  const [control, test] = detailCumulative();
  standardRouter({
    cumulative: [control, { ...test, results: [{ date: "2026-09-27", exposures: 0 }] }],
  });
  const detail = await getExperimentDetail(SCHEDULING_ID, ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.exposures, null);
  assert.equal(detail.srm, null);
  assert.ok(detail.daily);
  assert.deepEqual(
    detail.daily.map((d) => d.exposures.test),
    [0, 0, 0],
  );
});

test("getExperimentDetail returns null for unknown or draft ids", async () => {
  installFetch();
  standardRouter();
  assert.equal(await getExperimentDetail("exp_unknown", ENV, NOW), null);
  assert.equal(await getExperimentDetail("exp_goose_h1", ENV, NOW), null);
});

// ---------------------------------------------------------------------------
// Daily signups when the cumulative series is longer than the 28-day window:
// the day before the window is fetched as a baseline so the first kept day
// diffs to a real per-day value instead of the cumulative total.
// ---------------------------------------------------------------------------

const LONG_ID = "exp_long_series";
const LONG_START = Date.UTC(2026, 8, 6); // 2026-09-06, 30 days through 2026-10-05
const longDates = Array.from({ length: 30 }, (_, i) =>
  new Date(LONG_START + i * 86400000).toISOString().slice(0, 10),
);

function longDto(): ExternalExperimentDto {
  return {
    id: LONG_ID,
    name: LONG_ID,
    status: "active",
    startTime: LONG_START,
    duration: 30,
    description: 'A/B test on /long-series-lp: "module" varies between the groups.',
    groups: [
      { name: "control", id: "c1", size: 50, isControl: true, parameterValues: {} },
      { name: "test", id: "t1", size: 50, parameterValues: {} },
    ],
  };
}

function longCumulative(): CumulativeExposuresDto[] {
  return [
    {
      groupID: "c1",
      groupName: "control",
      results: longDates.map((date, i) => ({ date, exposures: 100 * (i + 1) })),
    },
    {
      groupID: "t1",
      groupName: "test",
      results: longDates.map((date, i) => ({ date, exposures: 200 * (i + 1) })),
    },
  ];
}

/** Known per-day signups: control gets i+1 on day i, test gets 2 every day. */
function longDatedPulse(date: string): ExperimentPulseResultsDto {
  const i = longDates.indexOf(date);
  if (i < 0) throw new Error(`no long-series fixture for ${date}`);
  const cumulative = {
    // sum of (k+1) for k ≤ i
    control: ((i + 1) * (i + 2)) / 2,
    test: 2 * (i + 1),
  };
  const units = { control: 100 * (i + 1), test: 200 * (i + 1) };
  return {
    ds: date,
    primaryMetrics: [
      {
        metricID: "Owner Signups::user_warehouse",
        metricName: "Owner Signups",
        directionality: "increase",
        controlMean: cumulative.control / units.control,
        testMean: cumulative.test / units.test,
        controlUnits: units.control,
        testUnits: units.test,
      },
    ],
  };
}

test("daily signups diff from a baseline day when the series is longer than the window", async () => {
  installFetch();
  router = (url) => {
    const path = url.pathname;
    if (path === "/console/v1/experiments") return data([longDto()]);
    const pulse = path.match(/^\/console\/v1\/experiments\/([^/]+)\/pulse_results$/);
    if (pulse) {
      if (pulse[1] !== LONG_ID) return new Response("unknown experiment", { status: 404 });
      const date = url.searchParams.get("date");
      return date ? data(longDatedPulse(date)) : data(schedulingPulse);
    }
    if (path === `/console/v1/experiments/${LONG_ID}/cumulative_exposures`) {
      return data(longCumulative());
    }
    // Linear relay with no LINEAR_API_KEY: unavailable, so the milestone is "—".
    if (path.startsWith("/api/projects/")) {
      return new Response("linear unavailable", { status: 503 });
    }
    return new Response(`no route for ${path}`, { status: 404 });
  };

  const detail = await getExperimentDetail(LONG_ID, ENV, NOW);
  assert.ok(detail);
  assert.ok(detail.daily);
  const daily = detail.daily;

  // the kept window is the last 28 days of the 30-day series
  assert.deepEqual(daily.map((d) => d.date), longDates.slice(-28));
  // exposures stay per-day deltas of the full cumulative series
  assert.deepEqual(daily.map((d) => d.exposures.control), Array(28).fill(100));
  // signups: the first kept day is a real delta (3), not the cumulative total (6)
  assert.deepEqual(
    daily.map((d) => d.signups.control),
    Array.from({ length: 28 }, (_, i) => i + 3),
  );
  assert.deepEqual(daily.map((d) => d.signups.test), Array(28).fill(2));

  // one baseline day before the window plus the 28 kept days, nothing more
  const datedCalls = requests.filter(
    (r) => r.url.includes("pulse_results") && r.url.includes("date="),
  );
  assert.equal(datedCalls.length, 29);
  assert.ok(datedCalls[0].url.includes("date=2026-09-07"), datedCalls[0]?.url);
  assert.ok(datedCalls.every((r) => !r.url.includes("date=2026-09-06")));
});

// ---------------------------------------------------------------------------
// Detail API route handler (src/lib/experiments-route.ts)
// ---------------------------------------------------------------------------

const DETAIL: ExperimentDetail = {
  id: SCHEDULING_ID,
  exposures: { control: 1507, test: 1549 },
  srm: { ok: true, pValue: 0.8 },
  daily: [],
  dailySource: "statsig",
};

/** getDetail stub that records the ids it was called with. */
function getDetailStub(result: ExperimentDetail | null | Error) {
  const calls: string[] = [];
  return {
    calls,
    getDetail: async (id: string): Promise<ExperimentDetail | null> => {
      calls.push(id);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test("detail route returns 401 without a user", async () => {
  const stub = getDetailStub(DETAIL);
  const response = await handleDetail(SCHEDULING_ID, { user: null, getDetail: stub.getDetail });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(stub.calls, []);
});

test("detail route rejects unknown ids", async () => {
  const user = { email: "brian@joinhomebase.com" };

  // path-traversal-shaped id: rejected before any lookup
  const traversal = getDetailStub(DETAIL);
  const bad = await handleDetail("../etc", { user, getDetail: traversal.getDetail });
  assert.equal(bad.status, 404);
  assert.deepEqual(await bad.json(), { error: "Unknown experiment" });
  assert.equal(bad.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(traversal.calls, []);

  // well-formed id the loader doesn't know: still a 404
  const unknown = getDetailStub(null);
  const missing = await handleDetail("exp_unknown", { user, getDetail: unknown.getDetail });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Unknown experiment" });
  assert.equal(missing.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(unknown.calls, ["exp_unknown"]);
});

test("detail route returns 502 when the loader throws", async () => {
  const stub = getDetailStub(new Error("console down"));
  const response = await handleDetail(SCHEDULING_ID, {
    user: { email: "brian@joinhomebase.com" },
    getDetail: stub.getDetail,
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Statsig unavailable" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(stub.calls, [SCHEDULING_ID]);
});

test("detail route returns the detail JSON for a valid id", async () => {
  const stub = getDetailStub(DETAIL);
  const response = await handleDetail(SCHEDULING_ID, {
    user: { email: "brian@joinhomebase.com" },
    getDetail: stub.getDetail,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), DETAIL);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(stub.calls, [SCHEDULING_ID]);
});

// ---------------------------------------------------------------------------
// Live Amplitude results on top of the Statsig page
// ---------------------------------------------------------------------------

const AMP_ENV = { ...ENV, AMPLITUDE_API_KEY: "amp-key", AMPLITUDE_SECRET: "amp-secret" };

type AmpCall = { experiment: string; arm: string; start: string; end: string; filters: unknown[] };

/** Routes amplitude.com funnels to per-arm fixtures; everything else to the Statsig router. */
function withAmplitudeRoute(
  arms: Record<string, { visitors: number; signups: number; daily: [string, number, number][] }> | "fail",
): AmpCall[] {
  const calls: AmpCall[] = [];
  const statsig = router;
  router = (url) => {
    if (url.origin !== "https://amplitude.com") return statsig(url);
    const step = JSON.parse(url.searchParams.getAll("e")[0]) as {
      filters: { subprop_key: string; subprop_value: string[] }[];
    };
    const armFilter = step.filters[2];
    calls.push({
      experiment: armFilter.subprop_key,
      arm: armFilter.subprop_value[0],
      start: url.searchParams.get("start")!,
      end: url.searchParams.get("end")!,
      filters: step.filters,
    });
    if (arms === "fail") return new Response("amplitude down", { status: 503 });
    const arm = arms[armFilter.subprop_value[0]];
    return Response.json({
      data: [
        {
          cumulativeRaw: [arm.visitors, arm.signups],
          dayFunnels: {
            xValues: arm.daily.map((d) => d[0]),
            series: arm.daily.map((d) => [d[1], d[2]]),
          },
        },
      ],
    });
  };
  return calls;
}

const AMP_ARMS = {
  "0": { visitors: 10000, signups: 260, daily: [["2026-10-04", 600, 15], ["2026-10-05", 300, 6]] as [string, number, number][] },
  "1": { visitors: 10000, signups: 200, daily: [["2026-10-04", 610, 11], ["2026-10-05", 310, 4]] as [string, number, number][] },
};

test("live experiments read sign-up results from Amplitude, from start through today", async () => {
  installFetch();
  standardRouter();
  const calls = withAmplitudeRoute(AMP_ARMS);
  const page = await getExperimentsPage(AMP_ENV, NOW);
  assert.ok(page);

  const live = page.experiments[0];
  assert.equal(live.resultsSource, "amplitude");
  assert.equal(live.controlRate, 2.6);
  assert.equal(live.testRate, 2);
  assert.equal(live.verdict, "losing");
  // 1D1 still comes from Statsig
  assert.deepEqual(
    live.results.map((r) => [r.label, r.source]),
    [
      ["Sign ups", "amplitude"],
      ["1D1s", "statsig"],
    ],
  );
  // the drafted experiment is never sent to Amplitude
  assert.equal(page.experiments[1].resultsSource, "statsig");

  assert.deepEqual(
    calls.map((c) => [c.experiment, c.arm, c.start, c.end]).sort(),
    [
      [SCHEDULING_ID, "0", "20260925", "20261005"],
      [SCHEDULING_ID, "1", "20260925", "20261005"],
    ],
  );
  // KPIs and the decision banner follow the live numbers
  assert.equal(page.kpis.find((k) => k.id === "signups")?.value, "460");
  assert.equal(page.kpis.find((k) => k.id === "significant")?.value, "1");
  assert.equal(page.decision?.experimentId, SCHEDULING_ID);
  // the daily cost uses Statsig's 7,013 test units over 10 days: 0.6% × 7,013 / 10 ≈ 4
  assert.match(page.decision?.body ?? "", /roughly 4 owner sign ups a day/);
});

test("an Amplitude failure falls back to Statsig's results", async () => {
  installFetch();
  standardRouter();
  withAmplitudeRoute("fail");
  const page = await getExperimentsPage(AMP_ENV, NOW);
  assert.ok(page);
  assert.deepEqual(page.experiments[0], (await statsigOnlyPage()).experiments[0]);
});

test("the detail panel's daily series comes from Amplitude when it is available", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  withAmplitudeRoute(AMP_ARMS);
  const detail = await getExperimentDetail(SCHEDULING_ID, AMP_ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.dailySource, "amplitude");
  assert.deepEqual(detail.daily, [
    { date: "2026-10-04", exposures: { control: 600, test: 610 }, signups: { control: 15, test: 11 } },
    { date: "2026-10-05", exposures: { control: 300, test: 310 }, signups: { control: 6, test: 4 } },
  ]);
  // traffic split and SRM still come from Statsig's exposures
  assert.deepEqual(detail.exposures, { control: 1507, test: 1549 });
  // no dated Statsig pulses are needed for the daily series
  assert.equal(requests.filter((r) => new URL(r.url).searchParams.has("date")).length, 0);
});

/** The page as it reads with no Amplitude keys, for comparing fallbacks against. */
async function statsigOnlyPage() {
  const saved = router;
  resetExperimentsCacheForTests();
  standardRouter();
  const page = await getExperimentsPage(ENV, NOW);
  router = saved;
  resetExperimentsCacheForTests();
  assert.ok(page);
  return page;
}

/**
 * Holds every Amplitude call until release() answers them all with AMP_ARMS.
 * The Statsig fetch keeps its normal routing.
 */
function holdAmplitude() {
  const statsigFetch = globalThis.fetch;
  const held: (() => void)[] = [];
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://amplitude.com") return statsigFetch(input, init);
    calls += 1;
    const arm = JSON.parse(url.searchParams.getAll("e")[0]).filters[2].subprop_value[0] as "0" | "1";
    const fixture = AMP_ARMS[arm];
    return new Promise<Response>((resolve) =>
      held.push(() =>
        resolve(
          Response.json({
            data: [
              {
                cumulativeRaw: [fixture.visitors, fixture.signups],
                dayFunnels: {
                  xValues: fixture.daily.map((d) => d[0]),
                  series: fixture.daily.map((d) => [d[1], d[2]]),
                },
              },
            ],
          }),
        ),
      ),
    );
  };
  return {
    calls: () => calls,
    release: async () => {
      // answers calls queued behind the concurrency cap as they start
      for (let i = 0; i < 50 && (held.length > 0 || calls < 2); i++) {
        held.splice(0).forEach((answer) => answer());
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}

test("Amplitude slower than the budget falls back to Statsig without holding the page", async () => {
  installFetch();
  standardRouter();
  const amplitude = holdAmplitude();
  const savedBudget = amplitudeBudget.ms;
  amplitudeBudget.ms = 20;
  try {
    // the held call never answers on its own, so only the budget can end the wait
    const page = await getExperimentsPage(AMP_ENV, NOW);
    assert.ok(amplitude.calls() > 0);
    assert.equal(page?.experiments[0].resultsSource, "statsig");
  } finally {
    amplitudeBudget.ms = savedBudget;
    await amplitude.release();
  }
});

test("a refresh slower than the budget shows the last good Amplitude result", async () => {
  installFetch();
  standardRouter();
  withAmplitudeRoute(AMP_ARMS);
  const warm = await getExperimentsPage(AMP_ENV, NOW);
  assert.equal(warm?.experiments[0].resultsSource, "amplitude");

  // 16 minutes on the cache is stale; the refresh hangs past the budget
  const amplitude = holdAmplitude();
  const savedBudget = amplitudeBudget.ms;
  amplitudeBudget.ms = 20;
  try {
    const page = await getExperimentsPage(AMP_ENV, NOW + 16 * 60_000);
    assert.ok(amplitude.calls() > 0);
    assert.equal(page?.experiments[0].resultsSource, "amplitude");
    assert.equal(page?.experiments[0].controlRate, 2.6);
  } finally {
    amplitudeBudget.ms = savedBudget;
    await amplitude.release();
  }
});

test("an arm with no Amplitude visitors keeps Statsig's results", async () => {
  installFetch();
  standardRouter();
  withAmplitudeRoute({ "0": AMP_ARMS["0"], "1": { visitors: 0, signups: 0, daily: [] } });
  const page = await getExperimentsPage(AMP_ENV, NOW);
  assert.equal(page?.experiments[0].resultsSource, "statsig");
});

test("an experiment Amplitude has no visitors for keeps Statsig's results", async () => {
  installFetch();
  standardRouter();
  withAmplitudeRoute({
    "0": { visitors: 0, signups: 0, daily: [] },
    "1": { visitors: 0, signups: 0, daily: [] },
  });
  const page = await getExperimentsPage(AMP_ENV, NOW);
  assert.ok(page);
  assert.equal(page.experiments[0].resultsSource, "statsig");
  assert.equal(page.experiments[0].controlN, 6852);
});

test("concluded experiments never query Amplitude", async () => {
  installFetch();
  standardRouter();
  const base = router;
  router = (url) =>
    url.pathname === "/console/v1/experiments"
      ? data([{ ...schedulingDto(), status: "decision_made" }])
      : base(url);
  const calls = withAmplitudeRoute(AMP_ARMS);
  const page = await getExperimentsPage(AMP_ENV, NOW);
  assert.equal(page?.experiments[0].status, "concluded");
  assert.equal(page?.experiments[0].resultsSource, "statsig");
  assert.equal(calls.length, 0);
});

test("the detail panel falls back to Statsig's daily series when Amplitude fails", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  withAmplitudeRoute("fail");
  const detail = await getExperimentDetail(SCHEDULING_ID, AMP_ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.dailySource, "statsig");
  assert.equal(detail.totals, undefined);
  assert.deepEqual(
    detail.daily?.map((d) => d.signups.control),
    [10, 16, 16],
  );
});

test("the detail panel keeps Amplitude's series when Statsig's exposures fail", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  const base = router;
  router = (url) =>
    url.pathname.endsWith("/cumulative_exposures") ? new Response("down", { status: 500 }) : base(url);
  withAmplitudeRoute(AMP_ARMS);
  const detail = await getExperimentDetail(SCHEDULING_ID, AMP_ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.dailySource, "amplitude");
  assert.equal(detail.exposures, null);
  assert.equal(detail.daily?.length, 2);
});

test("the Amplitude daily series covers dates either arm has, with whole-run totals", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  withAmplitudeRoute({
    "0": { visitors: 900, signups: 20, daily: [["2026-10-04", 600, 15]] },
    "1": { visitors: 920, signups: 15, daily: [["2026-10-04", 610, 11], ["2026-10-05", 310, 4]] },
  });
  const detail = await getExperimentDetail(SCHEDULING_ID, AMP_ENV, NOW);
  assert.ok(detail);
  assert.deepEqual(detail.daily, [
    { date: "2026-10-04", exposures: { control: 600, test: 610 }, signups: { control: 15, test: 11 } },
    { date: "2026-10-05", exposures: { control: 0, test: 310 }, signups: { control: 0, test: 4 } },
  ]);
  // unique visitors over the run, not the sum of daily uniques
  assert.deepEqual(detail.totals, {
    control: { visitors: 900, signups: 20 },
    test: { visitors: 920, signups: 15 },
  });
});

/** Runs `fn` with the Amplitude + Statsig keys in process.env (loadExperimentsNav reads it). */
async function withProcessEnv(fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(AMP_ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, AMP_ENV);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the sidebar nav gives up on a slow Amplitude after its short budget", { timeout: 2_000 }, async () => {
  installFetch();
  standardRouter();
  const amplitude = holdAmplitude();
  const saved = { ...amplitudeBudget };
  amplitudeBudget.ms = 60_000;
  amplitudeBudget.navMs = 20;
  try {
    await withProcessEnv(async () => {
      // the held call never answers, so only the nav budget can end the wait
      const nav = await loadExperimentsNav();
      assert.ok(amplitude.calls() > 0);
      assert.equal(nav?.counts.live, 1);
      // Statsig calls the scheduling test not significant: no decision needed
      assert.equal(nav?.counts.decision, 0);
    });
  } finally {
    Object.assign(amplitudeBudget, saved);
    await amplitude.release();
  }
});

test("the sidebar nav uses the last good Amplitude result when a refresh is slow", async () => {
  installFetch();
  standardRouter();
  withAmplitudeRoute(AMP_ARMS);
  await withProcessEnv(async () => {
    await getExperimentsPage(AMP_ENV, Date.now());
  });
  const amplitude = holdAmplitude();
  const saved = { ...amplitudeBudget };
  amplitudeBudget.ms = 60_000;
  amplitudeBudget.navMs = 20;
  try {
    await withProcessEnv(async () => {
      // past the 15-minute TTL the refresh is held; Amplitude's "losing" call still shows
      const realNow = Date.now;
      Date.now = () => realNow() + 16 * 60_000;
      try {
        const nav = await loadExperimentsNav();
        assert.equal(nav?.counts.decision, 1);
      } finally {
        Date.now = realNow;
      }
    });
  } finally {
    Object.assign(amplitudeBudget, saved);
    await amplitude.release();
  }
});

test("the detail panel keeps Statsig's daily series when an Amplitude arm has no visitors", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  withAmplitudeRoute({ "0": AMP_ARMS["0"], "1": { visitors: 0, signups: 0, daily: [] } });
  const detail = await getExperimentDetail(SCHEDULING_ID, AMP_ENV, NOW);
  assert.ok(detail);
  assert.equal(detail.dailySource, "statsig");
  assert.equal(detail.totals, undefined);
});

test("without Amplitude, the detail panel fetches Statsig's exposures once", async () => {
  installFetch();
  standardRouter({ cumulative: detailCumulative() });
  // the page's 7-day visitors KPI makes the first exposures call; the detail adds one
  await getExperimentsPage(ENV, NOW);
  const exposureCalls = () => requests.filter((r) => r.url.endsWith("/cumulative_exposures")).length;
  const beforeDetail = exposureCalls();
  await getExperimentDetail(SCHEDULING_ID, ENV, NOW);
  assert.equal(exposureCalls() - beforeDetail, 1);
});

test("a slow Statsig load shrinks the Amplitude wait so the page meets its deadline", { timeout: 2_000 }, async () => {
  installFetch();
  standardRouter();
  const amplitude = holdAmplitude();
  const saved = { ...amplitudeBudget };
  const realNow = Date.now;
  amplitudeBudget.ms = 60_000;
  // the Statsig half "takes" 25s: every clock read after the first is 25s later
  const t0 = realNow();
  let reads = 0;
  Date.now = () => (reads++ === 0 ? t0 : realNow() + 25_000);
  try {
    // without the deadline this would wait the full 60s budget on the held call
    const page = await getExperimentsPage(AMP_ENV, NOW);
    assert.ok(amplitude.calls() > 0);
    assert.equal(page?.experiments[0].resultsSource, "statsig");
  } finally {
    Date.now = realNow;
    Object.assign(amplitudeBudget, saved);
    await amplitude.release();
  }
});
