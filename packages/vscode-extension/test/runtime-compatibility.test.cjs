"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("../src/__fixtures__/runtime-compatibility/cases.json");
const {
  STATUS_READY,
  STATUS_DEGRADED,
  STATUS_REPAIR,
  evaluateRuntimeCompatibility,
} = require("../src/runtime-compatibility");

test("shared runtime fixture covers every user-facing outcome", () => {
  const statuses = new Set(cases.map((entry) => entry.expected.status));
  assert.deepEqual(
    statuses,
    new Set([STATUS_READY, STATUS_DEGRADED, STATUS_REPAIR]),
  );
});

for (const entry of cases) {
  test(`shared runtime fixture: ${entry.name}`, () => {
    const actual = evaluateRuntimeCompatibility(entry.input);
    assert.equal(actual.status, entry.expected.status);
    assert.equal(actual.cliVersion, entry.expected.cliVersion);
    if (Object.hasOwn(entry.expected, "minimumCliVersion")) {
      assert.equal(actual.minimumCliVersion, entry.expected.minimumCliVersion);
    }
    assert.deepEqual(actual.reasons, entry.expected.reasons);
    assert.match(
      actual.summary,
      new RegExp(actual.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
}
