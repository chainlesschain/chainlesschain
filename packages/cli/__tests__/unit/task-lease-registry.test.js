import { describe, it, expect, beforeEach } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";

// A mutable clock so lease expiry is fully deterministic.
function makeClock(start = 1000) {
  const c = { t: start };
  return {
    now: () => c.t,
    advance: (ms) => (c.t += ms),
    set: (v) => (c.t = v),
  };
}

describe("TaskLeaseRegistry.addTask", () => {
  let reg, clock;
  beforeEach(() => {
    clock = makeClock();
    reg = new TaskLeaseRegistry({ now: clock.now });
  });

  it("adds tasks and rejects duplicate keys / missing titles", () => {
    expect(reg.addTask({ key: "a", title: "A" }).ok).toBe(true);
    expect(reg.addTask({ key: "a", title: "again" })).toMatchObject({
      ok: false,
      reason: /duplicate/,
    });
    expect(reg.addTask({ key: "b" })).toMatchObject({
      ok: false,
      reason: /title required/,
    });
  });

  it("rejects a self-dependency", () => {
    const r = reg.addTask({ key: "a", title: "A", dependsOn: ["a"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cycle/);
  });

  it("rejects a dependency cycle across tasks", () => {
    expect(reg.addTask({ key: "a", title: "A", dependsOn: ["b"] }).ok).toBe(
      true,
    );
    // b → a → b would close a cycle.
    const r = reg.addTask({ key: "b", title: "B", dependsOn: ["a"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cycle/);
    expect(r.cycle).toContain("a");
    expect(r.cycle).toContain("b");
  });

  it("allows a valid DAG (diamond)", () => {
    expect(reg.addTask({ key: "root", title: "root" }).ok).toBe(true);
    expect(reg.addTask({ key: "l", title: "l", dependsOn: ["root"] }).ok).toBe(
      true,
    );
    expect(reg.addTask({ key: "r", title: "r", dependsOn: ["root"] }).ok).toBe(
      true,
    );
    expect(
      reg.addTask({ key: "join", title: "join", dependsOn: ["l", "r"] }).ok,
    ).toBe(true);
  });
});

describe("TaskLeaseRegistry exclusive lease (no double-processing)", () => {
  let reg, clock;
  beforeEach(() => {
    clock = makeClock();
    reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "t1", title: "T1" });
  });

  it("lets only ONE holder hold a valid lease", () => {
    const a = reg.acquire("t1", { holder: "agentA" });
    expect(a.ok).toBe(true);
    const b = reg.acquire("t1", { holder: "agentB" });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("leased");
    expect(b.holder).toBe("agentA");
    // t1 is no longer claimable while validly leased.
    expect(reg.claimable()).not.toContain("t1");
  });

  it("renews for the same holder (extends expiry, bumps renewals)", () => {
    const a = reg.acquire("t1", { holder: "agentA", ttlMs: 1000 });
    expect(a.lease.expiresAt).toBe(clock.now() + 1000);
    clock.advance(500);
    const r = reg.renew("t1", { holder: "agentA", ttlMs: 1000 });
    expect(r.ok).toBe(true);
    expect(r.lease.renewals).toBe(1);
    expect(r.lease.expiresAt).toBe(clock.now() + 1000);
    // A non-holder cannot renew.
    expect(reg.renew("t1", { holder: "agentB" }).ok).toBe(false);
  });

  it("lets another holder STEAL an expired lease", () => {
    reg.acquire("t1", { holder: "agentA", ttlMs: 1000 });
    expect(reg.acquire("t1", { holder: "agentB" }).ok).toBe(false); // still valid
    clock.advance(1001); // lease expired
    const stolen = reg.acquire("t1", { holder: "agentB" });
    expect(stolen.ok).toBe(true);
    expect(stolen.lease.holder).toBe("agentB");
    expect(stolen.lease.stolen).toBe(true);
  });
});

describe("TaskLeaseRegistry crash recovery", () => {
  it("reclaims expired leases so a crashed teammate's task is reassignable", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "t1", title: "T1" });
    reg.addTask({ key: "t2", title: "T2" });
    reg.acquire("t1", { holder: "dead", ttlMs: 1000 });
    reg.acquire("t2", { holder: "alive", ttlMs: 1000 });
    clock.advance(600);
    // "alive" heartbeats; "dead" does not.
    reg.renew("t2", { holder: "alive", ttlMs: 1000 });
    clock.advance(600); // t1 now 1200ms old (expired), t2 renewed 600ms ago (valid)
    const reclaimed = reg.reclaimExpired();
    expect(reclaimed).toEqual(["t1"]);
    expect(reg.getTask("t1").status).toBe("pending");
    expect(reg.getTask("t1").lease).toBe(null);
    // t1 is claimable again; t2 still held by alive.
    expect(reg.claimable()).toContain("t1");
    expect(reg.claimable()).not.toContain("t2");
    // A fresh teammate can pick it up.
    expect(reg.acquire("t1", { holder: "rescuer" }).ok).toBe(true);
  });

  it("a stale (expired) holder cannot complete work that was reassigned", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "t1", title: "T1" });
    reg.acquire("t1", { holder: "slow", ttlMs: 1000 });
    clock.advance(1001);
    reg.reclaimExpired();
    reg.acquire("t1", { holder: "fast" });
    // The slow teammate finally returns and tries to complete — rejected.
    const bad = reg.complete("t1", { holder: "slow" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("not_holder_or_expired");
    // The current holder can.
    expect(reg.complete("t1", { holder: "fast" }).ok).toBe(true);
    expect(reg.getTask("t1").status).toBe("completed");
  });
});

describe("TaskLeaseRegistry dependency gating", () => {
  let reg, clock;
  beforeEach(() => {
    clock = makeClock();
    reg = new TaskLeaseRegistry({ now: clock.now });
    reg.addTask({ key: "build", title: "build" });
    reg.addTask({ key: "test", title: "test", dependsOn: ["build"] });
  });

  it("blocks acquisition until dependencies are completed", () => {
    expect(reg.claimable()).toEqual(["build"]); // test is blocked
    const blocked = reg.acquire("test", { holder: "a" });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("blocked_by_deps");
    expect(blocked.unmet).toEqual(["build"]);

    // Finish build → test unblocks.
    reg.acquire("build", { holder: "a" });
    reg.complete("build", { holder: "a" });
    expect(reg.claimable()).toEqual(["test"]);
    expect(reg.acquire("test", { holder: "b" }).ok).toBe(true);
  });
});

describe("TaskLeaseRegistry fail / retry / cancel", () => {
  it("retries under the attempt cap then cancels", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, maxAttempts: 2 });
    reg.addTask({ key: "flaky", title: "flaky" });

    reg.acquire("flaky", { holder: "a" });
    const f1 = reg.fail("flaky", { holder: "a", error: "boom1" });
    expect(f1).toMatchObject({ ok: true, retry: true, attempts: 1 });
    expect(reg.getTask("flaky").status).toBe("pending"); // reclaimable

    reg.acquire("flaky", { holder: "b" });
    const f2 = reg.fail("flaky", { holder: "b", error: "boom2" });
    expect(f2).toMatchObject({ ok: true, retry: false, attempts: 2 });
    expect(reg.getTask("flaky").status).toBe("cancelled"); // gave up
    // A cancelled (terminal) task can't be re-acquired.
    expect(reg.acquire("flaky", { holder: "c" }).reason).toBe("terminal");
  });
});

describe("TaskLeaseRegistry snapshot / restore", () => {
  it("round-trips the graph, leases and attempts", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 5000 });
    reg.addTask({ key: "a", title: "A" });
    reg.addTask({ key: "b", title: "B", dependsOn: ["a"] });
    reg.acquire("a", { holder: "agentA", ttlMs: 5000 });

    const snap = JSON.parse(JSON.stringify(reg.snapshot()));
    const clock2 = makeClock(clock.now()); // same virtual time
    const restored = TaskLeaseRegistry.restore(snap, { now: clock2.now });

    expect(restored.getTask("a").lease.holder).toBe("agentA");
    expect(restored.getTask("b").dependsOn).toEqual(["a"]);
    // The restored registry enforces the SAME exclusive lease.
    expect(restored.acquire("a", { holder: "other" }).reason).toBe("leased");
    // And the same dependency gate.
    expect(restored.acquire("b", { holder: "x" }).reason).toBe(
      "blocked_by_deps",
    );
  });
});

describe("TaskLeaseRegistry stats / allDone", () => {
  it("reports counts and completion", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "a", title: "A" });
    reg.addTask({ key: "b", title: "B" });
    reg.acquire("a", { holder: "x" });
    const s = reg.stats();
    expect(s.total).toBe(2);
    expect(s.leased).toBe(1);
    expect(s.claimable).toBe(1); // b
    expect(reg.allDone()).toBe(false);

    reg.complete("a", { holder: "x" });
    reg.acquire("b", { holder: "y" });
    reg.complete("b", { holder: "y" });
    expect(reg.allDone()).toBe(true);
  });
});
