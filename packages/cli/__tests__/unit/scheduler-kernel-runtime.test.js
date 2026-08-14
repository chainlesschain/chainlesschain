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

  it("acknowledges a declared before-execute pause without invoking the adapter", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f, { job: { maxAttempts: 1 } });
    const runtimeControl = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["before_execute"],
    };
    const execute = vi.fn(async () => ({ completed: true }));
    let requested = false;
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "before-execute-owner",
      leaseMs: 10_000,
      adapters: [{ kind: "test.runtime", runtimeControl, execute }],
      authorize: ({ occurrence: claimed }) => {
        if (!requested) {
          requested = true;
          store.requestOccurrencePause({
            occurrenceId: claimed.id,
            expectedFence: claimed.fence,
            requestId: "runtime-before-execute-pause",
            capability: runtimeControl,
          });
        }
        return { allowed: true };
      },
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "paused",
      occurrence: { id: occurrence.id, attempt: 1, status: "retry_wait" },
      control: {
        state: "paused",
        checkpoint: {
          safePoint: "before_execute",
          data: { adapterStarted: false },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
    const control = store.getOccurrenceControl(occurrence.id);
    store.resumeOccurrence({
      occurrenceId: occurrence.id,
      expectedRevision: control.revision,
      requestId: "runtime-before-execute-resume",
    });
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      occurrence: { id: occurrence.id, attempt: 1, fence: 2 },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resumes from a durable adapter checkpoint without replaying earlier effects", async () => {
    const f = fixture();
    const store = f.open();
    const occurrence = enqueue(store, f);
    const runtimeControl = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["adapter_checkpoint"],
    };
    const classifyError = vi.fn();
    const effects = [];
    const execute = vi.fn(async (context) => {
      effects.push("effect:0", "effect:1", "effect:2");
      store.requestOccurrencePause({
        occurrenceId: context.occurrence.id,
        expectedFence: context.occurrence.fence,
        requestId: "runtime-adapter-checkpoint-pause",
        capability: runtimeControl,
      });
      context.checkpoint({ cursor: 3, phase: "write-safe" });
      return { unreachable: true };
    });
    const resume = vi.fn(async (context, checkpoint) => {
      expect(context.resumeCheckpoint).toEqual(checkpoint);
      expect(checkpoint).toEqual({
        schemaVersion: 1,
        safePoint: "adapter_checkpoint",
        data: { cursor: 3, phase: "write-safe" },
      });
      for (let cursor = checkpoint.data.cursor; cursor < 6; cursor += 1) {
        effects.push(`effect:${cursor}`);
      }
      return { resumedFrom: checkpoint.data.cursor };
    });
    const runtime = new SchedulerRuntime({
      store,
      ownerId: "adapter-checkpoint-owner",
      leaseMs: 10_000,
      adapters: [
        {
          kind: "test.runtime",
          runtimeControl,
          execute,
          resume,
          classifyError,
        },
      ],
      authorize: () => ({ allowed: true }),
    });

    const paused = await runtime.runOccurrence(occurrence.id);
    expect(paused).toMatchObject({
      status: "paused",
      occurrence: {
        id: occurrence.id,
        status: "retry_wait",
        attempt: 1,
        lastError: null,
      },
      control: {
        state: "paused",
        checkpoint: {
          safePoint: "adapter_checkpoint",
          data: { cursor: 3, phase: "write-safe" },
        },
      },
    });
    expect(classifyError).not.toHaveBeenCalled();
    expect(
      store.history({ occurrenceId: occurrence.id }).map((event) => event.type),
    ).toContain("occurrence_paused");
    expect(
      store.history({ occurrenceId: occurrence.id }).map((event) => event.type),
    ).not.toContain("occurrence_retry_scheduled");
    store.resumeOccurrence({
      occurrenceId: occurrence.id,
      expectedRevision: paused.control.revision,
      requestId: "runtime-adapter-checkpoint-resume",
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { resumedFrom: 3 },
      occurrence: { attempt: 1, fence: 2 },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(effects).toEqual([
      "effect:0",
      "effect:1",
      "effect:2",
      "effect:3",
      "effect:4",
      "effect:5",
    ]);
    expect(store.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "terminal",
      checkpoint: { data: { cursor: 3 } },
    });
  });

  it("reclaims a crashed resume and continues from the same durable checkpoint", async () => {
    const f = fixture();
    const firstStore = f.open();
    const occurrence = enqueue(firstStore, f, { job: { maxAttempts: 1 } });
    const runtimeControl = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["adapter_checkpoint"],
    };
    const firstResume = vi.fn(async () => new Promise(() => {}));
    const firstRuntime = new SchedulerRuntime({
      store: firstStore,
      ownerId: "resume-crash-owner",
      leaseMs: 1_000,
      renewIntervalMs: 500,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
      adapters: [
        {
          kind: "test.runtime",
          runtimeControl,
          execute: async (context) => {
            firstStore.requestOccurrencePause({
              occurrenceId: context.occurrence.id,
              expectedFence: context.occurrence.fence,
              requestId: "resume-crash-pause",
              capability: runtimeControl,
            });
            context.checkpoint({ cursor: 9 });
          },
          resume: firstResume,
        },
      ],
      authorize: () => ({ allowed: true }),
    });
    const paused = await firstRuntime.runOccurrence(occurrence.id);
    firstStore.resumeOccurrence({
      occurrenceId: occurrence.id,
      expectedRevision: paused.control.revision,
      requestId: "resume-crash-request",
    });

    const abandonedRun = firstRuntime.runOccurrence(occurrence.id);
    abandonedRun.catch(() => {});
    await vi.waitFor(() => expect(firstResume).toHaveBeenCalledTimes(1));
    const abandoned = firstStore.getOccurrence(occurrence.id);
    expect(firstStore.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "resumed",
      expectedFence: abandoned.fence,
      checkpoint: { data: { cursor: 9 } },
    });

    f.now = abandoned.leaseExpiresAt + 1;
    const recoveredStore = f.open();
    const recoveredExecute = vi.fn();
    const recoveredResume = vi.fn(async (_context, checkpoint) => ({
      resumedFrom: checkpoint.data.cursor,
    }));
    const recoveredRuntime = new SchedulerRuntime({
      store: recoveredStore,
      ownerId: "resume-recovered-owner",
      leaseMs: 1_000,
      adapters: [
        {
          kind: "test.runtime",
          runtimeControl,
          execute: recoveredExecute,
          resume: recoveredResume,
        },
      ],
      authorize: () => ({ allowed: true }),
    });

    await expect(
      recoveredRuntime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { resumedFrom: 9 },
      occurrence: {
        attempt: 1,
        fence: abandoned.fence + 1,
      },
    });
    expect(recoveredExecute).not.toHaveBeenCalled();
    expect(recoveredResume).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeCheckpoint: expect.objectContaining({ data: { cursor: 9 } }),
      }),
      expect.objectContaining({ data: { cursor: 9 } }),
    );
    expect(recoveredStore.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "terminal",
      expectedFence: abandoned.fence + 1,
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
