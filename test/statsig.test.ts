import assert from "node:assert/strict";
import { test } from "node:test";

import {
  experimentDay,
  experimentTitle,
  latestExperiments,
  statsigConfig,
  toExperimentCards,
  verdictFromPrimary,
} from "../src/lib/statsig";
import type { ExperimentPulseResultsDto, ExternalExperimentDto } from "../src/lib/statsig-types";

test("statsigConfig requires a non-empty key", () => {
  assert.equal(statsigConfig({}), null);
  assert.equal(statsigConfig({ STATSIG_CONSOLE_API_KEY: "" }), null);
  assert.equal(statsigConfig({ STATSIG_CONSOLE_API_KEY: "FOCUS_SENSITIVE_PLACEHOLDER" }), null);
  assert.deepEqual(
    statsigConfig({ STATSIG_CONSOLE_API_KEY: "console-abc123" }),
    { apiKey: "console-abc123" },
  );
});

test("experimentTitle prettifies experiment ids", () => {
  assert.equal(
    experimentTitle("exp_free_employee_scheduling_app_lp_module"),
    "Free Employee Scheduling App LP Module",
  );
  assert.equal(experimentTitle("exp_free_time_clock_app_lp_url_split"), "Free Time Clock App LP URL Split");
  assert.equal(experimentTitle("plain_name"), "Plain Name");
});

test("experimentDay is 1-based and clamped", () => {
  const start = Date.UTC(2026, 8, 25); // Sep 25 2026
  assert.equal(experimentDay(start, start), 1);
  assert.equal(experimentDay(start, start + 3 * 86400000), 4);
  assert.equal(experimentDay(null), null);
});

test("verdictFromPrimary: significant lift decides winning/losing", () => {
  const winning = verdictFromPrimary({
    metricID: "Owner Signups::user_warehouse",
    metricName: "Owner Signups",
    directionality: "increase",
    percentChange: 12.3,
    pValue: 0.01,
    adjustedAlpha: 0.05,
    percentConfidenceInterval: { lower: 3, upper: 22 },
  });
  assert.equal(winning.verdict, "winning");
  assert.deepEqual(winning.ci, [3, 22]);

  const losing = verdictFromPrimary({
    metricID: "Owner Signups::user_warehouse",
    metricName: "Owner Signups",
    directionality: "increase",
    percentChange: -53.4,
    pValue: 0.0037,
    adjustedAlpha: 0.05,
    percentConfidenceInterval: { lower: -75, upper: -22.6 },
  });
  assert.equal(losing.verdict, "losing");
  assert.equal(losing.significant, true);

  // a significant zero lift must not be scored losing
  const flatButSignificant = verdictFromPrimary({
    metricID: "m::user_warehouse",
    metricName: "m",
    directionality: "increase",
    percentChange: 0,
    pValue: 0.04,
    adjustedAlpha: 0.05,
  });
  assert.equal(flatButSignificant.verdict, "no-signal");
  assert.equal(flatButSignificant.significant, true);

  // directionality=decrease: a negative lift is a win
  const decreaseWin = verdictFromPrimary({
    metricID: "Errors::user_warehouse",
    metricName: "Errors",
    directionality: "decrease",
    percentChange: -30,
    pValue: 0.02,
    adjustedAlpha: 0.05,
  });
  assert.equal(decreaseWin.verdict, "winning");

  // significant against a stricter adjusted alpha is not significant at alpha=0.01
  const stricterAlpha = verdictFromPrimary({
    metricID: "m::user_warehouse",
    metricName: "m",
    directionality: "increase",
    percentChange: 12,
    pValue: 0.04,
    adjustedAlpha: 0.01,
  });
  assert.equal(stricterAlpha.verdict, "no-signal");
  assert.equal(stricterAlpha.significant, false);

  const noisy = verdictFromPrimary({
    metricID: "m::user_warehouse",
    metricName: "m",
    directionality: "increase",
    percentChange: 57.5,
    pValue: 0.55,
    adjustedAlpha: 0.05,
  });
  assert.equal(noisy.verdict, "no-signal");
  assert.equal(noisy.significant, false);

  const noData = verdictFromPrimary({
    metricID: "Week1-2D7::user_warehouse",
    metricName: "Week1-2D7",
    directionality: "increase",
    error: "no_data",
  });
  assert.equal(noData.verdict, "no-data");
  assert.equal(noData.significant, false);
  assert.equal(noData.noDataReason, "no_data");
  assert.equal(noData.percentChange, null);
});

const experiment: ExternalExperimentDto = {
  id: "exp_free_employee_scheduling_app_lp_module",
  name: "exp_free_employee_scheduling_app_lp_module",
  hypothesis: "A guided four-card scheduling module converts better.",
  permalink: "https://console.statsig.com/abc/experiments/exp_x",
  status: "active",
  startTime: Date.UTC(2026, 8, 25),
  duration: 28,
  controlGroupID: "64CJW1DIAaB8qUKP7OWxOX",
  primaryMetrics: [{ name: "Owner Signups", type: "user_warehouse" }],
  groups: [
    { name: "control", id: "64CJW1DIAaB8qUKP7OWxOX", isControl: true },
    { name: "test", id: "64CJW3iL2sKCKkiKIWSb7Z" },
  ],
};

test("toExperimentCards flattens experiment + pulse into a card", () => {
  const pulses = new Map<string, ExperimentPulseResultsDto>([
    [
      experiment.id,
      {
        ds: "2026-09-28",
        primaryMetrics: [
          {
            metricID: "Owner Signups::user_warehouse",
            metricName: "Owner Signups",
            directionality: "increase",
            percentChange: -53.40531561461794,
            controlMean: 0.024955436720142603,
            testMean: 0.011627906976744186,
            controlUnits: 1683,
            testUnits: 1720,
            pValue: 0.0037473829588379193,
            adjustedAlpha: 0.05,
            percentConfidenceInterval: { lower: -75.03, upper: -22.64 },
          },
        ],
      },
    ],
  ]);

  const now = Date.UTC(2026, 8, 28);
  const cards = toExperimentCards([experiment], pulses, now);
  const card = cards[0];
  assert.equal(card.title, "Free Employee Scheduling App LP Module");
  assert.equal(card.started, "2026-09-25");
  assert.equal(card.day, 4);
  assert.equal(card.durationDays, 28);
  assert.equal(card.primaryMetric, "Owner Signups");
  assert.equal(card.verdict, "losing");
  assert.equal(card.significant, true);
  assert.equal(card.controlUnits, 1683);
  assert.equal(card.testUnits, 1720);
  assert.ok(Math.abs((card.controlRate ?? 0) - 0.02495) < 0.001);
  assert.ok(Math.abs((card.percentChange ?? 0) + 53.4) < 0.1);
});

test("latestExperiments keeps the newest starts, unstarted last", () => {
  const at = (id: string, startTime: number | undefined) => ({ ...experiment, id, startTime });
  const cards = toExperimentCards(
    [
      at("old", Date.UTC(2026, 8, 1)),
      at("unstarted", undefined),
      at("newest", Date.UTC(2026, 9, 8)),
      at("mid", Date.UTC(2026, 8, 20)),
      at("newer", Date.UTC(2026, 9, 1)),
    ],
    new Map(),
    Date.UTC(2026, 9, 10),
  );
  assert.deepEqual(latestExperiments(cards, 3).map((c) => c.id), ["newest", "newer", "mid"]);
  assert.deepEqual(
    latestExperiments(cards, 10).map((c) => c.id),
    ["newest", "newer", "mid", "old", "unstarted"],
  );
  assert.equal(cards[0].id, "old", "input order is not mutated");

  const sameDay = toExperimentCards(
    [at("first", Date.UTC(2026, 9, 8, 9)), at("second", Date.UTC(2026, 9, 8, 15))],
    new Map(),
    Date.UTC(2026, 9, 10),
  );
  assert.deepEqual(latestExperiments(sameDay, 3).map((c) => c.id), ["first", "second"]);
});

test("toExperimentCards keeps experiments whose pulse load failed", () => {
  // pulse map is empty -> card still renders with a no-data verdict
  const cards = toExperimentCards([experiment], new Map(), Date.UTC(2026, 8, 28));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].verdict, "no-data");
  assert.equal(cards[0].percentChange, null);
});
