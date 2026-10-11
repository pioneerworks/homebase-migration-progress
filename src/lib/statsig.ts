import "server-only";

import { fetchWithTimeout, readJson } from "@/lib/fetch-timeout";

/**
 * Running Statsig experiments via the Console API.
 *
 * Lists the experiments currently in `active` status and, for each one, pulls
 * its Pulse results for the primary metric (control vs first test group):
 *
 *   GET https://statsigapi.net/console/v1/experiments?status=active
 *   GET /console/v1/experiments/{id}/pulse_results?control=..&test=..
 *
 * Auth is a Console API key created in Project Settings → API Keys, sent in
 * the STATSIG-API-KEY header. Like the Linear and Amplitude keys, it is
 * server-side only: reads a Vercel/local env var and is never shipped to the
 * browser. Without the key this module returns null and the overview section
 * simply does not render.
 *
 * Pulse results return regular (frequentist) stats for these experiments;
 * sequential-testing fields are exposed on the DTO but we use the regular
 * CI/p-value because the project does not enable sequential testing.
 */
import type { ExperimentPulseResultsDto, ExternalExperimentDto } from "./statsig-types";

// Pure derivations live in statsig-pure.ts so client components can import
// them without pulling the server-only API-key loader in too.
import {
  experimentDay,
  experimentTitle,
  pickArms,
  verdictFromPrimary,
  type ExperimentCard,
} from "./statsig-pure";

export {
  experimentDay,
  experimentTitle,
  latestExperiments,
  pickArms,
  verdictFromPrimary,
} from "./statsig-pure";
export type { ExperimentCard, ExperimentVerdict } from "./statsig-pure";

const CONSOLE_BASE = "https://statsigapi.net/console/v1";
const API_VERSION = "20240601";
// One call per experiment + one list call, so an hourly refresh stays far
// below the Console API limit (~900 req / 15 min).
const CACHE_TTL_MS = 60 * 60 * 1000;

export function statsigConfig(
  env: Record<string, string | undefined> = process.env,
): { apiKey: string } | null {
  const apiKey = env.STATSIG_CONSOLE_API_KEY?.trim();
  if (!apiKey || apiKey.includes("SENSITIVE")) return null;
  return { apiKey };
}

/** Per-request deadline; the pulse calls run in parallel after the list call. Mutable for tests. */
export const statsigTimeout = { ms: 6_000 };

/** Shared with the Experiments tab loader; behaviour unchanged. */
export async function consoleGet<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetchWithTimeout(
    `${CONSOLE_BASE}${path}`,
    {
      headers: {
        "STATSIG-API-KEY": apiKey,
        "STATSIG-API-VERSION": API_VERSION,
      },
      cache: "no-store",
    },
    statsigTimeout.ms,
    "Statsig Console API",
  );
  if (!response.ok) {
    throw new Error(`Statsig Console API failed: ${response.status}`);
  }
  const body = await readJson<{ data: T }>(response, statsigTimeout.ms, "Statsig Console API");
  return body.data;
}

/** Group DTOs plus pulse results, flattened into dashboard cards. */
export function toExperimentCards(
  experiments: ExternalExperimentDto[],
  pulses: Map<string, ExperimentPulseResultsDto>,
  now: number = Date.now(),
): ExperimentCard[] {
  return experiments.map((experiment) => {
    const pulse = pulses.get(experiment.id);
    const primaryRow = pulse?.primaryMetrics?.[0];
    const verdict = primaryRow
      ? verdictFromPrimary(primaryRow)
      : { verdict: "no-data" as const, significant: false, noDataReason: "no pull yet", percentChange: null, ci: null, pValue: null };

    return {
      id: experiment.id,
      title: experimentTitle(experiment.name),
      permalink: experiment.permalink ?? null,
      hypothesis: experiment.hypothesis || null,
      started: experiment.startTime
        ? new Date(experiment.startTime).toISOString().slice(0, 10)
        : null,
      day: experimentDay(experiment.startTime, now),
      durationDays: experiment.duration ?? null,
      primaryMetric: primaryRow?.metricName ?? experiment.primaryMetrics?.[0]?.name ?? null,
      percentChange: verdict.percentChange,
      ci: verdict.ci,
      pValue: verdict.pValue,
      significant: verdict.significant,
      controlRate: primaryRow?.controlMean ?? null,
      testRate: primaryRow?.testMean ?? null,
      controlUnits: primaryRow?.controlUnits ?? null,
      testUnits: primaryRow?.testUnits ?? null,
      verdict: verdict.verdict,
      noDataReason: verdict.noDataReason,
    };
  });
}

let cache: { at: number; ttl: number; cards: ExperimentCard[] } | null = null;
let failure: { at: number; error: unknown } | null = null;
/** Cards where some pulse failed are retried sooner than a clean load. */
const PARTIAL_CACHE_TTL_MS = 5 * 60 * 1000;
/** After a failed list call, skip Statsig briefly instead of waiting on it every view. */
const FAILURE_TTL_MS = 2 * 60 * 1000;

export function resetStatsigCacheForTests(): void {
  cache = null;
  failure = null;
}

/**
 * Running experiments with their quick primary-metric status, or null when
 * no key is configured. Fetch failures throw; callers catch and fall back.
 */
export async function getRunningExperiments(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): Promise<ExperimentCard[] | null> {
  const config = statsigConfig(env);
  if (!config) return null;

  if (cache && now - cache.at < cache.ttl) {
    return cache.cards;
  }
  if (failure && now - failure.at < FAILURE_TTL_MS) {
    if (cache) return cache.cards;
    throw failure.error;
  }

  let experiments: ExternalExperimentDto[];
  try {
    experiments = await consoleGet<ExternalExperimentDto[]>(
      config.apiKey,
      "/experiments?status=active&limit=100",
    );
  } catch (error) {
    failure = { at: now, error };
    // a stale list beats an error card
    if (cache) return cache.cards;
    throw error;
  }
  failure = null;
  let partial = false;

  const pulses = new Map<string, ExperimentPulseResultsDto>();
  await Promise.all(
    experiments.map(async (experiment) => {
      const { controlId, testId } = pickArms(experiment);
      if (!controlId || !testId) return;
      try {
        pulses.set(
          experiment.id,
          await consoleGet<ExperimentPulseResultsDto>(
            config.apiKey,
            `/experiments/${experiment.id}/pulse_results?control=${controlId}&test=${testId}`,
          ),
        );
      } catch {
        // one experiment failing to load results shouldn't hide the others
        partial = true;
      }
    }),
  );

  const cards = toExperimentCards(experiments, pulses, now);
  cache = { at: now, ttl: partial ? PARTIAL_CACHE_TTL_MS : CACHE_TTL_MS, cards };
  return cards;
}
