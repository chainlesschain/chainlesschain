import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchedulerRuntime } from "../../src/lib/scheduler-kernel/runtime.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

function authority() {
  return {
    schemaVersion: 1,
    principal: { type: "test", id: "runtime-test" },
    tenantId: null,
    workspaceId: null,
    requestedCapabilities: ["test.execute"],
    authorizationRefs: {
      decisionId: "decision-test",
      policyRevision: "policy-test",
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function job(overrides = {}) {
  return {
    id: "runtime-job",
    kind: "test.runtime",
    trigger: { source: "test" },
    payload: { value: 1 },
    authority: authority(),
    maxAttempts: 2,
    ...overrides,
  };
}

describe("scheduler-kernel runtime", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture(start = 1_700_000_000_000) {
    const dir = mkdtempSync(join(tmpdir(), "cc-scheduler-runtime-"));
    const file = join(dir, "scheduler.db");
    let now = start;
    const stores = [];
    const open = () => {
      const store = openSchedulerStore({
        file,
        Database,
        clock: () => now,
      });
      stores.push(store);
      return store;
    };
    cleanups.push(() => {
      for (const store of stores) store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    return {
      open,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  function enqueue(store, f, overrides = {}) {
    store.createJob(job(overrides.job));
    return store.enqueueOccurrence({
      jobId: overrides.job?.id ?? "runtime-job",
      scheduledFor: f.now,
      triggerKey: overrides.triggerKey ?? "runtime:first",
    });
  }

  it("authorizes the immutable snapshots before executing and settling", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const execute = vi.fn(async ({ job: claimedJob, occurrence: claimed }) => ({
      jobRevision: claimedJob.revision,
      payload: claimed.payload,
    }));
    const authorize = vi.fn(() => ({ allowed: true, reason: "test" }));
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "runtime-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize,
    });

    const result = await runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "succeeded",
      result: { jobRevision: 1, payload: { value: 1 } },
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ id: "runtime-job", revision: 1 }),
        occurrence: expect.objectContaining({ id: occurrence.id }),
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      store.history({ occurrenceId: occurrence.id }).map((event) => event.type),
    ).toEqual([
      "occurrence_succeeded",
      "occurrence_renewed",
      "occurrence_claimed",
      "occurrence_enqueued",
    ]);
  });

  it("applies confirmed-applied adjudication without replaying the adapter", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f, { job: { maxAttempts: 1 } });
    const first = store.claimNext({
      ownerId: "crashed-owner",
      leaseMs: 10_000,
    });
    store.settle({
      occurrenceId: occurrence.id,
      ownerId: "crashed-owner",
      fence: first.fence,
      outcome: "failed",
      error: { code: "TEST_OUTCOME_UNKNOWN" },
      retryable: false,
    });
    const candidate = store.getAdjudicationCase(occurrence.id);
    store.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"d".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    const execute = vi.fn();
    const adjudicate = vi.fn(async () => ({
      settled: true,
      result: { recovered: "operator-confirmed" },
    }));
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "adjudication-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute, adjudicate }],
      authorize: () => ({ allowed: true }),
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { recovered: "operator-confirmed" },
    });
    expect(adjudicate).toHaveBeenCalledWith(
      expect.objectContaining({
        adjudication: expect.objectContaining({
          decision: "confirmed_applied",
          status: "pending",
        }),
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(store.getOccurrenceAdjudication(occurrence.id)).toMatchObject({
      status: "applied",
      retryOutcome: {
        status: "succeeded",
        result: { recovered: "operator-confirmed" },
      },
    });
  });

  it("fails closed when authorization is denied or an adapter is missing", async () => {
    const deniedFixture = fixture();
    const deniedStore = deniedFixture.open();
    const denied = enqueue(deniedStore, deniedFixture);
    const execute = vi.fn();
    const deniedRuntime = new SchedulerRuntime({
      store: deniedStore,
      ownerId: "denied-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: false, reason: "policy_denied" }),
    });
    await expect(deniedRuntime.runOccurrence(denied.id)).resolves.toMatchObject(
      {
        status: "dead_letter",
        error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
      },
    );
    expect(execute).not.toHaveBeenCalled();

    const missingFixture = fixture();
    const missingStore = missingFixture.open();
    const missing = enqueue(missingStore, missingFixture);
    const missingRuntime = new SchedulerRuntime({
      store: missingStore,
      ownerId: "missing-owner",
      leaseMs: 10_000,
      adapters: [],
      authorize: () => ({ allowed: true }),
    });
    await expect(
      missingRuntime.runOccurrence(missing.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_RUNTIME_ADAPTER_MISSING" },
    });
  });

  it("treats hostile authorization decisions as unavailable without executing", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const execute = vi.fn();
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "authority-proxy-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () =>
        Object.defineProperty({}, "allowed", {
          get() {
            throw new Error("hostile decision getter");
          },
        }),
    });
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "retry_wait",
      error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_UNAVAILABLE" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the lease after slow authorization before adapter execution", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const execute = vi.fn();
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "slow-authority-owner",
      leaseMs: 1_000,
      renewIntervalMs: 250,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => {
        f.now += 1_001;
        return { allowed: true };
      },
    });

    await expect(runtime.runOccurrence(occurrence.id)).rejects.toMatchObject({
      code: "SCHEDULER_LEASE_LOST",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute an adapter when cancellation arrives during authorization", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const controller = new AbortController();
    const execute = vi.fn();
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "authority-abort-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => {
        controller.abort(new Error("operator stop"));
        return { allowed: true };
      },
    });

    await expect(
      runtime.runOccurrence(occurrence.id, { signal: controller.signal }),
    ).resolves.toMatchObject({
      status: "retry_wait",
      error: { code: "SCHEDULER_RUNTIME_ABORTED" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("dead-letters a stale job revision before adapter execution", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    store.updateJob("runtime-job", 1, { payload: { value: 2 } });
    const execute = vi.fn();
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "revision-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: true }),
    });
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: {
        code: "SCHEDULER_RUNTIME_STALE_REVISION",
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("persists retry policy and only reclaims after retryAt", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const execute = vi
      .fn()
      .mockImplementationOnce(async () => {
        const error = new Error("temporary provider outage");
        error.code = "PROVIDER_TEMPORARY";
        error.retryAt = f.now + 100;
        throw error;
      })
      .mockResolvedValueOnce({ ok: true });
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "retry-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: true }),
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "retry_wait",
      error: { code: "PROVIDER_TEMPORARY" },
    });
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "busy",
    });
    f.now += 100;
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { ok: true },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("renews the same owner/fence lease during a long adapter call", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    let heartbeat;
    const timer = { unref: vi.fn() };
    const execute = vi.fn(async () => {
      f.now += 900;
      heartbeat();
      expect(store.getOccurrence(occurrence.id).leaseExpiresAt).toBe(
        f.now + 1_000,
      );
      return { renewed: true };
    });
    const clearIntervalFn = vi.fn();
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "renew-owner",
      leaseMs: 1_000,
      renewIntervalMs: 250,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: true }),
      setIntervalFn(callback) {
        heartbeat = callback;
        return timer;
      },
      clearIntervalFn,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { renewed: true },
    });
    expect(timer.unref).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });

  it("does not settle success when an adapter ignores cancellation", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort(new Error("operator stop"));
      return { shouldNotCommit: true };
    });
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "abort-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: true }),
    });

    await expect(
      runtime.runOccurrence(occurrence.id, { signal: controller.signal }),
    ).resolves.toMatchObject({
      status: "retry_wait",
      error: { code: "SCHEDULER_RUNTIME_ABORTED" },
    });
    expect(store.getOccurrence(occurrence.id).result).toBeNull();
  });

  it("dead-letters when adapter error classification itself fails", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "classifier-owner",
      leaseMs: 10_000,
      adapters: [
        {
          kind: "test.runtime",
          async execute() {
            throw new Error("adapter failed");
          },
          classifyError() {
            throw new Error("classifier failed");
          },
        },
      ],
      authorize: () => ({ allowed: true }),
    });
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_RUNTIME_ERROR_POLICY_FAILED" },
    });
  });

  it("never executes one targeted occurrence twice under live contention", async () => {
    const f = fixture();
    const firstStore = f.open();
    const secondStore = f.open();
    const occurrence = enqueue(firstStore, f);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await gate;
      return { once: true };
    });
    const base = {
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", execute }],
      authorize: () => ({ allowed: true }),
    };
    const firstRuntime = new SchedulerRuntime({
      ...base,
      store: firstStore,
      ownerId: "contender-a",
    });
    const secondRuntime = new SchedulerRuntime({
      ...base,
      store: secondStore,
      ownerId: "contender-b",
    });

    const running = firstRuntime.runOccurrence(occurrence.id);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await expect(
      secondRuntime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({ status: "busy" });
    release();
    await expect(running).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      secondRuntime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({ status: "succeeded", alreadySettled: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
