/**
 * Pure scheduling planner (P1 unified event runtime): deterministic jitter,
 * adaptive next-wakeup, and expiry. Pure + clock-injected — no timers.
 */
import { describe, it, expect } from "vitest";
import {
  jitterOffsetMs,
  baseFireAt,
  effectiveFireAt,
  isSchedulable,
  isEntryExpired,
  partitionSchedule,
  nextWakeupAt,
  msUntilNextWakeup,
} from "../../src/lib/schedule-planner.js";

const cron = (over = {}) => ({
  id: "c1",
  kind: "cron",
  status: "active",
  nextAt: 1000,
  ...over,
});
const wakeup = (over = {}) => ({
  id: "w1",
  kind: "wakeup",
  status: "pending",
  dueAt: 1000,
  ...over,
});

describe("jitterOffsetMs", () => {
  it("is deterministic and bounded to [0, jitterMs)", () => {
    const a = jitterOffsetMs("task-abc", 60000);
    const b = jitterOffsetMs("task-abc", 60000);
    expect(a).toBe(b); // stable across calls (and, being a pure hash, restarts)
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(60000);
  });

  it("spreads different ids (not all the same offset)", () => {
    const offsets = new Set(
      ["a", "b", "c", "d", "e", "f"].map((id) => jitterOffsetMs(id, 60000)),
    );
    expect(offsets.size).toBeGreaterThan(1); // co-scheduled tasks fan out
  });

  it("is zero when jitter is disabled", () => {
    expect(jitterOffsetMs("x", 0)).toBe(0);
    expect(jitterOffsetMs("x", -5)).toBe(0);
  });
});

describe("baseFireAt / effectiveFireAt", () => {
  it("reads dueAt for wakeup, nextAt otherwise", () => {
    expect(baseFireAt(wakeup({ dueAt: 42 }))).toBe(42);
    expect(baseFireAt(cron({ nextAt: 99 }))).toBe(99);
    expect(baseFireAt({ kind: "cron", nextAt: "bad" })).toBe(null);
  });

  it("applies the deterministic jitter on top of the base", () => {
    const c = cron({ id: "jit", nextAt: 1000 });
    const eff = effectiveFireAt(c, 5000);
    expect(eff).toBe(1000 + jitterOffsetMs("jit", 5000));
    // jitter=0 → base unchanged
    expect(effectiveFireAt(c, 0)).toBe(1000);
  });
});

describe("isSchedulable / isEntryExpired", () => {
  it("only pending wakeups and active recurring are schedulable", () => {
    expect(isSchedulable(wakeup({ status: "pending" }))).toBe(true);
    expect(isSchedulable(wakeup({ status: "fired" }))).toBe(false);
    expect(isSchedulable(cron({ status: "active" }))).toBe(true);
    expect(isSchedulable(cron({ status: "exhausted" }))).toBe(false);
    expect(isSchedulable(null)).toBe(false);
  });

  it("expiresAt at or before now expires; missing never expires", () => {
    expect(isEntryExpired(cron({ expiresAt: 500 }), 1000)).toBe(true);
    expect(isEntryExpired(cron({ expiresAt: 2000 }), 1000)).toBe(false);
    expect(isEntryExpired(cron({}), 1000)).toBe(false);
    expect(isEntryExpired(cron({ expiresAt: 0 }), 1000)).toBe(false);
  });
});

describe("partitionSchedule", () => {
  it("splits into expired / due / waiting, retiring expired before firing", () => {
    const entries = [
      cron({ id: "due1", nextAt: 900 }),
      cron({ id: "wait1", nextAt: 2000 }),
      wakeup({ id: "duew", dueAt: 1000 }),
      cron({ id: "exp1", nextAt: 900, expiresAt: 500 }), // due-looking BUT expired
      cron({ id: "term", status: "exhausted", nextAt: 1 }), // terminal → skipped
    ];
    const { expired, due, waiting } = partitionSchedule(entries, { now: 1000 });
    expect(expired.map((e) => e.id)).toEqual(["exp1"]);
    expect(due.map((e) => e.id).sort()).toEqual(["due1", "duew"]);
    expect(waiting.map((e) => e.id)).toEqual(["wait1"]);
  });

  it("with jitter, a task can shift from due to waiting deterministically", () => {
    // base nextAt == now, but jitter pushes the effective fire into the future.
    const c = cron({ id: "j", nextAt: 1000 });
    const offset = jitterOffsetMs("j", 5000);
    expect(offset).toBeGreaterThan(0); // this id draws a non-zero offset
    const { due, waiting } = partitionSchedule([c], {
      now: 1000,
      jitterMs: 5000,
    });
    expect(due).toEqual([]);
    expect(waiting.map((e) => e.id)).toEqual(["j"]);
    // once now passes the jittered time, it fires
    const after = partitionSchedule([c], {
      now: 1000 + offset,
      jitterMs: 5000,
    });
    expect(after.due.map((e) => e.id)).toEqual(["j"]);
  });
});

describe("nextWakeupAt / msUntilNextWakeup (adaptive wakeup)", () => {
  const entries = [
    cron({ id: "a", nextAt: 5000 }),
    cron({ id: "b", nextAt: 3000 }),
    wakeup({ id: "c", dueAt: 8000 }),
  ];

  it("returns the earliest future fire time", () => {
    expect(nextWakeupAt(entries, { now: 1000 })).toBe(3000);
  });

  it("returns now for an already-due entry (fire immediately)", () => {
    const withDue = [...entries, cron({ id: "past", nextAt: 100 })];
    expect(nextWakeupAt(withDue, { now: 1000 })).toBe(1000);
  });

  it("ignores expired and terminal entries", () => {
    const mixed = [
      cron({ id: "exp", nextAt: 2000, expiresAt: 500 }),
      cron({ id: "done", status: "exhausted", nextAt: 2500 }),
      cron({ id: "live", nextAt: 4000 }),
    ];
    expect(nextWakeupAt(mixed, { now: 1000 })).toBe(4000);
  });

  it("returns null when nothing is scheduled", () => {
    expect(nextWakeupAt([], { now: 1000 })).toBe(null);
    expect(nextWakeupAt([cron({ status: "exhausted" })], { now: 1000 })).toBe(
      null,
    );
  });

  it("msUntilNextWakeup clamps to [0, maxMs]", () => {
    expect(msUntilNextWakeup(entries, { now: 1000 })).toBe(2000); // 3000-1000
    expect(msUntilNextWakeup(entries, { now: 1000, maxMs: 500 })).toBe(500);
    expect(msUntilNextWakeup(entries, { now: 9999 })).toBe(0); // all past → fire now
    expect(msUntilNextWakeup([], { now: 1000 })).toBe(null);
  });
});
