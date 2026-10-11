"use client";

import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatRate, trafficLabel } from "@/lib/experiments-derive";
import type { DailyPoint, ExperimentDetail, ResultsSource } from "@/lib/experiments-types";

/**
 * Block 04 charts: two side-by-side recharts bar charts (exposures and owner
 * signups per day), two bars per day (control then test), plus the signup-rate
 * table underneath. Values come from the detail payload (Amplitude visitors
 * when live, otherwise Statsig exposures) — nothing is derived here beyond
 * per-day rates and totals.
 */

const ARM_COLORS: Record<"control" | "test", string> = {
  control: "var(--exp-control)",
  test: "var(--exp-test)",
};

const ARM_NAMES: Record<"control" | "test", string> = {
  control: "Control",
  test: "Test",
};

type ChartRow = { date: string; control: number; test: number };

function toRows(field: "exposures" | "signups", daily: DailyPoint[]): ChartRow[] {
  return daily.map((point) => ({
    date: point.date,
    control: point[field].control,
    test: point[field].test,
  }));
}

/** "2025-09-24" → "Thu 24" — the short axis/table label. */
function dayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${day.getUTCDate()}`;
}

function countLabel(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString("en-US") : "";
}

type TipEntry = { dataKey?: string | number; value?: number | string };

function DayTooltip({
  active,
  payload,
  label,
  daily,
  showRate,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
  daily: DailyPoint[];
  showRate: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const date = String(label);
  const point = daily.find((entry) => entry.date === date);
  return (
    <div className="exp-d-tip">
      <p className="exp-d-tipdate">{dayLabel(date)}</p>
      {payload.map((entry) => {
        const arm = entry.dataKey === "test" ? "test" : "control";
        const value = Number(entry.value ?? 0);
        const rate =
          showRate && point && point.exposures[arm] > 0
            ? formatRate((point.signups[arm] / point.exposures[arm]) * 100)
            : null;
        return (
          <p className="exp-d-tiprow" key={arm}>
            <span className="exp-d-tipswatch" style={{ background: ARM_COLORS[arm] }} />
            {ARM_NAMES[arm]} {value.toLocaleString("en-US")}
            {rate ? <span className="exp-d-tiprate"> · {rate}</span> : null}
          </p>
        );
      })}
    </div>
  );
}

function DailyBarChart({
  title,
  rows,
  daily,
  showRate,
}: {
  title: string;
  rows: ChartRow[];
  daily: DailyPoint[];
  showRate: boolean;
}) {
  const controlTotal = rows.reduce((sum, row) => sum + row.control, 0);
  const testTotal = rows.reduce((sum, row) => sum + row.test, 0);
  return (
    <div className="exp-d-chart">
      <div className="exp-d-charthead">
        <h4 className="exp-d-charttitle">{title}</h4>
        <span className="exp-d-charttotal">
          Control {controlTotal.toLocaleString("en-US")} · Test {testTotal.toLocaleString("en-US")}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} barGap={2} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tickMargin={6}
            tick={{ fontSize: 10, fill: "var(--muted)", fontWeight: 600 }}
            tickFormatter={dayLabel}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "rgb(30 11 58 / 0.04)" }}
            content={<DayTooltip daily={daily} showRate={showRate} />}
          />
          <Bar
            dataKey="control"
            fill={ARM_COLORS.control}
            barSize={14}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="control"
              position="top"
              fontSize={9}
              fontWeight={700}
              fill="var(--ink)"
              formatter={countLabel}
            />
          </Bar>
          <Bar
            dataKey="test"
            fill={ARM_COLORS.test}
            barSize={14}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="test"
              position="top"
              fontSize={9}
              fontWeight={700}
              fill="var(--ink)"
              formatter={countLabel}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RateTable({ daily, runTotals }: { daily: DailyPoint[]; runTotals?: ExperimentDetail["totals"] }) {
  const n = daily.length;
  const totals = runTotals
    ? {
        controlSignups: runTotals.control.signups,
        testSignups: runTotals.test.signups,
        controlExposures: runTotals.control.visitors,
        testExposures: runTotals.test.visitors,
      }
    : daily.reduce(
        (acc, point) => ({
          controlSignups: acc.controlSignups + point.signups.control,
          testSignups: acc.testSignups + point.signups.test,
          controlExposures: acc.controlExposures + point.exposures.control,
          testExposures: acc.testExposures + point.exposures.test,
        }),
        { controlSignups: 0, testSignups: 0, controlExposures: 0, testExposures: 0 },
      );
  const rate = (signups: number, exposures: number): string =>
    exposures > 0 ? formatRate((signups / exposures) * 100) : "—";

  return (
    <table className="exp-d-ratetable">
      <thead>
        <tr>
          <th scope="col" className="exp-d-ratelabelhead">
            <span className="exp-d-ratelabel">Sign-up rate by day</span>
          </th>
          {daily.map((point) => (
            <th scope="col" key={point.date}>
              {dayLabel(point.date)}
            </th>
          ))}
          <th scope="col">{runTotals ? "Whole run" : `${n}-day`}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="exp-d-ratelabelhead">
            <span className="exp-d-raterowlabel">
              <span className="exp-d-rateswatch exp-d-rateswatch-control" aria-hidden="true" />
              Control
            </span>
          </th>
          {daily.map((point) => (
            <td key={point.date}>{rate(point.signups.control, point.exposures.control)}</td>
          ))}
          <td className="exp-d-ratetotal">
            {rate(totals.controlSignups, totals.controlExposures)}
          </td>
        </tr>
        <tr className="exp-d-raterow-test">
          <th scope="row" className="exp-d-ratelabelhead">
            <span className="exp-d-raterowlabel">
              <span className="exp-d-rateswatch exp-d-rateswatch-test" aria-hidden="true" />
              Test
            </span>
          </th>
          {daily.map((point) => (
            <td key={point.date}>{rate(point.signups.test, point.exposures.test)}</td>
          ))}
          <td className="exp-d-ratetotal">{rate(totals.testSignups, totals.testExposures)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default function DailyCharts({
  daily,
  source = "statsig",
  totals,
}: {
  daily: DailyPoint[];
  source?: ResultsSource;
  totals?: ExperimentDetail["totals"];
}) {
  return (
    <div className="exp-d-daily">
      <div className="exp-d-charts">
        <DailyBarChart title={`${trafficLabel(source)} / day`} rows={toRows("exposures", daily)} daily={daily} showRate={false} />
        <DailyBarChart
          // Amplitude counts a sign up on the day of the visit that led to it
          title={source === "amplitude" ? "Owner sign ups by visit day" : "Owner sign ups / day"}
          rows={toRows("signups", daily)}
          daily={daily}
          showRate={true}
        />
      </div>
      <RateTable daily={daily} runTotals={totals} />
    </div>
  );
}