import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  AUTHORITY_ENVELOPE_VERSION,
  MAX_HISTORY_LIMIT,
  SchedulerKernelError,
  canonicalJson,
  deriveOccurrenceIdentity,
  normalizeJson,
  normalizeAuthorityEnvelope,
} from "../../src/lib/scheduler-kernel/contract.js";
import {
  MIGRATION_V1_CHECKSUM,
  MIGRATION_V1_SQL,
  MIGRATION_V2_CHECKSUM,
  MIGRATION_V2_SQL,
  MIGRATION_V3_CHECKSUM,
  MIGRATION_V3_SQL,
  MIGRATION_V4_CHECKSUM,
  MIGRATION_V4_SQL,
  MIGRATION_V5_CHECKSUM,
  MIGRATION_V6_CHECKSUM,
  SCHEDULER_APPLICATION_ID,
  SCHEDULER_STORE_SCHEMA_VERSION,
  SCHEMA_V1_FINGERPRINT,
  SCHEMA_V2_FINGERPRINT,
  SCHEMA_V3_FINGERPRINT,
  SCHEMA_V4_FINGERPRINT,
  SCHEMA_V5_FINGERPRINT,
  SCHEMA_V6_FINGERPRINT,
  SchedulerStore,
  openSchedulerStore,
} from "../../src/lib/scheduler-kernel/store.js";
import { canonicalSchedulerSourcePath } from "../../src/lib/scheduler-kernel/source-locator-path.js";

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

  function advanceClockWhenNextWriteBodyStarts(store, fixtureClock, elapsedMs) {
    const write = store._write.bind(store);
    store._write = (callback) => {
      store._write = write;
      return write((...args) => {
        fixtureClock.now += elapsedMs;
        return callback(...args);
      });
    };
  }

  it("samples claimNext lease time after the immediate write transaction starts", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "transaction-clock:claim-next",
    });
    const beforeWriteWait = f.now;

    advanceClockWhenNextWriteBodyStarts(store, f, 250);
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 100 });

    expect(claim).toMatchObject({
      leaseExpiresAt: beforeWriteWait + 350,
      updatedAt: beforeWriteWait + 250,
    });
  });

  it("samples claimOccurrence lease time after the immediate write transaction starts", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "transaction-clock:claim-occurrence",
    });
    const beforeWriteWait = f.now;

    advanceClockWhenNextWriteBodyStarts(store, f, 250);
    const claim = store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "worker-a",
      leaseMs: 100,
    });

    expect(claim).toMatchObject({
      leaseExpiresAt: beforeWriteWait + 350,
      updatedAt: beforeWriteWait + 250,
    });
  });

  it("samples renew lease time after the immediate write transaction starts", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "transaction-clock:renew",
    });
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 1000 });
    const beforeWriteWait = f.now;

    advanceClockWhenNextWriteBodyStarts(store, f, 250);
    const renewed = store.renew({
      occurrenceId: claim.id,
      ownerId: "worker-a",
      fence: claim.fence,
      leaseMs: 2000,
    });

    expect(renewed).toMatchObject({
      leaseExpiresAt: beforeWriteWait + 2250,
      updatedAt: beforeWriteWait + 250,
    });
  });

  it("rejects settlement when the lease expires while waiting for the write transaction", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "transaction-clock:settle-expired",
    });
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 100 });

    advanceClockWhenNextWriteBodyStarts(store, f, 101);
    expectCode(
      () =>
        store.settle({
          occurrenceId: claim.id,
          ownerId: "worker-a",
          fence: claim.fence,
          outcome: "succeeded",
        }),
      "SCHEDULER_LEASE_LOST",
    );
    expect(store.getOccurrence(claim.id)).toMatchObject({
      status: "running",
      leaseOwner: "worker-a",
      fence: claim.fence,
    });
  });

  it("floors retryable settlement availability at transaction time", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput());
    store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "transaction-clock:settle-retry",
    });
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 1000 });
    const beforeWriteWait = f.now;

    advanceClockWhenNextWriteBodyStarts(store, f, 200);
    const retry = store.settle({
      occurrenceId: claim.id,
      ownerId: "worker-a",
      fence: claim.fence,
      outcome: "failed",
      error: { code: "retry-me" },
      retryAt: beforeWriteWait + 100,
    });

    expect(retry).toMatchObject({
      status: "retry_wait",
      availableAt: beforeWriteWait + 200,
      updatedAt: beforeWriteWait + 200,
    });
  });

  it.each([
    ["ENOSPC", "ENOSPC", false],
    ["EROFS", "EROFS", false],
    ["EIO", "EIO", false],
    ["SQLITE_FULL", "SQLITE_FULL", false],
    ["SQLITE_IOERR_WRITE", "SQLITE_IOERR", true],
    ["SQLITE_READONLY_DBMOVED", "SQLITE_READONLY", true],
  ])(
    "sanitizes %s storage failures while opening the database",
    (reportedCode, storageCode, nested) => {
      const privatePath = "C:\\private\\scheduler-secret.db";
      const nativeError = Object.assign(
        new Error(`could not write ${privatePath}`),
        { code: reportedCode },
      );
      const failure = nested
        ? new Error("native database wrapper failed", { cause: nativeError })
        : nativeError;
      class FailingDatabase {
        constructor() {
          throw failure;
        }
      }

      const error = expectCode(
        () =>
          openSchedulerStore({
            file: ":memory:",
            Database: FailingDatabase,
            clock: () => 1_700_000_000_000,
          }),
        "SCHEDULER_STORAGE_UNAVAILABLE",
      );
      expect(error.message).toBe("Scheduler storage is unavailable");
      expect(error.details).toEqual({
        phase: "open",
        storageCode,
        commitState: "unknown",
        retryable: false,
      });
      expect(Object.keys(error.details).sort()).toEqual([
        "commitState",
        "phase",
        "retryable",
        "storageCode",
      ]);
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(privatePath);
      expect(JSON.stringify(error)).not.toContain("could not write");
    },
  );

  it("reports sanitized commit-like wrapper failures as unknown", () => {
    const privatePath = "/private/scheduler-secret.db";
    const nativeError = Object.assign(
      new Error(`readonly database at ${privatePath}`),
      { code: "SQLITE_READONLY_CANTLOCK" },
    );
    const wrappedError = new Error("transaction failed", {
      cause: nativeError,
    });
    let callbackReturned = false;
    const fakeDb = {
      prepare: () => ({ run: () => undefined }),
      transaction: (callback) => ({
        immediate: () => {
          callback();
          callbackReturned = true;
          throw wrappedError;
        },
      }),
      close: () => undefined,
    };
    const store = new SchedulerStore(fakeDb, {
      file: ":memory:",
      clock: () => 1_700_000_000_000,
    });

    const error = expectCode(
      () => store._write(() => undefined),
      "SCHEDULER_STORAGE_UNAVAILABLE",
    );
    expect(error.message).toBe("Scheduler storage is unavailable");
    expect(error.details).toEqual({
      phase: "write",
      storageCode: "SQLITE_READONLY",
      commitState: "unknown",
      retryable: false,
    });
    expect(callbackReturned).toBe(true);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(privatePath);
    expect(JSON.stringify(error)).not.toContain("transaction failed");

    const authoritative = new SchedulerKernelError(
      "SCHEDULER_TEST_AUTHORITY",
      "authoritative kernel failure",
    );
    fakeDb.transaction = () => ({
      immediate: () => {
        throw authoritative;
      },
    });
    try {
      store._write(() => undefined);
      throw new Error("Expected the authoritative scheduler error");
    } catch (caught) {
      expect(caught).toBe(authoritative);
    }
  });

  it("retries SQLITE_BUSY only before the transaction body starts", () => {
    let attempts = 0;
    let callbackCalls = 0;
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    const fakeDb = {
      prepare: () => ({ run: () => undefined }),
      transaction: (callback) => ({
        immediate: () => {
          attempts += 1;
          if (attempts < 3) throw busy;
          return callback();
        },
      }),
      close: () => undefined,
    };
    const store = new SchedulerStore(fakeDb, {
      file: ":memory:",
      clock: () => 1_700_000_000_000,
    });

    expect(
      store._write(() => {
        callbackCalls += 1;
        return "committed";
      }),
    ).toBe("committed");
    expect(attempts).toBe(3);
    expect(callbackCalls).toBe(1);

    attempts = 0;
    fakeDb.transaction = (callback) => ({
      immediate: () => {
        attempts += 1;
        callback();
        throw busy;
      },
    });
    expect(() => store._write(() => undefined)).toThrow(busy);
    expect(attempts).toBe(1);
  });

  it("reports an unknown commit state when rollback failure obscures the outcome", () => {
    const bodyPath = "/private/body-secret.db";
    const rollbackPath = "/private/rollback-secret.db";
    const bodyError = Object.assign(new Error(`write failed at ${bodyPath}`), {
      code: "SQLITE_FULL",
    });
    const rollbackError = Object.assign(
      new Error(`rollback failed at ${rollbackPath}`, { cause: bodyError }),
      { code: "SQLITE_IOERR_ROLLBACK" },
    );
    let inTransaction = false;
    const fakeDb = {
      get inTransaction() {
        return inTransaction;
      },
      prepare: () => ({ run: () => undefined }),
      transaction: (callback) => ({
        immediate: () => {
          inTransaction = true;
          try {
            callback();
          } catch {
            throw rollbackError;
          }
        },
      }),
      close: () => undefined,
    };
    const store = new SchedulerStore(fakeDb, {
      file: ":memory:",
      clock: () => 1_700_000_000_000,
    });

    const error = expectCode(
      () =>
        store._write(() => {
          throw bodyError;
        }),
      "SCHEDULER_STORAGE_UNAVAILABLE",
    );
    expect(error.details).toEqual({
      phase: "write",
      storageCode: "SQLITE_IOERR",
      commitState: "unknown",
      retryable: false,
    });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(bodyPath);
    expect(JSON.stringify(error)).not.toContain(rollbackPath);
    expect(JSON.stringify(error)).not.toContain("rollback failed");
  });

  it("rolls back a native SQLITE_FULL transaction and reopens cleanly", () => {
    const f = fixture({ fileName: "full.db" });
    const store = f.open();
    store.createJob(jobInput());
    const before = store.db
      .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
      .get("job-a");
    const pageCount = store.db.pragma("page_count", { simple: true });
    store.db.pragma(`max_page_count = ${pageCount}`);

    const error = expectCode(
      () =>
        store._write(() => {
          store.db
            .prepare(
              "UPDATE jobs SET revision = revision + 1, updated_at = ? WHERE job_id = ?",
            )
            .run(f.now + 1, "job-a");
          store.db
            .prepare(
              `INSERT INTO events
                 (job_id, occurrence_id, event_type, occurred_at,
                  owner_id, fence, data_json)
               VALUES (?, NULL, ?, ?, NULL, NULL, ?)`,
            )
            .run(
              "job-a",
              "storage-pressure",
              f.now + 1,
              JSON.stringify({ payload: "x".repeat(1024 * 1024) }),
            );
        }),
      "SCHEDULER_STORAGE_UNAVAILABLE",
    );
    expect(error.details).toEqual({
      phase: "write",
      storageCode: "SQLITE_FULL",
      commitState: "not_committed",
      retryable: false,
    });
    expect(
      store.db
        .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
        .get("job-a"),
    ).toEqual(before);
    expect(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = ?")
        .get("storage-pressure").count,
    ).toBe(0);
    expect(store.db.pragma("quick_check", { simple: true })).toBe("ok");

    store.close();
    const reopened = f.open();
    expect(reopened.db.pragma("quick_check", { simple: true })).toBe("ok");
    expect(
      reopened.db
        .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
        .get("job-a"),
    ).toEqual(before);
    expect(
      reopened.db
        .prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = ?")
        .get("storage-pressure").count,
    ).toBe(0);
  });

  it("creates the exact current schema and migration record", () => {
    const f = fixture();
    const store = f.open();
    expect(store.schemaInfo()).toEqual({
      applicationId: SCHEDULER_APPLICATION_ID,
      schemaVersion: SCHEDULER_STORE_SCHEMA_VERSION,
      migration: {
        version: 6,
        name: "scheduler-kernel-runtime-control-v6",
        checksum: MIGRATION_V6_CHECKSUM,
        appliedAt: f.now,
      },
    });
    expect(SCHEMA_V1_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V2_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V3_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V4_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V5_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(SCHEMA_V6_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
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
      "scheduler_domain_migration_entries",
      "scheduler_domain_migrations",
      "scheduler_occurrence_adjudications",
      "scheduler_occurrence_controls",
      "scheduler_occurrence_retries",
    ]);
  });

  it("migrates an exact v1 database to v5 without losing jobs", () => {
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
      schemaVersion: 6,
      migration: { version: 6, checksum: MIGRATION_V6_CHECKSUM },
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

  it("migrates an exact v2 database to v5 without changing authority state", () => {
    const f = fixture({ fileName: "legacy-v2.db" });
    const seed = f.open();
    seed.createJob(jobInput());
    seed.ensureAuthorityPolicy(authority());
    seed.close();
    const legacy = new Database(f.file);
    legacy.exec("DROP TABLE scheduler_occurrence_retries");
    legacy.exec("DROP TABLE scheduler_occurrence_controls");
    legacy.exec("DROP TABLE scheduler_domain_migration_entries");
    legacy.exec("DROP TABLE scheduler_domain_migrations");
    legacy.exec("DROP TABLE scheduler_occurrence_adjudications");
    legacy.prepare("DELETE FROM migrations WHERE version >= 3").run();
    legacy.pragma("user_version = 2");
    legacy.close();

    const migrated = f.open();
    expect(migrated.schemaInfo()).toMatchObject({
      schemaVersion: 6,
      migration: { version: 6, checksum: MIGRATION_V6_CHECKSUM },
    });
    expect(migrated.getJob("job-a")).toMatchObject({ id: "job-a" });
    expect(migrated.getAuthorityPolicy(authority().principal)).toMatchObject({
      revision: 1,
    });
  });

  it("migrates an exact v3 database to v5 atomically", () => {
    const f = fixture({ fileName: "legacy-v3.db" });
    const seed = f.open();
    seed.createJob(jobInput());
    seed.close();
    const legacy = new Database(f.file);
    legacy.exec("DROP TABLE scheduler_occurrence_retries");
    legacy.exec("DROP TABLE scheduler_occurrence_controls");
    legacy.exec("DROP TABLE scheduler_domain_migration_entries");
    legacy.exec("DROP TABLE scheduler_domain_migrations");
    legacy.prepare("DELETE FROM migrations WHERE version >= 4").run();
    legacy.pragma("user_version = 3");
    legacy.close();

    const migrated = f.open();
    expect(migrated.schemaInfo()).toMatchObject({
      schemaVersion: 6,
      migration: { version: 6, checksum: MIGRATION_V6_CHECKSUM },
    });
    expect(migrated.getJob("job-a")).toMatchObject({ id: "job-a" });
    expect(migrated.listDomainMigrations()).toEqual([]);
  });

  it("migrates exact v4 migration rows to v5 with a null source locator", () => {
    const f = fixture({ fileName: "legacy-v4.db" });
    const legacy = new Database(f.file);
    legacy.exec(MIGRATION_V1_SQL);
    legacy.exec(MIGRATION_V2_SQL);
    legacy.exec(MIGRATION_V3_SQL);
    legacy.exec(MIGRATION_V4_SQL);
    const insertMigration = legacy.prepare(
      "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    );
    insertMigration.run(1, "scheduler-kernel-v1", MIGRATION_V1_CHECKSUM, f.now);
    insertMigration.run(
      2,
      "scheduler-kernel-authority-v2",
      MIGRATION_V2_CHECKSUM,
      f.now,
    );
    insertMigration.run(
      3,
      "scheduler-kernel-adjudication-v3",
      MIGRATION_V3_CHECKSUM,
      f.now,
    );
    insertMigration.run(
      4,
      "scheduler-kernel-domain-migration-v4",
      MIGRATION_V4_CHECKSUM,
      f.now,
    );
    legacy
      .prepare(
        `INSERT INTO scheduler_domain_migrations
           (migration_id, manifest_digest, manifest_json, state, entry_count,
            created_at, updated_at, completed_at, last_error_json)
         VALUES ('migration-v4', 'manifest-v4', '{}', 'prepared', 1,
                 ?, ?, NULL, NULL)`,
      )
      .run(f.now, f.now);
    legacy
      .prepare(
        `INSERT INTO scheduler_domain_migration_entries
           (migration_id, entry_id, domain, source_id, source_scope_digest,
            source_digest, target_job_id, target_job_digest, rollback_strategy,
            state, created_at, updated_at)
         VALUES ('migration-v4', 'entry-v4', 'agenda', 'source-v4',
                 'scope-v4', 'source-digest-v4', 'target-v4',
                 'target-digest-v4', 'disable', 'prepared', ?, ?)`,
      )
      .run(f.now, f.now);
    legacy.pragma(`application_id = ${SCHEDULER_APPLICATION_ID}`);
    legacy.pragma("user_version = 4");
    legacy.close();

    const migrated = f.open();
    expect(migrated.schemaInfo()).toMatchObject({
      schemaVersion: 6,
      migration: { version: 6, checksum: MIGRATION_V6_CHECKSUM },
    });
    expect(
      migrated.getDomainMigration("migration-v4").entries[0],
    ).toMatchObject({
      sourceId: "source-v4",
      sourceLocator: null,
    });
    expect(
      migrated.db
        .prepare(
          "SELECT source_locator_json AS locator FROM scheduler_domain_migration_entries WHERE migration_id = ?",
        )
        .get("migration-v4").locator,
    ).toBeNull();
  });

  it("migrates an exact v5 database to v6 without rebuilding occurrences", () => {
    const f = fixture({ fileName: "legacy-v5.db" });
    const seed = f.open();
    seed.createJob(jobInput());
    seed.close();
    const legacy = new Database(f.file);
    legacy.exec("DROP TABLE scheduler_occurrence_retries");
    legacy.exec("DROP TABLE scheduler_occurrence_controls");
    legacy.prepare("DELETE FROM migrations WHERE version = 6").run();
    legacy.pragma("user_version = 5");
    legacy.close();

    const migrated = f.open();
    expect(migrated.schemaInfo()).toMatchObject({
      schemaVersion: 6,
      migration: { version: 6, checksum: MIGRATION_V6_CHECKSUM },
    });
    expect(migrated.getJob("job-a")).toMatchObject({ id: "job-a" });
    expect(migrated.getOccurrenceControl("missing-occurrence")).toBeNull();
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

  it("rolls back a multi-statement scheduler write on real SQLITE_FULL and reopens cleanly", () => {
    const f = fixture({ fileName: "full-transaction.db" });
    const store = f.open();
    store.createJob(jobInput({ id: "job-full" }));
    const historyBefore = store.history({ jobId: "job-full" });
    const pageCount = store.db.pragma("page_count", { simple: true });
    store.db.pragma(`max_page_count = ${pageCount}`);

    let failure;
    try {
      store._write(() => {
        store.db
          .prepare("UPDATE jobs SET enabled = 0 WHERE job_id = ?")
          .run("job-full");
        store._appendEvent({
          jobId: "job-full",
          type: "fault_probe",
          occurredAt: f.now,
          data: { content: "x".repeat(512 * 1024) },
        });
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "SCHEDULER_STORAGE_UNAVAILABLE",
      details: {
        phase: "write",
        storageCode: "SQLITE_FULL",
        commitState: "not_committed",
        retryable: false,
      },
    });
    expect(store.getJob("job-full")).toMatchObject({ enabled: true });
    expect(store.history({ jobId: "job-full" })).toEqual(historyBefore);
    expect(store.db.pragma("quick_check(1)")).toEqual([{ quick_check: "ok" }]);
    store.close();

    const reopened = f.open();
    expect(reopened.schemaInfo()).toMatchObject({ schemaVersion: 6 });
    expect(reopened.getJob("job-full")).toMatchObject({ enabled: true });
    expect(reopened.history({ jobId: "job-full" })).toEqual(historyBefore);
    expect(reopened.db.pragma("quick_check(1)")).toEqual([
      { quick_check: "ok" },
    ]);
  });

  it("journals an idempotent domain migration through retire and safe rollback", () => {
    const f = fixture();
    const store = f.open();
    const agendaDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "safe-agenda"),
    );
    const source = {
      id: "agenda-one",
      status: "active",
      schedule: "0 * * * *",
    };
    const plan = {
      entries: [
        {
          domain: "agenda",
          sourceId: source.id,
          sourceScope: {
            store: "agent-schedule",
            directory: agendaDirectory,
          },
          sourceLocator: {
            schemaVersion: 1,
            type: "agenda-store",
            directory: agendaDirectory,
          },
          source,
          targetJob: jobInput({ id: "agenda-job" }),
        },
      ],
    };
    const prepared = store.prepareDomainMigration(plan);
    expect(prepared).toMatchObject({
      state: "prepared",
      deduplicated: false,
      entries: [
        {
          sourceLocator: {
            schemaVersion: 1,
            type: "agenda-store",
            directory: agendaDirectory,
          },
        },
      ],
    });
    expect(prepared.manifest.entries[0]).not.toHaveProperty("sourceLocator");
    expect(store.prepareDomainMigration(plan)).toMatchObject({
      id: prepared.id,
      state: "prepared",
      deduplicated: true,
    });
    const applied = store.applyDomainMigration(prepared.id);
    expect(applied).toMatchObject({
      state: "applied",
      entries: [
        {
          domain: "agenda",
          targetAction: "created",
          targetAppliedRevision: 1,
        },
      ],
    });
    expect(store.applyDomainMigration(prepared.id)).toMatchObject({
      state: "applied",
      deduplicated: true,
    });
    const verified = store.verifyDomainMigration(prepared.id, {
      sources: [{ entryId: applied.entries[0].entryId, source }],
    });
    expect(verified).toMatchObject({ state: "verified" });
    const retiring = store.beginDomainMigrationRetirement(prepared.id);
    const entry = retiring.entries[0];
    expect(entry.retirementToken).toMatch(/^scheduler-retirement-/);
    const retiredSource = {
      ...source,
      schedulerMigration: entry.retirementToken,
    };
    store.confirmDomainMigrationEntryRetired({
      migrationId: prepared.id,
      entryId: entry.entryId,
      retirementToken: entry.retirementToken,
      source: retiredSource,
    });
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      state: "retired",
      completedAt: f.now,
      entries: [{ targetAppliedRevision: 2 }],
    });
    expect(store.getJob("agenda-job")).toMatchObject({
      enabled: true,
      revision: 2,
    });

    expect(store.beginDomainMigrationRollback(prepared.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "rollback_target_disabled" }],
    });
    expect(store.rollbackDomainMigrationTargets(prepared.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "rollback_target_disabled" }],
      deduplicated: true,
    });
    expect(store.getJob("agenda-job")).toMatchObject({
      enabled: false,
      revision: 3,
    });
    store.confirmDomainMigrationEntrySourceRestored({
      migrationId: prepared.id,
      entryId: entry.entryId,
      retirementToken: entry.retirementToken,
      source,
    });
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      state: "rolled_back",
      entries: [{ state: "rolled_back", targetRollbackRevision: 3 }],
    });

    const replacement = store.prepareDomainMigration(plan);
    expect(replacement).toMatchObject({
      state: "prepared",
      deduplicated: false,
    });
    expect(replacement.id).not.toBe(prepared.id);
    expect(replacement.manifest).toMatchObject({
      schemaVersion: 2,
      planDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("restores updated targets and fails closed after target execution evidence", () => {
    const f = fixture();
    const store = f.open();
    const original = store.createJob(
      jobInput({
        id: "shared-job",
        payload: { action: "legacy" },
      }),
    );
    const source = { id: "routine-one", enabled: true };
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "routine",
          sourceId: source.id,
          sourceScope: { store: "routines", workspace: "workspace-a" },
          source,
          targetJob: jobInput({
            id: "shared-job",
            payload: { action: "scheduler" },
          }),
        },
      ],
    });
    const applied = store.applyDomainMigration(prepared.id);
    expect(applied.entries[0]).toMatchObject({
      targetAction: "updated",
      targetBefore: {
        id: original.id,
        payload: { action: "legacy" },
      },
      targetAppliedRevision: 2,
    });
    store.beginDomainMigrationRollback(prepared.id);
    store.rollbackDomainMigrationTargets(prepared.id);
    expect(store.getJob("shared-job")).toMatchObject({
      revision: 3,
      payload: { action: "legacy" },
    });

    const second = store.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: "flow-one",
          sourceScope: { database: "automation-a" },
          source: { id: "flow-one", status: "active" },
          targetJob: jobInput({ id: "executed-job" }),
        },
      ],
    });
    store.applyDomainMigration(second.id);
    store.verifyDomainMigration(second.id, {
      sources: [
        {
          entryId: store.getDomainMigration(second.id).entries[0].entryId,
          source: { id: "flow-one", status: "active" },
        },
      ],
    });
    const secondRetiring = store.beginDomainMigrationRetirement(second.id);
    const secondEntry = secondRetiring.entries[0];
    store.confirmDomainMigrationEntryRetired({
      migrationId: second.id,
      entryId: secondEntry.entryId,
      retirementToken: secondEntry.retirementToken,
      source: {
        id: "flow-one",
        status: "paused",
        schedulerMigration: secondEntry.retirementToken,
      },
    });
    store.enqueueOccurrence({
      jobId: "executed-job",
      scheduledFor: f.now,
      triggerKey: "migration:evidence",
    });
    expectCode(
      () => store.beginDomainMigrationRollback(second.id),
      "SCHEDULER_MIGRATION_EXECUTION_EVIDENCE",
    );
    expect(store.getDomainMigration(second.id)).toMatchObject({
      state: "retired",
      entries: [{ state: "retired" }],
    });
    expect(store.getJob("executed-job")).toMatchObject({ enabled: true });
  });

  it("fails closed when a rollback-disabled target changes before source restoration", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "agenda-crash-window", enabled: true };
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "agenda",
          sourceId: source.id,
          sourceScope: { store: "agent-schedule", directory: "legacy" },
          source,
          targetJob: jobInput({ id: "rollback-cas-target" }),
          rollbackStrategy: "disable",
        },
      ],
    });
    store.applyDomainMigration(prepared.id);
    const disabled = store.beginDomainMigrationRollback(prepared.id);
    const rollbackRevision = disabled.entries[0].targetRollbackRevision;
    expect(disabled.entries[0]).toMatchObject({
      state: "rollback_target_disabled",
      targetRollbackRevision: rollbackRevision,
    });

    store.updateJob("rollback-cas-target", rollbackRevision, {
      enabled: true,
      payload: { action: "tampered-after-rollback" },
    });

    expectCode(
      () => store.beginDomainMigrationRollback(prepared.id),
      "SCHEDULER_MIGRATION_TARGET_CHANGED",
    );
    expectCode(
      () => store.rollbackDomainMigrationTargets(prepared.id),
      "SCHEDULER_MIGRATION_TARGET_CHANGED",
    );
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      state: "rolling_back",
      entries: [
        {
          state: "rollback_target_disabled",
          sourceRestoredDigest: null,
        },
      ],
    });
  });

  it("fails closed when a target definition changes without a revision bump before rollback", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "target-definition-cas", enabled: true };
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: source.id,
          sourceScope: { store: "automation-engine", database: "legacy" },
          source,
          targetJob: jobInput({ id: "target-definition-cas-job" }),
          rollbackStrategy: "disable",
        },
      ],
    });
    const applied = store.applyDomainMigration(prepared.id);
    const appliedRevision = applied.entries[0].targetAppliedRevision;
    store.db
      .prepare("UPDATE jobs SET payload_json = ? WHERE job_id = ?")
      .run(
        canonicalJson({ action: "same-revision-tamper" }),
        "target-definition-cas-job",
      );

    expectCode(
      () => store.beginDomainMigrationRollback(prepared.id),
      "SCHEDULER_MIGRATION_TARGET_CHANGED",
    );
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      state: "applied",
      entries: [{ state: "applied", targetRollbackRevision: null }],
    });
    expect(store.getJob("target-definition-cas-job")).toMatchObject({
      revision: appliedRevision,
      payload: { action: "same-revision-tamper" },
      enabled: false,
    });
  });

  it("keeps a changed rollback target and source restoration in one immediate transaction", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "atomic-restore", enabled: true };
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "routine",
          sourceId: source.id,
          sourceScope: { store: "routines", workspace: "atomic" },
          source,
          targetJob: jobInput({ id: "atomic-restore-target" }),
          rollbackStrategy: "disable",
        },
      ],
    });
    store.applyDomainMigration(prepared.id);
    const rollingBack = store.beginDomainMigrationRollback(prepared.id);
    const entry = rollingBack.entries[0];
    let restoreCalled = false;

    store.updateJob("atomic-restore-target", entry.targetRollbackRevision, {
      enabled: true,
    });
    expectCode(
      () =>
        store.restoreDomainMigrationEntrySource({
          migrationId: prepared.id,
          entryId: entry.entryId,
          retirementToken: null,
          restoreSource: () => {
            restoreCalled = true;
            return source;
          },
        }),
      "SCHEDULER_MIGRATION_TARGET_CHANGED",
    );
    expect(restoreCalled).toBe(false);
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "rollback_target_disabled" }],
    });
  });

  it("does not repeat the source restore callback after rollback is terminal", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "terminal-restore-dedup", enabled: true };
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "agenda",
          sourceId: source.id,
          sourceScope: { store: "agent-schedule", directory: "legacy" },
          source,
          targetJob: jobInput({ id: "terminal-restore-dedup-job" }),
          rollbackStrategy: "disable",
        },
      ],
    });
    store.applyDomainMigration(prepared.id);
    const rollingBack = store.beginDomainMigrationRollback(prepared.id);
    const entry = rollingBack.entries[0];
    let restoreCalls = 0;
    const restoreSource = () => {
      restoreCalls += 1;
      return source;
    };

    expect(
      store.restoreDomainMigrationEntrySource({
        migrationId: prepared.id,
        entryId: entry.entryId,
        retirementToken: null,
        restoreSource,
      }),
    ).toMatchObject({ state: "rolled_back", deduplicated: false });
    expect(
      store.restoreDomainMigrationEntrySource({
        migrationId: prepared.id,
        entryId: entry.entryId,
        retirementToken: null,
        restoreSource,
      }),
    ).toMatchObject({ state: "rolled_back", deduplicated: true });
    expect(restoreCalls).toBe(1);
  });

  it("rolls back prepared and applied migrations with nullable tokens", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "routine-staged", enabled: true };
    const plan = {
      entries: [
        {
          domain: "routine",
          sourceId: source.id,
          sourceScope: { store: "routines", workspace: "workspace-a" },
          source,
          targetJob: jobInput({ id: "routine-staged-job" }),
        },
      ],
    };

    const prepared = store.prepareDomainMigration(plan);
    expect(store.beginDomainMigrationRollback(prepared.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "prepared", retirementToken: null }],
    });
    const preparedEntry = store.getDomainMigration(prepared.id).entries[0];
    store.confirmDomainMigrationEntrySourceRestored({
      migrationId: prepared.id,
      entryId: preparedEntry.entryId,
      retirementToken: null,
      source,
    });
    expect(store.beginDomainMigrationRollback(prepared.id)).toMatchObject({
      state: "rolled_back",
      deduplicated: true,
    });

    const applied = store.prepareDomainMigration(plan);
    store.applyDomainMigration(applied.id);
    expect(store.beginDomainMigrationRollback(applied.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "rollback_target_disabled", retirementToken: null }],
    });
    expect(store.getJob("routine-staged-job")).toMatchObject({
      enabled: false,
    });
    const appliedEntry = store.getDomainMigration(applied.id).entries[0];
    store.confirmDomainMigrationEntrySourceRestored({
      migrationId: applied.id,
      entryId: appliedEntry.entryId,
      source,
    });
    expect(
      store.confirmDomainMigrationEntrySourceRestored({
        migrationId: applied.id,
        entryId: appliedEntry.entryId,
        source,
      }),
    ).toMatchObject({ state: "rolled_back", deduplicated: true });
  });

  it("rejects changed migration sources, targets, and active duplicates", () => {
    const f = fixture();
    const store = f.open();
    const source = { id: "cowork-one", enabled: true };
    const plan = {
      entries: [
        {
          domain: "cowork-cron",
          sourceId: source.id,
          sourceScope: { workspace: "workspace-a" },
          source,
          targetJob: jobInput({ id: "cowork-job" }),
        },
      ],
    };
    const prepared = store.prepareDomainMigration(plan);
    const applied = store.applyDomainMigration(prepared.id);
    expectCode(
      () =>
        store.verifyDomainMigration(prepared.id, {
          sources: [
            {
              entryId: applied.entries[0].entryId,
              source: { ...source, enabled: false },
            },
          ],
        }),
      "SCHEDULER_MIGRATION_SOURCE_CHANGED",
    );
    store.updateJob("cowork-job", 1, { payload: { changed: true } });
    expectCode(
      () =>
        store.verifyDomainMigration(prepared.id, {
          sources: [{ entryId: applied.entries[0].entryId, source }],
        }),
      "SCHEDULER_MIGRATION_TARGET_CHANGED",
    );
    expectCode(
      () =>
        store.prepareDomainMigration({
          entries: [
            {
              ...plan.entries[0],
              source: { ...source, revision: 2 },
            },
          ],
        }),
      "SCHEDULER_MIGRATION_CONFLICT",
    );
  });

  it("binds typed source locators to their domain scope and detects tampering", () => {
    const f = fixture();
    const store = f.open();
    const routineDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "safe-routines"),
    );
    const differentDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "different-routines"),
    );
    const tamperedDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "tampered-routines"),
    );
    const entry = {
      domain: "routine",
      sourceId: "routine-locator",
      sourceScope: { store: "routines", directory: routineDirectory },
      sourceLocator: {
        schemaVersion: 1,
        type: "routine-store",
        directory: routineDirectory,
      },
      source: { id: "routine-locator", enabled: true },
      targetJob: jobInput({ id: "routine-locator-job" }),
    };
    expectCode(
      () =>
        store.prepareDomainMigration({
          entries: [
            {
              ...entry,
              sourceLocator: {
                ...entry.sourceLocator,
                directory: differentDirectory,
              },
            },
          ],
        }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
    const relativePathError = expectCode(
      () =>
        store.prepareDomainMigration({
          entries: [
            {
              ...entry,
              sourceScope: {
                store: "routines",
                directory: "relative/routines",
              },
              sourceLocator: {
                ...entry.sourceLocator,
                directory: "relative/routines",
              },
            },
          ],
        }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
    expect(relativePathError.message).toContain("must be an absolute path");
    expectCode(
      () =>
        store.prepareDomainMigration({
          entries: [
            {
              ...entry,
              sourceLocator: {
                schemaVersion: 1,
                type: "agenda-store",
                directory: routineDirectory,
              },
            },
          ],
        }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
    expectCode(
      () =>
        store.prepareDomainMigration({
          entries: [
            {
              ...entry,
              sourceLocator: {
                ...entry.sourceLocator,
                apiToken: "must-not-persist",
              },
            },
          ],
        }),
      "SCHEDULER_INVALID_ARGUMENT",
    );

    const prepared = store.prepareDomainMigration({ entries: [entry] });
    store.db
      .prepare(
        "UPDATE scheduler_domain_migration_entries SET source_locator_json = ? WHERE migration_id = ? AND entry_id = ?",
      )
      .run(
        canonicalJson({
          schemaVersion: 1,
          type: "routine-store",
          directory: tamperedDirectory,
        }),
        prepared.id,
        prepared.entries[0].entryId,
      );
    expectCode(
      () => store.getDomainMigration(prepared.id),
      "SCHEDULER_DATA_CORRUPT",
    );
  });

  it("binds a typed locator when an active pre-v5 migration resumes", () => {
    const f = fixture();
    const store = f.open();
    const agendaDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "upgraded-agenda"),
    );
    const entry = {
      domain: "agenda",
      sourceId: "agenda-upgrade-locator",
      sourceScope: {
        store: "agent-schedule",
        directory: agendaDirectory,
      },
      sourceLocator: {
        schemaVersion: 1,
        type: "agenda-store",
        directory: agendaDirectory,
      },
      source: { id: "agenda-upgrade-locator", enabled: true },
      targetJob: jobInput({ id: "agenda-upgrade-locator-job" }),
    };
    const prepared = store.prepareDomainMigration({ entries: [entry] });
    store.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries
         SET source_locator_json = NULL WHERE migration_id = ?`,
      )
      .run(prepared.id);
    expect(store.getDomainMigration(prepared.id).entries[0].sourceLocator).toBe(
      null,
    );

    expect(store.prepareDomainMigration({ entries: [entry] })).toMatchObject({
      id: prepared.id,
      deduplicated: true,
      entries: [{ sourceLocator: entry.sourceLocator }],
    });
  });

  it("fails closed when a pre-v5 path scope cannot prove the canonical locator", () => {
    const f = fixture();
    const store = f.open();
    const canonicalDirectory = canonicalSchedulerSourcePath(
      join(tmpdir(), "scheduler-kernel-tests", "legacy-agenda"),
    );
    const legacyDirectory = `${canonicalDirectory}-noncanonical`;
    const prepared = store.prepareDomainMigration({
      entries: [
        {
          domain: "agenda",
          sourceId: "agenda-v4-ambiguous-path",
          sourceScope: {
            store: "agent-schedule",
            directory: legacyDirectory,
          },
          source: { id: "agenda-v4-ambiguous-path", enabled: true },
          targetJob: jobInput({ id: "agenda-v4-ambiguous-path-job" }),
        },
      ],
    });

    expectCode(
      () =>
        store.bindDomainMigrationSourceLocator({
          migrationId: prepared.id,
          entryId: prepared.entries[0].entryId,
          sourceLocator: {
            schemaVersion: 1,
            type: "agenda-store",
            directory: canonicalDirectory,
          },
          expectedSourceDigest: prepared.entries[0].sourceDigest,
          expectedTargetJobId: prepared.entries[0].targetJobId,
        }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
    expect(store.getDomainMigration(prepared.id)).toMatchObject({
      entries: [{ sourceLocator: null }],
    });
  });

  it("binds a legacy Automation current-scope locator as an immutable sidecar", () => {
    const f = fixture();
    const store = f.open();
    const entry = {
      domain: "automation",
      sourceId: "automation-v4-current",
      sourceScope: { store: "automation-engine", database: "current" },
      source: { id: "automation-v4-current", status: "active" },
      targetJob: jobInput({ id: "automation-v4-current-job" }),
      rollbackStrategy: "disable",
    };
    const prepared = store.prepareDomainMigration({ entries: [entry] });
    const before = store.db
      .prepare(
        `SELECT m.manifest_digest AS manifest_digest,
                m.manifest_json AS manifest_json,
                e.entry_id AS entry_id
         FROM scheduler_domain_migrations m
         JOIN scheduler_domain_migration_entries e
           ON e.migration_id = m.migration_id
         WHERE m.migration_id = ?`,
      )
      .get(prepared.id);
    const locator = {
      schemaVersion: 1,
      type: "automation-database",
      database: canonicalSchedulerSourcePath(
        join(tmpdir(), "safe", "automation.db"),
      ),
    };

    expect(
      store.bindDomainMigrationSourceLocator({
        migrationId: prepared.id,
        entryId: prepared.entries[0].entryId,
        sourceLocator: locator,
        expectedSourceDigest: prepared.entries[0].sourceDigest,
        expectedTargetJobId: prepared.entries[0].targetJobId,
      }),
    ).toMatchObject({ sourceLocator: locator, deduplicated: false });
    expect(
      store.bindDomainMigrationSourceLocator({
        migrationId: prepared.id,
        entryId: prepared.entries[0].entryId,
        sourceLocator: locator,
        expectedSourceDigest: prepared.entries[0].sourceDigest,
        expectedTargetJobId: prepared.entries[0].targetJobId,
      }),
    ).toMatchObject({ sourceLocator: locator, deduplicated: true });
    expectCode(
      () =>
        store.bindDomainMigrationSourceLocator({
          migrationId: prepared.id,
          entryId: prepared.entries[0].entryId,
          sourceLocator: {
            ...locator,
            database: canonicalSchedulerSourcePath(
              join(tmpdir(), "wrong", "automation.db"),
            ),
          },
          expectedSourceDigest: prepared.entries[0].sourceDigest,
          expectedTargetJobId: prepared.entries[0].targetJobId,
        }),
      "SCHEDULER_MIGRATION_LOCATOR_CONFLICT",
    );
    expect(
      store.db
        .prepare(
          `SELECT m.manifest_digest AS manifest_digest,
                  m.manifest_json AS manifest_json,
                  e.entry_id AS entry_id
           FROM scheduler_domain_migrations m
           JOIN scheduler_domain_migration_entries e
             ON e.migration_id = m.migration_id
           WHERE m.migration_id = ?`,
        )
        .get(prepared.id),
    ).toEqual(before);
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

  it("CAS-adjudicates only outcome-unknown dead letters and grants one bounded claim", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 1 }));
    store.ensureAuthorityPolicy(authority());
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "adjudication:unknown",
    });
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 10_000 });
    const reservation = store.reserveAuthority({
      occurrenceId: occurrence.id,
      policyRevision: 1,
      units: 2,
    });
    store.settle({
      occurrenceId: occurrence.id,
      ownerId: "worker-a",
      fence: claim.fence,
      outcome: "failed",
      error: { code: "AGENDA_SCHEDULER_OUTCOME_UNKNOWN" },
      retryable: false,
    });

    const candidate = store.getAdjudicationCase(occurrence.id);
    expect(candidate).toMatchObject({
      eligible: true,
      attempt: 1,
      fence: 1,
      errorCode: "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
      reservation: { status: "failed", units: 2 },
    });
    expect(candidate.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.listAdjudicationCases({ limit: 10 })).toHaveLength(1);
    const reasonDigest = `sha256:${"a".repeat(64)}`;
    expectCode(
      () =>
        store.adjudicateOccurrence({
          occurrenceId: occurrence.id,
          decision: "confirmed_not_applied",
          expectedEvidenceDigest: `sha256:${"b".repeat(64)}`,
          expectedAttempt: 1,
          expectedFence: 1,
          reasonDigest,
          operatorDigest: `sha256:${"9".repeat(64)}`,
        }),
      "SCHEDULER_ADJUDICATION_EVIDENCE_CONFLICT",
    );
    const adjudicated = store.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: 1,
      expectedFence: 1,
      reasonDigest,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    expect(adjudicated).toMatchObject({
      eligible: false,
      status: "retry_wait",
      maxAttempts: 2,
      adjudication: {
        decision: "confirmed_not_applied",
        status: "pending",
        expectedAttempt: 1,
        expectedFence: 1,
        reasonDigest,
      },
      reservation: { status: "reserved", units: 2 },
    });
    expectCode(
      () =>
        store.adjudicateOccurrence({
          occurrenceId: occurrence.id,
          decision: "confirmed_not_applied",
          expectedEvidenceDigest: candidate.evidenceDigest,
          expectedAttempt: 1,
          expectedFence: 1,
          reasonDigest,
          operatorDigest: `sha256:${"9".repeat(64)}`,
        }),
      "SCHEDULER_ADJUDICATION_ALREADY_RECORDED",
    );

    const retry = store.claimNext({ ownerId: "worker-b", leaseMs: 10_000 });
    const pending = store.getOccurrenceAdjudication(occurrence.id);
    expect(retry).toMatchObject({ attempt: 2, fence: 2 });
    expect(
      store.reserveAuthority({
        occurrenceId: occurrence.id,
        policyRevision: 1,
        units: 2,
      }),
    ).toMatchObject({ deduplicated: true });
    store.settle({
      occurrenceId: occurrence.id,
      ownerId: "worker-b",
      fence: retry.fence,
      outcome: "succeeded",
      result: { retried: true },
      adjudicationRequestId: pending.requestId,
    });
    expect(store.getOccurrenceAdjudication(occurrence.id)).toMatchObject({
      status: "applied",
      retryOutcome: { status: "succeeded", result: { retried: true } },
    });
    expect(store.getAuthorityReservation(occurrence.id)).toMatchObject({
      occurrenceId: reservation.occurrenceId,
      status: "succeeded",
      units: 2,
    });
  });

  it("uses a synthetic claim to settle confirmed-applied without replay", () => {
    const f = fixture();
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 1 }));
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "adjudication:applied",
    });
    const claim = store.claimNext({ ownerId: "worker-a", leaseMs: 10_000 });
    store.settle({
      occurrenceId: occurrence.id,
      ownerId: "worker-a",
      fence: claim.fence,
      outcome: "failed",
      error: { code: "LOOP_SCHEDULER_OUTCOME_UNKNOWN" },
      retryable: false,
    });
    const candidate = store.getAdjudicationCase(occurrence.id);
    const adjudicated = store.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: 1,
      expectedFence: 1,
      reasonDigest: `sha256:${"c".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    expect(adjudicated.maxAttempts).toBe(3);
    const synthetic = store.claimNext({ ownerId: "worker-b", leaseMs: 10_000 });
    expect(synthetic).toMatchObject({ attempt: 2, fence: 2 });
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

  it("durably pauses and resumes one exact claim without consuming an attempt", () => {
    const f = fixture({ fileName: "runtime-control.db" });
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 2 }));
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "runtime-control:first",
    });
    const claim = store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "pause-owner",
      leaseMs: 10_000,
    });
    const capability = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["before_execute", "adapter_checkpoint"],
    };
    expectCode(
      () =>
        store.requestOccurrencePause({
          occurrenceId: occurrence.id,
          expectedFence: claim.fence,
          requestId: "pause-unsupported",
          capability: { schemaVersion: 1, pauseResume: "none", safePoints: [] },
        }),
      "SCHEDULER_PAUSE_UNSUPPORTED",
    );
    expect(store.getOccurrenceControl(occurrence.id)).toBeNull();

    const requested = store.requestOccurrencePause({
      occurrenceId: occurrence.id,
      expectedFence: claim.fence,
      requestId: "pause-request-1",
      capability,
    });
    expect(
      store.requestOccurrencePause({
        occurrenceId: occurrence.id,
        expectedFence: claim.fence,
        requestId: "pause-request-1",
        capability,
      }),
    ).toMatchObject({ state: "pause_requested", deduplicated: true });
    const paused = store.ackOccurrencePause({
      occurrenceId: occurrence.id,
      ownerId: "pause-owner",
      fence: claim.fence,
      requestId: "pause-request-1",
      expectedRevision: requested.revision,
      safePoint: "adapter_checkpoint",
      checkpoint: { cursor: 7 },
    });
    expect(paused).toMatchObject({
      occurrence: {
        id: occurrence.id,
        status: "retry_wait",
        attempt: claim.attempt,
        fence: claim.fence,
        leaseOwner: null,
      },
      control: {
        state: "paused",
        checkpoint: {
          safePoint: "adapter_checkpoint",
          data: { cursor: 7 },
        },
      },
    });
    expect(
      store.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: "blocked-owner",
        leaseMs: 10_000,
      }),
    ).toBeNull();

    store.close();
    const reopened = f.open();
    const durable = reopened.getOccurrenceControl(occurrence.id);
    expect(durable).toMatchObject({ state: "paused", revision: 2 });
    expectCode(
      () =>
        reopened.resumeOccurrence({
          occurrenceId: occurrence.id,
          expectedRevision: 1,
          requestId: "resume-request-1",
        }),
      "SCHEDULER_REVISION_CONFLICT",
    );
    const resumed = reopened.resumeOccurrence({
      occurrenceId: occurrence.id,
      expectedRevision: durable.revision,
      requestId: "resume-request-1",
    });
    expect(resumed.control.state).toBe("resumed");
    expect(
      reopened.resumeOccurrence({
        occurrenceId: occurrence.id,
        expectedRevision: durable.revision,
        requestId: "resume-request-1",
      }).control,
    ).toMatchObject({ state: "resumed", deduplicated: true });
    const resumedClaim = reopened.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "resumed-owner",
      leaseMs: 10_000,
    });
    expect(resumedClaim).toMatchObject({
      id: occurrence.id,
      attempt: claim.attempt,
      fence: claim.fence + 1,
    });
    expect(reopened.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "resumed",
      revision: resumed.control.revision + 1,
      expectedFence: resumedClaim.fence,
      checkpoint: {
        safePoint: "adapter_checkpoint",
        data: { cursor: 7 },
      },
    });
    const retryWait = reopened.settle({
      occurrenceId: occurrence.id,
      ownerId: "resumed-owner",
      fence: resumedClaim.fence,
      outcome: "failed",
      error: { code: "resume_retry", message: "Resume must retry" },
      retryable: true,
    });
    expect(retryWait).toMatchObject({
      status: "retry_wait",
      attempt: resumedClaim.attempt,
    });
    expect(reopened.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "resumed",
      expectedFence: resumedClaim.fence + 1,
      checkpoint: {
        safePoint: "adapter_checkpoint",
        data: { cursor: 7 },
      },
    });

    const retryClaim = reopened.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "retry-owner",
      leaseMs: 10_000,
    });
    expect(retryClaim).toMatchObject({
      id: occurrence.id,
      attempt: resumedClaim.attempt + 1,
      fence: resumedClaim.fence + 1,
    });
    expect(reopened.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "resumed",
      expectedFence: retryClaim.fence,
    });
    reopened.settle({
      occurrenceId: occurrence.id,
      ownerId: "retry-owner",
      fence: retryClaim.fence,
      outcome: "succeeded",
      result: { resumedFrom: 7 },
    });
    expect(reopened.getOccurrenceControl(occurrence.id)).toMatchObject({
      state: "terminal",
      expectedFence: retryClaim.fence,
    });
  });

  it("keeps an unacknowledged pause request across owner crash", () => {
    const f = fixture({ fileName: "runtime-control-crash.db" });
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 1 }));
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "runtime-control:crash",
    });
    const claim = store.claimNext({ ownerId: "crashed-owner", leaseMs: 100 });
    store.requestOccurrencePause({
      occurrenceId: occurrence.id,
      expectedFence: claim.fence,
      requestId: "pause-before-crash",
      capability: {
        schemaVersion: 1,
        pauseResume: "checkpoint_v1",
        safePoints: ["before_execute"],
      },
    });
    store.close();
    f.now += 101;

    const recovered = f.open();
    const reclaimed = recovered.claimNext({
      ownerId: "recovered-owner",
      leaseMs: 100,
    });
    expect(reclaimed).toMatchObject({
      id: occurrence.id,
      attempt: claim.attempt,
      fence: claim.fence + 1,
    });
    const rebound = recovered.getOccurrenceControl(occurrence.id);
    expect(rebound).toMatchObject({
      state: "pause_requested",
      pauseRequestId: "pause-before-crash",
      expectedFence: reclaimed.fence,
      revision: 2,
    });
    expect(
      recovered.ackOccurrencePause({
        occurrenceId: occurrence.id,
        ownerId: "recovered-owner",
        fence: reclaimed.fence,
        requestId: rebound.pauseRequestId,
        expectedRevision: rebound.revision,
        safePoint: "before_execute",
        checkpoint: { recovered: true },
      }),
    ).toMatchObject({ control: { state: "paused" } });
  });

  it("fails closed on stale pause evidence and terminalizes a losing request", () => {
    const f = fixture({ fileName: "runtime-control-conflicts.db" });
    const store = f.open();
    store.createJob(jobInput());
    const queued = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "runtime-control:conflicts",
    });
    const capability = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["before_execute"],
    };
    expectCode(
      () =>
        store.requestOccurrencePause({
          occurrenceId: queued.id,
          expectedFence: 1,
          requestId: "queued-pause",
          capability,
        }),
      "SCHEDULER_OCCURRENCE_NOT_RUNNING",
    );
    const claim = store.claimNext({
      ownerId: "settling-owner",
      leaseMs: 1000,
    });
    expectCode(
      () =>
        store.requestOccurrencePause({
          occurrenceId: queued.id,
          expectedFence: claim.fence + 1,
          requestId: "stale-pause",
          capability,
        }),
      "SCHEDULER_FENCE_CONFLICT",
    );
    const request = store.requestOccurrencePause({
      occurrenceId: queued.id,
      expectedFence: claim.fence,
      requestId: "settlement-race-pause",
      capability,
    });
    store.settle({
      occurrenceId: queued.id,
      ownerId: "settling-owner",
      fence: claim.fence,
      outcome: "succeeded",
      result: { finished: true },
    });
    expect(store.getOccurrenceControl(queued.id)).toMatchObject({
      state: "terminal",
      revision: request.revision + 1,
    });
    expectCode(
      () =>
        store.ackOccurrencePause({
          occurrenceId: queued.id,
          ownerId: "settling-owner",
          fence: claim.fence,
          requestId: request.pauseRequestId,
          expectedRevision: request.revision,
          safePoint: "before_execute",
        }),
      "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
    );
  });

  it("requeues exact dead-letter evidence without consuming another attempt", () => {
    const f = fixture({ fileName: "dead-letter-requeue.db" });
    const store = f.open();
    store.createJob(jobInput({ maxAttempts: 1 }));
    const occurrence = store.enqueueOccurrence({
      jobId: "job-a",
      scheduledFor: f.now,
      triggerKey: "dead-letter:requeue",
    });
    const first = store.claimNext({
      ownerId: "failing-owner",
      leaseMs: 1000,
    });
    const dead = store.settle({
      occurrenceId: occurrence.id,
      ownerId: "failing-owner",
      fence: first.fence,
      outcome: "failed",
      error: { code: "BOUNDARY_DENIED", message: "denied" },
      retryable: false,
    });
    expectCode(
      () =>
        store.requeueDeadLetter({
          occurrenceId: occurrence.id,
          expectedFence: dead.fence,
          expectedErrorCode: "OTHER_ERROR",
          requestId: "requeue-1",
        }),
      "SCHEDULER_REQUEUE_EVIDENCE_CONFLICT",
    );
    const requeued = store.requeueDeadLetter({
      occurrenceId: occurrence.id,
      expectedFence: dead.fence,
      expectedErrorCode: "BOUNDARY_DENIED",
      requestId: "requeue-1",
    });
    expect(requeued.occurrence).toMatchObject({
      id: occurrence.id,
      status: "retry_wait",
      attempt: first.attempt,
      lastError: { code: "BOUNDARY_DENIED" },
    });
    expect(
      store.requeueDeadLetter({
        occurrenceId: occurrence.id,
        expectedFence: dead.fence,
        expectedErrorCode: "BOUNDARY_DENIED",
        requestId: "requeue-1",
      }).deduplicated,
    ).toBe(true);
    expect(
      store.claimNext({ ownerId: "retry-owner", leaseMs: 1000 }),
    ).toMatchObject({
      id: occurrence.id,
      attempt: first.attempt,
      fence: first.fence + 1,
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
    futureDb.pragma("user_version = 7");
    futureDb.close();
    expectCode(() => future.open(), "SCHEDULER_SCHEMA_UNKNOWN");

    const damaged = fixture({ fileName: "damaged.db" });
    damaged.open().close();
    const damagedDb = new Database(damaged.file);
    damagedDb.exec("DROP INDEX scheduler_occurrences_claim");
    damagedDb.close();
    expectCode(() => damaged.open(), "SCHEDULER_SCHEMA_CORRUPT");

    const locatorShape = fixture({ fileName: "locator-shape.db" });
    locatorShape.open().close();
    const locatorShapeDb = new Database(locatorShape.file);
    locatorShapeDb.exec(
      "ALTER TABLE scheduler_domain_migration_entries DROP COLUMN source_locator_json",
    );
    locatorShapeDb.close();
    expectCode(() => locatorShape.open(), "SCHEDULER_SCHEMA_CORRUPT");

    const migrationHistory = fixture({ fileName: "migration-history.db" });
    migrationHistory.open().close();
    const migrationHistoryDb = new Database(migrationHistory.file);
    migrationHistoryDb
      .prepare("UPDATE migrations SET checksum = ? WHERE version = 5")
      .run("tampered-v5-checksum");
    migrationHistoryDb.close();
    expectCode(() => migrationHistory.open(), "SCHEDULER_SCHEMA_UNKNOWN");

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

    const truncated = fixture({ fileName: "truncated.db" });
    const truncatedStore = truncated.open();
    truncatedStore.createJob(jobInput({ id: "durable-before-damage" }));
    truncatedStore.close();
    truncateSync(truncated.file, 512);
    expectCode(() => truncated.open(), "SCHEDULER_SCHEMA_CORRUPT");
  });
});
