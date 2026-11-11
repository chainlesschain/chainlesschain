import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  installGoalJourneyClock,
} = require("../lib/project-goal-journey-clock.cjs");
const start = "2026-11-11T13:50:00.000Z";

test("synthetic Date preserves explicit dates, parsing, calls and subclasses", () => {
  const target = { Date };
  const before = Date.now();
  const clock = installGoalJourneyClock(start, target);
  assert.equal(clock.synthetic, true);
  assert.equal(clock.realTimers, true);
  assert(Object.isFrozen(clock));
  assert(Math.abs(target.Date.now() - Date.parse(start)) < 1000);
  const first = target.Date.now();
  const constructed = new target.Date().getTime();
  assert(constructed >= first && constructed <= target.Date.now());
  assert(new target.Date() instanceof Date);
  assert.equal(new target.Date(2000, 0, 2).getFullYear(), 2000);
  assert.equal(
    new target.Date("2026-01-01T00:00:00.000Z").toISOString(),
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(target.Date.parse(start), Date.parse(start));
  assert.equal(target.Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1));
  assert.equal(typeof target.Date(), "string");
  class ChildDate extends target.Date {}
  assert(new ChildDate() instanceof ChildDate);
  assert(new ChildDate() instanceof Date);
  assert(Date.now() - before < 1000, "the parent clock must remain real");
});

test("real timers progress while only the owned clock crosses midnight and quiet end", async () => {
  const target = { Date };
  const clock = installGoalJourneyClock(start, target);
  for (const timestamp of [
    "2026-11-11T14:10:00.000Z",
    "2026-11-11T16:05:00.000Z",
    "2026-11-12T00:00:00.000Z",
  ]) {
    clock.advanceTo(timestamp);
    assert(Math.abs(target.Date.now() - Date.parse(timestamp)) < 1000);
    assert.match(new target.Date().toISOString(), /^2026-11-/u);
  }
  const before = target.Date.now();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert(target.Date.now() >= before + 10);
});

test("invalid, backwards and excessive clock changes leave the current offset intact", () => {
  for (const initial of ["invalid", "2026-11-11", "2026-11-11T13:50:00Z"])
    assert.throws(() => installGoalJourneyClock(initial, { Date }), TypeError);
  const target = { Date },
    clock = installGoalJourneyClock(start, target);
  for (const timestamp of [
    "invalid",
    "2026-11-11T13:49:00.000Z",
    "2026-11-14T00:00:00.000Z",
  ])
    assert.throws(() => clock.advanceTo(timestamp), RangeError);
  assert(Math.abs(target.Date.now() - Date.parse(start)) < 1000);
});
