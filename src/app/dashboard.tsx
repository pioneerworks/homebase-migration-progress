"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PageStatus,
  Snapshot,
  TrackedIssue,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth-core";

const pollInterval = 60_000;
const statusLabels: Record<PageStatus, string> = {
  done: "Done",
  active: "Active",
  backlog: "Backlog",
  canceled: "Canceled",
};

function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

function ProgressRing({
  completion,
  done,
  total,
  unit = "URLs",
}: {
  completion: number;
  done: number;
  total: number;
  unit?: string;
}) {
  const radius = 66;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(completion, 100) / 100);
  return (
    <div
      className="progress-ring"
      role="img"
      aria-label={`${completion.toFixed(1)} percent of tracked ${unit.toLowerCase()} are complete`}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle className="ring-track" cx="80" cy="80" r={radius} />
        <circle
          className="ring-value"
          cx="80"
          cy="80"
          r={radius}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <div className="ring-copy">
        <strong>{Math.round(completion)}%</strong>
        <span>
          {done} of {total} {unit}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: PageStatus; label?: string }) {
  return (
    <span className={`status status-${status}`}>
      <i aria-hidden="true" />
      {label || statusLabels[status]}
    </span>
  );
}

function IssueList({
  issues,
  empty,
}: {
  issues: TrackedIssue[];
  empty: string;
}) {
  if (!issues.length) return <p className="empty-message">{empty}</p>;
  return (
    <div className="issue-list">
      {issues.map((issue) => (
        <a
          className="issue-row"
          href={issue.url}
          key={issue.id}
          target="_blank"
          rel="noreferrer"
        >
          <div className="issue-id">{issue.id}</div>
          <div>
            <div className="issue-heading">
              <strong>{issue.title}</strong>
              <span>{issue.status}</span>
            </div>
            <p>{issue.summary}</p>
          </div>
          <span className="external" aria-hidden="true">
            ↗
          </span>
        </a>
      ))}
    </div>
  );
}

export default function Dashboard({
  initialSnapshot,
  user,
}: {
  initialSnapshot: Snapshot;
  user: SessionUser;
}) {
  const [tab, setTab] = useState<"migration" | "cutover">("migration");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [pollState, setPollState] = useState<"idle" | "checking" | "error">(
    "idle",
  );
  const [changedTickets, setChangedTickets] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setPollState("checking");
    try {
      const response = await fetch("/api/snapshot", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        const callbackUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(
          `/login?callbackUrl=${encodeURIComponent(callbackUrl || "/")}`,
        );
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextSnapshot = (await response.json()) as Snapshot;
      setSnapshot((current) => {
        const previousStatuses = new Map(
          current.recentActivity.map((page) => [page.ticket, page.status]),
        );
        const changed = nextSnapshot.recentActivity
          .filter(
            (page) =>
              previousStatuses.has(page.ticket) &&
              previousStatuses.get(page.ticket) !== page.status,
          )
          .map((page) => page.ticket);
        if (changed.length) {
          setChangedTickets(new Set(changed));
          window.setTimeout(() => setChangedTickets(new Set()), 4_000);
        }
        return nextSnapshot;
      });
      setPollState("idle");
    } catch {
      setPollState("error");
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(refresh, pollInterval);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const filteredPages = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const sevenDaysAgo =
      new Date(snapshot.generatedAt).getTime() - 7 * 24 * 60 * 60 * 1000;
    return snapshot.pages.filter((page) => {
      const matchesSearch =
        !normalizedSearch ||
        page.path.toLowerCase().includes(normalizedSearch) ||
        page.ticket.toLowerCase().includes(normalizedSearch) ||
        page.title.toLowerCase().includes(normalizedSearch);
      const matchesFilter =
        filter === "all" ||
        page.pillar === filter ||
        (filter === "recent" &&
          new Date(page.completedAt ?? page.updatedAt).getTime() >=
            sevenDaysAgo);
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, snapshot.generatedAt, snapshot.pages]);

  const filteredCutoverTickets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return snapshot.hostingCutover.tickets.filter((ticket) => {
      const matchesSearch =
        !normalizedSearch ||
        ticket.path?.toLowerCase().includes(normalizedSearch) ||
        ticket.ticket.toLowerCase().includes(normalizedSearch) ||
        ticket.title.toLowerCase().includes(normalizedSearch) ||
        ticket.milestone.toLowerCase().includes(normalizedSearch);
      const matchesFilter =
        filter === "all" ||
        (filter === "phase-one" && ticket.labels.includes("Phase 1")) ||
        ticket.status === filter;
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, snapshot.hostingCutover.tickets]);

  const changeTab = (next: "migration" | "cutover") => {
    setTab(next);
    setSearch("");
    setFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sourceLabel =
    snapshot.source === "linear" ? "Live Linear cache" : "Verified fallback";
  const percentage = snapshot.overall.completion.toFixed(1);
  const cutoverPercentage = snapshot.hostingCutover.overall.completion.toFixed(1);

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <div className="topbar-primary">
            <a className="brand" href="#top">
              <span className="brand-mark" aria-hidden="true" />
              <span>Homebase migration</span>
            </a>
            <div className="dashboard-tabs" aria-label="Dashboard view">
              <button
                type="button"
                aria-pressed={tab === "migration"}
                onClick={() => changeTab("migration")}
              >
                Page migration
              </button>
              <button
                type="button"
                aria-pressed={tab === "cutover"}
                onClick={() => changeTab("cutover")}
              >
                Hosting cutover
              </button>
            </div>
          </div>
          <nav className="nav" aria-label="Dashboard sections">
            {tab === "migration" ? (
              <>
                <a href="#progress">Progress</a>
                <a href="#activity">Activity</a>
                <a href="#pages">Completed pages</a>
                <a href="#decisions">Decisions</a>
              </>
            ) : (
              <>
                <a href="#cutover-progress">Progress</a>
                <a href="#phase-one">Phase 1</a>
                <a href="#cutover-tickets">All tickets</a>
              </>
            )}
            <span className="nav-user" title={`Signed in as ${user.email}`}>
              {user.name}
            </span>
            <a className="nav-signout" href="/api/auth/logout">
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className={`live-dot ${snapshot.source}`} />
                {sourceLabel}
              </div>
              {tab === "migration" ? (
                <>
                  <h1>Web migration progress and decision log</h1>
                  <p>
                    A live, linked view of URL parity, work in motion, recent
                    completions, implementation decisions, and unresolved questions.
                  </p>
                </>
              ) : (
                <>
                  <h1>Hosting cutover progress</h1>
                  <p>
                    A complete view of the Webflow-to-Vercel cutover queue, with
                    the first production rollout cohort called out separately.
                  </p>
                </>
              )}
              <div className="snapshot-meta">
                <span>Updated {formatSnapshotTime(snapshot.generatedAt)} ET</span>
                <button
                  className="text-button"
                  onClick={refresh}
                  type="button"
                  disabled={pollState === "checking"}
                >
                  {pollState === "checking" ? "Checking…" : "Check now"}
                </button>
                {pollState === "error" && (
                  <span className="poll-error">Refresh failed; retrying</span>
                )}
              </div>
            </div>
            <ProgressRing
              completion={
                tab === "migration"
                  ? snapshot.overall.completion
                  : snapshot.hostingCutover.overall.completion
              }
              done={
                tab === "migration"
                  ? snapshot.overall.done + snapshot.overall.canceled
                  : snapshot.hostingCutover.overall.done
              }
              total={
                tab === "migration"
                  ? snapshot.overall.total
                  : snapshot.hostingCutover.overall.rolloutTotal
              }
              unit={tab === "migration" ? "URLs" : "tickets"}
            />
          </div>
        </section>

        {snapshot.warning && (
          <div className="warning-bar" role="status">
            <div className="shell">
              <strong>Data notice</strong>
              <span>{snapshot.warning}</span>
            </div>
          </div>
        )}

        {tab === "migration" ? (
          <>
        <section id="progress" className="section">
          <div className="shell">
            <div className="section-head">
              <div>
                <span className="section-kicker">Portfolio</span>
                <h2>URL parity progress</h2>
                <p>
                  Unique page-port tickets only. Decision, QA, and infrastructure
                  work are excluded. Done, canceled, and duplicate routes count as
                  resolved parity.
                </p>
              </div>
              <strong className="progress-summary">
                {percentage}% parity complete
              </strong>
            </div>

            <div className="metric-band" aria-label="Migration progress summary">
              <div>
                <strong>
                  {snapshot.overall.done + snapshot.overall.canceled}
                </strong>
                <span>URLs resolved</span>
              </div>
              <div>
                <strong>{snapshot.overall.active}</strong>
                <span>Active or in review</span>
              </div>
              <div>
                <strong>{snapshot.overall.backlog}</strong>
                <span>Remaining</span>
              </div>
              <div className="metric-recent">
                <strong>+{snapshot.overall.recentlyCompleted}</strong>
                <span>Resolved in 7 days</span>
              </div>
            </div>

            <div className="pillar-list" aria-label="Progress by migration pillar">
              {snapshot.pillars.map((pillar) => {
                const resolved = pillar.done + pillar.canceled;
                const completion = pillar.total
                  ? (resolved / pillar.total) * 100
                  : 0;
                const isBlog = pillar.id === "blog";
                const blogPosts = snapshot.blogMigration.estimatedPosts;
                return (
                  <a
                    className="pillar-row"
                    href={pillar.url}
                    key={pillar.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="pillar-name">
                      <strong>{pillar.name}</strong>
                      <span>
                        {isBlog && snapshot.blogMigration.status === "active"
                          ? `~${blogPosts ?? "800+"} posts currently migrating`
                          : pillar.active
                          ? `${pillar.active} currently active`
                          : pillar.backlog && pillar.canceled
                          ? `${pillar.backlog} remaining · ${pillar.canceled} canceled or duplicate`
                          : pillar.backlog
                          ? `${pillar.backlog} remaining`
                          : pillar.canceled
                          ? `${pillar.canceled} canceled or duplicate`
                          : "No URL tickets active"}
                      </span>
                    </div>
                    <div className="bar-block">
                      <div className="bar-track" aria-hidden="true">
                        <span style={{ transform: `scaleX(${completion / 100})` }} />
                      </div>
                      <span>
                        {isBlog
                          ? `Hub ${Math.round(completion)}%`
                          : `${Math.round(completion)}%`}
                      </span>
                    </div>
                    <div className="pillar-count">
                      <strong>{resolved}</strong>
                      <span>of {pillar.total}</span>
                    </div>
                    <span className="external" aria-hidden="true">
                      ↗
                    </span>
                  </a>
                );
              })}
            </div>

            <aside className="blog-notice" aria-labelledby="blog-notice-title">
              <div>
                <span className="section-kicker">Blog CMS exception</span>
                <h3 id="blog-notice-title">
                  The blog migration is still in progress
                </h3>
                <p>
                  The <code>/blog</code> hub is tracked as one URL ticket, but that
                  ticket represents only the hub—not the article corpus. The active
                  bulk migration covers the remaining{" "}
                  <strong>
                    ~{snapshot.blogMigration.estimatedPosts ?? "800+"} Webflow
                    posts
                  </strong>
                  , with content-fidelity and SEO-parity validation still underway.
                </p>
              </div>
              <div className="blog-notice-links">
                {snapshot.blogMigration.primaryIssue && (
                  <a
                    href={snapshot.blogMigration.primaryIssue.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {snapshot.blogMigration.primaryIssue.id} ·{" "}
                    {snapshot.blogMigration.stateName} ↗
                  </a>
                )}
                {snapshot.blogMigration.openFollowUps.map((issue) => (
                  <a
                    href={issue.url}
                    key={issue.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {issue.id} · {issue.status} ↗
                  </a>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section id="activity" className="section section-tinted">
          <div className="shell">
            <div className="section-head">
              <div>
                <span className="section-kicker">In motion</span>
                <h2>Recent URL activity</h2>
                <p>
                  The latest page tickets touched across the five migration
                  pillars. Active items pulse; changed states briefly highlight.
                </p>
              </div>
            </div>
            <div className="activity-list">
              {snapshot.recentActivity.map((page) => (
                <a
                  className={`activity-row ${
                    changedTickets.has(page.ticket) ? "changed" : ""
                  }`}
                  href={page.ticketUrl}
                  key={page.ticket}
                  target="_blank"
                  rel="noreferrer"
                >
                  <StatusBadge status={page.status} label={page.stateName} />
                  <code>{page.path}</code>
                  <span className="activity-pillar">{page.pillarName}</span>
                  <span className="activity-date">
                    {formatShortDate(page.updatedAt)}
                  </span>
                  <strong>{page.ticket}</strong>
                  <span className="external" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="pages" className="section">
          <div className="shell">
            <div className="section-head">
              <div>
                <span className="section-kicker">Completed inventory</span>
                <h2>Pages marked Done</h2>
                <p>
                  Every route links to the live page and its associated Linear
                  ticket.
                </p>
              </div>
              <span className="result-count">
                {filteredPages.length} of {snapshot.pages.length}
              </span>
            </div>
            <div className="controls">
              <label className="search-label">
                <span className="sr-only">Search completed pages</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search route or ticket"
                />
              </label>
              <div className="filters" role="group" aria-label="Filter pages">
                {[
                  ["all", "All"],
                  ["recent", "Last 7 days"],
                  ["product", "Product/content"],
                  ["seo", "SEO/static"],
                  ["foundations", "Foundations"],
                  ["blog", "Blog"],
                  ["webflow-cloud", "Webflow Cloud"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className="filter"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredPages.length ? (
              <div className="page-table">
                <div className="page-table-head" aria-hidden="true">
                  <span>Live route</span>
                  <span>Pillar</span>
                  <span>Linear</span>
                </div>
                {filteredPages.map((page) => (
                  <div className="page-row" key={`${page.ticket}-${page.path}`}>
                    <a
                      className="route-link"
                      href={page.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <code>{page.path}</code>
                      <span aria-hidden="true">↗</span>
                    </a>
                    <span className="page-pillar">{page.pillarName}</span>
                    <a
                      className="ticket-link"
                      href={page.ticketUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {page.ticket}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-message">
                No completed routes match this filter.
              </p>
            )}
          </div>
        </section>

        <section id="decisions" className="section section-tinted">
          <div className="shell">
            <div className="section-head">
              <div>
                <span className="section-kicker">Decision log</span>
                <h2>New decisions and learnings</h2>
                <p>
                  Recent calls that change how pages are ported, rendered, or
                  evaluated for parity.
                </p>
              </div>
              <a
                className="section-link"
                href={snapshot.decisions.projectUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open decision project ↗
              </a>
            </div>

            <div className="decision-band">
              <div>
                <strong>{snapshot.decisions.counts.total}</strong>
                <span>Total tracked</span>
              </div>
              <div>
                <strong>{snapshot.decisions.counts.done}</strong>
                <span>Done</span>
              </div>
              <div>
                <strong>{snapshot.decisions.counts.active}</strong>
                <span>Active/review</span>
              </div>
              <div>
                <strong>{snapshot.decisions.counts.backlog}</strong>
                <span>Backlog</span>
              </div>
              <div>
                <strong>{snapshot.decisions.counts.canceled}</strong>
                <span>Canceled/split</span>
              </div>
            </div>

            <IssueList
              issues={snapshot.decisions.recent}
              empty="No recent decision issues were returned."
            />

            <div className="questions-head">
              <span className="section-kicker">Needs alignment</span>
              <h2>Open questions and follow-ups</h2>
              <p>
                Unresolved items that need an owner call, shared-component fix, or
                content input.
              </p>
            </div>
            <IssueList
              issues={snapshot.decisions.questions}
              empty="No open questions were identified."
            />
          </div>
        </section>
          </>
        ) : (
          <>
            <section id="cutover-progress" className="section">
              <div className="shell">
                <div className="section-head">
                  <div>
                    <span className="section-kicker">Hosting portfolio</span>
                    <h2>Webflow-to-Vercel cutover progress</h2>
                    <p>
                      Canceled routes remain visible in the inventory but are
                      excluded from the rollout completion percentage.
                    </p>
                  </div>
                  <div className="section-actions">
                    <strong className="progress-summary">
                      {cutoverPercentage}% complete
                    </strong>
                    <a
                      className="section-link"
                      href={snapshot.hostingCutover.projectUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Hosting project ↗
                    </a>
                  </div>
                </div>

                <div className="decision-band cutover-band" aria-label="Hosting cutover summary">
                  <div>
                    <strong>{snapshot.hostingCutover.overall.total}</strong>
                    <span>Total tracked</span>
                  </div>
                  <div>
                    <strong>{snapshot.hostingCutover.overall.done}</strong>
                    <span>Cut over</span>
                  </div>
                  <div>
                    <strong>{snapshot.hostingCutover.overall.active}</strong>
                    <span>Active or in review</span>
                  </div>
                  <div>
                    <strong>{snapshot.hostingCutover.overall.backlog}</strong>
                    <span>Queued</span>
                  </div>
                  <div>
                    <strong>{snapshot.hostingCutover.overall.canceled}</strong>
                    <span>Canceled</span>
                  </div>
                </div>

                <div className="pillar-list" aria-label="Progress by hosting milestone">
                  {snapshot.hostingCutover.milestones.map((milestone) => {
                    const rolloutTotal = milestone.total - milestone.canceled;
                    const completion = rolloutTotal
                      ? (milestone.done / rolloutTotal) * 100
                      : 0;
                    return (
                      <div className="pillar-row cutover-milestone" key={milestone.id}>
                        <div className="pillar-name">
                          <strong>{milestone.name}</strong>
                          <span>
                            {milestone.active
                              ? `${milestone.active} currently active`
                              : `${milestone.backlog} queued`}
                          </span>
                        </div>
                        <div className="bar-block">
                          <div className="bar-track" aria-hidden="true">
                            <span style={{ transform: `scaleX(${completion / 100})` }} />
                          </div>
                          <span>{Math.round(completion)}%</span>
                        </div>
                        <div className="pillar-count">
                          <strong>{milestone.done}</strong>
                          <span>of {rolloutTotal}</span>
                        </div>
                        <span className="external" aria-hidden="true" />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section id="phase-one" className="section section-tinted">
              <div className="shell">
                <div className="section-head">
                  <div>
                    <span className="section-kicker">First rollout cohort</span>
                    <h2>Phase 1</h2>
                    <p>
                      The complete first set of routes planned for production
                      cutover through the reverse proxy.
                    </p>
                  </div>
                  <span className="result-count">
                    {snapshot.hostingCutover.phaseOne.filter(
                      (ticket) => ticket.status === "done",
                    ).length} of {snapshot.hostingCutover.phaseOne.length} complete
                  </span>
                </div>

                <div className="phase-one-list">
                  {snapshot.hostingCutover.phaseOne.map((ticket) => (
                    <a
                      className="phase-one-row"
                      href={ticket.ticketUrl}
                      key={ticket.ticket}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <StatusBadge status={ticket.status} label={ticket.stateName} />
                      <code>{ticket.path ?? ticket.title}</code>
                      <span>{ticket.milestone}</span>
                      <strong>{ticket.ticket}</strong>
                      <span className="external" aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </section>

            <section id="cutover-tickets" className="section">
              <div className="shell">
                <div className="section-head">
                  <div>
                    <span className="section-kicker">Complete inventory</span>
                    <h2>All Hosting cutover tickets</h2>
                    <p>
                      Every ticket in the Hosting Migration project, including
                      canceled routes and cross-route implementation work.
                    </p>
                  </div>
                  {snapshot.source === "linear" && (
                    <span className="result-count">
                      {filteredCutoverTickets.length} of{" "}
                      {snapshot.hostingCutover.tickets.length}
                    </span>
                  )}
                </div>

                {snapshot.source === "linear" && (
                  <div className="controls">
                    <label className="search-label">
                      <span className="sr-only">
                        Search Hosting cutover tickets
                      </span>
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search route, milestone, or ticket"
                      />
                    </label>
                    <div
                      className="filters"
                      role="group"
                      aria-label="Filter cutover tickets"
                    >
                      {[
                        ["all", "All"],
                        ["phase-one", "Phase 1"],
                        ["active", "Active"],
                        ["backlog", "Backlog"],
                        ["done", "Done"],
                        ["canceled", "Canceled"],
                      ].map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className="filter"
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {snapshot.source === "fallback" ? (
                  <p className="empty-message">
                    Live Linear is unavailable, so the full Hosting inventory is
                    temporarily hidden. The verified summary and Phase 1 cohort
                    remain available above.
                  </p>
                ) : filteredCutoverTickets.length ? (
                  <div className="cutover-table">
                    <div className="cutover-table-head" aria-hidden="true">
                      <span>Route or workstream</span>
                      <span>Milestone</span>
                      <span>Status</span>
                      <span>Linear</span>
                    </div>
                    {filteredCutoverTickets.map((ticket) => (
                      <div className="cutover-row" key={ticket.ticket}>
                        {ticket.path ? (
                          <a
                            className="route-link"
                            href={`https://www.joinhomebase.com${ticket.path}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <code>{ticket.path}</code>
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="cutover-work">{ticket.title}</span>
                        )}
                        <span className="page-pillar">{ticket.milestone}</span>
                        <StatusBadge status={ticket.status} label={ticket.stateName} />
                        <a
                          className="ticket-link"
                          href={ticket.ticketUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {ticket.ticket}
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-message">
                    No Hosting cutover tickets match this filter.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <footer>
        <div className="shell footer-inner">
          <span>
            {tab === "migration"
              ? "“Done” reflects Linear workflow state; it does not imply production cutover."
              : "Hosting progress reflects the workflow state of tickets in the Linear cutover project."}
          </span>
          <span>Auto-checks every 60 seconds · Linear cache refreshes hourly</span>
        </div>
      </footer>
    </>
  );
}
