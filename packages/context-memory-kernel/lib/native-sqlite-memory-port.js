"use strict";

const {
  canonicalDigest,
  canonicalJson,
  cloneCanonical,
} = require("./canonical.js");
const {
  assertScope,
  identifier,
  boundedInteger,
  timestamp,
  normalizeMemoryRecord,
  assertKnownFields,
  objectValue,
  jsonByteLength,
} = require("./contracts.js");
const { applyMemoryCommand, assertTransition } = require("./memory-reducer.js");
const { kernelError, invalidArgument } = require("./errors.js");

const EVENT_SCHEMA = "chainlesschain.memory-event/v1";
const OP_SCHEMA = "chainlesschain.native-sqlite-memory-operation/v1";
const EVENT_FIELDS = new Set([
  "schema",
  "eventId",
  "type",
  "memoryId",
  "fromState",
  "toState",
  "previousRevision",
  "revision",
  "recordDigest",
  "at",
  "reason",
  "authority",
  "successorMemoryId",
  "digest",
]);
const OP_FIELDS = new Set([
  "requestId",
  "subject",
  "selector",
  "scope",
  "scopeId",
  "memoryId",
  "fence",
  "authority",
  "expectedRevision",
  "reason",
  "contentRef",
  "evidenceRefs",
  "state",
  "stores",
  "startedAt",
  "tombstoneRevision",
  "receipt",
]);
const BINDING_FIELDS = [
  "requestId",
  "subject",
  "selector",
  "scope",
  "scopeId",
  "memoryId",
  "fence",
  "authority",
  "expectedRevision",
  "startedAt",
];
const COMMANDS = {
  active: "activate",
  reinforced: "reinforce",
  superseded: "supersede",
  archived: "archive",
  expired: "expire",
  deleted: "delete",
  purged: "purge",
};

function fail(message) {
  throw kernelError("native_sqlite_memory_invalid", message);
}
function verifyDigest(value, domain) {
  const { digest, ...body } = value;
  if (digest !== canonicalDigest(body, domain))
    throw kernelError(
      "digest_mismatch",
      "Stored memory metadata digest mismatch",
    );
}
function same(a, b) {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/**
 * Host-owned, synchronous SQLite adapter for the existing Kernel. No SQLite
 * binding is imported: db must provide the native prepare/exec/transaction API.
 * authorize is a trusted synchronous policy callback, not a renderer argument.
 * Outer transactions remain the host's responsibility; never await inside one.
 * Digests detect corruption, not an adversary with arbitrary database write access.
 */
class NativeSqliteMemoryPort {
  #db;
  #scope;
  #key;
  #authorize;
  #maxQueryRecords;

  constructor({ db, scope, authorize, maxQueryRecords = 1000 } = {}) {
    if (
      !db ||
      typeof db.prepare !== "function" ||
      typeof db.exec !== "function" ||
      typeof db.transaction !== "function"
    )
      throw new TypeError("A synchronous native SQLite database is required");
    if (typeof authorize !== "function")
      throw new TypeError("A synchronous authorize callback is required");
    this.#db = db;
    this.#scope = Object.freeze(assertScope(scope?.scope, scope?.scopeId));
    // Global scopes cannot isolate a trusted subject or project.
    if (this.#scope.scope === "global")
      throw invalidArgument(
        "Native SQLite memory requires an identified scope",
      );
    this.#key = canonicalDigest(
      this.#scope,
      "chainlesschain.native-memory-scope/v1",
    );
    this.#authorize = authorize;
    this.#maxQueryRecords = boundedInteger(maxQueryRecords, "maxQueryRecords", {
      min: 1,
      max: 10000,
    });
    Object.defineProperty(this, "name", {
      value: "native-sqlite-memory-authority",
      enumerable: true,
    });
    this.#db
      .transaction(() => {
        this.#allow("initialize");
        this.#db.exec(`
        CREATE TABLE IF NOT EXISTS context_memory_sqlite_scopes (
          scope_key TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0)
        );
        CREATE TABLE IF NOT EXISTS context_memory_sqlite_records (
          scope_key TEXT NOT NULL, memory_id TEXT NOT NULL, record_json TEXT NOT NULL,
          PRIMARY KEY(scope_key, memory_id)
        );
        CREATE TABLE IF NOT EXISTS context_memory_sqlite_events (
          scope_key TEXT NOT NULL, event_id TEXT NOT NULL, memory_id TEXT NOT NULL,
          revision INTEGER NOT NULL, event_json TEXT NOT NULL,
          PRIMARY KEY(scope_key, event_id), UNIQUE(scope_key, memory_id, revision)
        );
        CREATE TABLE IF NOT EXISTS context_memory_sqlite_reconciliations (
          scope_key TEXT NOT NULL, request_id TEXT NOT NULL, operation_json TEXT NOT NULL,
          digest TEXT NOT NULL, PRIMARY KEY(scope_key, request_id)
        );
      `);
        this.#db
          .prepare(
            "INSERT OR IGNORE INTO context_memory_sqlite_scopes VALUES (?, 0)",
          )
          .run(this.#key);
      })
      .immediate();
  }

  get scope() {
    return this.#scope;
  }

  #allow(operation, details = {}) {
    const decision = this.#authorize(
      Object.freeze({ operation, scope: this.#scope, ...details }),
    );
    if (
      !decision ||
      typeof decision.then === "function" ||
      decision.allowed !== true
    )
      throw kernelError("scope_denied", "Native memory authorization denied");
  }

  #assertScope(value) {
    if (!same(assertScope(value.scope, value.scopeId), this.#scope))
      throw kernelError(
        "scope_denied",
        "Memory scope does not match the host binding",
      );
  }

  #record(memoryId) {
    const row = this.#db
      .prepare(
        "SELECT record_json FROM context_memory_sqlite_records WHERE scope_key = ? AND memory_id = ?",
      )
      .get(this.#key, memoryId);
    if (!row) return null;
    const record = normalizeMemoryRecord(JSON.parse(row.record_json));
    this.#assertScope(record);
    if (record.memoryId !== memoryId) fail("Stored memory identity mismatch");
    return record;
  }

  read(memoryId) {
    identifier(memoryId, "memoryId");
    this.#allow("read", { memoryId });
    return this.#record(memoryId);
  }

  query(request = {}) {
    this.#allow("query");
    if (
      request.scopeAdmissions !== undefined &&
      (!Array.isArray(request.scopeAdmissions) ||
        request.scopeAdmissions.length !== 1 ||
        !same(request.scopeAdmissions[0], this.#scope))
    )
      throw kernelError(
        "scope_denied",
        "Query cannot expand the host memory scope",
      );
    const rows = this.#db
      .prepare(
        "SELECT memory_id, record_json FROM context_memory_sqlite_records WHERE scope_key = ? ORDER BY memory_id LIMIT ?",
      )
      .all(this.#key, this.#maxQueryRecords + 1);
    // Never silently omit an exact reference or rank a truncated corpus.
    if (rows.length > this.#maxQueryRecords)
      throw kernelError(
        "native_sqlite_memory_query_limit",
        "Scoped memory query exceeds its configured bound",
      );
    return rows.map((row) => {
      const record = normalizeMemoryRecord(JSON.parse(row.record_json));
      this.#assertScope(record);
      if (record.memoryId !== row.memory_id)
        fail("Stored memory identity mismatch");
      return record;
    });
  }

  #revision() {
    const value = this.#db
      .prepare(
        "SELECT revision FROM context_memory_sqlite_scopes WHERE scope_key = ?",
      )
      .get(this.#key)?.revision;
    return boundedInteger(value, "storeRevision", { min: 0 });
  }

  getRevision() {
    this.#allow("getRevision");
    return this.#revision();
  }

  #readEvent(memoryId, revision) {
    const row = this.#db
      .prepare(
        "SELECT event_json FROM context_memory_sqlite_events WHERE scope_key = ? AND memory_id = ? AND revision = ?",
      )
      .get(this.#key, memoryId, revision);
    if (!row) return null;
    const event = JSON.parse(row.event_json);
    verifyDigest(event, "chainlesschain.native-memory-event-projection/v1");
    const fields = new Set([...EVENT_FIELDS, "eventDigest"]);
    fields.delete("reason");
    assertKnownFields(event, fields, "MemoryEventProjection");
    identifier(event.eventId, "eventId");
    if (event.authority !== undefined) identifier(event.authority, "authority");
    if (event.successorMemoryId !== undefined)
      identifier(event.successorMemoryId, "successorMemoryId");
    timestamp(event.at, "at");
    if (
      event.schema !== EVENT_SCHEMA ||
      event.memoryId !== memoryId ||
      event.revision !== revision ||
      event.previousRevision !== revision - 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(event.eventDigest) ||
      !/^sha256:[a-f0-9]{64}$/.test(event.recordDigest)
    )
      fail("Stored event lineage mismatch");
    if (revision === 1) {
      if (
        event.fromState !== null ||
        !["active", "candidate"].includes(event.toState) ||
        event.type !==
          (event.toState === "active"
            ? "memory.activated"
            : "memory.candidate.created")
      )
        fail("Invalid stored initial event");
    } else {
      assertTransition(event.fromState, event.toState);
      if (event.type !== `memory.${event.toState}`)
        fail("Invalid stored transition event");
    }
    const current = this.#record(memoryId);
    if (
      !current ||
      current.revision < revision ||
      (current.revision === revision &&
        (current.digest !== event.recordDigest ||
          current.state !== event.toState))
    )
      fail("Stored event does not match canonical memory");
    return event;
  }

  // The eventDigest binds the original Kernel event; digest binds this body-free
  // projection (free-form reason is deliberately omitted).
  readEvent(memoryId, revision) {
    identifier(memoryId, "memoryId");
    boundedInteger(revision, "revision", { min: 1 });
    this.#allow("readEvent", { memoryId, revision });
    return this.#readEvent(memoryId, revision);
  }

  #event(record, event, current) {
    objectValue(event, "MemoryEvent");
    assertKnownFields(event, EVENT_FIELDS, "MemoryEvent");
    verifyDigest(event, EVENT_SCHEMA);
    identifier(event.eventId, "eventId");
    timestamp(event.at, "at");
    if (
      event.schema !== EVENT_SCHEMA ||
      event.memoryId !== record.memoryId ||
      event.fromState !== (current?.state ?? null) ||
      event.toState !== record.state ||
      event.previousRevision !== (current?.revision ?? 0) ||
      event.revision !== record.revision ||
      event.recordDigest !== record.digest ||
      event.at !== record.updatedAt ||
      record.revision !== (current?.revision ?? 0) + 1
    )
      fail("Memory event does not match record lineage");
    if (!current) {
      if (
        !["active", "candidate"].includes(record.state) ||
        record.createdAt !== record.updatedAt ||
        record.deletionFence !== undefined ||
        event.type !==
          (record.state === "active"
            ? "memory.activated"
            : "memory.candidate.created")
      )
        fail("Invalid initial memory event");
    } else {
      if (event.type !== `memory.${record.state}`)
        fail("Invalid memory transition event");
      if (record.state === "superseded") {
        const successor = this.#record(event.successorMemoryId);
        if (
          !successor ||
          successor.memoryId === current.memoryId ||
          ["deleted", "purged"].includes(successor.state)
        )
          fail("Successor must be an existing memory in the same scope");
      }
      const command = {
        type: COMMANDS[record.state],
        expectedRevision: current.revision,
        at: event.at,
        ...(event.authority === undefined
          ? {}
          : { authority: event.authority }),
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.successorMemoryId === undefined
          ? {}
          : { successorMemoryId: event.successorMemoryId }),
        ...(["deleted", "purged"].includes(record.state)
          ? { deletionFence: record.deletionFence }
          : {}),
      };
      if (record.state === "reinforced")
        Object.assign(command, {
          confidenceDelta: record.confidence - current.confidence,
          importance: record.importance,
          tags: record.tags,
          evidenceRefs: record.evidenceRefs,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
        });
      const reduced = applyMemoryCommand(current, command);
      if (reduced.record.digest !== record.digest)
        fail("Record does not match the Kernel reducer");
    }
    // Free-form reasons may quote deleted content. Persist only event lineage.
    const { reason, digest, ...projection } = event;
    return {
      ...projection,
      eventDigest: digest,
      digest: canonicalDigest(
        { ...projection, eventDigest: digest },
        "chainlesschain.native-memory-event-projection/v1",
      ),
    };
  }

  commit({ record: input, event, reconciliation } = {}, expectedRevision = 0) {
    boundedInteger(expectedRevision, "expectedRevision", { min: 0 });
    const record = normalizeMemoryRecord(input);
    this.#assertScope(record);
    return this.#db
      .transaction(() => {
        this.#allow("commit", { memoryId: record.memoryId });
        const current = this.#record(record.memoryId);
        const revision = this.#revision();
        if ((current?.revision ?? 0) !== expectedRevision)
          return {
            ok: false,
            currentRevision: current?.revision ?? 0,
            storeRevision: revision,
          };
        if (revision === Number.MAX_SAFE_INTEGER)
          fail("Memory store revision exhausted");
        const projection = this.#event(record, event, current);
        if (
          reconciliation &&
          (reconciliation.memoryId !== record.memoryId ||
            !["deleted", "purged"].includes(record.state))
        )
          fail("Reconciliation must bind this tombstone mutation");
        if (
          record.state === "deleted" &&
          current?.retentionPolicy.mode === "legal_hold"
        )
          throw kernelError("scope_denied", "Memory is under legal hold");
        this.#db
          .prepare(
            "INSERT INTO context_memory_sqlite_records VALUES (?, ?, ?) ON CONFLICT(scope_key, memory_id) DO UPDATE SET record_json=excluded.record_json",
          )
          .run(this.#key, record.memoryId, canonicalJson(record));
        this.#db
          .prepare(
            "INSERT INTO context_memory_sqlite_events VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            this.#key,
            event.eventId,
            record.memoryId,
            record.revision,
            canonicalJson(projection),
          );
        if (reconciliation) this.#putOperation(reconciliation, current);
        this.#db
          .prepare(
            "UPDATE context_memory_sqlite_scopes SET revision = revision + 1 WHERE scope_key = ?",
          )
          .run(this.#key);
        return {
          ok: true,
          revision: record.revision,
          storeRevision: revision + 1,
          reconciliationStored: Boolean(reconciliation),
        };
      })
      .immediate();
  }

  #operation(requestId) {
    const row = this.#db
      .prepare(
        "SELECT operation_json, digest FROM context_memory_sqlite_reconciliations WHERE scope_key = ? AND request_id = ?",
      )
      .get(this.#key, requestId);
    if (!row) return null;
    const operation = JSON.parse(row.operation_json);
    if (row.digest !== canonicalDigest(operation, OP_SCHEMA))
      throw kernelError(
        "digest_mismatch",
        "Deletion operation digest mismatch",
      );
    if (operation.requestId !== requestId)
      fail("Deletion operation identity mismatch");
    this.#validateOperation(operation);
    return operation;
  }

  #validateOperation(operation) {
    objectValue(operation, "DeletionOperation");
    assertKnownFields(operation, OP_FIELDS, "DeletionOperation");
    this.#assertScope(operation);
    for (const key of [
      "requestId",
      "subject",
      "memoryId",
      "fence",
      "authority",
    ])
      identifier(operation[key], key);
    timestamp(operation.startedAt, "startedAt");
    boundedInteger(operation.expectedRevision, "expectedRevision", { min: 1 });
    if (operation.selector !== `memory:${operation.memoryId}`)
      fail("Deletion selector mismatch");
    const record = this.#record(operation.memoryId);
    if (
      !record ||
      !["deleted", "purged"].includes(record.state) ||
      record.deletionFence !== operation.fence ||
      record.revision !==
        operation.expectedRevision + (record.state === "purged" ? 2 : 1)
    )
      fail("Deletion operation lacks its canonical tombstone");
    if (
      operation.tombstoneRevision !== undefined &&
      operation.tombstoneRevision !== operation.expectedRevision + 1
    )
      fail("Deletion tombstone revision mismatch");
    if (
      !["tombstoned", "purge_pending", "commit_pending", "purged"].includes(
        operation.state,
      ) ||
      (operation.state === "purged" && record.state !== "purged")
    )
      fail("Invalid deletion operation state");
    if (!Array.isArray(operation.stores) || operation.stores.length > 128)
      fail("Invalid deletion stores");
    const names = new Set();
    for (const store of operation.stores) {
      identifier(store.store, "store");
      if (
        names.has(store.store) ||
        !["purged", "pending"].includes(store.status)
      )
        fail("Invalid deletion store acknowledgment");
      names.add(store.store);
      if (store.status === "purged" && store.receipt?.status !== "purged")
        fail("Missing purge receipt");
      if (
        store.receipt?.fence !== undefined &&
        store.receipt.fence !== operation.fence
      )
        fail("Purge receipt fence mismatch");
      if (
        store.receipt?.memoryId !== undefined &&
        store.receipt.memoryId !== operation.memoryId
      )
        fail("Purge receipt memory mismatch");
    }
    if (
      operation.state === "purged" &&
      operation.stores.some((store) => store.status !== "purged")
    )
      fail("Pending stores cannot be sealed");
    if (operation.receipt !== undefined) {
      const receipt = operation.receipt;
      assertKnownFields(
        receipt,
        new Set([
          "schema",
          "schemaVersion",
          "requestId",
          "subject",
          "selector",
          "scope",
          "scopeId",
          "memoryId",
          "fence",
          "authority",
          "status",
          "revision",
          "recordState",
          "recordDigest",
          "stores",
          "startedAt",
          "completedAt",
          "digest",
        ]),
        "DeletionReceipt",
      );
      verifyDigest(receipt, "chainlesschain.memory-deletion-receipt/v1");
      if (
        operation.state !== "purged" ||
        receipt.schema !== "chainlesschain.memory-deletion-receipt/v1" ||
        receipt.schemaVersion !== 1 ||
        receipt.status !== "purged" ||
        receipt.recordState !== "purged" ||
        receipt.revision !== record.revision ||
        receipt.recordDigest !== record.digest ||
        BINDING_FIELDS.filter((key) => key !== "expectedRevision").some(
          (key) => !same(receipt[key], operation[key]),
        ) ||
        !same(receipt.stores, [
          { store: this.name, status: "purged", revision: record.revision },
          ...operation.stores,
        ])
      )
        fail("Deletion receipt does not match canonical completion");
      timestamp(receipt.completedAt, "completedAt");
      if (Date.parse(receipt.completedAt) < Date.parse(operation.startedAt))
        fail("Deletion completion predates its request");
      if (
        operation.contentRef !== undefined ||
        operation.evidenceRefs !== undefined
      )
        fail("Sealed deletion must discard content references");
    }
    jsonByteLength(operation, "DeletionOperation", 256 * 1024);
    return record;
  }

  #putOperation(input, previousRecord = null) {
    const operation = cloneCanonical(input);
    // Reasons are not required for retry and may contain deleted plaintext.
    delete operation.reason;
    this.#validateOperation(operation);
    const existing = this.#operation(operation.requestId);
    if (!existing) {
      if (
        !previousRecord ||
        previousRecord.memoryId !== operation.memoryId ||
        previousRecord.revision !== operation.expectedRevision ||
        operation.state !== "tombstoned" ||
        !same(operation.contentRef, previousRecord.contentRef || null) ||
        !same(operation.evidenceRefs, previousRecord.evidenceRefs) ||
        operation.stores.length !== 0 ||
        operation.receipt
      )
        fail("Deletion operation must be created with its tombstone commit");
    } else {
      if (BINDING_FIELDS.some((key) => !same(operation[key], existing[key])))
        fail("Deletion request binding cannot change");
      if (existing.receipt && !same(operation, existing))
        fail("Sealed deletion receipt is immutable");
      if (
        operation.state === "purged" &&
        existing.contentRef &&
        !operation.stores.some(
          (entry) =>
            entry.store === existing.contentRef.store &&
            entry.status === "purged",
        )
      )
        fail("Content store must acknowledge deletion before completion");
      if (
        !operation.receipt &&
        (!same(operation.contentRef, existing.contentRef) ||
          !same(operation.evidenceRefs, existing.evidenceRefs))
      )
        fail("Pending deletion purge references cannot change");
      for (const old of existing.stores) {
        const next = operation.stores.find(
          (entry) => entry.store === old.store,
        );
        // A retry re-runs all registered targets; e.g. ContentPort.existed can
        // legitimately change after its first successful purge. Only a sealed
        // receipt is immutable; an acknowledged target must never regress.
        if (!next || (old.status === "purged" && next.status !== "purged"))
          fail("Purge acknowledgment cannot be removed or downgraded");
      }
    }
    this.#db
      .prepare(
        "INSERT INTO context_memory_sqlite_reconciliations VALUES (?, ?, ?, ?) ON CONFLICT(scope_key, request_id) DO UPDATE SET operation_json=excluded.operation_json, digest=excluded.digest",
      )
      .run(
        this.#key,
        operation.requestId,
        canonicalJson(operation),
        canonicalDigest(operation, OP_SCHEMA),
      );
  }

  getReconciliation(requestId) {
    identifier(requestId, "requestId");
    this.#allow("getReconciliation", { requestId });
    return this.#operation(requestId);
  }

  putReconciliation(operation) {
    return this.#db
      .transaction(() => {
        this.#allow("putReconciliation", { requestId: operation?.requestId });
        this.#putOperation(operation);
      })
      .immediate();
  }
}

module.exports = { NativeSqliteMemoryPort };
