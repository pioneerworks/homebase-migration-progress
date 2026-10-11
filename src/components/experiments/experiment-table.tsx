"use client";

import { ChevronDown, ChevronRight, CircleDashed, Hourglass, TrendingDown, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import ExperimentDetailPanel from "@/components/experiments/experiment-detail";
import { formatLift, formatRate, significanceLabel, sourceLabel } from "@/lib/experiments-derive";
import type { ExperimentListItem, HubStatus } from "@/lib/experiments-types";

/**
 * The experiments table card. Rows toggle a detail panel (the four-block
 * ExperimentDetailPanel); the open set is seeded from the `?open=` URL param,
 * which sidebar "Live now" links point at.
 */

const STATUS_LABELS: Record<HubStatus, string> = {
  live: "Live",
  queued: "Queued",
  draft: "Draft",
  concluded: "Concluded",
};

/** Tagline icons by state; colour comes from the CSS class (handoff §6). */
const TAGLINE_ICONS = {
  ahead: TrendingUp,
  losing: TrendingDown,
  too_early: Hourglass,
  not_started: CircleDashed,
} as const;

export type TableState = "ok" | "fetch-failed" | "unconfigured";

export default function ExperimentTable({
  items,
  state = "ok",
  seededId = null,
}: {
  items: ExperimentListItem[];
  state?: TableState;
  /** ?open={id} — seeds the open set (replacing it on each new seed) and scrolls to the row. */
  seededId?: string | null;
}) {
  const router = useRouter();
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(seededId != null ? [seededId] : []),
  );
  // The last ?open value we acted on; null means "no seed handled yet", so a
  // direct load with ?open={id} seeds and scrolls exactly like before.
  const lastSeed = useRef<string | null>(null);

  // Live-now links land here with ?open={id}. The table stays mounted across
  // client-side navigations, so each NEW seed value replaces the open set
  // (dropping rows the user opened earlier) and scrolls once; a removed or
  // unknown id leaves the current rows alone.
  useEffect(() => {
    if (seededId == null || seededId === lastSeed.current) return;
    if (state !== "ok" || !items.some((item) => item.id === seededId)) return;
    lastSeed.current = seededId;
    setOpenIds(new Set([seededId]));
    requestAnimationFrame(() => {
      document
        .getElementById(`exp-${seededId}`)
        ?.scrollIntoView({ block: "center" });
    });
  }, [seededId, items, state]);

  const toggle = (id: string) => {
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="exp-table-card">
      {state !== "ok" ? (
        <div className="exp-tablewrap">
          <div className="exp-empty" role="status">
            {state === "fetch-failed" ? (
              <>
                Couldn&rsquo;t reach Statsig ·{" "}
                <button type="button" className="exp-retry" onClick={() => router.refresh()}>
                  retry
                </button>
              </>
            ) : (
              "Statsig isn't configured for this deployment."
            )}
          </div>
        </div>
      ) : (
        <div className="exp-tablewrap">
          <table className="exp-table">
            <colgroup>
              <col className="exp-col-chevron" />
              <col />
              <col className="exp-col-status" />
              <col className="exp-col-metric" />
              <col className="exp-col-rates" />
              <col className="exp-col-lift" />
              <col className="exp-col-sig" />
              <col className="exp-col-samples" />
              <col className="exp-col-progress" />
              <col className="exp-col-owner" />
            </colgroup>
            <thead className="exp-thead">
              <tr>
                <th scope="col">
                  <span className="sr-only">Details</span>
                </th>
                <th scope="col">Experiment</th>
                <th scope="col">Status</th>
                <th scope="col">Primary metric</th>
                <th scope="col">Control → Test</th>
                <th scope="col">Lift</th>
                <th scope="col">Significance</th>
                <th scope="col">Samples</th>
                <th scope="col">Progress</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="exp-td" colSpan={10}>
                    <div className="exp-empty">No experiments match this view.</div>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isOpen = openIds.has(item.id);
                  const sig = significanceLabel(item);
                  return (
                    <RowFragment
                      key={item.id}
                      item={item}
                      isOpen={isOpen}
                      sig={sig}
                      onToggle={() => toggle(item.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RowFragment({
  item,
  isOpen,
  sig,
  onToggle,
}: {
  item: ExperimentListItem;
  isOpen: boolean;
  sig: { text: string; tone: "danger" | "success" | "muted" | null };
  onToggle: () => void;
}) {
  const samples =
    item.controlN != null && item.testN != null
      ? `${item.controlN.toLocaleString("en-US")} vs ${item.testN.toLocaleString("en-US")}`
      : "—";

  return (
    <>
      <tr
        id={`exp-${item.id}`}
        className={`exp-tr${isOpen ? " exp-tr-open" : ""}`}
        onClick={onToggle}
      >
        <td className="exp-td exp-td-chevron">
          <button
            type="button"
            className="exp-chevron"
            aria-expanded={isOpen}
            aria-controls={`exp-panel-${item.id}`}
            aria-label={`${isOpen ? "Hide" : "Show"} details for ${item.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          </button>
        </td>
        <td className="exp-td">
          <span className="exp-cellname">{item.name}</span>
          {item.path ? <span className="exp-cellpath">{item.path}</span> : null}
          <span className={`exp-tagline exp-tagline-${item.tagline.state}`}>
            <TaglineIcon state={item.tagline.state} />
            <strong>{item.tagline.text}</strong>
            {item.tagline.reason ? <span className="exp-tagline-reason"> · {item.tagline.reason}</span> : null}
          </span>
        </td>
        <td className="exp-td">
          <span className={`exp-pill exp-pill-${item.status}`}>{STATUS_LABELS[item.status]}</span>
        </td>
        <td className="exp-td exp-td-metric">{item.primaryMetric ?? "—"}</td>
        <td className="exp-td exp-td-rates">
          {item.controlRate != null && item.testRate != null
            ? `${formatRate(item.controlRate)} → ${formatRate(item.testRate)}`
            : "—"}
        </td>
        <td className={`exp-td exp-td-lift${item.lift != null ? (item.lift < 0 ? " exp-lift-neg" : item.lift > 0 ? " exp-lift-pos" : "") : ""}`}>
          {formatLift(item.lift)}
        </td>
        <td className={`exp-td exp-td-sig${sig.tone ? ` exp-sig-${sig.tone}` : ""}`}>{sig.text}</td>
        <td
          className="exp-td exp-td-samples"
          title={samples === "—" ? undefined : sourceLabel(item.resultsSource)}
        >
          {samples}
        </td>
        <td className="exp-td exp-td-progress">
          {item.status === "live" && item.day != null && item.totalDays != null ? (
            <>
              <span className="exp-progresstrack" aria-hidden="true">
                <span
                  className="exp-progressfill"
                  style={{ width: `${Math.min(100, Math.max(0, (item.day / item.totalDays) * 100))}%` }}
                />
              </span>
              <span className="exp-progresslabel">{item.progressLabel}</span>
            </>
          ) : (
            item.progressLabel
          )}
        </td>
        <td className="exp-td exp-td-owner">{item.owner ?? "Unassigned"}</td>
      </tr>
      {isOpen ? (
        <tr className="exp-panel-row" id={`exp-panel-${item.id}`}>
          <td className="exp-td" colSpan={10}>
            {/* width:0 + min-width:100% keeps wide panel content (a 30-day
                rate table, say) from stretching the whole table; it scrolls
                inside the panel instead. */}
            <div className="exp-panel-scroll">
              <ExperimentDetailPanel item={item} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The tagline's state icon, keyed off the shared map. */
function TaglineIcon({ state }: { state: keyof typeof TAGLINE_ICONS }) {
  const Icon = TAGLINE_ICONS[state];
  return <Icon size={12} aria-hidden="true" />;
}
