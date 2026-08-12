import { fallbackSnapshot } from "./fallback";
import {
  DECISIONS_PROJECT,
  HOSTING_PROJECT,
  MIGRATED_SITE_ORIGIN,
  PILLAR_PROJECTS,
  SNAPSHOT_TAG,
} from "./projects";
import type {
  CutoverMilestoneProgress,
  CutoverRecord,
  PageRecord,
  PageStatus,
  PillarProgress,
  Snapshot,
  StatusCounts,
  TrackedIssue,
} from "./types";

interface LinearIssue {
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  state: {
    name: string;
    type: string;
  };
  labels: {
    nodes: Array<{ name: string }>;
  };
  projectMilestone: {
    id: string;
    name: string;
  } | null;
}

interface LinearProjectResult {
  issues: {
    nodes: LinearIssue[];
  };
}

interface LinearResponse {
  data?: {
    product: LinearProjectResult | null;
    seo: LinearProjectResult | null;
    blog: LinearProjectResult | null;
    foundations: LinearProjectResult | null;
    webflowCloud: LinearProjectResult | null;
    decisions: LinearProjectResult | null;
    hosting: LinearProjectResult | null;
  };
  errors?: Array<{ message: string }>;
}

const query = `
  query MigrationSnapshot(
    $product: String!
    $seo: String!
    $blog: String!
    $foundations: String!
    $webflowCloud: String!
    $decisions: String!
    $hosting: String!
  ) {
    product: project(id: $product) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
    seo: project(id: $seo) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
    blog: project(id: $blog) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
    foundations: project(id: $foundations) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
    webflowCloud: project(id: $webflowCloud) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
    decisions: project(id: $decisions) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
    hosting: project(id: $hosting) {
      issues(first: 250, includeArchived: true) { nodes { ...IssueFields } }
    }
  }

  fragment IssueFields on Issue {
    identifier
    title
    url
    description
    updatedAt
    completedAt
    canceledAt
    state { name type }
    labels { nodes { name } }
    projectMilestone { id name }
  }
`;

const variables = {
  product: PILLAR_PROJECTS[0].id,
  seo: PILLAR_PROJECTS[1].id,
  blog: PILLAR_PROJECTS[2].id,
  foundations: PILLAR_PROJECTS[3].id,
  webflowCloud: PILLAR_PROJECTS[4].id,
  decisions: DECISIONS_PROJECT.id,
  hosting: HOSTING_PROJECT.id,
};

function normalizeStatus(issue: LinearIssue): PageStatus {
  const type = issue.state.type.toLowerCase();
  const name = issue.state.name.toLowerCase();
  if (type === "completed" || name === "done") return "done";
  if (
    type === "canceled" ||
    type === "cancelled" ||
    type === "duplicate" ||
    name.includes("cancel") ||
    name.includes("duplicate")
  ) {
    return "canceled";
  }
  if (
    type === "started" ||
    name.includes("progress") ||
    name.includes("review")
  ) {
    return "active";
  }
  return "backlog";
}

function normalizePath(path: string): string | null {
  let value = path.trim().replace(/[),.;:\]}]+$/, "");
  if (value.startsWith("http")) {
    try {
      value = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  value = value.split(/[?#]/)[0];
  if (!value.startsWith("/")) return null;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value || "/";
}

function extractPath(issue: LinearIssue): string | null {
  const portMatch = issue.title.match(
    /^Port\s+(https?:\/\/\S+|\/\S*|homepage)(?:\s|$)/i,
  );
  if (portMatch) {
    if (portMatch[1].toLowerCase() === "homepage") return "/";
    return normalizePath(portMatch[1]);
  }

  const labels = issue.labels.nodes.map((label) => label.name.toLowerCase());
  const isPageTicket = labels.some(
    (label) => label.includes("page") || label.includes("migration"),
  );
  if (!isPageTicket) return null;

  const liveMatch = issue.description?.match(
    /https?:\/\/(?:www\.)?joinhomebase\.com(\/[^\s)\]>"']*)?/i,
  );
  return liveMatch ? normalizePath(liveMatch[1] || "/") : null;
}

function issueToPage(
  issue: LinearIssue,
  pillar: (typeof PILLAR_PROJECTS)[number],
): PageRecord | null {
  const path = extractPath(issue);
  if (!path) return null;
  return {
    path,
    title: issue.title,
    ticket: issue.identifier,
    ticketUrl: issue.url,
    liveUrl: `${MIGRATED_SITE_ORIGIN}${path === "/" ? "" : path}`,
    pillar: pillar.key,
    pillarName: pillar.shortName,
    status: normalizeStatus(issue),
    stateName: issue.state.name,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt ?? issue.canceledAt,
    labels: issue.labels.nodes.map((label) => label.name),
  };
}

const phaseOnePathOrder = [
  "/payroll",
  "/payroll-lp",
  "/food-beverage",
  "/time-clock/cloud-based-time-tracking",
  "/homebase-vs-wheniwork",
];

export function extractCutoverPathFromTitle(title: string): string | null {
  const match = title.match(
    /^Hosting cutover:\s*(https?:\/\/\S+|\/\S*)(?:\s|$)/i,
  );
  return match ? normalizePath(match[1]) : null;
}

export function cutoverCompletion(counts: StatusCounts): number {
  const rolloutTotal = counts.done + counts.active + counts.backlog;
  return rolloutTotal ? (counts.done / rolloutTotal) * 100 : 0;
}

function issueToCutover(issue: LinearIssue): CutoverRecord {
  return {
    path: extractCutoverPathFromTitle(issue.title),
    title: issue.title,
    ticket: issue.identifier,
    ticketUrl: issue.url,
    status: normalizeStatus(issue),
    stateName: issue.state.name,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt,
    labels: issue.labels.nodes.map((label) => label.name),
    milestone: issue.projectMilestone?.name ?? "Cross-project",
  };
}

const statusRank: Record<PageStatus, number> = {
  done: 4,
  active: 3,
  backlog: 2,
  canceled: 1,
};

function dedupePages(pages: PageRecord[]): PageRecord[] {
  const unique = new Map<string, PageRecord>();
  for (const page of pages) {
    const existing = unique.get(page.path);
    if (
      !existing ||
      statusRank[page.status] > statusRank[existing.status] ||
      (statusRank[page.status] === statusRank[existing.status] &&
        new Date(page.updatedAt) > new Date(existing.updatedAt))
    ) {
      unique.set(page.path, page);
    }
  }
  return [...unique.values()];
}

function countStatuses(pages: Array<{ status: PageStatus }>): StatusCounts {
  const counts: StatusCounts = {
    total: pages.length,
    done: 0,
    active: 0,
    backlog: 0,
    canceled: 0,
  };
  for (const page of pages) counts[page.status] += 1;
  return counts;
}

export function resolvedCompletion(counts: StatusCounts): number {
  return counts.total
    ? ((counts.done + counts.canceled) / counts.total) * 100
    : 0;
}

function countCutoverMilestones(
  tickets: CutoverRecord[],
  issues: LinearIssue[],
): CutoverMilestoneProgress[] {
  const milestoneIds = new Map(
    issues.map((issue) => [
      issue.projectMilestone?.name ?? "Cross-project",
      issue.projectMilestone?.id ?? "cross-project",
    ]),
  );
  const names = [...new Set(tickets.map((ticket) => ticket.milestone))].sort(
    (a, b) => {
      if (a === "Cross-project") return 1;
      if (b === "Cross-project") return -1;
      return a.localeCompare(b);
    },
  );
  return names.map((name) => ({
    id: milestoneIds.get(name) ?? name,
    name,
    ...countStatuses(tickets.filter((ticket) => ticket.milestone === name)),
  }));
}

function cleanSummary(description: string | null, stateName: string): string {
  if (!description) return `Tracked in Linear · ${stateName}`;
  const cleaned = description
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `Tracked in Linear · ${stateName}`;
  return cleaned.length > 260 ? `${cleaned.slice(0, 257).trim()}…` : cleaned;
}

function issueToTracked(issue: LinearIssue): TrackedIssue {
  return {
    id: issue.identifier,
    title: issue.title,
    status: issue.state.name,
    summary: cleanSummary(issue.description, issue.state.name),
    url: issue.url,
    updatedAt: issue.updatedAt,
    labels: issue.labels.nodes.map((label) => label.name),
  };
}

function isQuestion(issue: LinearIssue): boolean {
  const title = issue.title.toLowerCase();
  const labels = issue.labels.nodes.map((label) => label.name.toLowerCase());
  return (
    labels.some(
      (label) =>
        label.includes("question") ||
        label.includes("blocker") ||
        label.includes("decision needed"),
    ) ||
    title.includes("decision needed") ||
    title.startsWith("should ") ||
    title.endsWith("?")
  );
}

function isRecordedDecision(issue: LinearIssue): boolean {
  if (isQuestion(issue)) return false;
  const title = issue.title.toLowerCase();
  return (
    normalizeStatus(issue) === "done" ||
    title.startsWith("decision:") ||
    title.startsWith("learning:") ||
    title.includes("deliberately") ||
    title.includes("do not ") ||
    title.includes("preferred over live")
  );
}

function extractEstimatedBlogPosts(issue: LinearIssue | undefined): number | null {
  if (!issue) return null;
  const text = `${issue.title} ${issue.description ?? ""}`;
  const match = text.match(/~?([\d,]+)\s+blog posts/i);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function buildSnapshot(data: NonNullable<LinearResponse["data"]>): Snapshot {
  const projectResults: Record<string, LinearProjectResult | null> = {
    product: data.product,
    seo: data.seo,
    blog: data.blog,
    foundations: data.foundations,
    "webflow-cloud": data.webflowCloud,
  };
  const projectPages = PILLAR_PROJECTS.flatMap((project) => {
    const projectResult = projectResults[project.key];
    return (projectResult?.issues.nodes ?? [])
      .map((issue) => issueToPage(issue, project))
      .filter((page): page is PageRecord => Boolean(page));
  });

  const pages = dedupePages(projectPages);
  const counts = countStatuses(pages);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyCompleted = pages.filter(
    (page) =>
      (page.status === "done" || page.status === "canceled") &&
      page.completedAt &&
      new Date(page.completedAt).getTime() >= sevenDaysAgo,
  ).length;

  const pillars: PillarProgress[] = PILLAR_PROJECTS.map((project) => {
    const pillarPages = dedupePages(
      projectPages.filter((page) => page.pillar === project.key),
    );
    return {
      id: project.key,
      name: project.name,
      shortName: project.shortName,
      url: project.url,
      ...countStatuses(pillarPages),
    };
  });

  const decisionIssues = data.decisions?.issues.nodes ?? [];
  const blogIssues = data.blog?.issues.nodes ?? [];
  const blogBulkIssue = blogIssues.find((issue) =>
    issue.title.toLowerCase().includes("bulk-import"),
  );
  const blogOpenFollowUps = blogIssues
    .filter(
      (issue) =>
        issue.identifier !== blogBulkIssue?.identifier &&
        !extractPath(issue) &&
        normalizeStatus(issue) !== "done" &&
        normalizeStatus(issue) !== "canceled",
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .map(issueToTracked);
  const decisionCounts = countStatuses(
    decisionIssues.map((issue) => ({ status: normalizeStatus(issue) })),
  );
  const sortedDecisionIssues = [...decisionIssues].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const questions = sortedDecisionIssues
    .filter(
      (issue) =>
        normalizeStatus(issue) !== "done" &&
        normalizeStatus(issue) !== "canceled" &&
        (isQuestion(issue) || !isRecordedDecision(issue)),
    )
    .slice(0, 8)
    .map(issueToTracked);
  const recent = sortedDecisionIssues
    .filter(isRecordedDecision)
    .slice(0, 8)
    .map(issueToTracked);

  const hostingIssues = data.hosting?.issues.nodes ?? [];
  const cutoverTickets = hostingIssues.map(issueToCutover).sort((a, b) => {
    const aPhaseOne = a.labels.includes("Phase 1") ? 1 : 0;
    const bPhaseOne = b.labels.includes("Phase 1") ? 1 : 0;
    if (aPhaseOne !== bPhaseOne) return bPhaseOne - aPhaseOne;
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[b.status] - statusRank[a.status];
    }
    const milestoneDiff = a.milestone.localeCompare(b.milestone);
    if (milestoneDiff) return milestoneDiff;
    return (a.path ?? a.title).localeCompare(b.path ?? b.title);
  });
  const cutoverCounts = countStatuses(cutoverTickets);
  const cutoverRolloutTotal =
    cutoverCounts.done + cutoverCounts.active + cutoverCounts.backlog;
  const phaseOne = cutoverTickets
    .filter((ticket) => ticket.labels.includes("Phase 1"))
    .sort((a, b) => {
      const aIndex = phaseOnePathOrder.indexOf(a.path ?? "");
      const bIndex = phaseOnePathOrder.indexOf(b.path ?? "");
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  const cutoverRecentlyCompleted = cutoverTickets.filter(
    (ticket) =>
      ticket.status === "done" &&
      ticket.completedAt &&
      new Date(ticket.completedAt).getTime() >= sevenDaysAgo,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    source: "linear",
    overall: {
      ...counts,
      completion: resolvedCompletion(counts),
      recentlyCompleted,
    },
    pillars,
    pages: pages
      .filter((page) => page.status === "done")
      .sort((a, b) => {
        const completedDiff =
          new Date(b.completedAt ?? b.updatedAt).getTime() -
          new Date(a.completedAt ?? a.updatedAt).getTime();
        return completedDiff || a.path.localeCompare(b.path);
      }),
    recentActivity: [...pages]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 12),
    blogMigration: {
      estimatedPosts: extractEstimatedBlogPosts(blogBulkIssue),
      status: blogBulkIssue ? normalizeStatus(blogBulkIssue) : "backlog",
      stateName: blogBulkIssue?.state.name ?? "Not tracked",
      primaryIssue: blogBulkIssue ? issueToTracked(blogBulkIssue) : null,
      openFollowUps: blogOpenFollowUps,
    },
    decisions: {
      projectUrl: DECISIONS_PROJECT.url,
      counts: decisionCounts,
      recent,
      questions,
    },
    hostingCutover: {
      projectUrl: HOSTING_PROJECT.url,
      overall: {
        ...cutoverCounts,
        rolloutTotal: cutoverRolloutTotal,
        completion: cutoverCompletion(cutoverCounts),
        recentlyCompleted: cutoverRecentlyCompleted,
      },
      milestones: countCutoverMilestones(cutoverTickets, hostingIssues),
      phaseOne,
      tickets: cutoverTickets,
    },
  };
}

export async function getSnapshot(): Promise<Snapshot> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return fallbackSnapshot;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      next: {
        revalidate: 60 * 60,
        tags: [SNAPSHOT_TAG],
      },
    });

    if (!response.ok) {
      throw new Error(`Linear returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as LinearResponse;
    if (payload.errors?.length || !payload.data) {
      throw new Error(
        payload.errors?.map((error) => error.message).join("; ") ||
          "Linear returned no data",
      );
    }
    return buildSnapshot(payload.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Linear API error";
    return {
      ...fallbackSnapshot,
      warning: `Live Linear refresh failed: ${message}. Showing the last verified snapshot.`,
    };
  }
}
