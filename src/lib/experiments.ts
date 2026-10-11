import "server-only";

/**
 * Server data loader for the Experiments (A/B testing) tab. Everything on the
 * page comes from the Statsig Console API (auth and base client in statsig.ts):
 *
 *   GET /console/v1/experiments?limit=100
 *       every experiment, all statuses → the table (hub statuses only)
 *   GET /console/v1/experiments/{id}/pulse_results?control=..&test=..
 *       headline results per experiment
 *   GET /console/v1/experiments/{id}/pulse_results?…&date=YYYY-MM-DD
 *       cumulative results as of a past day → daily signups (detail panel)
 *   GET /console/v1/experiments/{id}/cumulative_exposures
 *       cumulative exposures per group per day → daily exposures and the
 *       "Visitors in test · 7d" KPI
 *
 * The "M1 · First live experiments" KPI comes from the Linear ab-testing
 * project (linear-projects.ts); Linear being down only blanks that cell.
 *
 * Caching is ttlCache: page and details for an hour, last good value for 2
 * minutes after a failure, and a page whose Statsig calls partially failed is
 * retried after 5 minutes instead of served for the full hour (see partialUntil
 * below).
 *
 * Statsig's results only refresh once a day (its Databricks sync), so live
 * experiments take their sign-up results from Amplitude instead
 * (experiment-amplitude.ts, cached 15 minutes): rates, lift, significance,
 * the sign-up KPI and the detail panel's daily series. That overlay is applied
 * on every read, on top of the hourly Statsig cache. An experiment keeps
 * Statsig's numbers when its Amplitude call fails, when it runs past
 * amplitudeBudget with no earlier result cached, or when Amplitude saw no
 * visitors in one of its arms.
 */
import { after } from "next/server";
import { cache } from "react";

import { amplitudeConfig } from "./amplitude";
import { getArmResults, lastArmResults } from "./experiment-amplitude";
import {
  buildKpis,
  buildNav,
  dailyFromCumulative,
  hubStatus,
  pickDecision,
  srm,
  sortExperiments,
  toListItem,
  withAmplitude,
} from "./experiments-derive";
import type {
  ArmResults,
  DailyPoint,
  ExperimentDetail,
  ExperimentListItem,
  ExperimentsNav,
  ExperimentsPage,
} from "./experiments-types";
import { getProjectOverview } from "./linear-projects";
import { nextMilestone } from "./milestones";
import { consoleGet, pickArms, statsigConfig } from "./statsig";
import { shiftDate, torontoToday } from "./standup";
import type {
  CumulativeExposuresDto,
  ExperimentPulseResultsDto,
  ExternalExperimentDto,
} from "./statsig-types";
import { trackerProject } from "./tracker-projects";
import { ttlCache } from "./ttl-cache";

const PAGE_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
/** A page with some failed Statsig calls is retried sooner than a clean one. */
const PARTIAL_TTL_MS = 5 * 60 * 1000;
/** Dated pulse calls per detail, run at most this many at a time. */
const DATED_PULSE_CONCURRENCY = 6;
/** Days of daily detail kept, like the design's 28-day series cap. */
const DETAIL_DAYS = 28;
/**
 * How long a page or detail load waits on Amplitude before showing Statsig's
 * numbers instead. The slow call keeps running and fills the cache for the
 * next load. The sidebar nav, rendered on every tab, waits much less.
 * Mutable for tests.
 */
export const amplitudeBudget = { ms: 10_000, navMs: 1_500 };
/** Statsig plus Amplitude must fit well inside the Experiments page's 30s maxDuration. */
const PAGE_DEADLINE_MS = 25_000;

/**
 * Keep a call the response no longer waits for running until it settles, so
 * it still fills the cache on serverless hosts that suspend after responding.
 * Outside a request (tests, scripts) the call simply runs on.
 */
function keepAlive(promise: Promise<unknown>): void {
  try {
    after(() => promise.then(() => undefined, () => undefined));
  } catch {
    // not inside a Next request scope
  }
}

type PageKey = { apiKey: string; now: number };
type DetailKey = { id: string; apiKey: string; now: number };
/**
 * The Statsig half of the page, cached for the hour: list items with Statsig's
 * results, the inputs the KPIs need, and the raw DTOs (the detail panel needs
 * the group ids). The Amplitude overlay is applied per read.
 */
type PageValue = {
  items: ExperimentListItem[];
  visitors7d: { control: number; test: number } | null;
  milestone: { progress: number; targetDate: string | null } | null;
  syncedAt: number;
  dtos: ExternalExperimentDto[];
};
type Split = Pick<ExperimentDetail, "exposures" | "srm">;
type Point = { date: string; value: number };

let partialUntil = 0;
let pageCache = newPageCache();
let detailCache = newDetailCache();
let splitCache = newSplitCache();

function newPageCache() {
  return ttlCache<PageKey, PageValue>(
    ({ apiKey, now }) => loadPage(apiKey, now),
    { ttlMs: PAGE_TTL_MS, failureTtlMs: FAILURE_TTL_MS, keyOf: () => "page" },
  );
}

function newDetailCache() {
  return ttlCache<DetailKey, ExperimentDetail | null>(
    ({ id, apiKey, now }) => loadDetail(id, apiKey, now),
    { ttlMs: PAGE_TTL_MS, failureTtlMs: FAILURE_TTL_MS, keyOf: ({ id }) => id },
  );
}

function newSplitCache() {
  return ttlCache<DetailKey, Split | null>(
    ({ id, apiKey, now }) => loadSplit(id, apiKey, now),
    { ttlMs: PAGE_TTL_MS, failureTtlMs: FAILURE_TTL_MS, keyOf: ({ id }) => id },
  );
}

export function resetExperimentsCacheForTests(): void {
  pageCache = newPageCache();
  detailCache = newDetailCache();
  splitCache = newSplitCache();
  partialUntil = 0;
}

/**
 * The whole Experiments page, or null when no Console key is configured.
 * `budgetMs` caps the wait on Amplitude (the sidebar nav, shown on every tab,
 * passes a short one).
 */
export async function getExperimentsPage(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
  budgetMs: number = amplitudeBudget.ms,
): Promise<ExperimentsPage | null> {
  const config = statsigConfig(env);
  if (!config) return null;
  const startedAt = Date.now();
  const value = await pageValue(config.apiKey, now);
  // a slow Statsig load leaves less time for Amplitude, so the page stays
  // inside its 30s maxDuration and renders Statsig's numbers instead of a 504
  const remaining = Math.max(0, Math.min(budgetMs, startedAt + PAGE_DEADLINE_MS - Date.now()));

  const items = await Promise.all(
    value.items.map(async (item) => {
      const amp = await liveArmResults(item, env, now, remaining);
      return amp ? withAmplitude(item, amp) : item;
    }),
  );
  const today = torontoToday(new Date(now));
  return {
    today,
    week: weekContaining(today),
    sync: { ok: true, at: new Date(value.syncedAt).toISOString() },
    experiments: items,
    kpis: buildKpis(items, { visitors7d: value.visitors7d, milestone: value.milestone, today }),
    decision: pickDecision(items),
  };
}

/**
 * One experiment's daily detail. Queued and draft experiments use list data
 * only, so they return null here like unknown ids do. With Amplitude
 * available, the daily series is its live visitors and sign ups and only the
 * traffic split comes from Statsig.
 */
export async function getExperimentDetail(
  id: string,
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): Promise<ExperimentDetail | null> {
  const config = statsigConfig(env);
  if (!config) return null;
  const { items } = await pageValue(config.apiKey, now);
  const item = items.find((candidate) => candidate.id === id);
  // with Amplitude configured the split is likely needed; don't make it wait on
  // Amplitude (without Amplitude, loadDetail fetches the exposures itself)
  const splitLoad =
    item?.status === "live" && amplitudeConfig(env)
      ? splitCache.get({ id, apiKey: config.apiKey, now }, now)
      : null;
  splitLoad?.catch(() => undefined);
  const amp = item ? await liveArmResults(item, env, now, amplitudeBudget.ms) : null;
  if (!amp) return detailCache.get({ id, apiKey: config.apiKey, now }, now);

  const daily = amplitudeDaily(amp);
  let split: Split | null;
  try {
    split = splitLoad ? await splitLoad : null;
  } catch (error) {
    // the Amplitude series still stands without Statsig's traffic split
    console.log(
      `[experiments] Statsig exposures for ${id} failed:`,
      error instanceof Error ? error.message : error,
    );
    split = { exposures: null, srm: null };
  }
  if (!split) return null;
  const totals = {
    control: { visitors: amp.control.visitors, signups: amp.control.signups },
    test: { visitors: amp.test.visitors, signups: amp.test.signups },
  };
  return { id, ...split, daily, dailySource: "amplitude", totals };
}

/**
 * Live Amplitude funnels for a live experiment, from its start date through
 * today (UTC). If the call is still running when the budget is up (a cold
 * cache, or a slow 15-minute refresh), the experiment's last good result is
 * used. Null (Statsig's numbers stay) when Amplitude isn't configured, the
 * experiment isn't live or has no start date, the call fails (logged), the
 * budget runs out with nothing cached, or Amplitude saw no visitors in an arm
 * (a page that doesn't stamp the arm property).
 */
async function liveArmResults(
  item: ExperimentListItem,
  env: Record<string, string | undefined>,
  now: number,
  budgetMs: number,
): Promise<ArmResults | null> {
  if (item.status !== "live" || !item.startDate) return null;
  const window = { id: item.id, start: item.startDate, end: new Date(now).toISOString().slice(0, 10) };
  const timedOut = Symbol("timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), budgetMs);
  });
  const results = getArmResults(window, env, now).catch((error: unknown) => {
    console.log(
      `[experiments] Amplitude results for ${item.id} failed, showing Statsig's:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  });
  try {
    const raced = await Promise.race([results, budget]);
    if (raced === timedOut) keepAlive(results);
    const amp = raced === timedOut ? lastArmResults(window, env, now) : raced;
    // a slow refresh with a cached result is routine (the nav waits 1.5s); only
    // say so when Statsig's numbers are shown because of it
    if (raced === timedOut && !amp && budgetMs > 0) {
      console.log(`[experiments] Amplitude results for ${item.id} took over ${budgetMs}ms, showing Statsig's`);
    }
    return amp && amp.control.visitors > 0 && amp.test.visitors > 0 ? amp : null;
  } finally {
    clearTimeout(timer);
  }
}

/** The last DETAIL_DAYS days of both arms' Amplitude funnels, visitors in the exposures slot. */
function amplitudeDaily(amp: ArmResults): DailyPoint[] {
  const control = new Map(amp.control.daily.map((day) => [day.date, day]));
  const test = new Map(amp.test.daily.map((day) => [day.date, day]));
  const dates = [...new Set([...control.keys(), ...test.keys()])].sort().slice(-DETAIL_DAYS);
  return dates.map((date) => ({
    date,
    exposures: { control: control.get(date)?.visitors ?? 0, test: test.get(date)?.visitors ?? 0 },
    signups: { control: control.get(date)?.signups ?? 0, test: test.get(date)?.signups ?? 0 },
  }));
}

/**
 * A page built with some failed calls is retried after PARTIAL_TTL_MS instead
 * of serving the hourly cache entry to its end (ttlCache has no per-entry TTL):
 * while the window is in effect the cached page is served as usual, and once it
 * has elapsed the entry is dropped so the next call loads fresh.
 */
async function pageValue(apiKey: string, now: number): Promise<PageValue> {
  if (partialUntil > 0 && now >= partialUntil) {
    partialUntil = 0;
    pageCache.clear();
  }
  return pageCache.get({ apiKey, now }, now);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

async function loadPage(apiKey: string, now: number): Promise<PageValue> {
  const dtos = (await consoleGet<ExternalExperimentDto[]>(apiKey, "/experiments?limit=100")).filter(
    (dto) => hubStatus(dto) != null,
  );

  const pulses = await pulsesFor(dtos, apiKey, now);
  const visitors7d = await visitors7dFor(dtos, apiKey, now);
  const milestone = await milestoneFor();

  const items = sortExperiments(dtos.map((dto) => toListItem(dto, pulses.get(dto.id), now)));
  return { items, visitors7d, milestone, syncedAt: now, dtos };
}

/** Pulse results for live and concluded experiments; one failure marks the page partial. */
async function pulsesFor(
  dtos: ExternalExperimentDto[],
  apiKey: string,
  now: number,
): Promise<Map<string, ExperimentPulseResultsDto>> {
  const pulses = new Map<string, ExperimentPulseResultsDto>();
  let partial = false;
  await Promise.all(
    dtos.map(async (dto) => {
      const status = hubStatus(dto);
      if (status !== "live" && status !== "concluded") return;
      const { controlId, testId } = pickArms(dto);
      if (!controlId || !testId) return;
      try {
        pulses.set(
          dto.id,
          await consoleGet<ExperimentPulseResultsDto>(
            apiKey,
            `/experiments/${dto.id}/pulse_results?control=${controlId}&test=${testId}`,
          ),
        );
      } catch {
        // one experiment failing to load results shouldn't hide the others
        partial = true;
      }
    }),
  );
  if (partial) partialUntil = now + PARTIAL_TTL_MS;
  return pulses;
}

/**
 * Visitors in test · 7d: per live experiment, cumulative exposures at the last
 * day minus the value exactly 7 days earlier (0 when that day is missing),
 * summed across experiments and arms. Any failed call makes the KPI null and
 * marks the page partial, like a failed pulse does.
 */
async function visitors7dFor(
  dtos: ExternalExperimentDto[],
  apiKey: string,
  now: number,
): Promise<{ control: number; test: number } | null> {
  let control = 0;
  let test = 0;
  let failed = false;
  await Promise.all(
    dtos.map(async (dto) => {
      if (hubStatus(dto) !== "live") return;
      const { controlId, testId } = pickArms(dto);
      if (!controlId || !testId) return;
      try {
        const groups = await consoleGet<CumulativeExposuresDto[]>(
          apiKey,
          `/experiments/${dto.id}/cumulative_exposures`,
        );
        const byGroup = exposureSeries(groups);
        control += sevenDayTotal(byGroup.get(controlId) ?? []);
        test += sevenDayTotal(byGroup.get(testId) ?? []);
      } catch {
        failed = true;
      }
    }),
  );
  if (failed) partialUntil = now + PARTIAL_TTL_MS;
  return failed ? null : { control, test };
}

/** The ab-testing project's next milestone, or null when Linear is unavailable. */
async function milestoneFor(): Promise<{ progress: number; targetDate: string | null } | null> {
  try {
    const slugId = trackerProject("ab-testing")?.linearSlugId;
    if (!slugId) return null;
    const overview = await getProjectOverview(slugId, "ab-testing");
    return nextMilestone(overview?.milestones);
  } catch {
    return null;
  }
}

/** The Monday–Sunday week that contains `today`. */
function weekContaining(today: string): { start: string; end: string } {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = shiftDate(today, -((day + 6) % 7));
  return { start, end: shiftDate(start, 6) };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** The experiment's list item and arm ids, or null for unknown, queued and draft ids. */
async function detailTarget(id: string, apiKey: string, now: number) {
  const { items, dtos } = await pageValue(apiKey, now);
  const item = items.find((candidate) => candidate.id === id);
  if (!item || item.status === "queued" || item.status === "draft") return null;
  const dto = dtos.find((candidate) => candidate.id === id);
  if (!dto) return null;
  return { item, ...pickArms(dto) };
}

/** Exposure series per arm, and the totals + SRM derived from them. */
async function exposuresFor(id: string, apiKey: string, item: ExperimentListItem, controlId: string, testId: string) {
  const groups = await consoleGet<CumulativeExposuresDto[]>(
    apiKey,
    `/experiments/${id}/cumulative_exposures`,
  );
  const byGroup = exposureSeries(groups);
  const controlSeries = byGroup.get(controlId) ?? [];
  const testSeries = byGroup.get(testId) ?? [];
  // With one arm missing or still at 0 there is no usable pair: totals and SRM
  // would be judged against a fabricated 0 and report a false mismatch.
  const controlLast = controlSeries.at(-1);
  const testLast = testSeries.at(-1);
  const exposures =
    controlLast && controlLast.value > 0 && testLast && testLast.value > 0
      ? { control: controlLast.value, test: testLast.value }
      : null;
  const srmResult = exposures ? srm([exposures.control, exposures.test], item.targetSplit) : null;
  return { controlSeries, testSeries, exposures, srm: srmResult };
}

/** Traffic split only (Statsig exposures + SRM), for details whose daily series is Amplitude's. */
async function loadSplit(id: string, apiKey: string, now: number): Promise<Split | null> {
  const target = await detailTarget(id, apiKey, now);
  if (!target) return null;
  const { item, controlId, testId } = target;
  if (!controlId || !testId) return { exposures: null, srm: null };
  const { exposures, srm: srmResult } = await exposuresFor(id, apiKey, item, controlId, testId);
  return { exposures, srm: srmResult };
}

async function loadDetail(id: string, apiKey: string, now: number): Promise<ExperimentDetail | null> {
  const target = await detailTarget(id, apiKey, now);
  if (!target) return null;
  const { item, controlId, testId } = target;
  if (!controlId || !testId) return { id, exposures: null, srm: null, daily: null, dailySource: "statsig" };

  const { controlSeries, testSeries, exposures, srm: srmResult } = await exposuresFor(
    id,
    apiKey,
    item,
    controlId,
    testId,
  );

  // Daily exposures come from the full cumulative series (so the first kept
  // day still has a correct delta). Dated pulses are cumulative too, so when
  // the window is shorter than the series the day just before it is fetched
  // as a baseline; the diff then runs over the full requested series before
  // the result is sliced to the last 28 days.
  const controlDaily = dailyFromCumulative(controlSeries);
  const testDaily = dailyFromCumulative(testSeries);
  const dates = controlDaily.map((point) => point.date).slice(-DETAIL_DAYS);
  const pulseDates =
    controlDaily.length > DETAIL_DAYS ? [shiftDate(dates[0], -1), ...dates] : dates;

  const signups = await signupsForDates(apiKey, id, controlId, testId, pulseDates);
  if (!signups) return { id, exposures, srm: srmResult, daily: null, dailySource: "statsig" };

  // Drop the baseline day's pseudo-delta so the kept window starts at a real one.
  const skip = pulseDates.length - dates.length;
  const daily: DailyPoint[] = dates.map((date, index) => ({
    date,
    exposures: {
      control: controlDaily.find((point) => point.date === date)?.value ?? 0,
      test: testDaily.find((point) => point.date === date)?.value ?? 0,
    },
    signups: {
      control: signups.control[index + skip],
      test: signups.test[index + skip],
    },
  }));
  return { id, exposures, srm: srmResult, daily, dailySource: "statsig" };
}

/**
 * Per-day signup deltas for each requested date, from dated pulse calls run at
 * most DATED_PULSE_CONCURRENCY at a time. The pulses are cumulative, so the
 * caller includes a baseline day when needed; diffing happens over the whole
 * requested series in order. Null when any call fails: the daily series needs
 * every day, while exposures and SRM above still stand.
 */
async function signupsForDates(
  apiKey: string,
  id: string,
  controlId: string,
  testId: string,
  dates: string[],
): Promise<{ control: number[]; test: number[] } | null> {
  const results = await pooled(dates, DATED_PULSE_CONCURRENCY, async (date) => {
    try {
      const pulse = await consoleGet<ExperimentPulseResultsDto>(
        apiKey,
        `/experiments/${id}/pulse_results?control=${controlId}&test=${testId}&date=${date}`,
      );
      const row = pulse.primaryMetrics[0];
      if (
        !row ||
        row.error ||
        row.controlMean == null ||
        row.testMean == null ||
        row.controlUnits == null ||
        row.testUnits == null
      ) {
        return null;
      }
      return {
        date,
        control: Math.round(row.controlMean * row.controlUnits),
        test: Math.round(row.testMean * row.testUnits),
      };
    } catch {
      return null;
    }
  });
  if (results.some((result) => result == null)) return null;
  const points = results as { date: string; control: number; test: number }[];
  const toValues = (series: { date: string; value: number }[]) =>
    dailyFromCumulative(series).map((point) => point.value);
  return {
    control: toValues(points.map((point) => ({ date: point.date, value: point.control }))),
    test: toValues(points.map((point) => ({ date: point.date, value: point.test }))),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** groupID → cumulative exposure series, ready for dailyFromCumulative. */
function exposureSeries(groups: CumulativeExposuresDto[]): Map<string, Point[]> {
  return new Map(
    groups.map((group) => [
      group.groupID,
      group.results.map((result) => ({ date: result.date, value: result.exposures })),
    ]),
  );
}

/** last − value exactly 7 days earlier, 0 when that day is missing. */
function sevenDayTotal(series: Point[]): number {
  const last = series.at(-1);
  if (!last) return 0;
  const weekAgo = shiftDate(last.date, -7);
  const earlier = series.find((point) => point.date === weekAgo)?.value ?? 0;
  return last.value - earlier;
}

/** Run `fn` over `items` with at most `limit` calls in flight, keeping order. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Per-request loaders for the page and sidebar
// ---------------------------------------------------------------------------

/** undefined = fetch failed (logged), null = Statsig not configured. */
export const loadExperimentsPage = cache(
  (): Promise<ExperimentsPage | null | undefined> =>
    getExperimentsPage().catch((error) => {
      console.log(
        "[experiments] Statsig fetch failed:",
        error instanceof Error ? error.message : error,
      );
      return undefined;
    }),
);

/**
 * Sidebar counts, built from the same page the tab renders; zeros when it
 * can't load. The sidebar renders on every tab, so it waits on Amplitude only
 * briefly: past amplitudeBudget.navMs it builds the page again with that short
 * budget (cached results and Statsig only), while the slow call still fills
 * the cache.
 */
export async function loadExperimentsNav(): Promise<ExperimentsNav | null> {
  const page = await navPage();
  if (page === undefined) return buildNav([], { ok: false, at: null });
  if (page === null) return null;
  return buildNav(page.experiments, page.sync);
}

async function navPage(): Promise<ExperimentsPage | null | undefined> {
  const full = loadExperimentsPage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), amplitudeBudget.navMs);
  });
  try {
    const first = await Promise.race([full, late]);
    if (first !== "late") return first;
    keepAlive(full);
  } finally {
    clearTimeout(timer);
  }
  return getExperimentsPage(process.env, Date.now(), 0).catch((error) => {
    console.log(
      "[experiments] Statsig fetch failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  });
}
