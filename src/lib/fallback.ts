import { DECISIONS_PROJECT, PILLAR_PROJECTS } from "./projects";
import type {
  PageRecord,
  PageStatus,
  PillarProgress,
  Snapshot,
  TrackedIssue,
} from "./types";

const completedPages: Array<[string, string, string]> = [
  ["/industry/nonprofit-payroll", "AIA-976", "product"],
  ["/food-truck-catering-event-management", "AIA-954", "seo"],
  ["/groceries-and-markets", "AIA-951", "seo"],
  ["/construction-crews", "AIA-950", "seo"],
  ["/bar-winery-brewery-scheduling", "AIA-953", "seo"],
  ["/cleaning-crews", "AIA-952", "seo"],
  ["/healthcare", "AIA-949", "seo"],
  ["/cashout-employer", "AIA-888", "foundations"],
  ["/free-employee-scheduling-app-lp", "AIA-893", "foundations"],
  ["/free-clock-in-out-app-lp", "AIA-889", "foundations"],
  ["/ai-assistants", "AIA-985", "product"],
  ["/hiring-and-onboarding", "AIA-981", "product"],
  ["/square", "AIA-1010", "product"],
  ["/tableneeds", "AIA-1024", "product"],
  ["/lightspeed", "AIA-1013", "product"],
  ["/adp", "AIA-1014", "product"],
  ["/gusto", "AIA-1015", "product"],
  ["/rippling", "AIA-1017", "product"],
  ["/shopify", "AIA-1011", "product"],
  ["/elavon", "AIA-1018", "product"],
  ["/payanywhere", "AIA-1020", "product"],
  ["/industry/restaurant-payroll", "AIA-971", "product"],
  ["/industry/retail-payroll", "AIA-972", "product"],
  ["/industry/construction-payroll", "AIA-973", "product"],
  ["/industry/salon-payroll", "AIA-974", "product"],
  ["/industry/hospitality-payroll", "AIA-975", "product"],
  ["/", "AIA-913", "foundations"],
  ["/pricing", "AIA-914", "foundations"],
  ["/free-employee-scheduling", "AIA-886", "foundations"],
  ["/free-time-clock-app-lp", "AIA-891", "foundations"],
  ["/how-it-works", "AIA-911", "foundations"],
  ["/compare", "AIA-906", "foundations"],
  ["/comparison/quickbooks-time", "AIA-896", "foundations"],
  ["/employee-scheduling", "AIA-979", "product"],
  ["/faq-cashout", "AIA-1026", "product"],
  ["/app", "AIA-993", "product"],
  ["/hr-compliance", "AIA-984", "product"],
  ["/employee-happiness", "AIA-983", "product"],
  ["/team-communication", "AIA-982", "product"],
  ["/timesheets", "AIA-980", "product"],
  ["/time-clock", "AIA-978", "product"],
  ["/awards", "AIA-988", "product"],
  ["/state-labor-laws", "AIA-940", "seo"],
  ["/free-timesheets-smallbusiness-lp", "AIA-967", "seo"],
  ["/restaurants", "AIA-948", "seo"],
  ["/bug-bounty-program", "AIA-1027", "seo"],
  ["/privacy", "AIA-955", "seo"],
  ["/education-caregiving", "AIA-946", "seo"],
  ["/medical-veterinary", "AIA-947", "seo"],
  ["/retail", "AIA-942", "seo"],
  ["/health-beauty", "AIA-944", "seo"],
  ["/home-repair", "AIA-941", "seo"],
  ["/hospitality-entertainment", "AIA-945", "seo"],
  ["/contact-sales", "AIA-917", "foundations"],
  ["/talk-to-us", "AIA-916", "foundations"],
  ["/careers", "AIA-915", "foundations"],
  ["/events-talk-to-us", "AIA-930", "foundations"],
  ["/accountants-talk-to-us", "AIA-931", "foundations"],
  ["/payroll-talk-to-us", "AIA-932", "foundations"],
];

const fallbackGeneratedAt = "2026-07-30T12:00:00.000Z";

function page(
  path: string,
  ticket: string,
  pillar: string,
  status: PageStatus = "done",
): PageRecord {
  const project = PILLAR_PROJECTS.find((item) => item.key === pillar);
  return {
    path,
    title: `Port ${path === "/" ? "homepage" : path}`,
    ticket,
    ticketUrl: `https://linear.app/joinhomebase/issue/${ticket}`,
    liveUrl: `https://www.joinhomebase.com${path === "/" ? "" : path}`,
    pillar,
    pillarName: project?.shortName ?? pillar,
    status,
    stateName: status === "done" ? "Done" : "Backlog",
    updatedAt: fallbackGeneratedAt,
    completedAt: status === "done" ? fallbackGeneratedAt : null,
    labels: [],
  };
}

const pages = completedPages.map(([path, ticket, pillar]) =>
  page(path, ticket, pillar),
);

const pillarCounts: Record<
  string,
  Pick<PillarProgress, "done" | "active" | "backlog" | "canceled" | "total">
> = {
  product: { done: 26, active: 2, backlog: 30, canceled: 0, total: 58 },
  seo: { done: 17, active: 1, backlog: 17, canceled: 0, total: 35 },
  blog: { done: 0, active: 1, backlog: 0, canceled: 0, total: 1 },
  foundations: { done: 16, active: 4, backlog: 34, canceled: 0, total: 54 },
};

const pillars = PILLAR_PROJECTS.map((project) => ({
  id: project.key,
  name: project.name,
  shortName: project.shortName,
  url: project.url,
  ...pillarCounts[project.key],
}));

const tracked = (
  id: string,
  title: string,
  status: string,
  summary: string,
): TrackedIssue => ({
  id,
  title,
  status,
  summary,
  url: `https://linear.app/joinhomebase/issue/${id}`,
  updatedAt: fallbackGeneratedAt,
  labels: [],
});

const recent = [
  tracked(
    "AIA-1457",
    "Ship larger AccordionShowcase labels and cross-fade transitions",
    "In Review",
    "The food-truck page uses bolder tab labels and cross-fades screenshots instead of reproducing the smaller static Webflow treatment.",
  ),
  tracked(
    "AIA-1439",
    "Correct four inherited Webflow copy defects",
    "Backlog",
    "Four migrated pages intentionally correct typos or wrong-page copy inherited from Webflow.",
  ),
  tracked(
    "AIA-1436",
    "Accept /audio-lp’s current layout instead of chasing live",
    "Backlog",
    "The page owner prefers the migrated layout; its known structural deltas are accepted divergences.",
  ),
  tracked(
    "AIA-1355",
    "Remove the stale “[2023]” from /cleaning-crews",
    "Done",
    "The migrated H1 corrects an outdated year suffix while preserving the existing SEO metadata.",
  ),
  tracked(
    "AIA-1342",
    "Standardize segment pages on the /retail reviews band",
    "Done",
    "Segment pages share one reviews-band structure even where individual Webflow pages differ.",
  ),
];

const questions = [
  tracked(
    "AIA-1443",
    "Restaurant-payroll is missing two live FAQ answers",
    "Backlog",
    "The labor-cost and POS-to-payroll questions still need to be ported.",
  ),
  tracked(
    "AIA-1455",
    "Food-truck SplitHeader is approximately 100px shorter than live",
    "Backlog",
    "The hero is consistently shorter because live includes an empty rich-text block and an additional column gutter.",
  ),
  tracked(
    "AIA-1454",
    "FeatureRow subheadings miss live’s responsive h3 scale",
    "Backlog",
    "Bullet-group headings are fixed at 22px instead of following live’s responsive type scale.",
  ),
  tracked(
    "AIA-1445",
    "Ploy imports accumulate duplicate font declarations",
    "In Review",
    "Each page import appends another dead font-family declaration to the shared Astro layout.",
  ),
  tracked(
    "AIA-1348",
    "Homepage metadata drops four primary keywords",
    "Backlog",
    "An SEO owner call is required on scheduling, time-clock and payroll terms missing from the migrated metadata.",
  ),
];

export const fallbackSnapshot: Snapshot = {
  generatedAt: fallbackGeneratedAt,
  source: "fallback",
  warning:
    "Showing the last verified snapshot. Add LINEAR_API_KEY in Vercel to enable live Linear data.",
  overall: {
    total: 148,
    done: 59,
    active: 8,
    backlog: 81,
    canceled: 0,
    completion: 39.9,
    recentlyCompleted: 10,
  },
  pillars,
  pages,
  recentActivity: pages.slice(0, 10),
  decisions: {
    projectUrl: DECISIONS_PROJECT.url,
    counts: {
      total: 93,
      done: 59,
      active: 8,
      backlog: 23,
      canceled: 3,
    },
    recent,
    questions,
  },
};
