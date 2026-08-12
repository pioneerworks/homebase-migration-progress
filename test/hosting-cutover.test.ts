import assert from "node:assert/strict";
import test from "node:test";

import {
  cutoverCompletion,
  extractCutoverPathFromTitle,
  resolvedCompletion,
} from "../src/lib/linear";

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
