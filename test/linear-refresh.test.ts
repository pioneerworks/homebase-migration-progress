import assert from "node:assert/strict";
import test from "node:test";

import { refreshSnapshot } from "../src/lib/linear";
import {
  DECISIONS_PROJECT,
  HOSTING_PROJECT,
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
): Response {
  return Response.json({
    data: {
      project: {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  });
}

test("fetches each Linear project separately and follows pagination", async () => {
  process.env.LINEAR_API_KEY = "test-key";
  const requests: Array<Record<string, unknown>> = [];

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      variables: Record<string, unknown>;
    };
    requests.push(request.variables);
    if (
      request.variables.project === PILLAR_PROJECTS[0].id &&
      request.variables.after === null
    ) {
      return projectResponse(true, "next-page");
    }
    return projectResponse();
  };

  const snapshot = await refreshSnapshot();

  assert.equal(snapshot.source, "linear");
  assert.equal(requests.length, 8);
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
