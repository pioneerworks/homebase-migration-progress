import assert from "node:assert/strict";
import test from "node:test";

import { refreshSnapshot } from "../src/lib/linear";
import {
  DECISIONS_PROJECT,
  HOSTING_PROJECT,
  MIGRATION_PROJECT,
  PILLAR_PROJECTS,
} from "../src/lib/projects";

const originalApiKey = process.env.LINEAR_API_KEY;
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = originalApiKey;
  globalThis.fetch = originalFetch;
});

function projectResponse(
  hasNextPage = false,
  endCursor: string | null = null,
  nodes: Array<Record<string, unknown>> = [],
): Response {
  return Response.json({
    data: {
      project: {
        issues: {
          nodes,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  });
}

function projectUpdatesResponse(
  nodes: Array<Record<string, unknown>> = [],
): Response {
  return Response.json({
    data: {
      project: {
        projectUpdates: { nodes },
      },
    },
  });
}

test("fetches each Linear project separately and follows pagination", async () => {
  process.env.LINEAR_API_KEY = "test-key";
  const requests: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  const issue = (
    identifier: string,
    title: string,
    description: string,
    state: { name: string; type: string },
    labels: string[],
    completedAt: string | null = null,
    canceledAt: string | null = null,
  ) => ({
    identifier,
    title,
    description,
    url: `https://linear.app/joinhomebase/issue/${identifier}`,
    updatedAt: now,
    completedAt,
    canceledAt,
    state,
    labels: { nodes: labels.map((name) => ({ name })) },
    projectMilestone: null,
  });

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    requests.push(request.variables);
    if (request.query.includes("query ProjectUpdates")) {
      if (request.variables.project === MIGRATION_PROJECT.id) {
        return projectUpdatesResponse([
          {
            id: "project-update-test",
            body: [
              "## What's next",
              "1. Configure the Webflow backup host.",
            ].join("\n"),
            health: "onTrack",
            url: "https://linear.app/joinhomebase/project/test/activity#project-update-test",
            createdAt: now,
            updatedAt: now,
          },
        ]);
      }
      return projectUpdatesResponse();
    }
    if (
      request.variables.project === PILLAR_PROJECTS[0].id &&
      request.variables.after === null
    ) {
      return projectResponse(true, "next-page", [
        issue(
          "AIA-TEST-PAGE",
          "Port /test-page",
          "Bring the page to a full content and SEO match.",
          { name: "Done", type: "completed" },
          ["Migration page"],
          now,
        ),
        issue(
          "AIA-TEST-DUPLICATE",
          "Port /test-page",
          "Remove the duplicate route ticket.",
          { name: "Duplicate", type: "canceled" },
          ["Migration page"],
          null,
          now,
        ),
        issue(
          "AIA-TEST-REMOVED",
          "Port /removed-page",
          "Remove this route from migration scope.",
          { name: "Canceled", type: "canceled" },
          ["Migration page"],
          null,
          now,
        ),
      ]);
    }
    if (request.variables.project === HOSTING_PROJECT.id) {
      return projectResponse(false, null, [
        issue(
          "AIA-TEST-HOST",
          "Hosting cutover: /test-page",
          "Approximately half of the hosting configuration is ready.",
          { name: "Backlog", type: "backlog" },
          ["Phase 1"],
        ),
      ]);
    }
    return projectResponse();
  };

  const snapshot = await refreshSnapshot();

  assert.equal(snapshot.source, "linear");
  assert.ok(snapshot.stakeholderRecaps.migration.today.length > 0);
  assert.ok(snapshot.stakeholderRecaps.migration.nextSteps.length > 0);
  assert.ok(snapshot.stakeholderRecaps.cutover.today.length > 0);
  assert.ok(snapshot.stakeholderRecaps.cutover.nextSteps.length > 0);
  assert.equal(
    snapshot.stakeholderRecaps.migration.today[0].sources[0].id,
    "AIA-TEST-PAGE",
  );
  assert.match(snapshot.stakeholderRecaps.migration.today[0].text, /completed/i);
  assert.equal(
    snapshot.stakeholderRecaps.migration.today[1].sources[0].id,
    "AIA-TEST-REMOVED",
  );
  assert.match(
    snapshot.stakeholderRecaps.migration.today[1].text,
    /removed from migration scope/i,
  );
  assert.equal(
    [
      ...snapshot.stakeholderRecaps.migration.today,
      ...snapshot.stakeholderRecaps.migration.week,
      ...snapshot.stakeholderRecaps.migration.workingOn,
      ...snapshot.stakeholderRecaps.migration.nextSteps,
    ]
      .flatMap((item) => item.sources)
      .some((source) => source.id === "AIA-TEST-DUPLICATE"),
    false,
  );
  assert.equal(
    snapshot.stakeholderRecaps.migration.nextSteps[0].sources[0].label,
    "Project update",
  );
  assert.match(snapshot.stakeholderRecaps.migration.nextSteps[0].text, /set up/i);
  assert.match(snapshot.stakeholderRecaps.cutover.today[0].text, /about/i);
  assert.equal(
    snapshot.stakeholderRecaps.cutover.nextSteps[0].sources[0].id,
    "AIA-TEST-HOST",
  );
  assert.equal(requests.length, 10);
  assert.deepEqual(
    requests
      .filter((request) => request.after === null)
      .map((request) => request.project),
    [
      ...PILLAR_PROJECTS.map((project) => project.id),
      DECISIONS_PROJECT.id,
      HOSTING_PROJECT.id,
    ],
  );
  assert.deepEqual(
    requests.find((request) => request.after === "next-page"),
    {
      project: PILLAR_PROJECTS[0].id,
      after: "next-page",
      includeArchived: true,
    },
  );
  assert.equal(
    requests.find((request) => request.project === DECISIONS_PROJECT.id)
      ?.includeArchived,
    false,
  );
  assert.deepEqual(
    requests
      .filter((request) => request.after === undefined)
      .map((request) => request.project)
      .sort(),
    [HOSTING_PROJECT.id, MIGRATION_PROJECT.id].sort(),
  );
});

test("throws when Linear cannot produce live project data", async () => {
  process.env.LINEAR_API_KEY = "test-key";
  globalThis.fetch = async () =>
    Response.json(
      { errors: [{ message: "Query is too complex" }] },
      { status: 400 },
    );

  await assert.rejects(refreshSnapshot(), /Query is too complex/);
});
