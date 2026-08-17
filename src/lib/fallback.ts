import {
  DECISIONS_PROJECT,
  HOSTING_PROJECT,
  MIGRATED_SITE_ORIGIN,
  PILLAR_PROJECTS,
} from "./projects";
import type {
  CutoverRecord,
  PageRecord,
  PageStatus,
  PillarProgress,
  RecapItem,
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
  ["/hourly-wage-calculator", "AIA-2069", "webflow-cloud"],
  ["/press", "AIA-2062", "webflow-cloud"],
];

const fallbackGeneratedAt = "2026-08-14T16:24:00.000Z";
const legacyFallbackTimestamp = "2026-07-30T12:00:00.000Z";

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
    liveUrl: `${MIGRATED_SITE_ORIGIN}${path === "/" ? "" : path}`,
    pillar,
    pillarName: project?.shortName ?? pillar,
    status,
    stateName: status === "done" ? "Done" : "Backlog",
    updatedAt: legacyFallbackTimestamp,
    completedAt: status === "done" ? legacyFallbackTimestamp : null,
    labels: [],
  };
}

const pages = completedPages.map(([path, ticket, pillar]) =>
  page(path, ticket, pillar),
);

const phaseOneCutoverTickets: CutoverRecord[] = [
  ["/payroll", "AIA-1602"],
  ["/payroll-lp", "AIA-1684"],
  ["/food-beverage", "AIA-1543"],
  ["/time-clock/cloud-based-time-tracking", "AIA-2094"],
  ["/homebase-vs-wheniwork", "AIA-2093"],
].map(([path, ticket]) => ({
  path,
  title: `Hosting cutover: ${path}`,
  ticket,
  ticketUrl: `https://linear.app/joinhomebase/issue/${ticket}`,
  status: path === "/payroll" ? "done" : "backlog",
  stateName: path === "/payroll" ? "Done" : "Backlog",
  updatedAt:
    path === "/payroll" ? "2026-08-13T20:08:20.908Z" : legacyFallbackTimestamp,
  completedAt:
    path === "/payroll" ? "2026-08-13T20:08:20.908Z" : null,
  labels: ["Phase 1"],
  milestone: "Phase 1",
}));

const pillarCounts: Record<
  string,
  Pick<PillarProgress, "done" | "active" | "backlog" | "canceled" | "total">
> = {
  product: { done: 59, active: 0, backlog: 0, canceled: 1, total: 60 },
  seo: { done: 31, active: 0, backlog: 0, canceled: 4, total: 35 },
  blog: { done: 1, active: 0, backlog: 0, canceled: 0, total: 1 },
  foundations: { done: 36, active: 0, backlog: 0, canceled: 20, total: 56 },
  "webflow-cloud": { done: 18, active: 3, backlog: 0, canceled: 0, total: 21 },
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

const recap = (text: string, tickets: string[]): RecapItem => ({
  text,
  sources: tickets.map((id) => ({
    id,
    url: `https://linear.app/joinhomebase/issue/${id}`,
  })),
});

export const fallbackSnapshot: Snapshot = {
  generatedAt: fallbackGeneratedAt,
  source: "fallback",
  warning:
    "Showing the last verified snapshot. Add LINEAR_API_KEY in Vercel to enable the full live Linear inventory.",
  overall: {
    total: 165,
    done: 143,
    active: 3,
    backlog: 0,
    canceled: 19,
    completion: 98.2,
    recentlyCompleted: 33,
  },
  pillars,
  pages,
  recentActivity: pages.slice(0, 10),
  blogMigration: {
    estimatedPosts: 829,
    status: "done",
    stateName: "Done",
    primaryIssue: tracked(
      "AIA-1446",
      "Bulk-import the remaining ~829 blog posts from Webflow",
      "Done",
      "The Webflow blog corpus was imported; remaining work focuses on cutover sitemap and redirect validation.",
    ),
    openFollowUps: [
      tracked(
        "AIA-2050",
        "Dynamic Webflow sitemap fetch for cutover",
        "In Review",
        "Keep un-migrated Webflow routes discoverable while the reverse proxy rolls out.",
      ),
      tracked(
        "AIA-2081",
        "Import the full Webflow 301 export into the redirect map",
        "In Review",
        "Validate the production redirect set before expanding the hosting cutover.",
      ),
    ],
  },
  decisions: {
    projectUrl: DECISIONS_PROJECT.url,
    counts: {
      total: 226,
      done: 81,
      active: 7,
      backlog: 135,
      canceled: 3,
    },
    recent,
    questions,
  },
  stakeholderRecaps: {
    migration: {
      asOf: "2026-08-14T16:24:00.000Z",
      today: [
        recap(
          "The state labor law family is the active migration focus, including its route and SEO review.",
          ["AIA-940", "AIA-2008"],
        ),
        recap(
          "Content and SEO decisions are being resolved before more page work is completed.",
          ["AIA-1439", "AIA-1443"],
        ),
      ],
      week: [
        recap(
          "The blog import and several Webflow Cloud routes were finished this week.",
          ["AIA-1446", "AIA-2062", "AIA-2069"],
        ),
        recap(
          "Content and SEO findings were documented for restaurant and homepage pages.",
          ["AIA-1443", "AIA-1348"],
        ),
      ],
      workingOn: [
        recap("The state labor law guide family and its content-quality review.", [
          "AIA-940",
          "AIA-2008",
        ]),
        recap("Restaurant payroll FAQ content still needs a full page match.", [
          "AIA-1443",
        ]),
        recap("Homepage metadata still needs its primary keyword review.", [
          "AIA-1348",
        ]),
      ],
      nextSteps: [
        recap("Resolve the highest-priority content and SEO gaps affecting launch readiness.", [
          "AIA-1443",
          "AIA-1348",
        ]),
        recap("Finish the open page layout and responsive type fixes.", [
          "AIA-1455",
          "AIA-1454",
        ]),
      ],
    },
    cutover: {
      asOf: "2026-08-14T16:24:00.000Z",
      today: [
        recap(
          "The first production route and public Vercel routing layer remain under observation after cutover.",
          ["AIA-1602", "AIA-2193"],
        ),
      ],
      week: [
        recap(
          "The public DNS move to Vercel and the first production route, /payroll, were completed this week.",
          ["AIA-2193", "AIA-1602"],
        ),
        recap("One of five Phase 1 routes is complete.", [
          "AIA-1602",
          "AIA-1684",
          "AIA-1543",
          "AIA-2094",
          "AIA-2093",
        ]),
      ],
      workingOn: [
        recap("Post-cutover checks for /payroll and the public Vercel routing layer.", [
          "AIA-1602",
          "AIA-2193",
        ]),
        recap("Redirect readiness for routes removed from migration scope.", [
          "AIA-1880",
        ]),
      ],
      nextSteps: [
        recap(
          "Prepare /payroll-lp, /food-beverage, /time-clock/cloud-based-time-tracking, and /homebase-vs-wheniwork for Phase 1.",
          ["AIA-1684", "AIA-1543", "AIA-2094", "AIA-2093"],
        ),
        recap("Finish redirect import and validation before expanding the rollout.", [
          "AIA-1880",
        ]),
      ],
    },
  },
  hostingCutover: {
    projectUrl: HOSTING_PROJECT.url,
    overall: {
      total: 167,
      rolloutTotal: 156,
      done: 2,
      active: 0,
      backlog: 154,
      canceled: 11,
      completion: 1.3,
      recentlyCompleted: 2,
    },
    milestones: [
      {
        id: "a8c3fa2f-4454-441b-87c1-a129cecaa60a",
        name: "Phase 1",
        done: 1,
        active: 0,
        backlog: 4,
        canceled: 0,
        total: 5,
      },
      {
        id: "no-milestone",
        name: "No milestone",
        done: 1,
        active: 0,
        backlog: 150,
        canceled: 11,
        total: 162,
      },
    ],
    phaseOne: phaseOneCutoverTickets,
    tickets: [],
  },
};
