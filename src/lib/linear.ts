import { fallbackSnapshot } from "./fallback";
import {
  DECISIONS_PROJECT,
  HOSTING_PROJECT,
  MIGRATION_PROJECT,
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
  RecapItem,
  RecapSource,
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

interface LinearProjectUpdate {
  id: string;
  body: string;
  health: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface LinearProjectUpdatesResult {
  updates: LinearProjectUpdate[];
}

interface LinearSnapshotData {
  product: LinearProjectResult;
  seo: LinearProjectResult;
  blog: LinearProjectResult;
  foundations: LinearProjectResult;
  webflowCloud: LinearProjectResult;
  decisions: LinearProjectResult;
  hosting: LinearProjectResult;
  mainUpdates: LinearProjectUpdatesResult;
  pageUpdates: LinearProjectUpdatesResult;
  hostingUpdates: LinearProjectUpdatesResult;
}

interface LinearProjectPageResponse {
  data?: {
    project: {
      issues: {
        nodes: LinearIssue[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface LinearProjectUpdatesResponse {
  data?: {
    project: {
      projectUpdates: {
        nodes: LinearProjectUpdate[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}

const projectIssuesQuery = `
  query ProjectIssues(
    $project: String!
    $after: String
    $includeArchived: Boolean!
  ) {
    project(id: $project) {
      issues(
        first: 250
        after: $after
        includeArchived: $includeArchived
      ) {
        nodes { ...IssueFields }
        pageInfo { hasNextPage endCursor }
      }
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

const projectUpdatesQuery = `
  query ProjectUpdates($project: String!) {
    project(id: $project) {
      projectUpdates(first: 10) {
        nodes {
          id
          body
          health
          url
          createdAt
          updatedAt
        }
      }
    }
  }
`;

const snapshotProjects = [
  { id: PILLAR_PROJECTS[0].id, includeArchived: true },
  { id: PILLAR_PROJECTS[1].id, includeArchived: true },
  { id: PILLAR_PROJECTS[2].id, includeArchived: true },
  {
    id: PILLAR_PROJECTS[3].id,
    includeArchived: true,
  },
  {
    id: PILLAR_PROJECTS[4].id,
    includeArchived: true,
  },
  { id: DECISIONS_PROJECT.id, includeArchived: false },
  { id: HOSTING_PROJECT.id, includeArchived: true },
] as const;

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
    milestone: issue.projectMilestone?.name ?? "No milestone",
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
      issue.projectMilestone?.name ?? "No milestone",
      issue.projectMilestone?.id ?? "no-milestone",
    ]),
  );
  const names = [...new Set(tickets.map((ticket) => ticket.milestone))].sort(
    (a, b) => {
      if (a === "Phase 1") return -1;
      if (b === "Phase 1") return 1;
      if (a === "No milestone") return 1;
      if (b === "No milestone") return -1;
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

function torontoDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function currentWeekStartKey(value: string): string {
  const currentKey = torontoDateKey(value);
  const current = new Date(`${currentKey}T12:00:00Z`);
  const daysSinceMonday = (current.getUTCDay() + 6) % 7;
  current.setUTCDate(current.getUTCDate() - daysSinceMonday);
  return current.toISOString().slice(0, 10);
}

function joinRecapItems(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function recapTitle(title: string): string {
  return title
    .replace(/^Hosting cutover:\s*/i, "")
    .replace(/^(?:Port|Migrate|Build)\s+/i, "")
    .replace(/\s+\(Webflow Cloud\).*$/i, "")
    .replace(/\s+—.*$/, "")
    .trim();
}

function recapItem(text: string, sources: RecapSource[]): RecapItem {
  return { text, sources };
}

function issueSource(issue: LinearIssue): RecapSource {
  return { id: issue.identifier, url: issue.url };
}

function pageSource(page: PageRecord): RecapSource {
  return { id: page.ticket, url: page.ticketUrl };
}

function cutoverSource(ticket: CutoverRecord): RecapSource {
  return { id: ticket.ticket, url: ticket.ticketUrl };
}

function projectUpdateSource(update: LinearProjectUpdate): RecapSource {
  return {
    id: update.id,
    label: "Project update",
    url: update.url,
  };
}

function plainLanguage(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bapproximately\b/gi, "about"],
    [/\bcohort\b/gi, "group"],
    [/\bcommence\b/gi, "start"],
    [/\bconfiguration\b/gi, "setup"],
    [/\bconfigure\b/gi, "set up"],
    [/\bdependencies\b/gi, "needs"],
    [/\bfacilitate\b/gi, "help"],
    [/\bimplementation\b/gi, "work"],
    [/\binfrastructure\b/gi, "hosting work"],
    [/\bobjective\b/gi, "goal"],
    [/\bparity\b/gi, "match"],
    [/\bpreserve\b/gi, "keep"],
    [/\bprioritize\b/gi, "focus on"],
    [/\breconciliation\b/gi, "cleanup"],
    [/\breconcile\b/gi, "check and fix"],
    [/\bremediation\b/gi, "fix"],
    [/\bsubsequent\b/gi, "next"],
    [/\bsubstantial\b/gi, "large"],
    [/\butilize\b/gi, "use"],
    [/\bvalidation\b/gi, "checks"],
    [/\bvalidate\b/gi, "check"],
  ];
  return replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

function shortRecapText(value: string): string {
  const text = plainLanguage(value).replace(/\s+/g, " ").trim();
  if (text.length <= 150) return text;
  const shortened = text.slice(0, 147).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

function cleanMarkdownLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .trim();
}

function projectUpdateLine(
  update: LinearProjectUpdate,
  sectionNames: string[],
): string | null {
  const lines = update.body.split("\n");
  const sectionIndex = lines.findIndex((line) => {
    const heading = cleanMarkdownLine(line).toLowerCase();
    return sectionNames.some((name) => heading.includes(name));
  });
  if (sectionIndex === -1) return null;
  for (const line of lines.slice(sectionIndex + 1)) {
    if (/^\s*#{1,3}\s+/.test(line)) break;
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) continue;
    const cleaned = cleanMarkdownLine(line);
    if (cleaned) return shortRecapText(cleaned);
  }
  return null;
}

function markdownHeading(
  line: string,
): { level: number; title: string } | null {
  const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return {
    level: match[1].length,
    title: cleanMarkdownLine(match[2]).toLowerCase(),
  };
}

function structuredProjectUpdateItems(
  update: LinearProjectUpdate,
  sectionName: "page migration" | "hosting cutover",
  subsectionName: "today" | "this week" | "working on now" | "next steps",
  limit: number,
): RecapItem[] {
  const lines = update.body.split("\n");
  const sectionIndex = lines.findIndex(
    (line) => markdownHeading(line)?.title === sectionName,
  );
  if (sectionIndex === -1) return [];

  const sectionLevel = markdownHeading(lines[sectionIndex])?.level ?? 0;
  const sectionEnd = lines.findIndex((line, index) => {
    if (index <= sectionIndex) return false;
    const heading = markdownHeading(line);
    return Boolean(heading && heading.level <= sectionLevel);
  });
  const scopedEnd = sectionEnd === -1 ? lines.length : sectionEnd;
  const subsectionIndex = lines.findIndex((line, index) => {
    if (index <= sectionIndex || index >= scopedEnd) return false;
    return markdownHeading(line)?.title === subsectionName;
  });
  if (subsectionIndex === -1) return [];

  const subsectionLevel = markdownHeading(lines[subsectionIndex])?.level ?? 0;
  const subsectionEnd = lines.findIndex((line, index) => {
    if (index <= subsectionIndex || index >= scopedEnd) return false;
    const heading = markdownHeading(line);
    return Boolean(heading && heading.level <= subsectionLevel);
  });
  const itemEnd = subsectionEnd === -1 ? scopedEnd : subsectionEnd;

  return lines
    .slice(subsectionIndex + 1, itemEnd)
    .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .slice(0, limit)
    .map((text) =>
      recapItem(shortRecapText(text), [projectUpdateSource(update)]),
    );
}

function latestProjectUpdate(
  updates: LinearProjectUpdate[],
): LinearProjectUpdate | null {
  return (
    [...updates].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0] ?? null
  );
}

function recapDetail(issue: LinearIssue): string | null {
  if (!issue.description) return null;
  const beforeChecklist = issue.description
    .split(/\n#{1,3}\s+(?:Acceptance criteria|Checklist|Definition of done)/i)[0]
    .trim();
  if (!beforeChecklist) return null;
  const summary = cleanSummary(beforeChecklist, issue.state.name);
  if (summary.startsWith("Tracked in Linear")) return null;
  return shortRecapText(summary);
}

function contextualIssueText(issue: LinearIssue): string {
  const title = plainLanguage(recapTitle(issue.title));
  const detail = recapDetail(issue);
  return detail ? `${title}: ${detail}` : title;
}

function buildStakeholderRecaps({
  generatedAt,
  projectPages,
  pillarIssues,
  decisionIssues,
  hostingIssues,
  mainProjectUpdates,
  pageProjectUpdates,
  hostingProjectUpdates,
  cutoverTickets,
}: {
  generatedAt: string;
  projectPages: PageRecord[];
  pillarIssues: LinearIssue[];
  decisionIssues: LinearIssue[];
  hostingIssues: LinearIssue[];
  mainProjectUpdates: LinearProjectUpdate[];
  pageProjectUpdates: LinearProjectUpdate[];
  hostingProjectUpdates: LinearProjectUpdate[];
  cutoverTickets: CutoverRecord[];
}): Snapshot["stakeholderRecaps"] {
  const todayKey = torontoDateKey(generatedAt);
  const weekStartKey = currentWeekStartKey(generatedAt);
  const isToday = (value: string | null) =>
    Boolean(value && torontoDateKey(value) === todayKey);
  const isThisWeek = (value: string | null) => {
    if (!value) return false;
    const key = torontoDateKey(value);
    return key >= weekStartKey && key <= todayKey;
  };
  const mainProjectUpdate = latestProjectUpdate(mainProjectUpdates);
  const pageProjectUpdate = latestProjectUpdate(pageProjectUpdates);
  const hostingProjectUpdate = latestProjectUpdate(hostingProjectUpdates);

  const todayDonePages = projectPages.filter(
    (page) => page.status === "done" && isToday(page.completedAt),
  );
  const todayRemovedPages = projectPages.filter(
    (page) => page.status === "canceled" && isToday(page.completedAt),
  );
  const weekDonePages = projectPages.filter(
    (page) => page.status === "done" && isThisWeek(page.completedAt),
  );
  const weekRemovedPages = projectPages.filter(
    (page) => page.status === "canceled" && isThisWeek(page.completedAt),
  );
  const todayDecisionUpdates = decisionIssues.filter((issue) =>
    isToday(issue.updatedAt),
  );
  const activePillarIssues = pillarIssues
    .filter((issue) => normalizeStatus(issue) === "active")
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const todayActiveIssues = activePillarIssues.filter((issue) =>
    isToday(issue.updatedAt),
  );
  const latestPillarIssue = [...pillarIssues].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
  const newestPages = (pages: PageRecord[]) =>
    [...pages].sort(
      (a, b) =>
        new Date(b.completedAt ?? b.updatedAt).getTime() -
        new Date(a.completedAt ?? a.updatedAt).getTime(),
    );
  const openDecisionIssues = decisionIssues
    .filter((issue) => {
      const status = normalizeStatus(issue);
      return status === "active" || status === "backlog";
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const migrationToday: RecapItem[] = todayActiveIssues
    .slice(0, 1)
    .map((issue) =>
      recapItem(`Current focus — ${contextualIssueText(issue)}`, [
        issueSource(issue),
      ]),
    );
  const pageUpdateProgress = pageProjectUpdate
    ? projectUpdateLine(pageProjectUpdate, ["progress so far", "progress"])
    : null;
  const pageUpdateNext = pageProjectUpdate
    ? projectUpdateLine(pageProjectUpdate, ["what’s next", "what's next", "next steps"])
    : null;
  if (
    pageProjectUpdate &&
    pageUpdateProgress &&
    isToday(pageProjectUpdate.createdAt)
  ) {
    migrationToday.unshift(
      recapItem(`From the project update — ${pageUpdateProgress}`, [
        projectUpdateSource(pageProjectUpdate),
      ]),
    );
  }
  const todayDoneHighlights = newestPages(todayDonePages).slice(0, 3);
  if (todayDoneHighlights.length) {
    migrationToday.push(
      recapItem(
        `Completed today: ${joinRecapItems(todayDoneHighlights.map((page) => page.path))}.`,
        todayDoneHighlights.map(pageSource),
      ),
    );
  }
  const todayRemovedHighlights = newestPages(todayRemovedPages).slice(0, 3);
  if (todayRemovedHighlights.length) {
    migrationToday.push(
      recapItem(
        `Removed from migration scope today: ${joinRecapItems(todayRemovedHighlights.map((page) => page.path))}.`,
        todayRemovedHighlights.map(pageSource),
      ),
    );
  }
  const latestDecisionUpdate = [...todayDecisionUpdates].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
  if (latestDecisionUpdate && migrationToday.length < 2) {
    migrationToday.push(
      recapItem(
        `Decision work — ${contextualIssueText(latestDecisionUpdate)}`,
        [issueSource(latestDecisionUpdate)],
      ),
    );
  }
  if (!migrationToday.length && latestPillarIssue) {
    migrationToday.push(
      recapItem(
        `Latest work — ${contextualIssueText(latestPillarIssue)}`,
        [issueSource(latestPillarIssue)],
      ),
    );
  }
  migrationToday.splice(2);

  const weekDoneHighlights = newestPages(weekDonePages).slice(0, 3);
  const weekRemovedHighlights = newestPages(weekRemovedPages).slice(0, 3);
  const webflowCloudHighlights = newestPages(
    weekDonePages.filter((page) => page.pillar === "webflow-cloud"),
  ).slice(0, 2);
  const migrationWeek: RecapItem[] = weekDoneHighlights.length
    ? [
        recapItem(
          `Finished this week: ${joinRecapItems(weekDoneHighlights.map((page) => page.path))}.`,
          weekDoneHighlights.map(pageSource),
        ),
      ]
    : [];
  if (weekRemovedHighlights.length) {
    migrationWeek.push(
      recapItem(
        `Removed from migration scope this week: ${joinRecapItems(weekRemovedHighlights.map((page) => page.path))}.`,
        weekRemovedHighlights.map(pageSource),
      ),
    );
  }
  if (
    pageProjectUpdate &&
    pageUpdateProgress &&
    isThisWeek(pageProjectUpdate.createdAt)
  ) {
    migrationWeek.unshift(
      recapItem(`From the project update — ${pageUpdateProgress}`, [
        projectUpdateSource(pageProjectUpdate),
      ]),
    );
  }
  if (webflowCloudHighlights.length) {
    migrationWeek.push(
      recapItem(
        `Webflow Cloud progress included ${joinRecapItems(webflowCloudHighlights.map((page) => page.path))}.`,
        webflowCloudHighlights.map(pageSource),
      ),
    );
  }
  if (!migrationWeek.length && latestPillarIssue) {
    migrationWeek.push(
      recapItem(
        `Latest migration context — ${contextualIssueText(latestPillarIssue)}`,
        [issueSource(latestPillarIssue)],
      ),
    );
  }
  migrationWeek.splice(2);

  const weekCompletedCutover = cutoverTickets.filter(
    (ticket) => ticket.status === "done" && isThisWeek(ticket.completedAt),
  );
  const todayCompletedCutover = cutoverTickets.filter(
    (ticket) => ticket.status === "done" && isToday(ticket.completedAt),
  );
  const phaseOne = cutoverTickets.filter((ticket) =>
    ticket.labels.includes("Phase 1"),
  );
  const phaseOneRemaining = phaseOne.filter(
    (ticket) => ticket.status !== "done" && ticket.status !== "canceled",
  );
  const payrollCompleted = weekCompletedCutover.some(
    (ticket) => ticket.path === "/payroll",
  );
  const hostingIssueById = new Map(
    hostingIssues.map((issue) => [issue.identifier, issue]),
  );
  const todayHostingUpdates = hostingIssues
    .filter((issue) => isToday(issue.updatedAt))
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const activeHostingIssues = hostingIssues
    .filter((issue) => normalizeStatus(issue) === "active")
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const latestHostingIssue = [...hostingIssues].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
  const redirectWork = cutoverTickets.find(
    (ticket) =>
      ticket.status !== "done" &&
      ticket.status !== "canceled" &&
      ticket.title.toLowerCase().includes("redirect"),
  );
  const cutoverToday: RecapItem[] = todayHostingUpdates
    .slice(0, 2)
    .map((issue) =>
      recapItem(contextualIssueText(issue), [issueSource(issue)]),
    );
  const hostingUpdateProgress = hostingProjectUpdate
    ? projectUpdateLine(hostingProjectUpdate, ["progress so far", "progress"])
    : null;
  const hostingUpdateNext = hostingProjectUpdate
    ? projectUpdateLine(hostingProjectUpdate, ["what’s next", "what's next", "next steps"])
    : null;
  if (
    hostingProjectUpdate &&
    hostingUpdateProgress &&
    isToday(hostingProjectUpdate.createdAt)
  ) {
    cutoverToday.unshift(
      recapItem(`From the project update — ${hostingUpdateProgress}`, [
        projectUpdateSource(hostingProjectUpdate),
      ]),
    );
  }
  if (!cutoverToday.length && todayCompletedCutover[0]) {
    const ticket = todayCompletedCutover[0];
    const issue = hostingIssueById.get(ticket.ticket);
    cutoverToday.push(
      recapItem(
        `Latest completed work under observation — ${issue ? contextualIssueText(issue) : recapTitle(ticket.title)}`,
        [cutoverSource(ticket)],
      ),
    );
  }
  if (!cutoverToday.length && latestHostingIssue) {
    cutoverToday.push(
      recapItem(
        `Latest work — ${contextualIssueText(latestHostingIssue)}`,
        [issueSource(latestHostingIssue)],
      ),
    );
  }
  cutoverToday.splice(2);

  const weekCompletedHighlights = [...weekCompletedCutover]
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.updatedAt).getTime() -
        new Date(a.completedAt ?? a.updatedAt).getTime(),
    )
    .slice(0, 3);
  const cutoverWeek: RecapItem[] = weekCompletedHighlights.length
    ? [
        recapItem(
          `Completed this week: ${joinRecapItems(weekCompletedHighlights.map((ticket) => recapTitle(ticket.title)))}.`,
          weekCompletedHighlights.map(cutoverSource),
        ),
      ]
    : [];
  if (
    hostingProjectUpdate &&
    hostingUpdateProgress &&
    isThisWeek(hostingProjectUpdate.createdAt)
  ) {
    cutoverWeek.unshift(
      recapItem(`From the project update — ${hostingUpdateProgress}`, [
        projectUpdateSource(hostingProjectUpdate),
      ]),
    );
  }
  if (phaseOne.length) {
    cutoverWeek.push(
      recapItem(
        `${phaseOne.filter((ticket) => ticket.status === "done").length} of ${phaseOne.length} Phase 1 routes are complete.`,
        phaseOne.map(cutoverSource),
      ),
    );
  }
  cutoverWeek.splice(2);

  const migrationWorkingOn = activePillarIssues.slice(0, 3).map((issue) =>
    recapItem(contextualIssueText(issue), [issueSource(issue)]),
  );
  if (!migrationWorkingOn.length && openDecisionIssues[0]) {
    migrationWorkingOn.push(
      recapItem(contextualIssueText(openDecisionIssues[0]), [
        issueSource(openDecisionIssues[0]),
      ]),
    );
  }
  const migrationNextSteps: RecapItem[] = [];
  if (
    pageProjectUpdate &&
    pageUpdateNext &&
    isThisWeek(pageProjectUpdate.createdAt)
  ) {
    migrationNextSteps.push(
      recapItem(`From the project update — ${pageUpdateNext}`, [
        projectUpdateSource(pageProjectUpdate),
      ]),
    );
  }
  if (activePillarIssues[0]) {
    migrationNextSteps.push(
      recapItem(
        `Close the active work on ${recapTitle(activePillarIssues[0].title)} before expanding the cutover set.`,
        [issueSource(activePillarIssues[0])],
      ),
    );
  }
  if (openDecisionIssues[0]) {
    migrationNextSteps.push(
      recapItem(
        `Next decision — ${contextualIssueText(openDecisionIssues[0])}`,
        [issueSource(openDecisionIssues[0])],
      ),
    );
  }
  if (!migrationNextSteps.length && latestPillarIssue) {
    migrationNextSteps.push(
      recapItem(`Check next — ${contextualIssueText(latestPillarIssue)}`, [
        issueSource(latestPillarIssue),
      ]),
    );
  }
  migrationNextSteps.splice(2);

  const cutoverWorkingOn = activeHostingIssues.slice(0, 2).map((issue) =>
    recapItem(contextualIssueText(issue), [issueSource(issue)]),
  );
  if (!cutoverWorkingOn.length && payrollCompleted) {
    const payroll = weekCompletedCutover.find(
      (ticket) => ticket.path === "/payroll",
    );
    if (payroll) {
      cutoverWorkingOn.push(
        recapItem(
          "Monitoring /payroll and the public Vercel routing layer after cutover.",
          [cutoverSource(payroll)],
        ),
      );
    }
  }
  if (!cutoverWorkingOn.length && latestHostingIssue) {
    cutoverWorkingOn.push(
      recapItem(contextualIssueText(latestHostingIssue), [
        issueSource(latestHostingIssue),
      ]),
    );
  }
  const cutoverNextSteps: RecapItem[] = [];
  if (
    hostingProjectUpdate &&
    hostingUpdateNext &&
    isThisWeek(hostingProjectUpdate.createdAt)
  ) {
    cutoverNextSteps.push(
      recapItem(`From the project update — ${hostingUpdateNext}`, [
        projectUpdateSource(hostingProjectUpdate),
      ]),
    );
  }
  if (phaseOneRemaining.length) {
    cutoverNextSteps.push(
      recapItem(
        `Prepare the remaining Phase 1 routes: ${joinRecapItems(
          phaseOneRemaining.map(
            (ticket) => ticket.path ?? recapTitle(ticket.title),
          ),
        )}.`,
        phaseOneRemaining.map(cutoverSource),
      ),
    );
  }
  if (redirectWork) {
    const redirectIssue = hostingIssueById.get(redirectWork.ticket);
    cutoverNextSteps.push(
      recapItem(
        redirectIssue
          ? `Redirect work — ${contextualIssueText(redirectIssue)}`
          : "Finish redirect import and validation before expanding the rollout.",
        [cutoverSource(redirectWork)],
      ),
    );
  }
  if (!cutoverNextSteps.length && latestHostingIssue) {
    cutoverNextSteps.push(
      recapItem(`Check next — ${contextualIssueText(latestHostingIssue)}`, [
        issueSource(latestHostingIssue),
      ]),
    );
  }
  cutoverNextSteps.splice(2);

  const structuredRecap = (
    sectionName: "page migration" | "hosting cutover",
  ) => ({
    today:
      mainProjectUpdate && isToday(mainProjectUpdate.createdAt)
        ? structuredProjectUpdateItems(
            mainProjectUpdate,
            sectionName,
            "today",
            2,
          )
        : [],
    week:
      mainProjectUpdate && isThisWeek(mainProjectUpdate.createdAt)
        ? structuredProjectUpdateItems(
            mainProjectUpdate,
            sectionName,
            "this week",
            2,
          )
        : [],
    workingOn:
      mainProjectUpdate && isThisWeek(mainProjectUpdate.createdAt)
        ? structuredProjectUpdateItems(
            mainProjectUpdate,
            sectionName,
            "working on now",
            3,
          )
        : [],
    nextSteps:
      mainProjectUpdate && isThisWeek(mainProjectUpdate.createdAt)
        ? structuredProjectUpdateItems(
            mainProjectUpdate,
            sectionName,
            "next steps",
            2,
          )
        : [],
  });
  const pageStructuredRecap = structuredRecap("page migration");
  const hostingStructuredRecap = structuredRecap("hosting cutover");

  return {
    migration: {
      asOf: generatedAt,
      today: pageStructuredRecap.today.length
        ? pageStructuredRecap.today
        : migrationToday,
      week: pageStructuredRecap.week.length
        ? pageStructuredRecap.week
        : migrationWeek,
      workingOn: pageStructuredRecap.workingOn.length
        ? pageStructuredRecap.workingOn
        : migrationWorkingOn,
      nextSteps: pageStructuredRecap.nextSteps.length
        ? pageStructuredRecap.nextSteps
        : migrationNextSteps,
    },
    cutover: {
      asOf: generatedAt,
      today: hostingStructuredRecap.today.length
        ? hostingStructuredRecap.today
        : cutoverToday,
      week: hostingStructuredRecap.week.length
        ? hostingStructuredRecap.week
        : cutoverWeek,
      workingOn: hostingStructuredRecap.workingOn.length
        ? hostingStructuredRecap.workingOn
        : cutoverWorkingOn,
      nextSteps: hostingStructuredRecap.nextSteps.length
        ? hostingStructuredRecap.nextSteps
        : cutoverNextSteps,
    },
  };
}

function buildSnapshot(data: LinearSnapshotData): Snapshot {
  const generatedAt = new Date().toISOString();
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
  const pillarIssues = [
    data.product,
    data.seo,
    data.blog,
    data.foundations,
    data.webflowCloud,
  ].flatMap((result) => result?.issues.nodes ?? []);

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
    generatedAt,
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
    stakeholderRecaps: buildStakeholderRecaps({
      generatedAt,
      projectPages: pages,
      pillarIssues,
      decisionIssues,
      hostingIssues,
      mainProjectUpdates: data.mainUpdates.updates,
      pageProjectUpdates: data.pageUpdates.updates,
      hostingProjectUpdates: data.hostingUpdates.updates,
      cutoverTickets,
    }),
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
    return await getLiveSnapshot(apiKey);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Linear API error";
    return {
      ...fallbackSnapshot,
      warning: `Live Linear refresh failed: ${message}. Showing the last verified snapshot.`,
    };
  }
}

async function fetchProjectIssues(
  apiKey: string,
  project: string,
  includeArchived: boolean,
): Promise<LinearProjectResult> {
  const nodes: LinearIssue[] = [];
  let after: string | null = null;

  do {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: projectIssuesQuery,
        variables: { project, after, includeArchived },
      }),
      next: {
        revalidate: 60 * 60,
        tags: [SNAPSHOT_TAG],
      },
    });

    const payload = (await response.json()) as LinearProjectPageResponse;
    if (!response.ok || payload.errors?.length || !payload.data?.project) {
      const detail = payload.errors?.map((error) => error.message).join("; ");
      throw new Error(
        detail ||
          (response.ok
            ? "Linear returned no project data"
            : `Linear returned HTTP ${response.status}`),
      );
    }

    nodes.push(...payload.data.project.issues.nodes);
    const { hasNextPage, endCursor } = payload.data.project.issues.pageInfo;
    after = hasNextPage ? endCursor : null;
    if (hasNextPage && !after) {
      throw new Error("Linear pagination did not return an end cursor");
    }
  } while (after);

  return { issues: { nodes } };
}

async function fetchProjectUpdates(
  apiKey: string,
  project: string,
): Promise<LinearProjectUpdatesResult> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: projectUpdatesQuery,
      variables: { project },
    }),
    next: {
      revalidate: 60 * 60,
      tags: [SNAPSHOT_TAG],
    },
  });

  const payload = (await response.json()) as LinearProjectUpdatesResponse;
  if (!response.ok || payload.errors?.length || !payload.data?.project) {
    const detail = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(
      detail ||
        (response.ok
          ? "Linear returned no project update data"
          : `Linear returned HTTP ${response.status}`),
    );
  }

  return { updates: payload.data.project.projectUpdates.nodes };
}

async function getLiveSnapshot(apiKey: string): Promise<Snapshot> {
  const [projectResults, mainUpdates, pageUpdateResults, hostingUpdates] =
    await Promise.all([
      Promise.all(
        snapshotProjects.map(({ id, includeArchived }) =>
          fetchProjectIssues(apiKey, id, includeArchived),
        ),
      ),
      fetchProjectUpdates(apiKey, MIGRATION_PROJECT.id),
      Promise.all(
        PILLAR_PROJECTS.map((project) =>
          fetchProjectUpdates(apiKey, project.id),
        ),
      ),
      fetchProjectUpdates(apiKey, HOSTING_PROJECT.id),
    ]);
  const [product, seo, blog, foundations, webflowCloud, decisions, hosting] =
    projectResults;

  return buildSnapshot({
    product,
    seo,
    blog,
    foundations,
    webflowCloud,
    decisions,
    hosting,
    mainUpdates,
    pageUpdates: {
      updates: pageUpdateResults.flatMap((result) => result.updates),
    },
    hostingUpdates,
  });
}

export async function refreshSnapshot(): Promise<Snapshot> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY is not configured");
  return getLiveSnapshot(apiKey);
}
