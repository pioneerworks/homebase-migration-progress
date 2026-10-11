"use client";

import {
  ArrowUpRight,
  Calendar,
  CircleCheck,
  Image as ImageIcon,
  Split,
  Target,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import DailyCharts from "@/components/experiments/daily-charts";
import { formatLift, formatRate, sourceLabel, trafficLabel } from "@/lib/experiments-derive";
import type {
  DailyPoint,
  ExperimentDetail,
  ExperimentListItem,
  MetricResult,
  ResultsSource,
} from "@/lib/experiments-types";

/**
 * The expanded row's detail panel: detail bar, hypothesis (01), traffic split
 * (02), page frames (03) and the daily charts (04). List data renders the bar
 * and block 01 immediately; blocks 02–04 need GET /api/experiments/{id}, which
 * is cached at module level for an hour so reopening a row doesn't fetch
 * again. Failed fetches are never cached — the inline retry always refetches.
 */

const DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
const detailCache = new Map<string, { detail: ExperimentDetail; at: number }>();
const inflight = new Map<string, Promise<ExperimentDetail>>();

/** The cached detail, or null when absent or older than the hour TTL. */
function cachedDetail(id: string): ExperimentDetail | null {
  const entry = detailCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.at > DETAIL_CACHE_TTL_MS) {
    detailCache.delete(id);
    return null;
  }
  return entry.detail;
}

class DetailUnavailableError extends Error {}

async function fetchDetail(id: string): Promise<ExperimentDetail> {
  const pending = inflight.get(id);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const response = await fetch(`/api/experiments/${id}`);
      if (response.status === 404) {
        // Unknown, queued and draft ids: the panel's Statsig data simply
        // doesn't exist — not an auth failure, and nothing to retry.
        throw new DetailUnavailableError(`no detail for ${id}`);
      }
      if (!response.ok) throw new Error(`detail fetch failed: ${response.status}`);
      const detail = (await response.json()) as ExperimentDetail;
      detailCache.set(id, { detail, at: Date.now() });
      return detail;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, promise);
  return promise;
}

type DetailState =
  | { kind: "loading" }
  | { kind: "ok"; detail: ExperimentDetail | null }
  | { kind: "error" };

/** "2025-09-25" → "Thu, Sep 25" — the one date format the detail panel uses. */
function hubDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function ExperimentDetailPanel({ item }: { item: ExperimentListItem }) {
  const slim = item.status === "queued" || item.status === "draft";
  const [state, setState] = useState<DetailState>(() => {
    const cached = cachedDetail(item.id);
    return cached ? { kind: "ok", detail: cached } : { kind: "loading" };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (slim) return;
    const cached = cachedDetail(item.id);
    if (cached) {
      setState({ kind: "ok", detail: cached });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDetail(item.id)
      .then((detail) => {
        if (!cancelled) setState({ kind: "ok", detail });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof DetailUnavailableError ? { kind: "ok", detail: null } : { kind: "error" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, slim, attempt]);

  if (slim) {
    return (
      <div className="exp-detail">
        <HypothesisBlock item={item} />
      </div>
    );
  }

  return (
    <div className="exp-detail">
      <div className="exp-d-bar">
        <div className="exp-d-meta">
          <span className="exp-d-metaitem">
            <Calendar size={14} aria-hidden="true" />
            Started {item.startDate ? hubDate(item.startDate) : "—"}
            {item.endDate ? ` · ends ${hubDate(item.endDate)}` : ""}
          </span>
          <span className="exp-d-metaitem">
            <Timer size={14} aria-hidden="true" />
            {item.day != null && item.totalDays != null
              ? `Day ${item.day} of ${item.totalDays}`
              : item.progressLabel}
          </span>
          <span className="exp-d-metaitem">
            <Split size={14} aria-hidden="true" />
            {item.targetSplit[0]} / {item.targetSplit[1]} split
          </span>
          <span className="exp-d-metaitem">
            <Target size={14} aria-hidden="true" />
            {item.primaryMetric ?? "—"}
          </span>
        </div>
        <div className="exp-d-actions">
          {item.statsigUrl ? (
            <a
              className="exp-btn exp-btn-dark exp-btn-sm"
              href={item.statsigUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Statsig
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          ) : (
            <button type="button" className="exp-btn exp-btn-dark exp-btn-sm" disabled>
              Open in Statsig
            </button>
          )}
        </div>
      </div>

      {/* 01 + 02 share a row (01 fills the space, 02 is fixed 380); on error
          only 01 renders, from list data. */}
      <div className="exp-d-row">
        <HypothesisBlock item={item} />
        {state.kind === "ok" ? <SplitBlock item={item} detail={state.detail} /> : null}
        {state.kind === "loading" ? (
          <div className="exp-d-block exp-d-block-split" aria-hidden="true">
            <span className="skeleton-line skeleton-line-sm" />
            <span className="skeleton-line exp-d-skel-bar" />
            <span className="skeleton-line skeleton-line-md" />
          </div>
        ) : null}
      </div>

      {state.kind === "error" ? (
        <p className="exp-d-error" role="status">
          Couldn&rsquo;t load details from Statsig.{" "}
          <button
            type="button"
            className="exp-retry"
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            retry
          </button>
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <div className="exp-d-block" aria-hidden="true">
          <span className="skeleton-line skeleton-line-sm" />
          <span className="skeleton-block" />
        </div>
      ) : null}
      {state.kind === "ok" ? (
        <>
          <PagesBlock item={item} />
          <DailyBlock
            daily={state.detail?.daily ?? null}
            source={state.detail?.dailySource ?? "statsig"}
            totals={state.detail?.totals}
          />
        </>
      ) : null}
    </div>
  );
}

/* --- 01 Hypothesis (also the whole slim panel for queued/draft rows) --- */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="exp-d-fact">
      <span className="exp-d-factkey">{label}</span>
      <span className="exp-d-factval">{value}</span>
    </div>
  );
}

function HypothesisBlock({ item }: { item: ExperimentListItem }) {
  return (
    <section className="exp-d-block exp-d-grow">
      <header className="exp-d-blockhead">
        <span className="exp-d-num" aria-hidden="true">
          01
        </span>
        <h3 className="exp-d-blocktitle">Hypothesis</h3>
      </header>
      <p className="exp-d-hypothesis">{item.hypothesis ?? "No hypothesis written yet."}</p>
      <div className="exp-d-facts">
        <Fact label="Primary metric" value={item.primaryMetric ?? "—"} />
        <Fact label="Guardrails" value={item.guardrails} />
        <Fact label="MDE" value="—" />
        <Fact label="Planned run" value={item.plannedRun} />
      </div>
      {item.results.length > 0 ? (
        <div className="exp-d-results">
          {item.results.map((result) => (
            <ResultEntry key={result.label} result={result} />
          ))}
        </div>
      ) : null}
      {item.resultsSource === "amplitude" ? (
        <p className="exp-d-muted">
          Sign ups are live from Amplitude (Page Viewed on mw_ pages, Linux excluded → Owner Account
          Created within 7 days). Amplitude only sees visitors who accept cookies, so its counts run
          below Statsig&rsquo;s exposures; the rates are comparable. Visitors from the last 7 days
          are still inside their sign-up window, so recent rates can rise.
          {item.results.some((r) => r.source === "statsig") ? " 1D1s come from Statsig and are a day behind." : ""}
        </p>
      ) : null}
    </section>
  );
}

function ResultEntry({ result }: { result: MetricResult }) {
  return (
    <div className="exp-d-result">
      <span className="exp-d-factkey">{result.label}</span>
      <span className="exp-d-resvalrow">
        <span className="exp-d-factval">
          {result.control.toLocaleString("en-US")} → {result.test.toLocaleString("en-US")}
        </span>
        <span
          className={`exp-d-delta${
            result.lift == null
              ? ""
              : result.lift < 0
                ? " exp-d-delta-neg"
                : result.lift > 0
                  ? " exp-d-delta-pos"
                  : ""
          }`}
        >
          {formatLift(result.lift)}
        </span>
      </span>
      <span className="exp-d-ressub">
        {formatRate(result.controlRate)} → {formatRate(result.testRate)}
      </span>
    </div>
  );
}

/* --- 02 Traffic split --- */

function SplitBlock({
  item,
  detail,
}: {
  item: ExperimentListItem;
  detail: ExperimentDetail | null;
}) {
  const exposures = detail?.exposures ?? null;
  const total = exposures != null ? exposures.control + exposures.test : 0;
  const controlPct = total > 0 ? (exposures!.control / total) * 100 : null;
  const testPct = controlPct != null ? 100 - controlPct : null;
  const srm = detail?.srm ?? null;

  return (
    <section className="exp-d-block exp-d-block-split">
      <header className="exp-d-blockhead">
        <span className="exp-d-num" aria-hidden="true">
          02
        </span>
        <h3 className="exp-d-blocktitle">Traffic split</h3>
        <span className="exp-d-blocksub">
          Target {item.targetSplit[0]} / {item.targetSplit[1]}
        </span>
      </header>
      {exposures == null || total <= 0 ? (
        <p className="exp-d-muted">No exposures yet</p>
      ) : (
        <>
          <div
            className="exp-d-splitbar"
            role="img"
            aria-label={`Control ${controlPct!.toFixed(1)}% · Test ${testPct!.toFixed(1)}%`}
          >
            <span
              className="exp-d-seg exp-d-seg-control"
              style={{ flexGrow: controlPct! }}
            >
              Control {controlPct!.toFixed(1)}%
            </span>
            <span className="exp-d-seg exp-d-seg-test" style={{ flexGrow: testPct! }}>
              Test {testPct!.toFixed(1)}%
            </span>
          </div>
          <div className="exp-d-splitcounts">
            <span>{exposures.control.toLocaleString("en-US")} exposures</span>
            <span>{exposures.test.toLocaleString("en-US")} exposures</span>
          </div>
        </>
      )}
      {srm ? (
        <div className={`exp-d-srm ${srm.ok ? "exp-d-srm-ok" : "exp-d-srm-bad"}`}>
          {srm.ok ? (
            <CircleCheck size={14} aria-hidden="true" />
          ) : (
            <TriangleAlert size={14} aria-hidden="true" />
          )}
          <span>
            {srm.ok ? "No sample-ratio mismatch" : "Sample-ratio mismatch"} · p ={" "}
            {srm.pValue.toFixed(2)}
          </span>
        </div>
      ) : null}
      <p className="exp-d-muted">Device split isn&rsquo;t available from Statsig yet.</p>
    </section>
  );
}

/* --- 03 What the pages look like --- */

function PagesBlock({ item }: { item: ExperimentListItem }) {
  const arms = [
    { key: "control" as const, name: "Control", url: item.armUrls.control, rate: item.controlRate },
    { key: "test" as const, name: "Test", url: item.armUrls.test, rate: item.testRate },
  ];
  return (
    <section className="exp-d-block">
      <header className="exp-d-blockhead">
        <span className="exp-d-num" aria-hidden="true">
          03
        </span>
        <h3 className="exp-d-blocktitle">What the pages look like</h3>
        <span className="exp-d-blocksub">Above the fold · desktop</span>
      </header>
      <div className="exp-d-thumbs">
        {arms.map((arm) => (
          <div className="exp-d-thumb" key={arm.key}>
            <div className="exp-d-armrow">
              <span className={`exp-d-arm exp-d-arm-${arm.key}`}>{arm.name}</span>
              {arm.rate != null ? (
                <span className="exp-d-armrate">{formatRate(arm.rate)} sign-up rate</span>
              ) : null}
            </div>
            <PageFrame url={arm.url} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** host + path without the protocol, e.g. "joinhomebase.com/free-employee-scheduling-app". */
function urlLabel(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function PageFrame({ url }: { url: string | null }) {
  const body = (
    <span className="exp-d-body">
      <span className="exp-d-bodyinner">
        <ImageIcon size={20} aria-hidden="true" />
        Placeholder — swap in the test variant screenshot from Statsig
      </span>
    </span>
  );
  const chrome = (
    <span className="exp-d-chrome" aria-hidden="true">
      <span className="exp-d-dot exp-d-dot-r" />
      <span className="exp-d-dot exp-d-dot-y" />
      <span className="exp-d-dot exp-d-dot-g" />
      <span className="exp-d-urlbar">{url ? urlLabel(url) : "—"}</span>
    </span>
  );
  if (url) {
    return (
      <a className="exp-d-frame" href={url} target="_blank" rel="noreferrer">
        {chrome}
        {body}
      </a>
    );
  }
  return (
    <div className="exp-d-frame">
      {chrome}
      {body}
    </div>
  );
}

/* --- 04 Daily exposures & signups --- */

function DailyBlock({
  daily,
  source,
  totals,
}: {
  daily: DailyPoint[] | null;
  source: ResultsSource;
  totals: ExperimentDetail["totals"];
}) {
  const hasDaily = daily != null && daily.length > 0;
  const traffic = trafficLabel(source);
  return (
    <section className="exp-d-block">
      <header className="exp-d-blockhead">
        <span className="exp-d-num" aria-hidden="true">
          04
        </span>
        <h3 className="exp-d-blocktitle">Daily {traffic.toLowerCase()} &amp; sign ups</h3>
        {hasDaily ? (
          <span className="exp-d-blocksub">
            {hubDate(daily![0].date)} – {hubDate(daily![daily!.length - 1].date)} · {sourceLabel(source)}
          </span>
        ) : null}
        <span className="exp-d-legend">
          <span className="exp-d-legenditem">
            <span className="exp-d-legendswatch" style={{ background: "var(--exp-control)" }} />
            Control
          </span>
          <span className="exp-d-legenditem">
            <span className="exp-d-legendswatch" style={{ background: "var(--exp-test)" }} />
            Test
          </span>
        </span>
      </header>
      {hasDaily ? (
        <DailyCharts daily={daily!} source={source} totals={totals} />
      ) : (
        <p className="exp-d-muted">Daily breakdown isn&rsquo;t available yet.</p>
      )}
    </section>
  );
}