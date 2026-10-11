"use client";

import {
  Archive,
  ArrowLeft,
  FlaskConical,
  Gavel,
  LayoutGrid,
  ListOrdered,
  PencilLine,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use } from "react";

import { SidebarUser } from "@/components/app-shell";
import { formatLift, parseFilters, SURFACE_LABELS } from "@/lib/experiments-derive";
import type { ExperimentsNav, Surface, View } from "@/lib/experiments-types";

/**
 * Sidebar shown while the app is on /experiments. The nav counts stream in as
 * a promise (built server-side from the same page as the tab: Statsig plus
 * the live Amplitude results); badges render skeleton lines until it
 * resolves, like the hub sidebar's project labels. URLs follow the tab's contract:
 * view links keep the current surface, surface links keep the current view,
 * and live experiments deep-link into the All view with the row open.
 */

const VIEWS: { view: View; label: string; icon: typeof LayoutGrid }[] = [
  { view: "all", label: "All experiments", icon: LayoutGrid },
  { view: "live", label: "Live", icon: Radio },
  { view: "decision", label: "Needs a decision", icon: Gavel },
  { view: "queued", label: "Queued", icon: ListOrdered },
  { view: "draft", label: "Drafts", icon: PencilLine },
  { view: "concluded", label: "Concluded", icon: Archive },
];

const SURFACE_ORDER: Surface[] = ["landing_page", "signup_flow", "tool_page"];

export function ExperimentsSidebar({
  nav,
  user,
  onNavigate,
}: {
  nav: Promise<ExperimentsNav | null>;
  user: { name: string; email: string } | null;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="sidebar-top">
        <div className="exp-side-brand">
          <span className="sidebar-brand-mark">
            <FlaskConical size={20} aria-hidden="true" />
          </span>
          <span className="exp-side-brand-copy">
            <span className="exp-side-title">Experiments</span>
            <span className="exp-side-sub">AI Hub · Statsig</span>
          </span>
        </div>
      </div>

      <nav className="sidebar-top" aria-label="Experiments">
        <Link href="/" className="exp-side-back" onClick={onNavigate}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to AI Hub
        </Link>

        <Suspense fallback={<ExperimentsSectionsFallback />}>
          <ExperimentsSections nav={nav} onNavigate={onNavigate} />
        </Suspense>
      </nav>

      <div className="exp-side-bottom">
        <Suspense fallback={<SyncBoxFallback />}>
          <SyncBox nav={nav} />
        </Suspense>
        <SidebarUser user={user} />
      </div>
    </>
  );
}

function ExperimentsSections({
  nav: pending,
  onNavigate,
}: {
  nav: Promise<ExperimentsNav | null>;
  onNavigate: () => void;
}) {
  const nav = use(pending);
  const params = useSearchParams();
  const { view, surface } = parseFilters({
    view: params.get("view"),
    surface: params.get("surface"),
  });

  // View links keep the current surface; surface links toggle the surface and
  // keep the current view (clicking the active surface clears it).
  const surfaceQuery = surface ? `&surface=${surface}` : "";
  const hrefForView = (v: View) => `/experiments?view=${v}${surfaceQuery}`;
  const hrefForSurface = (s: Surface) =>
    s === surface ? `/experiments?view=${view}` : `/experiments?view=${view}&surface=${s}`;

  return (
    <>
      <div className="exp-side-group" role="group" aria-labelledby="exp-side-views-label">
        <p className="sidebar-heading" id="exp-side-views-label">
          Views
        </p>
        {VIEWS.map(({ view: v, label, icon: Icon }) => {
          const count = nav?.counts[v] ?? 0;
          const danger = v === "decision" && count > 0;
          return (
            <Link
              key={v}
              href={hrefForView(v)}
              className="exp-side-row"
              aria-current={view === v ? "page" : undefined}
              onClick={onNavigate}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="exp-side-row-label">{label}</span>
              <span className={`exp-side-count${danger ? " exp-side-count-danger" : ""}`}>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {nav && nav.live.length > 0 ? (
        <div className="exp-side-group" role="group" aria-labelledby="exp-side-live-label">
          <p className="sidebar-heading" id="exp-side-live-label">
            Live now
          </p>
          {nav.live.map((exp) => {
            const dayPart = exp.day != null && exp.totalDays != null ? ` · Day ${exp.day}/${exp.totalDays}` : "";
            return (
              <Link
                key={exp.id}
                href={`/experiments?view=all&open=${exp.id}#exp-${exp.id}`}
                className="exp-side-live"
                onClick={onNavigate}
              >
                <span
                  className={`exp-side-live-dot${exp.losing ? " exp-side-live-dot-losing" : ""}`}
                  aria-hidden="true"
                />
                <span className="exp-side-live-copy">
                  <span className="exp-side-live-name">
                    <span className="sr-only">{exp.losing ? "Losing" : "Live"}: </span>
                    {exp.name}
                  </span>
                  <span className="exp-side-live-meta">
                    {formatLift(exp.lift)}
                    {dayPart}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}

      <div className="exp-side-group" role="group" aria-labelledby="exp-side-surfaces-label">
        <p className="sidebar-heading" id="exp-side-surfaces-label">
          By surface
        </p>
        {SURFACE_ORDER.map((s) => (
          <Link
            key={s}
            href={hrefForSurface(s)}
            className="exp-side-row exp-side-row-surface"
            aria-current={surface === s ? "page" : undefined}
            onClick={onNavigate}
          >
            <span className="exp-side-row-label">{SURFACE_LABELS[s]}</span>
            <span className="exp-side-surface-count">{nav?.surfaces[s] ?? 0}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function SyncBox({ nav: pending }: { nav: Promise<ExperimentsNav | null> }) {
  const nav = use(pending);
  if (!nav) return null;
  const { sync } = nav;
  const minutes = sync.at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(sync.at)) / 60000))
    : null;
  return (
    <div className="exp-side-sync">
      <div className="exp-side-sync-row">
        <span
          className={`exp-side-sync-dot${sync.ok ? "" : " exp-side-sync-dot-failed"}`}
          aria-hidden="true"
        />
        <span className="exp-side-sync-status">
          {sync.ok ? "Statsig synced" : "Statsig sync failed"}
        </span>
      </div>
      {sync.ok ? (
        <span className="exp-side-sync-meta">
          <span>Results refresh hourly</span>
          {/* "N min ago" is computed from Date.now(), which differs between the
              server render and hydration; suppress the benign text mismatch. */}
          {minutes != null ? (
            <span suppressHydrationWarning>Last sync {minutes} min ago</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Same layout as the resolved sections, with skeleton lines where numbers go. */
function ExperimentsSectionsFallback() {
  return (
    <>
      <div className="exp-side-group" role="group" aria-labelledby="exp-side-views-label">
        <p className="sidebar-heading" id="exp-side-views-label">
          Views
        </p>
        {VIEWS.map(({ view, label, icon: Icon }) => (
          <span key={view} className="exp-side-row">
            <Icon size={16} aria-hidden="true" />
            <span className="exp-side-row-label">{label}</span>
            <span className="skeleton-line exp-side-skeleton-badge" aria-hidden="true" />
          </span>
        ))}
      </div>

      <div className="exp-side-group" role="group" aria-labelledby="exp-side-live-label">
        <p className="sidebar-heading" id="exp-side-live-label">
          Live now
        </p>
        {[0, 1].map((i) => (
          <span key={i} className="exp-side-live">
            <span className="skeleton-line exp-side-skeleton-dot" aria-hidden="true" />
            <span className="exp-side-live-copy">
              <span className="skeleton-line exp-side-skeleton-name" aria-hidden="true" />
              <span className="skeleton-line exp-side-skeleton-meta" aria-hidden="true" />
            </span>
          </span>
        ))}
      </div>

      <div className="exp-side-group" role="group" aria-labelledby="exp-side-surfaces-label">
        <p className="sidebar-heading" id="exp-side-surfaces-label">
          By surface
        </p>
        {SURFACE_ORDER.map((s) => (
          <span key={s} className="exp-side-row exp-side-row-surface">
            <span className="exp-side-row-label">{SURFACE_LABELS[s]}</span>
            <span className="skeleton-line exp-side-skeleton-count" aria-hidden="true" />
          </span>
        ))}
      </div>
    </>
  );
}

function SyncBoxFallback() {
  return (
    <div className="exp-side-sync" aria-hidden="true">
      <span className="skeleton-line exp-side-skeleton-md" />
      <span className="skeleton-line exp-side-skeleton-sm" />
    </div>
  );
}
