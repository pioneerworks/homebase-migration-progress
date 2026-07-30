import { fallbackSnapshot } from "./fallback";
import {
  DECISIONS_PROJECT,
  PILLAR_PROJECTS,
  SNAPSHOT_TAG,
} from "./projects";
import type {
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
  state: {
    name: string;
    type: string;
  };
  labels: {
    nodes: Array<{ name: string }>;
  };
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
    decisions: LinearProjectResult | null;
  };
  errors?: Array<{ message: string }>;
}

const query = `
  query MigrationSnapshot(
    $product: String!
    $seo: String!
    $blog: String!
    $foundations: String!
    $decisions: String!
  ) {
    product: project(id: $product) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
    seo: project(id: $seo) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
    blog: project(id: $blog) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
    foundations: project(id: $foundations) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
    decisions: project(id: $decisions) {
      issues(first: 250) { nodes { ...IssueFields } }
    }
  }

  fragment IssueFields on Issue {
    identifier
    title
    url
    description
    updatedAt
    completedAt
    state { name type }
    labels { nodes { name } }
  }
`;

const variables = {
  product: PILLAR_PROJECTS[0].id,
  seo: PILLAR_PROJECTS[1].id,
  blog: PILLAR_PROJECTS[2].id,
  foundations: PILLAR_PROJECTS[3].id,
  decisions: DECISIONS_PROJECT.id,
};

function normalizeStatus(issue: LinearIssue): PageStatus {
  const type = issue.state.type.toLowerCase();
  const name = issue.state.name.toLowerCase();
  if (type === "completed" || name === "done") return "done";
  if (type === "canceled" || type === "cancelled") return "canceled";
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
    liveUrl: `https://www.joinhomebase.com${path === "/" ? "" : path}`,
    pillar: pillar.key,
    pillarName: pillar.shortName,
    status: normalizeStatus(issue),
    stateName: issue.state.name,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt,
    labels: issue.labels.nodes.map((label) => label.name),
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

function buildSnapshot(data: NonNullable<LinearResponse["data"]>): Snapshot {
  const projectPages = PILLAR_PROJECTS.flatMap((project) => {
    const projectResult = data[
      project.key as keyof Pick<
        NonNullable<LinearResponse["data"]>,
        "product" | "seo" | "blog" | "foundations"
      >
    ];
    return (projectResult?.issues.nodes ?? [])
      .map((issue) => issueToPage(issue, project))
      .filter((page): page is PageRecord => Boolean(page));
  });

  const pages = dedupePages(projectPages);
  const counts = countStatuses(pages);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyCompleted = pages.filter(
    (page) =>
      page.status === "done" &&
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
  const decisionCounts = countStatuses(
    decisionIssues.map((issue) => ({ status: normalizeStatus(issue) })),
  );
  const sortedDecisionIssues = [...decisionIssues].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const questions = sortedDecisionIssues
    .filter(
      (issue) => isQuestion(issue) && normalizeStatus(issue) !== "canceled",
    )
    .slice(0, 8)
    .map(issueToTracked);
  const recent = sortedDecisionIssues
    .filter((issue) => !isQuestion(issue))
    .slice(0, 8)
    .map(issueToTracked);

  return {
    generatedAt: new Date().toISOString(),
    source: "linear",
    overall: {
      ...counts,
      completion: counts.total ? (counts.done / counts.total) * 100 : 0,
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
    decisions: {
      projectUrl: DECISIONS_PROJECT.url,
      counts: decisionCounts,
      recent,
      questions,
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
        revalidate: 15 * 60,
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
