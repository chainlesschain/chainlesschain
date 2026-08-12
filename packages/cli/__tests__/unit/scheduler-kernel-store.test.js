import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  AUTHORITY_ENVELOPE_VERSION,
  MAX_HISTORY_LIMIT,
  canonicalJson,
  deriveOccurrenceIdentity,
  normalizeJson,
  normalizeAuthorityEnvelope,
} from "../../src/lib/scheduler-kernel/contract.js";
import {
  MIGRATION_V1_CHECKSUM,
  MIGRATION_V1_SQL,
  MIGRATION_V2_CHECKSUM,
  SCHEDULER_APPLICATION_ID,
  SCHEDULER_STORE_SCHEMA_VERSION,
  SCHEMA_V1_FINGERPRINT,
  SCHEMA_V2_FINGERPRINT,
  openSchedulerStore,
} from "../../src/lib/scheduler-kernel/store.js";

const STORE_URL = new URL(
  "../../src/lib/scheduler-kernel/store.js",
  import.meta.url,
).href;

function authority(overrides = {}) {
  return {
    schemaVersion: 1,
    principal: { type: "agent", id: "scheduler-test" },
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    requestedCapabilities: ["workspace.read", "network.none"],
    authorizationRefs: {
      decisionId: "decision-1",
      policyRevision: "policy-7",
      grantIds: ["grant-1"],
      approvalIds: [],
      delegationIds: [],
    },
    ...overrides,
  };
}

function jobInput(overrides = {}) {
  return {
    id: "job-a",
    kind: "test.adapter",
    trigger: { adapter: "test", expression: "opaque" },
    payload: { action: "probe" },
    authority: authority(),
    maxAttempts: 3,
    ...overrides,
  };
}

function expectCode(action, code) {
  try {
    action();
  } catch (error) {
    expect(error?.code).toBe(code);
    return error;
  }
  throw new Error(`Expected ${code}`);
}

const CLAIM_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

(async () => {
  let store;
  try {
    const { openSchedulerStore } = await import(workerData.storeUrl);
    store = openSchedulerStore({
      file: workerData.file,
      clock: () => workerData.now,
      busyTimeoutMs: 5000,
    });
    parentPort.once("message", () => {
      try {
        const gate = new Int32Array(workerData.claimGate);
        const arrivals = Atomics.add(gate, 0, 1) + 1;
        if (arrivals === 2) {
          Atomics.notify(gate, 0);
        } else {
          const wait = Atomics.wait(gate, 0, 1, 5000);
          if (wait === "timed-out" || Atomics.load(gate, 0) !== 2) {
            throw new Error("claim race barrier timed out");
          }
        }
        const claim = store.claimNext({
          ownerId: workerData.ownerId,
          leaseMs: 1000,
        });
        parentPort.postMessage({
          type: "result",
          claim: claim && {
            id: claim.id,
            owner: claim.leaseOwner,
            fence: claim.fence,
          },
        });
      } catch (error) {
        parentPort.postMessage({
          type: "error",
          error: { message: error.message, code: error.code },
        });
      } finally {
        store.close();
      }
    });
    parentPort.postMessage({ type: "ready" });
  } catch (error) {
    try { store?.close(); } catch {}
    parentPort.postMessage({
      type: "error",
      error: { message: error.message, code: error.code },
    });
  }
})();
`;

function makeClaimWorker(workerData) {
  const worker = new Worker(CLAIM_WORKER_SOURCE, {
    eval: true,
    workerData: { ...workerData, storeUrl: STORE_URL },
  });
  let readyResolve;
  let readyReject;
  let resultResolve;
  let resultReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  worker.on("message", (message) => {
    if (message.type === "ready") readyResolve();
    if (message.type === "result") resultResolve(message.claim);
    if (message.type === "error") {
      const error = new Error(message.error.message);
      error.code = message.error.code;
      readyReject(error);
      resultReject(error);
    }
  });
  worker.on("error", (error) => {
    readyReject(error);
    resultReject(error);
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      const error = new Error(`claim worker exited ${code}`);
      readyReject(error);
      resultReject(error);
    }
  });
  return { worker, ready, result };
}

describe("scheduler-kernel contract v1", () => {
  it("derives stable, revision-sensitive occurrence and idempotency identities", () => {
    const input = {
      jobId: "job-a",
      jobRevision: 1,
      scheduledFor: 1_700_000_000_000,
      triggerKey: "agenda:daily",
    };
    const first = deriveOccurrenceIdentity(input);
    expect(deriveOccurrenceIdentity({ ...input })).toEqual(first);
    expect(deriveOccurrenceIdentity({ ...input, jobRevision: 2 })).not.toEqual(
      first,
    );
    expect(first.occurrenceId).toMatch(/^occ_[a-f0-9]{64}$/);
    expect(first.idempotencyKey).toMatch(/^scheduler:v1:[a-f0-9]{64}$/);
  });

  it("normalizes authority evidence without treating it as an execution grant", () => {
    const normalized = normalizeAuthorityEnvelope(
      authority({
        requestedCapabilities: [
          "workspace.read",
          "network.none",
          "workspace.read",
        ],
      }),
    );
    expect(normalized.schemaVersion).toBe(AUTHORITY_ENVELOPE_VERSION);
    expect(normalized.requestedCapabilities).toEqual([
      "network.none",
      "workspace.read",
    ]);
    expect(() =>
      normalizeAuthorityEnvelope({ ...authority(), allowExecution: true }),
    ).toThrow(/unknown fields/);
  });

  it("canonicalizes own __proto__ keys without mutating prototypes", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"payload"}',
    );
    const normalized = normalizeJson(input, "payload");
    expect(Object.hasOwn(normalized, "__proto__")).toBe(true);
    expect(canonicalJson(normalized)).toBe(
      '{"__proto__":{"polluted":true},"constructor":"payload"}',
    );
    expect({}.polluted).toBeUndefined();
  });
});

describe("scheduler-kernel SQLite store", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()();
  });

  function fixture({
    start = 1_700_000_000_000,
    fileName = "scheduler.db",
  } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "cc-scheduler-kernel-"));
    const file = join(dir, fileName);
    let now = start;
    const handles = [];
    const open = (options = {}) => {
      const store = openSchedulerStore({
        file,
        Database,
        clock: () => now,
        ...options,
      });
      handles.push(store);
      return store;
    };
    cleanups.push(async () => {
      for (const handle of handles) {
        try {
          handle.close();
        } catch {
          // A test may have already closed or invalidated the handle.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    });
    return {
      dir,
      file,
      open,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  it("creates the exact current schema and migration record", () => {
    const f = fixture();
    const store = f.open();
    expect(store.schemaInfo()).toEqual({
      applicationId: SCHEDULER_APPLICATION_ID,
      schemaVersion: SCHEDULER_STORE_SCHEMA_VERSION,
      migration: {
        version: 2,
        name: "scheduler-kernel-authority-v2",
        checksum: MIGRATION_V2_CHECKSUM,
        appliedAt: f.now,
      },
    });
    expect(SCHEMA_V1_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V2_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    const tables = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "events",
      "jobs",
      "migrations",
      "occurrences",
      "scheduler_authority_policies",
      "scheduler_authority_reservations",
      "scheduler_authority_usage",
    ]);
  });

  it("migrates an exact v1 database to v2 without losing jobs", () => {
    const f = fixture({ fileName: "legacy-v1.db" });
    const legacy = new Database(f.file);
    legacy.exec(MIGRATION_V1_SQL);
    legacy
      .prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(1, "scheduler-kernel-v1", MIGRATION_V1_CHECKSUM, f.now - 1);
    legacy
      .prepare(
        `INSERT INTO jobs
           (job_id, kind, trigger_json, payload_json, authority_json,
            enabled, revision, max_attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, 3, ?, ?)`,
      )
      .run(
        "legacy-job",
        "test.adapter",
        canonicalJson({ adapter: "legacy" }),
        canonicalJson({ action: "preserve" }),
        canonicalJson(authority()),
        f.now - 1,
        f.now - 1,
      );
    const legacyOccurrence = deriveOccurrenceIdentity({
      jobId: "legacy-job",
      jobRevision: 1,
      scheduledFor: f.now - 1,
      triggerKey: "legacy:queued",
    });
    legacy
      .prepare(
        `INSERT INTO occurrences
           (occurrence_id, job_id, job_revision, idempotency_key,
            trigger_key, scheduled_for, available_at, status, attempt,
            max_attempts, fence, lease_owner, lease_expires_at,
            authority_json, payload_json, last_error_json, result_json,
            created_at, updated_at, settled_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, 'queued', 0, 3, 0, NULL, NULL,
                 ?, ?, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        legacyOccurrence.occurrenceId,
        "legacy-job",
        legacyOccurrence.idempotencyKey,
        "legacy:queued",
        f.now - 1,
        f.now - 1,
        canonicalJson(authority()),
        canonicalJson({ action: "preserve" }),
        f.now - 1,
        f.now - 1,
      );
    legacy.pragma(`application_id = ${SCHEDULER_APPLICATION_ID}`);
    legacy.pragma("user_version = 1");
    legacy.close();

    const migrated = f.open();
    expect(migrated.schemaInfo()).toMatchObject({
      schemaVersion: 2,
      migration: { version: 2, checksum: MIGRATION_V2_CHECKSUM },
    });
    expect(migrated.getJob("legacy-job")).toMatchObject({
      id: "legacy-job",
      revision: 1,
      payload: { action: "preserve" },
    });
    expect(migrated.getAuthorityPolicy(authority().principal)).toMatchObject({
      revision: 1,
      capabilities: ["network.none", "workspace.read"],
    });
    expect(
      migrated.getJob("legacy-job").authority.authorizationRefs,
    ).toMatchObject({
      policyRevision: "policy-7",
      schedulerPolicyRevision: "scheduler-authority:1",
    });
    expect(
      migrated.getOccurrence(legacyOccurrence.occurrenceId).authority
        .authorizationRefs,
    ).toMatchObject({
      policyRevision: "policy-7",
      schedulerPolicyRevision: "scheduler-authority:1",
    });
  });

  it("applies expected-revision CAS across two real database handles", () => {
    const f = fixture();
    const first = f.open();
    const second = f.open();
    expect(first.createJob(jobInput()).revision).toBe(1);
    expect(
      second.updateJob("job-a", 1, { payload: { action: "v2" } }),
    ).toMatchObject({ revision: 2, payload: { action: "v2" } });
    const conflict = expectCode(
      () => first.updateJob("job-a", 1, { enabled: false }),
      "SCHEDULER_REVISION_CONFLICT",
    );
    expect(conflict.details).toEqual({
      expectedRevision: 1,
      actualRevision: 2,
    });
  });

  it("parameterizes identifiers and deduplicates a logical occurrence", () => {
    const f = fixture();
    const store = f.open();
    const injection = "job'; DROP TABLE jobs;--";
    store.createJob(jobInput({ id: injection }));
    const first = store.enqueueOccurrence({
      jobId: injection,
      scheduledFor: f.now,
      triggerKey: "routine:one",
    });
    const duplicate = store.enqueueOccurrence({
      jobId: injection,
      scheduledFor: f.now,
      triggerKey: "routine:one",
    });
    expect(first.deduplicated).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, deduplicated: true });
    expect(store.getJob(injection)).not.toBeNull();
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    ).toBe(1);
  });

  it("binds an occurrence payload override to its idempotency identity", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ id: "event-job" }));
    const first = store.enqueueOccurrence({
      jobId: "event-job",
      scheduledFor: f.now,
      triggerKey: "event:one",
      payload: { eventId: "evt-1", input: { text: "hello" } },
    });
    const duplicate = store.enqueueOccurrence({
      jobId: "event-job",
      scheduledFor: f.now,
      triggerKey: "event:one",
      payload: { eventId: "evt-1", input: { text: "hello" } },
    });

    expect(first.payload).toEqual({
      eventId: "evt-1",
      input: { text: "hello" },
    });
    expect(duplicate).toMatchObject({ id: first.id, deduplicated: true });
    expect(
      store.listOccurrencesByTrigger({
        jobId: "event-job",
        triggerKey: "event:one",
      }),
    ).toHaveLength(1);
    expect(() =>
      store.enqueueOccurrence({
        jobId: "event-job",
        scheduledFor: f.now,
        triggerKey: "event:one",
        payload: { eventId: "evt-1", input: { text: "changed" } },
      }),
    ).toThrow(/different payload/u);
  });

  it("increments a monotonic fence and rejects stale owner/fence renew or settle", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "agenda:daily",
    });
    const first = store.claimNext({ ownerId: "worker-a", leaseMs: 100 });
    expect(first).toMatchObject({ id: occurrence.id, attempt: 1, fence: 1 });
    expect(
      store.renew({
        occurrenceId: first.id,
        ownerId: "worker-a",
        fence: first.fence,
        leaseMs: 50,
      }).leaseExpiresAt,
    ).toBe(first.leaseExpiresAt);
    expectCode(
      () =>
        store.renew({
          occurrenceId: first.id,
          ownerId: "worker-b",
          fence: first.fence,
          leaseMs: 100,
        }),
      "SCHEDULER_LEASE_LOST",
    );
    f.now += 101;
    expectCode(
      () =>
        store.renew({
          occurrenceId: first.id,
          ownerId: "worker-a",
          fence: first.fence,
          leaseMs: 100,
        }),
      "SCHEDULER_LEASE_LOST",
    );
    const second = store.claimNext({ ownerId: "worker-b", leaseMs: 100 });
    expect(second).toMatchObject({
      attempt: 2,
      fence: 2,
      leaseOwner: "worker-b",
    });
    expectCode(
      () =>
        store.settle({
          occurrenceId: first.id,
          ownerId: "worker-a",
          fence: first.fence,
          outcome: "succeeded",
        }),
      "SCHEDULER_LEASE_LOST",
    );
    expect(
      store.settle({
        occurrenceId: second.id,
        ownerId: "worker-b",
        fence: second.fence,
        outcome: "succeeded",
        result: { ok: true },
      }),
    ).toMatchObject({ status: "succeeded", result: { ok: true } });
  });

  it("targets one occurrence without consuming unrelated queued work", () => {
    const f = fixture();
    const firstHandle = f.open();
    const secondHandle = f.open();
    firstHandle.createJob(jobInput());
    const first = firstHandle.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "target:first",
    });
    const target = firstHandle.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "target:second",
    });

    const targeted = secondHandle.claimOccurrence({
      occurrenceId: target.id,
      ownerId: "target-owner-a",
      leaseMs: 100,
    });
    expect(targeted).toMatchObject({
      id: target.id,
      status: "running",
      leaseOwner: "target-owner-a",
      fence: 1,
      attempt: 1,
    });
    expect(firstHandle.getOccurrence(first.id).status).toBe("queued");
    expect(
      firstHandle.claimOccurrence({
        occurrenceId: target.id,
        ownerId: "target-owner-b",
        leaseMs: 100,
      }),
    ).toBeNull();

    f.now += 101;
    const reclaimed = firstHandle.claimOccurrence({
      occurrenceId: target.id,
      ownerId: "target-owner-b",
      leaseMs: 100,
    });
    expect(reclaimed).toMatchObject({
      id: target.id,
      leaseOwner: "target-owner-b",
      fence: 2,
      attempt: 2,
    });
    firstHandle.settle({
      occurrenceId: target.id,
      ownerId: "target-owner-b",
      fence: reclaimed.fence,
      outcome: "succeeded",
      result: { targeted: true },
    });
    expect(
      secondHandle.claimOccurrence({
        occurrenceId: target.id,
        ownerId: "target-owner-c",
        leaseMs: 100,
      }),
    ).toBeNull();
    expectCode(
      () =>
        firstHandle.claimOccurrence({
          occurrenceId: "occ_missing",
          ownerId: "target-owner",
          leaseMs: 100,
        }),
      "SCHEDULER_NOT_FOUND",
    );
  });

  it("claims only the requested adapter kind without consuming other work", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ id: "job-other", kind: "other.adapter" }));
    store.createJob(jobInput({ id: "job-routine", kind: "routine" }));
    const other = store.enqueueOccurrence({
      jobId: "job-other",
      scheduledFor: f.now,
      triggerKey: "kind:other",
    });
    const routine = store.enqueueOccurrence({
      jobId: "job-routine",
      scheduledFor: f.now,
      triggerKey: "kind:routine",
    });

    expect(
      store.claimNext({
        ownerId: "routine-driver",
        leaseMs: 100,
        jobKind: "routine",
      }),
    ).toMatchObject({ id: routine.id, leaseOwner: "routine-driver" });
    expect(store.getOccurrence(other.id).status).toBe("queued");
    expect(
      store.claimNext({ ownerId: "generic-driver", leaseMs: 100 }),
    ).toMatchObject({ id: other.id, leaseOwner: "generic-driver" });
  });

  it("claims only the requested workspace without consuming sibling work", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(
      jobInput({
        id: "job-workspace-a",
        kind: "cowork-cron",
        authority: authority({ workspaceId: "workspace-a" }),
      }),
    );
    store.createJob(
      jobInput({
        id: "job-workspace-b",
        kind: "cowork-cron",
        authority: authority({ workspaceId: "workspace-b" }),
      }),
    );
    const workspaceA = store.enqueueOccurrence({
      jobId: "job-workspace-a",
      scheduledFor: f.now,
      triggerKey: "workspace:a",
    });
    const workspaceB = store.enqueueOccurrence({
      jobId: "job-workspace-b",
      scheduledFor: f.now,
      triggerKey: "workspace:b",
    });

    expect(
      store.claimNext({
        ownerId: "workspace-b-driver",
        leaseMs: 100,
        jobKind: "cowork-cron",
        workspaceId: "workspace-b",
      }),
    ).toMatchObject({ id: workspaceB.id, leaseOwner: "workspace-b-driver" });
    expect(store.getOccurrence(workspaceA.id).status).toBe("queued");
  });

  it("bounds retries, dead-letters exhaustion, and exposes bounded history", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 2 }));
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "loop:one",
    });
    const first = store.claimNext({ ownerId: "worker-a", leaseMs: 10_000 });
    expect(
      store.settle({
        occurrenceId: first.id,
        ownerId: "worker-a",
        fence: first.fence,
        outcome: "failed",
        error: { code: "temporary" },
        retryAt: f.now + 50,
      }),
    ).toMatchObject({ status: "retry_wait", attempt: 1 });
    expect(store.claimNext({ ownerId: "worker-b", leaseMs: 100 })).toBeNull();
    f.now += 50;
    const second = store.claimNext({ ownerId: "worker-b", leaseMs: 10_000 });
    const terminal = store.settle({
      occurrenceId: second.id,
      ownerId: "worker-b",
      fence: second.fence,
      outcome: "failed",
      error: { code: "still-broken" },
    });
    expect(terminal).toMatchObject({
      id: occurrence.id,
      status: "dead_letter",
      attempt: 2,
      lastError: { code: "still-broken" },
    });
    expect(store.listDeadLetters({ limit: 10 })).toHaveLength(1);
    expect(
      store
        .history({ occurrenceId: occurrence.id, limit: 1000 })
        .map((event) => event.type),
    ).toEqual([
      "occurrence_dead_lettered",
      "occurrence_claimed",
      "occurrence_retry_scheduled",
      "occurrence_claimed",
      "occurrence_enqueued",
    ]);

    const secondOccurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now + 1,
      availableAt: f.now,
      triggerKey: "loop:two",
    });
    const running = store.claimNext({
      ownerId: "history-worker",
      leaseMs: 10_000,
    });
    expect(running.id).toBe(secondOccurrence.id);
    for (let index = 0; index < MAX_HISTORY_LIMIT + 5; index += 1) {
      store.renew({
        occurrenceId: running.id,
        ownerId: "history-worker",
        fence: running.fence,
        leaseMs: 10_000,
      });
    }
    expect(store.history({ limit: 10_000 })).toHaveLength(MAX_HISTORY_LIMIT);
  });

  it("dead-letters an expired final attempt before selecting more work", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 1 }));
    const queued = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "once",
    });
    store.claimNext({ ownerId: "worker-a", leaseMs: 10 });
    f.now += 11;
    expect(store.claimNext({ ownerId: "worker-b", leaseMs: 10 })).toBeNull();
    expect(store.getOccurrence(queued.id)).toMatchObject({
      status: "dead_letter",
      lastError: { code: "lease_expired" },
    });
  });

  it("allows exactly one claimant under a real two-handle worker race", async () => {
    const f = fixture();
    const setup = f.open();
    setup.createJob(jobInput());
    const occurrence = setup.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "race",
    });
    setup.close();

    const claimGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const workers = ["race-a", "race-b"].map((ownerId) =>
      makeClaimWorker({
        file: f.file,
        now: f.now,
        ownerId,
        claimGate,
      }),
    );
    cleanups.push(async () => {
      await Promise.all(
        workers.map(({ worker }) => worker.terminate().catch(() => undefined)),
      );
    });
    await Promise.all(workers.map(({ ready }) => ready));
    for (const { worker } of workers) worker.postMessage("claim");
    const results = await Promise.all(workers.map(({ result }) => result));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)).toMatchObject({
      id: occurrence.id,
      fence: 1,
    });

    const verify = f.open();
    expect(verify.getOccurrence(occurrence.id)).toMatchObject({
      status: "running",
      attempt: 1,
      fence: 1,
      leaseOwner: results.find(Boolean).owner,
    });
  });

  it("fails closed for unknown and damaged schema state", () => {
    const future = fixture({ fileName: "future.db" });
    future.open().close();
    const futureDb = new Database(future.file);
    futureDb.pragma("user_version = 3");
    futureDb.close();
    expectCode(() => future.open(), "SCHEDULER_SCHEMA_UNKNOWN");

    const damaged = fixture({ fileName: "damaged.db" });
    damaged.open().close();
    const damagedDb = new Database(damaged.file);
    damagedDb.exec("DROP INDEX scheduler_occurrences_claim");
    damagedDb.close();
    expectCode(() => damaged.open(), "SCHEDULER_SCHEMA_CORRUPT");

    const injected = fixture({ fileName: "trigger.db" });
    injected.open().close();
    const injectedDb = new Database(injected.file);
    injectedDb.exec(`
      CREATE TRIGGER scheduler_unexpected_trigger
      AFTER INSERT ON jobs
      BEGIN
        UPDATE jobs SET enabled = 0 WHERE job_id = NEW.job_id;
      END
    `);
    injectedDb.close();
    expectCode(() => injected.open(), "SCHEDULER_SCHEMA_CORRUPT");

    const semantic = fixture({ fileName: "semantic.db" });
    const semanticStore = semantic.open();
    semanticStore.createJob(jobInput());
    semanticStore.close();
    const semanticDb = new Database(semantic.file);
    semanticDb
      .prepare("UPDATE jobs SET authority_json = ? WHERE job_id = ?")
      .run('{"schemaVersion":2}', "job-a");
    semanticDb.close();
    const semanticRead = semantic.open();
    expectCode(() => semanticRead.getJob("job-a"), "SCHEDULER_DATA_CORRUPT");

    const garbage = fixture({ fileName: "garbage.db" });
    writeFileSync(garbage.file, "not-a-sqlite-database", { mode: 0o600 });
    expectCode(() => garbage.open(), "SCHEDULER_SCHEMA_CORRUPT");
  });
});
