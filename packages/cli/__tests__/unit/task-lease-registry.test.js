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

  it(
    "bulk-validates a 10,000-task deep DAG without recursive stack overflow",
    { timeout: 30_000 },
    () => {
      const definitions = Array.from({ length: 10_000 }, (_, index) => ({
        key: `deep-${index}`,
        title: `Deep ${index}`,
        dependsOn: index === 0 ? [] : [`deep-${index - 1}`],
      }));
      expect(reg.addTasks(definitions)).toMatchObject({ ok: true });
      expect(reg.claimable()).toEqual(["deep-0"]);
    },
  );
});

describe("TaskLeaseRegistry fairness scheduling", () => {
  it("donates a blocked high-priority descendant to its low dependency", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({
      now: clock.now,
      queueWaitSloMs: 10_000,
      agingWindowMs: 2_500,
    });
    reg.addTask({ key: "ordinary-high", title: "high", priority: "high" });
    reg.addTask({ key: "dependency-low", title: "low", priority: "low" });
    reg.addTask({
      key: "dependent-high",
      title: "dependent",
      priority: "high",
      dependsOn: ["dependency-low"],
    });

    expect(reg.schedulingPriority("dependency-low")).toMatchObject({
      base: 0,
      donation: 2,
      criticalPathBoost: 1,
      total: 3,
      queueWaitSloMs: 10_000,
    });
    expect(reg.nextClaimable()).toBe("dependency-low");
  });

  it("promotes an old low-priority task before the queue-wait SLO", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({
      now: clock.now,
      queueWaitSloMs: 400,
      agingWindowMs: 100,
    });
    reg.addTask({ key: "old-low", title: "low", priority: "low" });
    expect(reg.nextClaimable()).toBe("old-low");
    reg.addTask({ key: "first-high", title: "high", priority: "high" });
    expect(reg.nextClaimable()).toBe("first-high");
    const first = reg.acquire("first-high", { holder: "worker" });
    expect(first.ok).toBe(true);
    expect(
      reg.complete("first-high", {
        holder: "worker",
        leaseId: first.lease.leaseId,
      }).ok,
    ).toBe(true);

    clock.advance(300);
    reg.addTask({ key: "new-high", title: "new high", priority: "high" });
    expect(reg.schedulingPriority("old-low")).toMatchObject({
      sloUrgent: true,
      sloBoost: 10_000,
      queueWaitMs: 300,
    });
    expect(reg.nextClaimable()).toBe("old-low");
  });

  it("preserves the fairness clock and SLO across durable restore", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({
      now: clock.now,
      queueWaitSloMs: 400,
      agingWindowMs: 100,
    });
    reg.addTask({ key: "waiting-low", title: "waiting", priority: "low" });
    clock.advance(250);
    const restored = TaskLeaseRegistry.restore(
      JSON.parse(JSON.stringify(reg.snapshot())),
      { now: clock.now },
    );
    clock.advance(50);

    expect(restored.schedulingPriority("waiting-low")).toMatchObject({
      sloUrgent: true,
      queueWaitMs: 300,
      queueWaitSloMs: 400,
    });
    expect(restored.snapshot().registry).toMatchObject({
      queueWaitSloMs: 400,
      agingWindowMs: 100,
      readySinceByKey: [["waiting-low", 1000]],
    });
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
    const r = reg.renew("t1", {
      holder: "agentA",
      leaseId: a.lease.leaseId,
      ttlMs: 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.lease.renewals).toBe(1);
    expect(r.lease.expiresAt).toBe(clock.now() + 1000);
    // A non-holder cannot renew.
    expect(reg.renew("t1", { holder: "agentB" }).ok).toBe(false);
  });

  it("fences an older executor even when its holder label is reused", () => {
    const first = reg.acquire("t1", { holder: "agentA", ttlMs: 1000 });
    clock.advance(1001);
    const second = reg.acquire("t1", { holder: "agentA", ttlMs: 1000 });

    expect(second.ok).toBe(true);
    expect(second.lease.leaseId).not.toBe(first.lease.leaseId);
    expect(
      reg.complete("t1", {
        holder: "agentA",
        leaseId: first.lease.leaseId,
      }),
    ).toMatchObject({ ok: false, reason: "not_holder_or_expired" });
    expect(
      reg.complete("t1", {
        holder: "agentA",
        leaseId: second.lease.leaseId,
      }),
    ).toMatchObject({ ok: true });
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
    const alive = reg.acquire("t2", { holder: "alive", ttlMs: 1000 });
    clock.advance(600);
    // "alive" heartbeats; "dead" does not.
    reg.renew("t2", {
      holder: "alive",
      leaseId: alive.lease.leaseId,
      ttlMs: 1000,
    });
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
    const slow = reg.acquire("t1", { holder: "slow", ttlMs: 1000 });
    clock.advance(1001);
    reg.reclaimExpired();
    const fast = reg.acquire("t1", { holder: "fast" });
    // The slow teammate finally returns and tries to complete — rejected.
    const bad = reg.complete("t1", {
      holder: "slow",
      leaseId: slow.lease.leaseId,
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("not_holder_or_expired");
    // The current holder can.
    expect(
      reg.complete("t1", {
        holder: "fast",
        leaseId: fast.lease.leaseId,
      }).ok,
    ).toBe(true);
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
    const build = reg.acquire("build", { holder: "a" });
    reg.complete("build", {
      holder: "a",
      leaseId: build.lease.leaseId,
    });
    expect(reg.claimable()).toEqual(["test"]);
    expect(reg.acquire("test", { holder: "b" }).ok).toBe(true);
  });
});

describe("TaskLeaseRegistry fail / retry / cancel", () => {
  it("retries under the attempt cap then cancels", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, maxAttempts: 2 });
    reg.addTask({ key: "flaky", title: "flaky" });

    const first = reg.acquire("flaky", { holder: "a" });
    const f1 = reg.fail("flaky", {
      holder: "a",
      leaseId: first.lease.leaseId,
      error: "boom1",
    });
    expect(f1).toMatchObject({ ok: true, retry: true, attempts: 1 });
    expect(reg.getTask("flaky").status).toBe("pending"); // reclaimable

    const second = reg.acquire("flaky", { holder: "b" });
    const f2 = reg.fail("flaky", {
      holder: "b",
      leaseId: second.lease.leaseId,
      error: "boom2",
    });
    expect(f2).toMatchObject({ ok: true, retry: false, attempts: 2 });
    expect(reg.getTask("flaky").status).toBe("cancelled"); // gave up
    // A cancelled (terminal) task can't be re-acquired.
    expect(reg.acquire("flaky", { holder: "c" }).reason).toBe("terminal");
  });

  it("cancels a non-retryable attempt immediately", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({
      now: clock.now,
      maxAttempts: 5,
    });
    reg.addTask({ key: "side-effect", title: "side-effect" });
    const claim = reg.acquire("side-effect", { holder: "a" });

    expect(
      reg.fail("side-effect", {
        holder: "a",
        leaseId: claim.lease.leaseId,
        error: "unknown external result",
        retryable: false,
      }),
    ).toMatchObject({ ok: true, retry: false, attempts: 1 });
    expect(reg.getTask("side-effect").status).toBe("cancelled");
  });

  it("fails an ambiguous side effect closed until a matching human decision", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({
      now: clock.now,
      maxAttempts: 5,
    });
    reg.addTask({ key: "side-effect", title: "side-effect" });
    const claim = reg.acquire("side-effect", { holder: "a" });

    expect(
      reg.fail("side-effect", {
        holder: "a",
        leaseId: claim.lease.leaseId,
        error: "interrupt raced with an external write",
        retryable: false,
        adjudication: {
          code: "TEAM_TASK_HUMAN_INTERRUPTED",
          evidenceDigest: "sha256:evidence",
        },
      }),
    ).toMatchObject({ ok: true, retry: false, attempts: 1 });
    expect(reg.allDone()).toBe(false);
    expect(reg.stats().adjudicationRequired).toBe(1);
    expect(reg.pendingAdjudications()).toEqual([
      expect.objectContaining({
        key: "side-effect",
        required: true,
        evidenceDigest: "sha256:evidence",
      }),
    ]);
    expect(
      reg.resolveAdjudication("side-effect", {
        decision: "retry",
        decisionId: "decision-1",
        evidenceDigest: "sha256:wrong",
      }),
    ).toEqual({ ok: false, reason: "evidence_mismatch" });
    expect(reg.claimable()).toEqual([]);
    expect(
      reg.bindAdjudicationCase("side-effect", {
        caseId: "case-1",
        registryDigest: "sha256:registry",
        sideEffectDigest: "sha256:side-effect",
      }),
    ).toMatchObject({ ok: true });
    expect(
      reg.bindAdjudicationCase("side-effect", {
        caseId: "case-1",
        registryDigest: "sha256:registry",
        sideEffectDigest: "sha256:side-effect",
      }),
    ).toMatchObject({ ok: true, idempotent: true });
    expect(
      reg.bindAdjudicationCase("side-effect", {
        caseId: "different",
        registryDigest: "sha256:registry",
        sideEffectDigest: "sha256:side-effect",
      }),
    ).toEqual({ ok: false, reason: "case_binding_conflict" });

    expect(
      reg.resolveAdjudication("side-effect", {
        decision: "retry",
        decisionId: "decision-1",
        actor: "operator@example.test",
        reason: "verified no write occurred",
        evidenceDigest: "sha256:evidence",
      }),
    ).toMatchObject({
      ok: true,
      decision: "retry",
      status: "pending",
    });
    expect(reg.claimable()).toEqual(["side-effect"]);
    expect(reg.getTask("side-effect").metadata.adjudication).toMatchObject({
      required: false,
      decision: {
        id: "decision-1",
        action: "retry",
        actor: "operator@example.test",
      },
    });
    expect(
      reg.resolveAdjudication("side-effect", {
        decision: "retry",
        decisionId: "decision-1",
      }),
    ).toMatchObject({ ok: true, idempotent: true });
  });

  it("accepts an observed side effect and unblocks its dependents", () => {
    const reg = new TaskLeaseRegistry();
    reg.addTask({ key: "write", title: "write" });
    reg.addTask({ key: "verify", title: "verify", dependsOn: ["write"] });
    const claim = reg.acquire("write", { holder: "a" });
    reg.fail("write", {
      holder: "a",
      leaseId: claim.lease.leaseId,
      error: "outcome unknown",
      retryable: false,
      adjudication: { evidenceDigest: "sha256:observed" },
    });

    expect(
      reg.resolveAdjudication("write", {
        decision: "accept",
        decisionId: "decision-accept",
        evidenceDigest: "sha256:observed",
        result: { externalId: "remote-123" },
      }),
    ).toMatchObject({ ok: true, status: "completed" });
    expect(reg.getTask("write")).toMatchObject({
      status: "completed",
      metadata: { result: { externalId: "remote-123" } },
    });
    expect(reg.claimable()).toEqual(["verify"]);
  });

  it("keeps an explicitly cancelled adjudication terminal and rejects conflicts", () => {
    const reg = new TaskLeaseRegistry();
    reg.addTask({ key: "unsafe", title: "unsafe" });
    const claim = reg.acquire("unsafe", { holder: "a" });
    reg.fail("unsafe", {
      holder: "a",
      leaseId: claim.lease.leaseId,
      error: "unknown",
      retryable: false,
      adjudication: {},
    });

    expect(
      reg.resolveAdjudication("unsafe", {
        decision: "cancel",
        decisionId: "decision-cancel",
      }),
    ).toMatchObject({ ok: true, status: "cancelled" });
    expect(reg.allDone()).toBe(true);
    expect(
      reg.resolveAdjudication("unsafe", {
        decision: "retry",
        decisionId: "different",
      }),
    ).toEqual({ ok: false, reason: "adjudication_not_required" });
  });

  it("fails a completed task closed when recovery evidence becomes ambiguous", () => {
    const reg = new TaskLeaseRegistry();
    reg.addTask({ key: "external", title: "external" });
    const claim = reg.acquire("external", { holder: "a" });
    reg.complete("external", {
      holder: "a",
      leaseId: claim.lease.leaseId,
      result: { reported: "ok" },
    });

    expect(
      reg.requireAdjudication("external", {
        code: "TEAM_SIDE_EFFECT_LEDGER_UNKNOWN",
        reason: "side-effect ledger contains an unknown settlement",
        evidenceDigest: "sha256:ledger",
      }),
    ).toMatchObject({ ok: true, priorStatus: "completed" });
    expect(reg.getTask("external")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: {
          required: true,
          priorStatus: "completed",
          evidenceDigest: "sha256:ledger",
        },
      },
    });
    expect(reg.allDone()).toBe(false);
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

describe("TaskLeaseRegistry crash resume (session recovery)", () => {
  it("keeps completed tasks done and reclaims a lease left dangling by a crash", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "a", title: "A" });
    reg.addTask({ key: "b", title: "B" });
    const a = reg.acquire("a", { holder: "x" });
    reg.complete("a", { holder: "x", leaseId: a.lease.leaseId });
    reg.acquire("b", { holder: "y" }); // in-flight when the process "crashes"

    const snap = JSON.parse(JSON.stringify(reg.snapshot()));
    // Restart LATER — b's lease has since expired (nobody renewed it).
    const clock2 = makeClock(clock.now() + 2000);
    const restored = TaskLeaseRegistry.restore(snap, { now: clock2.now });
    expect(restored.getTask("a").status).toBe("completed"); // work not redone
    // The dangling lease is reclaimed → b is runnable again.
    const freed = restored.reclaimExpired();
    expect(freed).toEqual(["b"]);
    expect(restored.getTask("b").status).toBe("pending");
    expect(restored.claimable()).toEqual(["b"]);
    expect(restored.acquire("b", { holder: "z" }).ok).toBe(true);
  });

  it("reclaimAll reclaims a still-in-TTL lease on resume (crash seconds after acquire)", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 60000 });
    reg.addTask({ key: "a", title: "A" });
    reg.acquire("a", { holder: "x", ttlMs: 60000 }); // expires far in the future
    const snap = JSON.parse(JSON.stringify(reg.snapshot()));

    // Restart only 1s later — a's lease is STILL VALID (until +60s), so the
    // prior process crashed within the TTL window. reclaimExpired can't help.
    const clock2 = makeClock(clock.now() + 1000);
    const restored = TaskLeaseRegistry.restore(snap, { now: clock2.now });
    expect(restored.reclaimExpired()).toEqual([]); // expired-only sweep skips it…
    expect(restored.claimable()).toEqual([]); // …and the valid lease blocks it → stuck

    // reclaimAll frees every dangling lease regardless of expiry.
    expect(restored.reclaimAll()).toEqual(["a"]);
    expect(restored.getTask("a").status).toBe("pending");
    expect(restored.getTask("a").lease).toBe(null);
    expect(restored.claimable()).toEqual(["a"]);
    expect(restored.acquire("a", { holder: "rescuer" }).ok).toBe(true);
  });

  it("fails abandoned non-retry-safe work closed for adjudication", () => {
    const reg = new TaskLeaseRegistry({ defaultTtlMs: 60_000 });
    reg.addTask({
      key: "unsafe",
      title: "May have external side effects",
      metadata: { retrySafe: false },
    });
    reg.addTask({
      key: "safe",
      title: "Idempotent",
      metadata: { retrySafe: true },
    });
    reg.acquire("unsafe", { holder: "lost-a" });
    reg.acquire("safe", { holder: "lost-b" });

    const recovery = reg.reconcileAbandoned({
      shouldRetry: (task) => task.metadata?.retrySafe === true,
      error: "manual adjudication required",
    });

    expect(recovery).toEqual({
      reclaimed: ["safe"],
      adjudicationRequired: ["unsafe"],
    });
    expect(reg.getTask("safe")).toMatchObject({
      status: "pending",
      lease: null,
    });
    expect(reg.getTask("unsafe")).toMatchObject({
      status: "cancelled",
      lease: null,
      attempts: 1,
      metadata: {
        lastError: "manual adjudication required",
        adjudication: {
          required: true,
          code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
        },
      },
    });
    expect(reg.claimable()).toEqual(["safe"]);
    expect(reg.allDone()).toBe(false);
  });
});

describe("TaskLeaseRegistry custody handoff", () => {
  const revisionDigest = `sha256:${"a".repeat(64)}`;
  const authorityDigest = `sha256:${"b".repeat(64)}`;

  function offer(reg, claim, overrides = {}) {
    return reg.offerHandoff("work", {
      handoffId: "handoff-1",
      holder: "source",
      leaseId: claim.lease.leaseId,
      toHolder: "target",
      revisionDigest,
      authorityDigest,
      artifactIds: ["artifact-1"],
      preconditions: { tests: "green" },
      summary: { objective: "continue the task" },
      ttlMs: 500,
      ...overrides,
    });
  }

  it("atomically transfers custody and fences every late source write", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "work", title: "Work" });
    const source = reg.acquire("work", { holder: "source" });

    const offered = offer(reg, source);
    expect(offered).toMatchObject({
      ok: true,
      handoff: {
        id: "handoff-1",
        status: "offered",
        fromHolder: "source",
        toHolder: "target",
        revisionDigest,
        authorityDigest,
      },
    });
    clock.advance(10);
    expect(offer(reg, source)).toMatchObject({
      ok: true,
      idempotent: true,
      handoff: { expiresAtMs: 1500 },
    });
    expect(reg.acceptHandoff("handoff-1", { holder: "intruder" })).toEqual({
      ok: false,
      reason: "wrong_recipient",
    });
    expect(
      reg.acceptHandoff("handoff-1", {
        holder: "target",
        recipientAttempt: { id: "attempt-target" },
      }),
    ).toMatchObject({ ok: true, handoff: { status: "accepted" } });

    const committed = reg.commitHandoff("handoff-1", {
      holder: "source",
      leaseId: source.lease.leaseId,
    });
    expect(committed).toMatchObject({
      ok: true,
      key: "work",
      handoff: { status: "committed" },
      lease: {
        holder: "target",
        handoffId: "handoff-1",
        transferredFromLeaseId: source.lease.leaseId,
      },
    });
    expect(committed.lease.leaseId).not.toBe(source.lease.leaseId);
    expect(reg.getTask("work")).toMatchObject({
      status: "in_progress",
      assignee: "target",
      lease: committed.lease,
    });
    expect(
      reg.complete("work", {
        holder: "source",
        leaseId: source.lease.leaseId,
      }),
    ).toEqual({ ok: false, reason: "not_holder_or_expired" });
    expect(reg.acquire("work", { holder: "intruder" })).toMatchObject({
      ok: false,
      reason: "custody_transferred",
      holder: "target",
    });

    expect(
      reg.markHandoffStarted("work", {
        handoffId: "handoff-1",
        holder: "target",
        leaseId: committed.lease.leaseId,
      }),
    ).toMatchObject({ ok: true });
    expect(
      reg.complete("work", {
        holder: "target",
        leaseId: committed.lease.leaseId,
        result: { continued: true },
      }),
    ).toEqual({ ok: true });
    expect(reg.getTask("work").metadata.custodyHandoffs.at(-1)).toMatchObject({
      id: "handoff-1",
      status: "committed",
      targetStartedAt: clock.now(),
      targetSettledAt: clock.now(),
      targetSettlement: "completed",
    });
  });

  it("makes reject, revoke, expiry, and conflicting retries race-safe", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now });
    reg.addTask({ key: "work", title: "Work" });
    const source = reg.acquire("work", { holder: "source" });

    offer(reg, source);
    expect(
      reg.rejectHandoff("handoff-1", {
        holder: "target",
        reason: "missing capability",
      }),
    ).toMatchObject({ ok: true, handoff: { status: "rejected" } });
    expect(reg.acceptHandoff("handoff-1", { holder: "target" })).toEqual({
      ok: false,
      reason: "handoff_rejected",
    });
    expect(offer(reg, source, { summary: { objective: "changed" } })).toEqual({
      ok: false,
      reason: "handoff_id_conflict",
    });

    expect(offer(reg, source, { handoffId: "handoff-2" })).toMatchObject({
      ok: true,
    });
    expect(reg.acceptHandoff("handoff-2", { holder: "target" })).toMatchObject({
      ok: true,
    });
    expect(
      reg.revokeHandoff("handoff-2", {
        holder: "source",
        leaseId: source.lease.leaseId,
        reason: "source resumed",
      }),
    ).toMatchObject({ ok: true, handoff: { status: "revoked" } });
    expect(
      reg.commitHandoff("handoff-2", {
        holder: "source",
        leaseId: source.lease.leaseId,
      }),
    ).toEqual({ ok: false, reason: "handoff_revoked" });

    expect(
      offer(reg, source, { handoffId: "handoff-3", ttlMs: 20 }),
    ).toMatchObject({ ok: true });
    clock.advance(20);
    expect(reg.acceptHandoff("handoff-3", { holder: "target" })).toEqual({
      ok: false,
      reason: "handoff_expired",
    });
    expect(reg.findHandoff("handoff-3").handoff).toMatchObject({
      status: "expired",
      expiredAt: clock.now(),
    });
  });

  it("recovers only an unstarted committed recipient with a fresh fence", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 100 });
    reg.addTask({ key: "work", title: "Work" });
    const source = reg.acquire("work", { holder: "source" });
    offer(reg, source);
    reg.acceptHandoff("handoff-1", { holder: "target" });
    const committed = reg.commitHandoff("handoff-1", {
      holder: "source",
      leaseId: source.lease.leaseId,
      ttlMs: 100,
    });
    const snapshot = JSON.parse(JSON.stringify(reg.snapshot()));

    const resumedClock = makeClock(clock.now() + 200);
    const resumed = TaskLeaseRegistry.restore(snapshot, {
      now: resumedClock.now,
    });
    expect(resumed.claimable()).toEqual([]);
    expect(resumed.reclaimExpired()).toEqual([]);
    expect(resumed.reconcileAbandoned()).toEqual({
      reclaimed: [],
      adjudicationRequired: [],
    });
    expect(resumed.pendingCommittedHandoffs()).toEqual([
      expect.objectContaining({
        key: "work",
        handoff: expect.objectContaining({
          id: "handoff-1",
          toHolder: "target",
          targetStartedAt: null,
        }),
      }),
    ]);

    const recovered = resumed.refreshCommittedHandoffLease("work", {
      handoffId: "handoff-1",
      holder: "target",
      ttlMs: 1000,
    });
    expect(recovered).toMatchObject({ ok: true, lease: { recovered: true } });
    expect(recovered.lease.leaseId).not.toBe(committed.lease.leaseId);
    expect(
      resumed.complete("work", {
        holder: "target",
        leaseId: committed.lease.leaseId,
      }),
    ).toEqual({ ok: false, reason: "not_holder_or_expired" });
    expect(
      resumed.markHandoffStarted("work", {
        handoffId: "handoff-1",
        holder: "target",
        leaseId: recovered.lease.leaseId,
      }),
    ).toMatchObject({ ok: true });
    expect(resumed.pendingCommittedHandoffs()).toEqual([]);
    expect(
      resumed.complete("work", {
        holder: "target",
        leaseId: recovered.lease.leaseId,
      }),
    ).toEqual({ ok: true });
  });

  it("routes a crash after target start through retry/adjudication instead of dispatch replay", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 100 });
    reg.addTask({ key: "work", title: "Work" });
    const source = reg.acquire("work", { holder: "source" });
    offer(reg, source);
    reg.acceptHandoff("handoff-1", { holder: "target" });
    const committed = reg.commitHandoff("handoff-1", {
      holder: "source",
      leaseId: source.lease.leaseId,
      ttlMs: 100,
    });
    reg.markHandoffStarted("work", {
      handoffId: "handoff-1",
      holder: "target",
      leaseId: committed.lease.leaseId,
    });
    const restored = TaskLeaseRegistry.restore(
      JSON.parse(JSON.stringify(reg.snapshot())),
      { now: clock.now },
    );

    expect(restored.pendingCommittedHandoffs()).toEqual([]);
    expect(restored.reconcileAbandoned({ shouldRetry: () => true })).toEqual({
      reclaimed: ["work"],
      adjudicationRequired: [],
    });
    expect(restored.getTask("work")).toMatchObject({
      status: "pending",
      lease: null,
      metadata: {
        custodyHandoffs: [
          expect.objectContaining({
            id: "handoff-1",
            targetSettlement: "recovery_retry",
            targetSettledAt: clock.now(),
          }),
        ],
      },
    });
    expect(restored.claimable()).toEqual(["work"]);
    expect(restored.acquire("work", { holder: "source" })).toMatchObject({
      ok: false,
      reason: "custody_transferred",
      holder: "target",
    });
    expect(restored.acquire("work", { holder: "target" })).toMatchObject({
      ok: true,
      lease: { holder: "target" },
    });
  });

  it("synchronizes a post-expiry target fence back into the custody journal", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 100 });
    reg.addTask({ key: "work", title: "Work" });
    const source = reg.acquire("work", { holder: "source" });
    offer(reg, source);
    reg.acceptHandoff("handoff-1", { holder: "target" });
    const committed = reg.commitHandoff("handoff-1", {
      holder: "source",
      leaseId: source.lease.leaseId,
      ttlMs: 100,
    });
    reg.markHandoffStarted("work", {
      handoffId: "handoff-1",
      holder: "target",
      leaseId: committed.lease.leaseId,
    });

    clock.advance(101);
    const reacquired = reg.acquire("work", {
      holder: "target",
      ttlMs: 1000,
    });
    expect(reacquired).toMatchObject({
      ok: true,
      lease: {
        holder: "target",
        handoffId: "handoff-1",
        transferredFromLeaseId: committed.lease.leaseId,
        recovered: true,
      },
    });
    expect(reacquired.lease.leaseId).not.toBe(committed.lease.leaseId);
    expect(reg.findHandoff("handoff-1").handoff.targetLease).toMatchObject({
      leaseId: reacquired.lease.leaseId,
      fencingToken: reacquired.lease.fencingToken,
    });
    expect(
      reg.complete("work", {
        holder: "target",
        leaseId: committed.lease.leaseId,
      }),
    ).toEqual({ ok: false, reason: "not_holder_or_expired" });
    expect(
      reg.complete("work", {
        holder: "target",
        leaseId: reacquired.lease.leaseId,
      }),
    ).toEqual({ ok: true });
    expect(reg.findHandoff("handoff-1").handoff).toMatchObject({
      targetSettlement: "completed",
      targetLease: { leaseId: reacquired.lease.leaseId },
    });
  });
});

describe("TaskLeaseRegistry stats / allDone", () => {
  it("reports counts and completion", () => {
    const clock = makeClock();
    const reg = new TaskLeaseRegistry({ now: clock.now, defaultTtlMs: 1000 });
    reg.addTask({ key: "a", title: "A" });
    reg.addTask({ key: "b", title: "B" });
    const a = reg.acquire("a", { holder: "x" });
    const s = reg.stats();
    expect(s.total).toBe(2);
    expect(s.leased).toBe(1);
    expect(s.claimable).toBe(1); // b
    expect(reg.allDone()).toBe(false);

    reg.complete("a", { holder: "x", leaseId: a.lease.leaseId });
    const b = reg.acquire("b", { holder: "y" });
    reg.complete("b", { holder: "y", leaseId: b.lease.leaseId });
    expect(reg.allDone()).toBe(true);
  });
});
