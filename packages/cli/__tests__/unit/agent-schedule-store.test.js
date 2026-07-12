import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AgentScheduleStore,
  parseCron,
  nextCronTime,
} from "../../src/lib/agent-schedule-store.js";

describe("parseCron", () => {
  it("parses the 5 fields with * , - / support", () => {
    const sets = parseCron("*/15 9-17 * * 1-5");
    expect([...sets[0]].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect(sets[1].has(9)).toBe(true);
    expect(sets[1].has(17)).toBe(true);
    expect(sets[1].has(8)).toBe(false);
    expect(sets[4].has(1)).toBe(true);
    expect(sets[4].has(0)).toBe(false);
  });

  it("rejects the wrong field count and out-of-range values", () => {
    expect(() => parseCron("* * * *")).toThrow(/5 fields/);
    expect(() => parseCron("99 * * * *")).toThrow(/out of range/);
  });
});

describe("nextCronTime", () => {
  it("finds the next matching minute strictly after the cursor", () => {
    // 2026-03-02 is a Monday. "0 9 * * 1" = 09:00 Monday.
    const from = new Date(2026, 2, 2, 8, 30, 0).getTime();
    const next = new Date(nextCronTime("0 9 * * 1", from));
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDay()).toBe(1);
  });

  it("advances to the next occurrence when already past today's slot", () => {
    const from = new Date(2026, 2, 2, 9, 30, 0).getTime(); // Monday 09:30
    const next = new Date(nextCronTime("0 9 * * 1", from));
    expect(next.getDate()).toBe(9); // next Monday
  });
});

describe("AgentScheduleStore", () => {
  let dir;
  let clock;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sched-"));
    clock = 1_000_000;
    store = new AgentScheduleStore({ dir, now: () => clock });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("schedules a wakeup and reports it due once the clock passes dueAt", () => {
    const entry = store.scheduleWakeup({ prompt: "check CI", delayMs: 5000 });
    expect(entry.dueAt).toBe(1_005_000);
    expect(store.due("wakeup")).toHaveLength(0);
    clock = 1_005_001;
    expect(store.due("wakeup").map((e) => e.id)).toEqual([entry.id]);
    store.markWakeupFired(entry.id);
    expect(store.due("wakeup")).toHaveLength(0);
    expect(store.list("wakeup")[0].status).toBe("fired");
  });

  it("creates a cron and advances its nextAt after a run", () => {
    const entry = store.createCron({ prompt: "daily", cron: "0 0 * * *" });
    expect(entry.status).toBe("active");
    const firstNext = entry.nextAt;
    const advanced = store.advanceCron(entry.id, firstNext + 60000);
    expect(advanced.nextAt).toBeGreaterThan(firstNext);
    expect(advanced.runs).toBe(1);
  });

  it("creates a monitor, records checks, matches, and honours maxChecks", () => {
    const entry = store.createMonitor({
      command: "echo hi",
      intervalMs: 30000,
      stopWhen: "done",
      maxChecks: 3,
    });
    expect(entry.intervalMs).toBe(30000);

    const c1 = store.recordMonitorCheck(entry.id, { matched: false });
    expect(c1.status).toBe("active");
    expect(c1.checks).toBe(1);

    const matched = store.recordMonitorCheck(entry.id, { matched: true });
    expect(matched.status).toBe("matched");

    // A fresh monitor exhausts after maxChecks non-matching checks.
    const m2 = store.createMonitor({
      command: "echo x",
      intervalMs: 1000,
      maxChecks: 2,
    });
    store.recordMonitorCheck(m2.id, { matched: false });
    const exhausted = store.recordMonitorCheck(m2.id, { matched: false });
    expect(exhausted.status).toBe("exhausted");
  });

  it("rejects a bad monitor regex at creation", () => {
    expect(() =>
      store.createMonitor({ command: "x", intervalMs: 1000, stopWhen: "(" }),
    ).toThrow();
  });

  it("lists across kinds and cancels by id", () => {
    const w = store.scheduleWakeup({ prompt: "a" });
    store.createCron({ prompt: "b", cron: "0 0 * * *" });
    expect(store.list()).toHaveLength(2);
    expect(store.cancel(w.id).id).toBe(w.id);
    expect(store.list()).toHaveLength(1);
    expect(store.cancel("nope")).toBeNull();
  });

  it("survives a corrupt JSONL line", () => {
    store.scheduleWakeup({ prompt: "ok" });
    fs.appendFileSync(path.join(dir, "wakeup.jsonl"), "{ broken\n");
    expect(store.list("wakeup")).toHaveLength(1);
  });

  describe("expiry (expiresAt / retireExpired)", () => {
    it("stores a normalized expiresAt on every kind, null when absent/invalid", () => {
      const w = store.scheduleWakeup({
        prompt: "a",
        expiresAt: clock + 5000,
      });
      const c = store.createCron({
        prompt: "b",
        cron: "0 0 * * *",
        expiresAt: clock + 9000,
      });
      const m = store.createMonitor({
        command: "echo hi",
        intervalMs: 1000,
        expiresAt: -1, // invalid → null
      });
      const plain = store.scheduleWakeup({ prompt: "c" });
      expect(w.expiresAt).toBe(clock + 5000);
      expect(c.expiresAt).toBe(clock + 9000);
      expect(m.expiresAt).toBeNull();
      expect(plain.expiresAt).toBeNull();
    });

    it("due() never fires an expired entry even before it is retired", () => {
      store.scheduleWakeup({
        prompt: "soon-but-expired",
        dueAt: clock, // due now…
        expiresAt: clock + 100, // …but expires shortly after
      });
      expect(store.due(null, clock)).toHaveLength(1); // due, not yet expired
      expect(store.due(null, clock + 200)).toHaveLength(0); // past expiry → skipped
    });

    it("retireExpired marks past-expiry schedulable entries expired, leaves others", () => {
      const dead = store.scheduleWakeup({
        prompt: "dead",
        delayMs: 0,
        expiresAt: clock + 100,
      });
      const live = store.scheduleWakeup({
        prompt: "live",
        delayMs: 0,
        expiresAt: clock + 10000,
      });
      const noExpiry = store.createCron({
        prompt: "forever",
        cron: "0 0 * * *",
      });

      const retired = store.retireExpired(clock + 500);
      expect(retired.map((e) => e.id)).toEqual([dead.id]);

      const byId = Object.fromEntries(store.list().map((e) => [e.id, e]));
      expect(byId[dead.id].status).toBe("expired");
      expect(byId[dead.id].expiredAt).toBe(clock + 500);
      expect(byId[live.id].status).toBe("pending");
      expect(byId[noExpiry.id].status).toBe("active");
    });

    it("retireExpired is idempotent — an already-expired entry is not re-retired", () => {
      store.scheduleWakeup({ prompt: "x", expiresAt: clock + 100 });
      expect(store.retireExpired(clock + 200)).toHaveLength(1);
      expect(store.retireExpired(clock + 300)).toHaveLength(0);
    });
  });
});
