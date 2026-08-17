import assert from "node:assert/strict";
import test from "node:test";

import {
  cutoverCompletion,
  extractCutoverPathFromTitle,
  resolvedCompletion,
} from "../src/lib/linear";
import { fallbackSnapshot } from "../src/lib/fallback";
import { PILLAR_PROJECTS } from "../src/lib/projects";

test("extracts simple and nested Hosting cutover routes", () => {
  assert.equal(extractCutoverPathFromTitle("Hosting cutover: /"), "/");
  assert.equal(
    extractCutoverPathFromTitle("Hosting cutover: /payroll"),
    "/payroll",
  );
  assert.equal(
    extractCutoverPathFromTitle(
      "Hosting cutover: /time-clock/cloud-based-time-tracking",
    ),
    "/time-clock/cloud-based-time-tracking",
  );
  assert.equal(
    extractCutoverPathFromTitle(
      "Hosting cutover: https://www.joinhomebase.com/payroll-lp",
    ),
    "/payroll-lp",
  );
});

test("does not treat cross-project implementation work as a route", () => {
  assert.equal(
    extractCutoverPathFromTitle(
      "Hosting cutover: implement redirects for retired routes",
    ),
    null,
  );
});

test("excludes canceled tickets from cutover completion", () => {
  assert.equal(
    cutoverCompletion({
      total: 10,
      done: 4,
      active: 2,
      backlog: 2,
      canceled: 2,
    }),
    50,
  );
  assert.equal(
    cutoverCompletion({
      total: 3,
      done: 0,
      active: 0,
      backlog: 0,
      canceled: 3,
    }),
    0,
  );
});

test("counts canceled or duplicate page routes as resolved parity", () => {
  assert.equal(
    resolvedCompletion({
      total: 10,
      done: 6,
      active: 1,
      backlog: 1,
      canceled: 2,
    }),
    80,
  );
  assert.equal(
    resolvedCompletion({
      total: 4,
      done: 2,
      active: 0,
      backlog: 0,
      canceled: 2,
    }),
    100,
  );
});

test("includes Webflow Cloud as a page-parity track", () => {
  const project = PILLAR_PROJECTS.find(
    (candidate) => candidate.key === "webflow-cloud",
  );

  assert.deepEqual(project, {
    id: "06c2c723-c6b0-4ef5-a138-d2daacc5f52d",
    key: "webflow-cloud",
    name: "Webflow Cloud pages",
    shortName: "Webflow Cloud",
    url: "https://linear.app/joinhomebase/project/pillar-migration-webflow-cloud-pages-32be9962a7bf",
  });
});

test("fallback parity matches the verified five-track snapshot", () => {
  assert.deepEqual(fallbackSnapshot.overall, {
    total: 165,
    done: 143,
    active: 3,
    backlog: 0,
    canceled: 19,
    completion: 98.2,
    recentlyCompleted: 33,
  });
  assert.deepEqual(
    fallbackSnapshot.pages
      .filter((page) => page.pillar === "webflow-cloud")
      .map((page) => page.path)
      .sort(),
    ["/hourly-wage-calculator", "/press"],
  );
  assert.equal(
    fallbackSnapshot.pages.some(
      (page) => page.path === "/free-timesheets-smallbusiness-lp",
    ),
    false,
  );
  assert.match(
    fallbackSnapshot.stakeholderRecaps.migration.today
      .map((item) => item.text)
      .join(" "),
    /state labor law family/i,
  );
  const migrationRecap = fallbackSnapshot.stakeholderRecaps.migration;
  const migrationRecapSources = [
    ...migrationRecap.today,
    ...migrationRecap.week,
    ...migrationRecap.workingOn,
    ...migrationRecap.nextSteps,
  ].flatMap((item) => item.sources.map((source) => source.id));
  assert.equal(
    migrationRecapSources.some((source) =>
      [
        "AIA-1602",
        "AIA-1684",
        "AIA-1543",
        "AIA-1880",
        "AIA-2050",
        "AIA-2081",
        "AIA-2093",
        "AIA-2094",
        "AIA-2193",
      ].includes(source),
    ),
    false,
  );
  assert.match(
    fallbackSnapshot.stakeholderRecaps.cutover.week
      .map((item) => item.text)
      .join(" "),
    /public DNS move to Vercel.*\/payroll/i,
  );
  assert.deepEqual(
    fallbackSnapshot.stakeholderRecaps.cutover.week[0].sources.map(
      (source) => source.id,
    ),
    ["AIA-2193", "AIA-1602"],
  );
  assert.equal(fallbackSnapshot.hostingCutover.phaseOne[0].status, "done");
  assert.deepEqual(
    fallbackSnapshot.hostingCutover.milestones.map((milestone) => ({
      name: milestone.name,
      total: milestone.total,
    })),
    [
      { name: "Phase 1", total: 5 },
      { name: "No milestone", total: 162 },
    ],
  );
  assert.equal(
    fallbackSnapshot.hostingCutover.phaseOne.every(
      (ticket) => ticket.milestone === "Phase 1",
    ),
    true,
  );
});
