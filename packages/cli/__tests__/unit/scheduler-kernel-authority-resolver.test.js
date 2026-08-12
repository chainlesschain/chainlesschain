import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
} from "../../src/lib/scheduler-kernel/authority-resolver.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

function authority({ capability = "agent.execute", reference = null } = {}) {
  return {
    schemaVersion: 1,
    principal: { type: "test-schedule", id: "shared-authority" },
    tenantId: null,
    workspaceId: "workspace-a",
    requestedCapabilities: [capability],
    authorizationRefs: {
      decisionId: null,
      policyRevision: "domain-policy:7",
      ...(reference === null ? {} : { schedulerPolicyRevision: reference }),
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function createJob(store, boundAuthority, id = "authority-job") {
  return store.createJob({
    id,
    kind: "test.authority",
    trigger: { source: "test" },
    payload: { action: "execute" },
    authority: boundAuthority,
    maxAttempts: 3,
  });
}

function enqueueAndClaim(store, jobId, sequence, now) {
  const occurrence = store.enqueueOccurrence({
    jobId,
    scheduledFor: now,
    triggerKey: `authority:${sequence}`,
  });
  return store.claimOccurrence({
    occurrenceId: occurrence.id,
    ownerId: "authority-owner",
    leaseMs: 60_000,
  });
}

describe("scheduler shared permission and budget resolver", () => {
  const stores = [];

  afterEach(() => {
    while (stores.length > 0) stores.pop().close();
  });

  function fixture(start = 1_700_000_000_000) {
    let now = start;
    const store = openSchedulerStore({
      file: ":memory:",
      Database,
      clock: () => now,
    });
    stores.push(store);
    return {
      store,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  it("binds an exact policy revision, reserves units and settles atomically", async () => {
    const f = fixture();
    const bound = bindSchedulerAuthorityPolicy(f.store, authority(), {
      windowMs: 60_000,
      maxRuns: 2,
      maxUnits: 4,
    });
    expect(bound.authorizationRefs).toMatchObject({
      policyRevision: "domain-policy:7",
      schedulerPolicyRevision: "scheduler-authority:1",
    });
    const job = createJob(f.store, bound);
    const occurrence = enqueueAndClaim(f.store, job.id, 1, f.now);
    const resolve = createSchedulerAuthorityResolver({
      store: f.store,
      validate: () => ({ allowed: true, reason: "snapshot_bound" }),
      units: () => 2,
    });

    await expect(resolve({ job, occurrence })).resolves.toMatchObject({
      allowed: true,
      policyRevision: 1,
      reservation: { units: 2, status: "reserved", deduplicated: false },
    });
    expect(f.store.getAuthorityReservation(occurrence.id)).toMatchObject({
      occurrenceId: occurrence.id,
      policyRevision: 1,
      units: 2,
      status: "reserved",
    });

    f.store.settle({
      occurrenceId: occurrence.id,
      ownerId: "authority-owner",
      fence: occurrence.fence,
      outcome: "succeeded",
      result: { ok: true },
    });
    expect(f.store.getAuthorityReservation(occurrence.id)).toMatchObject({
      status: "succeeded",
      outcome: { status: "succeeded", result: { ok: true } },
      settledAt: f.now,
    });
    expect(f.store.history({ occurrenceId: occurrence.id })[0]).toMatchObject({
      type: "occurrence_succeeded",
      data: { authorityPolicyRevision: 1, authorityUnits: 2 },
    });
  });

  it("deduplicates a reservation across retry claims without double charging", async () => {
    const f = fixture();
    const bound = bindSchedulerAuthorityPolicy(f.store, authority(), {
      windowMs: 60_000,
      maxRuns: 1,
      maxUnits: 1,
    });
    const job = createJob(f.store, bound);
    let occurrence = enqueueAndClaim(f.store, job.id, 1, f.now);
    const resolve = createSchedulerAuthorityResolver({
      store: f.store,
      validate: () => ({ allowed: true }),
    });
    expect((await resolve({ job, occurrence })).reservation.deduplicated).toBe(
      false,
    );
    f.store.settle({
      occurrenceId: occurrence.id,
      ownerId: "authority-owner",
      fence: occurrence.fence,
      outcome: "failed",
      error: { code: "retry", message: "retry" },
      retryable: true,
      retryAt: f.now,
    });
    expect(f.store.getAuthorityReservation(occurrence.id).status).toBe(
      "reserved",
    );

    occurrence = f.store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "authority-owner",
      leaseMs: 60_000,
    });
    expect((await resolve({ job, occurrence })).reservation).toMatchObject({
      deduplicated: true,
      units: 1,
      status: "reserved",
    });
    expect(
      f.store.db
        .prepare("SELECT runs, units FROM scheduler_authority_usage")
        .get(),
    ).toEqual({ runs: 1, units: 1 });
  });

  it("fails closed for stale policy snapshots and exact capability expansion", async () => {
    const f = fixture();
    const bound = bindSchedulerAuthorityPolicy(f.store, authority(), {
      windowMs: 60_000,
      maxRuns: 10,
      maxUnits: 10,
    });
    const job = createJob(f.store, bound);
    const stale = enqueueAndClaim(f.store, job.id, 1, f.now);
    f.store.setAuthorityPolicy(bound.principal, {
      capabilities: ["agent.execute"],
      windowMs: 60_000,
      maxRuns: 10,
      maxUnits: 10,
      expectedRevision: 1,
    });
    const resolve = createSchedulerAuthorityResolver({
      store: f.store,
      validate: () => ({ allowed: true }),
    });
    await expect(resolve({ job, occurrence: stale })).resolves.toEqual({
      allowed: false,
      reason: "scheduler_authority_policy_stale",
    });
    expect(f.store.getAuthorityReservation(stale.id)).toBeNull();

    const expandedJob = createJob(
      f.store,
      authority({
        capability: "network.write",
        reference: "scheduler-authority:2",
      }),
      "expanded-job",
    );
    const expanded = enqueueAndClaim(f.store, expandedJob.id, 2, f.now);
    await expect(
      resolve({ job: expandedJob, occurrence: expanded }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "scheduler_authority_permission_denied",
      details: { denied: ["network.write"] },
    });
    expect(f.store.getAuthorityReservation(expanded.id)).toBeNull();
  });

  it("enforces a durable budget and rejects inconsistent accounting state", async () => {
    const f = fixture();
    const bound = bindSchedulerAuthorityPolicy(f.store, authority(), {
      windowMs: 60_000,
      maxRuns: 2,
      maxUnits: 2,
    });
    const job = createJob(f.store, bound);
    const resolve = createSchedulerAuthorityResolver({
      store: f.store,
      validate: () => ({ allowed: true }),
    });
    const first = enqueueAndClaim(f.store, job.id, 1, f.now);
    expect((await resolve({ job, occurrence: first })).allowed).toBe(true);
    f.store.settle({
      occurrenceId: first.id,
      ownerId: "authority-owner",
      fence: first.fence,
      outcome: "succeeded",
    });
    f.store.db.prepare("UPDATE scheduler_authority_usage SET units = 0").run();

    const second = enqueueAndClaim(f.store, job.id, 2, f.now);
    await expect(resolve({ job, occurrence: second })).resolves.toMatchObject({
      allowed: false,
      reason: "scheduler_authority_budget_state_invalid",
    });
    expect(f.store.getAuthorityReservation(second.id)).toBeNull();
  });

  it("fails closed for an unbound legacy job and enforces a bound run limit", async () => {
    const f = fixture();
    const legacyAuthority = authority();
    f.store.setAuthorityPolicy(legacyAuthority.principal, {
      capabilities: ["agent.execute"],
      windowMs: 60_000,
      maxRuns: 1,
      maxUnits: 1,
      expectedRevision: 0,
    });
    const job = createJob(f.store, legacyAuthority);
    const resolve = createSchedulerAuthorityResolver({
      store: f.store,
      validate: () => ({ allowed: true }),
    });
    const first = enqueueAndClaim(f.store, job.id, 1, f.now);
    await expect(resolve({ job, occurrence: first })).resolves.toEqual({
      allowed: false,
      reason: "scheduler_authority_policy_unbound",
    });
    f.store.settle({
      occurrenceId: first.id,
      ownerId: "authority-owner",
      fence: first.fence,
      outcome: "failed",
      retryable: false,
    });
    const bound = bindSchedulerAuthorityPolicy(f.store, legacyAuthority);
    const boundJob = createJob(f.store, bound, "bound-limit-job");
    const accepted = enqueueAndClaim(f.store, boundJob.id, 2, f.now);
    expect(
      (await resolve({ job: boundJob, occurrence: accepted })).allowed,
    ).toBe(true);
    f.store.settle({
      occurrenceId: accepted.id,
      ownerId: "authority-owner",
      fence: accepted.fence,
      outcome: "succeeded",
    });
    const second = enqueueAndClaim(f.store, boundJob.id, 3, f.now);
    await expect(
      resolve({ job: boundJob, occurrence: second }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "scheduler_authority_budget_exhausted",
    });
  });
});
