"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const { goalError, reviseGoalRecord } = require("./goal-contract.js");
const { PersonalProjectGoalService } = require("./project-goal-service.js");

const KIND = "context-memory-kernel";
const TYPES = Object.freeze(["user-fact", "agent-inference", "execution-note"]);
const MAX_OPERATIONS = 1000;
const MAX_LINKS = 1000;
const MAX_BYTES = 65536;
function fail(code) {
  throw goalError(code);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_MEMORY_INVALID_REQUEST");
  return value;
}
function options(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("GOAL_MEMORY_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("GOAL_MEMORY_INVALID_REQUEST");
  return value;
}
function version(record) {
  return `v1:r${record.revision}:${record.digest}`;
}
function reference(record) {
  return { kind: KIND, id: record.memoryId, version: version(record) };
}
function parseVersion(value) {
  const match =
    typeof value === "string" &&
    /^v1:r([1-9][0-9]*):(sha256:[a-f0-9]{64})$/u.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    fail("GOAL_MEMORY_INVALID_VERSION");
  return { revision: Number(match[1]), digest: match[2] };
}

/** Trusted personal-goal adapter. Memory bodies and lifecycle stay owned by
 * the existing Kernel. Goal records hold versioned references; the durable
 * grant, rather than a caller-supplied reference, permits output. Each async
 * mutation has a body-free operation record and a stable Kernel identity. */
class ProjectGoalMemoryService {
  constructor({
    db,
    getActor,
    memoryHostFactory,
    clock = Date.now,
    onAuthorityChanged = () => {},
  } = {}) {
    if (typeof memoryHostFactory !== "function")
      fail("GOAL_MEMORY_HOST_REQUIRED");
    if (typeof clock !== "function") fail("GOAL_MEMORY_INVALID_CLOCK");
    this.db = db;
    this.clock = clock;
    this.memoryHostFactory = memoryHostFactory;
    if (typeof onAuthorityChanged !== "function")
      fail("GOAL_MEMORY_HOST_REQUIRED");
    this.onAuthorityChanged = onAuthorityChanged;
    this.goals = new PersonalProjectGoalService({
      db,
      getActor,
      now: () => this._stamp(),
    });
    this.adapter = this.goals.adapter;
    this._tx(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_memory_authority (
      goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,epoch INTEGER NOT NULL CHECK(epoch>=0),
      PRIMARY KEY(goal_id,actor_did));
      CREATE TABLE IF NOT EXISTS cc_project_goal_memory_links (
      goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,memory_id TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL,
      PRIMARY KEY(goal_id,actor_did,memory_id));
      CREATE TABLE IF NOT EXISTS cc_project_goal_memory_operations (
      goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,request_id TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL,
      PRIMARY KEY(goal_id,actor_did,request_id));`),
    );
  }
  _stamp() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999)
      fail("GOAL_MEMORY_INVALID_CLOCK");
    return new Date(now).toISOString();
  }
  _tx(callback) {
    return this.adapter._transaction(callback);
  }
  _goal(goalId, actor = this.adapter._actor()) {
    const goal = this.adapter._read(identifier(goalId), actor);
    if (!goal) fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _context(goal) {
    const key = digest([
      goal.storeId,
      goal.ownerRef,
      goal.projectRef.id,
      goal.id,
    ]).slice(7);
    return {
      goalId: goal.id,
      storeId: goal.storeId,
      actorDid: goal.ownerRef,
      projectId: goal.projectRef.id,
      scope: { scope: "project", scopeId: `goal-memory:${key}` },
      sink: `goal-output:${key}`,
    };
  }
  _authority(context, expectedRevision = null) {
    const actor = this.adapter._actor();
    if (actor !== context.actorDid) fail("GOAL_IDENTITY_CHANGED");
    const goal = this._goal(context.goalId, actor);
    if (digest(this._context(goal)) !== digest(context))
      fail("GOAL_MEMORY_SCOPE_CHANGED");
    if (expectedRevision !== null && goal.revision !== expectedRevision)
      fail("GOAL_REVISION_CONFLICT");
    return goal;
  }
  _host(context, expectedRevision = null) {
    const host = this.memoryHostFactory({
      scope: clone(context.scope),
      authorize: () => {
        this._authority(context, expectedRevision);
        return { allowed: true };
      },
    });
    if (
      !host ||
      host.then ||
      typeof host.port?.read !== "function" ||
      typeof host.port?.readEvent !== "function" ||
      typeof host.port?.getReconciliation !== "function" ||
      ["proposeMemory", "decideMemory", "deleteMemory", "reconcile"].some(
        (name) => typeof host.kernel?.[name] !== "function",
      )
    )
      fail("GOAL_MEMORY_HOST_INVALID");
    return host;
  }
  _readMemory(host, memoryId) {
    const record = host.port.read(memoryId);
    if (record?.then) fail("GOAL_MEMORY_SYNCHRONOUS_READ_REQUIRED");
    if (
      record &&
      (record.memoryId !== memoryId ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 1 ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.digest))
    )
      fail("GOAL_MEMORY_RECORD_CORRUPT");
    return record;
  }
  _decode(row, kind, context) {
    if (!row) return null;
    try {
      if (
        typeof row.record_json !== "string" ||
        Buffer.byteLength(row.record_json, "utf8") > MAX_BYTES
      )
        throw new Error();
      const value = JSON.parse(row.record_json);
      if (
        value.schema !== `chainlesschain.goal-memory-${kind}/v1` ||
        value.goalId !== context.goalId ||
        value.actorDid !== context.actorDid ||
        value.storeId !== context.storeId ||
        value.projectId !== context.projectId ||
        value.scopeId !== context.scope.scopeId ||
        value.sink !== context.sink ||
        digest(value) !== row.content_digest
      )
        throw new Error();
      if (kind === "operation") {
        options(value, [
          "schema",
          "goalId",
          "actorDid",
          "storeId",
          "projectId",
          "scopeId",
          "sink",
          "requestId",
          "inputDigest",
          "type",
          "status",
          "goalRevision",
          "controlGeneration",
          "memoryId",
          "sourceRef",
          "payloadDigest",
          "startedAt",
          "discard",
          "result",
        ]);
        if (
          value.requestId !== row.request_id ||
          !["create", "correct", "revoke", "delete"].includes(value.type) ||
          ![
            "prepared",
            "denied",
            "complete",
            "discard-requested",
            "discarded",
          ].includes(value.status) ||
          !Number.isSafeInteger(value.goalRevision) ||
          value.goalRevision < 1 ||
          !Number.isSafeInteger(value.controlGeneration) ||
          value.controlGeneration < 0 ||
          !/^sha256:[a-f0-9]{64}$/u.test(value.inputDigest) ||
          (value.payloadDigest !== null &&
            !/^sha256:[a-f0-9]{64}$/u.test(value.payloadDigest)) ||
          new Date(value.startedAt).toISOString() !== value.startedAt ||
          ["complete", "discarded"].includes(value.status) !==
            (value.result !== null)
        )
          throw new Error();
        identifier(value.requestId);
        identifier(value.memoryId);
        if (value.type === "create" && value.sourceRef !== null)
          throw new Error();
        if (value.type !== "create") {
          options(value.sourceRef, ["kind", "id", "version"]);
          parseVersion(value.sourceRef.version);
          if (value.sourceRef.kind !== KIND) throw new Error();
          identifier(value.sourceRef.id);
        }
        if (value.discard !== null) {
          options(value.discard, ["requestId", "inputDigest"]);
          identifier(value.discard.requestId);
          if (!/^sha256:[a-f0-9]{64}$/u.test(value.discard.inputDigest))
            throw new Error();
        }
        if (
          ["discard-requested", "discarded"].includes(value.status) &&
          value.discard === null
        )
          throw new Error();
        if (value.result !== null) {
          options(value.result, [
            "operation",
            "memoryId",
            "reference",
            "receipt",
            "goalRevision",
            "memoryEpoch",
            "goalReferenceRetained",
          ]);
          if (
            value.result.memoryId !== value.memoryId ||
            value.result.operation !==
              (value.status === "discarded" ? "discard" : value.type) ||
            !Number.isSafeInteger(value.result.goalRevision) ||
            value.result.goalRevision < 1 ||
            !Number.isSafeInteger(value.result.memoryEpoch) ||
            value.result.memoryEpoch < 0 ||
            typeof value.result.goalReferenceRetained !== "boolean"
          )
            throw new Error();
          if (
            value.status === "complete" &&
            ["create", "correct"].includes(value.type)
          ) {
            options(value.result.reference, ["kind", "id", "version"]);
            if (
              value.result.reference.kind !== KIND ||
              value.result.reference.id !== value.memoryId
            )
              throw new Error();
            parseVersion(value.result.reference.version);
          } else if (value.result.reference !== null) throw new Error();
          if (
            value.status === "complete" &&
            value.type === "delete" &&
            !value.result.receipt
          )
            throw new Error();
        }
      } else {
        options(value, [
          "schema",
          "goalId",
          "actorDid",
          "storeId",
          "projectId",
          "scopeId",
          "sink",
          "memoryId",
          "version",
          "state",
          "operationRequestId",
        ]);
        if (
          value.memoryId !== row.memory_id ||
          !["active", "revoked", "corrected", "deleted"].includes(value.state)
        )
          throw new Error();
        identifier(value.memoryId);
        identifier(value.operationRequestId);
        parseVersion(value.version);
      }
      return value;
    } catch {
      fail("GOAL_MEMORY_RECORD_CORRUPT");
    }
  }
  _binding(context) {
    const { goalId, actorDid, storeId, projectId, sink } = context;
    return {
      goalId,
      actorDid,
      storeId,
      projectId,
      scopeId: context.scope.scopeId,
      sink,
    };
  }
  _operation(context, requestId) {
    return this._decode(
      this.db
        .prepare(
          "SELECT * FROM cc_project_goal_memory_operations WHERE goal_id=? AND actor_did=? AND request_id=?",
        )
        .get(context.goalId, context.actorDid, requestId),
      "operation",
      context,
    );
  }
  _link(context, memoryId) {
    return this._decode(
      this.db
        .prepare(
          "SELECT * FROM cc_project_goal_memory_links WHERE goal_id=? AND actor_did=? AND memory_id=?",
        )
        .get(context.goalId, context.actorDid, memoryId),
      "link",
      context,
    );
  }
  _saveOperation(value) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_BYTES)
      fail("GOAL_MEMORY_CAPACITY");
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_memory_operations VALUES (?,?,?,?,?)
      ON CONFLICT(goal_id,actor_did,request_id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        value.goalId,
        value.actorDid,
        value.requestId,
        serialized,
        digest(value),
      );
    return value;
  }
  _saveLink(context, memoryId, memoryVersion, state, requestId) {
    const value = {
      schema: "chainlesschain.goal-memory-link/v1",
      ...this._binding(context),
      memoryId,
      version: memoryVersion,
      state,
      operationRequestId: requestId,
    };
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_memory_links VALUES (?,?,?,?,?)
      ON CONFLICT(goal_id,actor_did,memory_id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        context.goalId,
        context.actorDid,
        memoryId,
        JSON.stringify(value),
        digest(value),
      );
    return value;
  }
  _epoch(context) {
    const value =
      this.db
        .prepare(
          "SELECT epoch FROM cc_project_goal_memory_authority WHERE goal_id=? AND actor_did=?",
        )
        .get(context.goalId, context.actorDid)?.epoch ?? 0;
    if (!Number.isSafeInteger(value) || value < 0)
      fail("GOAL_MEMORY_RECORD_CORRUPT");
    return value;
  }
  _advanceEpoch(context) {
    const next = this._epoch(context) + 1;
    if (!Number.isSafeInteger(next)) fail("GOAL_MEMORY_CAPACITY");
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_memory_authority VALUES (?,?,?)
      ON CONFLICT(goal_id,actor_did) DO UPDATE SET epoch=excluded.epoch`,
      )
      .run(context.goalId, context.actorDid, next);
    // A body-free invalidation before commit only prompts an authorized reread;
    // it cannot claim success, including when the containing transaction rolls back.
    try {
      this.onAuthorityChanged();
    } catch {}
    return next;
  }
  _payload(input) {
    if (
      !TYPES.includes(input.category) ||
      typeof input.content !== "string" ||
      !input.content.trim() ||
      Buffer.byteLength(input.content, "utf8") > 8192
    )
      fail("GOAL_MEMORY_INVALID_CONTENT");
    if (
      input.expiresAt !== undefined &&
      (typeof input.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(input.expiresAt)) ||
        new Date(input.expiresAt).toISOString() !== input.expiresAt)
    )
      fail("GOAL_MEMORY_INVALID_EXPIRY");
  }
  _proposal(input, operation, context) {
    return {
      memoryId: operation.memoryId,
      ...context.scope,
      category: input.category,
      content: input.content,
      provenance: {
        source: `goal-memory.${input.category}`,
        actor: `goal-actor-${digest(context.actorDid).slice(7)}`,
        observedAt: operation.startedAt,
      },
      evidenceRefs: [
        {
          store: context.scope.scopeId,
          id: `goal-source-${digest(context.goalId).slice(7)}`,
          revision: operation.goalRevision,
          digest: operation.inputDigest,
        },
      ],
      confidence: input.category === "agent-inference" ? 0.5 : 1,
      importance: 0.5,
      tags: [],
      sensitivity: "personal",
      allowedSinks: [context.sink],
      retentionPolicy: input.expiresAt
        ? { mode: "until_expired", expiresAt: input.expiresAt }
        : { mode: "durable" },
      activate: true,
      createdAt: operation.startedAt,
      ...(operation.type === "correct"
        ? { supersedes: [operation.sourceRef.id] }
        : {}),
    };
  }
  _proposalFingerprint(record) {
    if (
      record.revision !== 1 ||
      record.state !== "active" ||
      record.contentRef !== undefined ||
      record.summary !== undefined ||
      record.lastAccessedAt !== undefined ||
      record.accessCount !== 0 ||
      record.createdAt !== record.updatedAt
    )
      fail("GOAL_MEMORY_OPERATION_CONFLICT");
    return digest(
      Object.fromEntries(
        [
          "memoryId",
          "scope",
          "scopeId",
          "category",
          "content",
          "provenance",
          "evidenceRefs",
          "confidence",
          "importance",
          "tags",
          "sensitivity",
          "allowedSinks",
          "retentionPolicy",
          "createdAt",
          "supersedes",
        ]
          .filter((key) => record[key] !== undefined)
          .map((key) => [key, record[key]])
          .concat([["activate", true]]),
      ),
    );
  }
  _prepare(type, input) {
    const fields = ["goalId", "expectedRevision", "requestId"];
    if (type !== "create") fields.push("memoryId", "memoryVersion");
    if (["create", "correct"].includes(type))
      fields.push("content", "category");
    options(
      input,
      fields,
      ["create", "correct"].includes(type) ? ["expiresAt"] : [],
    );
    identifier(input.requestId);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    )
      fail("GOAL_MEMORY_INVALID_REQUEST");
    if (type !== "create") {
      identifier(input.memoryId);
      parseVersion(input.memoryVersion);
    }
    if (["create", "correct"].includes(type)) this._payload(input);
    const inputDigest = digest({ type, input });
    const initial = this._tx(() => this._goal(input.goalId));
    const context = this._context(initial);
    const host = this._host(context);
    const operation = this._tx(() => {
      const goal = this._authority(context);
      const prior = this._operation(context, input.requestId);
      if (prior) {
        if (prior.inputDigest !== inputDigest)
          fail("GOAL_MEMORY_REQUEST_CONFLICT");
        return prior;
      }
      if (goal.revision !== input.expectedRevision)
        fail("GOAL_REVISION_CONFLICT");
      if (input.expiresAt !== undefined && input.expiresAt <= this._stamp())
        fail("GOAL_MEMORY_INVALID_EXPIRY");
      if (["create", "correct"].includes(type) && goal.status === "done")
        fail("GOAL_MEMORY_REOPEN_REQUIRED");
      const pending = ["create", "correct"].includes(type)
        ? this.db
            .prepare(
              "SELECT request_id FROM cc_project_goal_memory_operations WHERE goal_id=? AND actor_did=?",
            )
            .all(context.goalId, context.actorDid)
            .map((row) => this._operation(context, row.request_id))
        : [];
      if (
        pending.some((item) => !["complete", "discarded"].includes(item.status))
      )
        fail("GOAL_MEMORY_OPERATION_PENDING");
      if (pending.length >= MAX_OPERATIONS) fail("GOAL_MEMORY_CAPACITY");
      const linkCount = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM cc_project_goal_memory_links WHERE goal_id=? AND actor_did=?",
        )
        .get(context.goalId, context.actorDid).count;
      if (["create", "correct"].includes(type) && linkCount >= MAX_LINKS)
        fail("GOAL_MEMORY_CAPACITY");
      let sourceRef = null;
      if (type !== "create") {
        const link = this._link(context, input.memoryId);
        if (!link) fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
        if (type === "delete" && link.state === "deleted")
          fail("GOAL_MEMORY_DELETE_PENDING_OR_FINISHED");
        sourceRef = {
          kind: KIND,
          id: input.memoryId,
          version: input.memoryVersion,
        };
        if (
          type !== "delete" &&
          (link.state !== "active" ||
            link.version !== input.memoryVersion ||
            !goal.memoryRefs.some((ref) => digest(ref) === digest(sourceRef)))
        )
          fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
        if (type !== "revoke") {
          const record = this._readMemory(host, input.memoryId);
          if (!record || version(record) !== input.memoryVersion)
            fail("GOAL_MEMORY_VERSION_CONFLICT");
          if (type === "correct" && !this._readable(record, context))
            fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
          if (["deleted", "purged"].includes(record.state))
            fail("GOAL_MEMORY_ALREADY_DELETED");
        }
      }
      const prepared = {
        schema: "chainlesschain.goal-memory-operation/v1",
        ...this._binding(context),
        requestId: input.requestId,
        inputDigest,
        type,
        status: "prepared",
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        memoryId: ["create", "correct"].includes(type)
          ? `goal-mem-${digest([context.scope.scopeId, input.requestId]).slice(7)}`
          : input.memoryId,
        sourceRef,
        payloadDigest: null,
        startedAt: this._stamp(),
        discard: null,
        result: null,
      };
      if (["create", "correct"].includes(type))
        prepared.payloadDigest = digest(
          this._proposal(input, prepared, context),
        );
      this._saveOperation(prepared);
      if (["revoke", "delete"].includes(type)) {
        this._saveLink(
          context,
          input.memoryId,
          sourceRef.version,
          type === "revoke" ? "revoked" : "deleted",
          input.requestId,
        );
        this._advanceEpoch(context);
        // Completed goals retain historical references. The independent grant
        // is already denied; privacy cleanup never fabricates a new proof.
        if (goal.status !== "done")
          this.adapter.compareAndSwapInTransaction(
            goal.id,
            goal.revision,
            (current) =>
              reviseGoalRecord(
                current,
                {
                  memoryRefs: current.memoryRefs.filter(
                    (ref) => ref.kind !== KIND || ref.id !== input.memoryId,
                  ),
                },
                this._stamp(),
              ),
          );
        prepared.status = "denied";
        this._saveOperation(prepared);
      }
      this._authority(context);
      return prepared;
    });
    return { context, host, operation };
  }
  _readable(record, context) {
    const expires = record.retentionPolicy.expiresAt;
    const maxAge = record.retentionPolicy.maxAgeDays;
    return (
      record.scope === context.scope.scope &&
      record.scopeId === context.scope.scopeId &&
      ["active", "reinforced"].includes(record.state) &&
      record.allowedSinks.length === 1 &&
      record.allowedSinks[0] === context.sink &&
      (!expires || expires > this._stamp()) &&
      (!maxAge ||
        Date.parse(record.createdAt) + maxAge * 86400000 >
          Date.parse(this._stamp()))
    );
  }
  _verifyGrant(goal, context, ref, host) {
    if (ref.kind !== KIND) fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
    const link = this._link(context, ref.id);
    if (
      !link ||
      link.state !== "active" ||
      link.version !== ref.version ||
      !goal.memoryRefs.some((item) => digest(item) === digest(ref))
    )
      fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
    const record = this._readMemory(host, ref.id);
    if (
      !record ||
      version(record) !== ref.version ||
      !this._readable(record, context)
    )
      fail("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
    return record;
  }
  _result(context, operation, receipt = null) {
    return this._tx(() => {
      const goal = this._authority(context);
      const current = this._operation(context, operation.requestId);
      if (current.status === "complete")
        return { operation: clone(current), goal, replayed: true };
      current.status = "complete";
      current.result = {
        operation: current.type,
        memoryId: current.memoryId,
        reference: null,
        receipt,
        goalRevision: goal.revision,
        memoryEpoch: this._epoch(context),
        goalReferenceRetained: goal.memoryRefs.some(
          (ref) => ref.kind === KIND && ref.id === current.memoryId,
        ),
      };
      this._saveOperation(current);
      this._authority(context);
      return { operation: clone(current), goal, replayed: false };
    });
  }
  _replay(context, operation) {
    const host =
      operation.result?.receipt || operation.status === "discarded"
        ? this._host(context)
        : null;
    return this._tx(() => ({
      operation: clone(this._validateReplay(context, operation, host)),
      goal: this._authority(context),
      replayed: true,
    }));
  }
  _validateReplay(context, operation, host) {
    if (
      operation.type === "delete" &&
      operation.status === "complete" &&
      !operation.result?.receipt
    )
      fail("GOAL_MEMORY_RECEIPT_CORRUPT");
    if (
      operation.status === "discarded" &&
      !operation.result?.receipt &&
      this._readMemory(host, operation.memoryId)
    )
      fail("GOAL_MEMORY_RECEIPT_CORRUPT");
    if (operation.result?.receipt) {
      const request = this._deletionRequest(
        context,
        operation,
        operation.status === "discarded",
      );
      const prior = host.port.getReconciliation(request.requestId);
      this._checkDeletionBinding(prior, request);
      if (
        !prior.receipt ||
        digest(prior.receipt) !== digest(operation.result.receipt)
      )
        fail("GOAL_MEMORY_RECEIPT_CORRUPT");
      this._checkDeletionReceipt(host, operation.result.receipt, request);
    }
    return operation;
  }
  _deletionRequest(context, operation, discard = false) {
    const key = digest([
      context.scope.scopeId,
      operation.requestId,
      operation.memoryId,
      discard ? operation.discard.requestId : null,
    ]).slice(7);
    return {
      requestId: `goal-${discard ? "discard" : "delete"}-${key}`,
      memoryId: operation.memoryId,
      expectedRevision: discard
        ? 1
        : parseVersion(operation.sourceRef.version).revision,
      subject: `goal-actor-${digest(context.actorDid).slice(7)}`,
      ...context.scope,
      selector: `memory:${operation.memoryId}`,
      fence: `goal-delete-fence-${key}`,
      authority: context.scope.scopeId,
    };
  }
  _checkDeletionBinding(value, request) {
    if (
      !value ||
      value.then ||
      [
        "requestId",
        "memoryId",
        "subject",
        "scope",
        "scopeId",
        "selector",
        "fence",
        "authority",
      ].some((key) => value[key] !== request[key])
    )
      fail("GOAL_MEMORY_RECEIPT_CORRUPT");
  }
  _checkDeletionReceipt(host, receipt, request) {
    this._checkDeletionBinding(receipt, request);
    if (
      !["partial", "reconciliation_required", "purged"].includes(receipt.status)
    )
      fail("GOAL_MEMORY_RECEIPT_CORRUPT");
    if (receipt.status === "purged") {
      const record = this._readMemory(host, request.memoryId);
      if (
        !record ||
        record.state !== "purged" ||
        receipt.recordState !== record.state ||
        receipt.revision !== record.revision ||
        receipt.recordDigest !== record.digest ||
        record.deletionFence !== request.fence
      )
        fail("GOAL_MEMORY_RECEIPT_CORRUPT");
    }
  }
  async _write(type, input) {
    const { context, operation } = this._prepare(type, input);
    if (["complete", "discarded"].includes(operation.status))
      return this._replay(context, operation);
    if (operation.status === "discard-requested")
      fail("GOAL_MEMORY_OPERATION_DISCARD_PENDING");
    const host = this._host(context, operation.goalRevision);
    let record = this._readMemory(host, operation.memoryId);
    if (!record) {
      try {
        record = (
          await host.kernel.proposeMemory(
            this._proposal(input, operation, context),
          )
        ).record;
      } catch (error) {
        record = this._readMemory(host, operation.memoryId);
        if (!record) throw error;
      }
    }
    if (this._proposalFingerprint(record) !== operation.payloadDigest)
      fail("GOAL_MEMORY_OPERATION_CONFLICT");
    return this._finishWrite(context, operation, host);
  }
  async _finishWrite(context, operation, host) {
    const type = operation.type;
    if (type === "correct") {
      const previous = this._readMemory(host, operation.sourceRef.id);
      const expected = parseVersion(operation.sourceRef.version);
      if (previous && version(previous) === operation.sourceRef.version) {
        try {
          await host.kernel.decideMemory({
            memoryId: previous.memoryId,
            type: "supersede",
            expectedRevision: previous.revision,
            successorMemoryId: operation.memoryId,
          });
        } catch (error) {
          const current = this._readMemory(host, previous.memoryId);
          if (
            current?.state !== "superseded" ||
            current.revision !== expected.revision + 1
          )
            throw error;
        }
      }
      const superseded = this._readMemory(host, operation.sourceRef.id);
      const event = host.port.readEvent(
        operation.sourceRef.id,
        expected.revision + 1,
      );
      if (
        event?.then ||
        superseded?.state !== "superseded" ||
        superseded.revision !== expected.revision + 1 ||
        event?.successorMemoryId !== operation.memoryId ||
        event?.recordDigest !== superseded.digest ||
        event?.previousRevision !== expected.revision
      )
        fail("GOAL_MEMORY_OPERATION_CONFLICT");
    }
    return this._tx(() => {
      const goal = this._authority(context);
      const current = this._operation(context, operation.requestId);
      if (current.status === "complete")
        return { operation: clone(current), goal, replayed: true };
      if (
        goal.revision !== current.goalRevision ||
        goal.controlGeneration !== current.controlGeneration
      )
        fail("GOAL_REVISION_CONFLICT");
      const live = this._readMemory(host, current.memoryId);
      if (
        !live ||
        this._proposalFingerprint(live) !== current.payloadDigest ||
        !this._readable(live, context)
      )
        fail("GOAL_MEMORY_OPERATION_CONFLICT");
      const nextRef = reference(live);
      if (type === "correct")
        this._saveLink(
          context,
          current.sourceRef.id,
          current.sourceRef.version,
          "corrected",
          current.requestId,
        );
      this._saveLink(
        context,
        live.memoryId,
        nextRef.version,
        "active",
        current.requestId,
      );
      const next = this.adapter.compareAndSwapInTransaction(
        goal.id,
        goal.revision,
        (item) =>
          reviseGoalRecord(
            item,
            {
              memoryRefs: [
                ...item.memoryRefs.filter(
                  (ref) =>
                    type !== "correct" ||
                    ref.kind !== KIND ||
                    ref.id !== current.sourceRef.id,
                ),
                nextRef,
              ],
            },
            this._stamp(),
          ),
      );
      const memoryEpoch = this._advanceEpoch(context);
      current.status = "complete";
      current.result = {
        operation: type,
        memoryId: live.memoryId,
        reference: nextRef,
        receipt: null,
        goalRevision: next.revision,
        memoryEpoch,
        goalReferenceRetained: true,
      };
      this._saveOperation(current);
      this._authority(context);
      return { operation: clone(current), goal: next, replayed: false };
    });
  }
  create(input) {
    return this._write("create", input);
  }
  correct(input) {
    return this._write("correct", input);
  }
  revoke(input) {
    const { context, operation } = this._prepare("revoke", input);
    return operation.status === "complete"
      ? this._replay(context, operation)
      : this._result(context, operation);
  }
  async delete(input) {
    const { context, operation, host } = this._prepare("delete", input);
    if (operation.status === "complete")
      return this._replay(context, operation);
    return this._deletePrepared(context, operation, host);
  }
  async _deletePrepared(context, operation, host) {
    const request = this._deletionRequest(context, operation);
    const receipt = await host.kernel.deleteMemory(request);
    this._checkDeletionReceipt(host, receipt, request);
    if (receipt.status !== "purged")
      return this._tx(() => ({
        operation: this._operation(context, operation.requestId),
        receipt,
        goal: this._authority(context),
        replayed: false,
      }));
    return this._result(context, operation, receipt);
  }
  async recover(input) {
    options(input, ["goalId", "requestId"]);
    identifier(input.requestId);
    const admitted = this._tx(() => {
      const goal = this._goal(input.goalId),
        context = this._context(goal);
      const operation = this._operation(context, input.requestId);
      if (!operation) fail("GOAL_MEMORY_OPERATION_NOT_FOUND");
      return { goal, context, operation };
    });
    const { goal, context, operation } = admitted;
    if (["complete", "discarded"].includes(operation.status))
      return this._replay(context, operation);
    if (operation.status === "discard-requested")
      return this._discardPrepared(context, operation);
    if (operation.type === "revoke") return this._result(context, operation);
    if (operation.type === "delete")
      return this._deletePrepared(context, operation, this._host(context));
    if (
      goal.revision !== operation.goalRevision ||
      goal.controlGeneration !== operation.controlGeneration
    )
      return {
        operation,
        goal,
        blockedReason: "GOAL_REVISION_CONFLICT",
        replayed: false,
      };
    const host = this._host(context, operation.goalRevision);
    const record = this._readMemory(host, operation.memoryId);
    if (!record)
      return {
        operation,
        goal: this._tx(() => this._authority(context)),
        blockedReason: "GOAL_MEMORY_ORIGINAL_INPUT_REQUIRED",
        replayed: false,
      };
    if (this._proposalFingerprint(record) !== operation.payloadDigest)
      fail("GOAL_MEMORY_OPERATION_CONFLICT");
    return this._finishWrite(context, operation, host);
  }
  async discard(input) {
    options(input, [
      "goalId",
      "expectedRevision",
      "operationRequestId",
      "requestId",
    ]);
    identifier(input.requestId);
    identifier(input.operationRequestId);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    )
      fail("GOAL_MEMORY_INVALID_REQUEST");
    const inputDigest = digest(input);
    const initial = this._tx(() => this._goal(input.goalId));
    const context = this._context(initial);
    const operation = this._tx(() => {
      const goal = this._authority(context),
        current = this._operation(context, input.operationRequestId);
      if (!current) fail("GOAL_MEMORY_OPERATION_NOT_FOUND");
      if (current.discard) {
        if (
          current.discard.inputDigest !== inputDigest ||
          current.discard.requestId !== input.requestId
        )
          fail("GOAL_MEMORY_REQUEST_CONFLICT");
        return current;
      }
      if (
        !["create", "correct"].includes(current.type) ||
        current.status !== "prepared"
      )
        fail("GOAL_MEMORY_DISCARD_DENIED");
      if (goal.revision !== input.expectedRevision)
        fail("GOAL_REVISION_CONFLICT");
      // Fence any admitted late proposal by advancing the goal revision, then
      // purge the unlinked candidate using the Kernel's deletion journal.
      if (goal.status !== "done")
        this.adapter.compareAndSwapInTransaction(
          goal.id,
          goal.revision,
          (record) =>
            reviseGoalRecord(
              record,
              { memoryRefs: record.memoryRefs },
              this._stamp(),
            ),
        );
      this._advanceEpoch(context);
      current.status = "discard-requested";
      current.discard = { requestId: input.requestId, inputDigest };
      this._saveOperation(current);
      return current;
    });
    return operation.status === "discarded"
      ? this._replay(context, operation)
      : this._discardPrepared(context, operation);
  }
  async _discardPrepared(context, operation) {
    const host = this._host(context);
    const candidate = this._readMemory(host, operation.memoryId);
    let receipt = null;
    if (candidate) {
      const request = this._deletionRequest(context, operation, true);
      // A retry uses the durable reconciliation even after the tombstone CAS.
      const prior = host.port.getReconciliation(request.requestId);
      if (prior?.then) fail("GOAL_MEMORY_SYNCHRONOUS_READ_REQUIRED");
      if (prior) {
        this._checkDeletionBinding(prior, request);
        receipt = await host.kernel.reconcile(request.requestId);
      } else {
        if (this._proposalFingerprint(candidate) !== operation.payloadDigest)
          fail("GOAL_MEMORY_OPERATION_CONFLICT");
        receipt = await host.kernel.deleteMemory(request);
      }
      this._checkDeletionReceipt(host, receipt, request);
      if (receipt.status !== "purged")
        return this._tx(() => ({
          operation: this._operation(context, operation.requestId),
          receipt,
          goal: this._authority(context),
          replayed: false,
        }));
    }
    return this._tx(() => {
      const goal = this._authority(context),
        current = this._operation(context, operation.requestId);
      if (current.status === "discarded")
        return { operation: current, goal, replayed: true };
      let next = goal;
      if (current.type === "correct") {
        const old = this._readMemory(host, current.sourceRef.id);
        if (old?.state === "superseded") {
          const event = host.port.readEvent(old.memoryId, old.revision);
          if (event?.successorMemoryId !== current.memoryId)
            fail("GOAL_MEMORY_OPERATION_CONFLICT");
          this._saveLink(
            context,
            old.memoryId,
            current.sourceRef.version,
            "corrected",
            current.requestId,
          );
          if (goal.status !== "done")
            next = this.adapter.compareAndSwapInTransaction(
              goal.id,
              goal.revision,
              (record) =>
                reviseGoalRecord(
                  record,
                  {
                    memoryRefs: record.memoryRefs.filter(
                      (ref) => ref.kind !== KIND || ref.id !== old.memoryId,
                    ),
                  },
                  this._stamp(),
                ),
            );
        }
      }
      current.status = "discarded";
      current.result = {
        operation: "discard",
        memoryId: current.memoryId,
        reference: null,
        receipt,
        goalRevision: next.revision,
        memoryEpoch: this._epoch(context),
        goalReferenceRetained: false,
      };
      this._saveOperation(current);
      this._authority(context);
      return { operation: current, goal: next, replayed: false };
    });
  }
  list(input) {
    options(input, ["goalId"], ["afterId", "limit"]);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_MEMORY_INVALID_LIMIT");
    if (input.afterId !== undefined) identifier(input.afterId);
    const initial = this._tx(() => this._goal(input.goalId));
    const context = this._context(initial),
      host = this._host(context);
    return this._tx(() => {
      const goal = this._authority(context);
      const rows = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_memory_links WHERE goal_id=? AND actor_did=? AND memory_id>? ORDER BY memory_id LIMIT ?",
        )
        .all(context.goalId, context.actorDid, input.afterId ?? "", limit + 1);
      const refs = [];
      const items = rows.slice(0, limit).map((row) => {
        const link = this._decode(row, "link", context),
          ref = { kind: KIND, id: link.memoryId, version: link.version };
        const record = this._readMemory(host, link.memoryId);
        const item = {
          memoryId: link.memoryId,
          reference: ref,
          grantState: link.state,
          state: record?.state ?? "missing",
          currentVersion: record ? version(record) : null,
          record: null,
          unavailable: true,
        };
        if (
          link.state === "active" &&
          record &&
          version(record) === link.version &&
          this._readable(record, context) &&
          goal.memoryRefs.some((value) => digest(value) === digest(ref))
        ) {
          item.record = clone(record);
          item.unavailable = false;
          refs.push(ref);
        }
        return item;
      });
      const outputToken = {
        schema: "chainlesschain.goal-memory-output/v1",
        ...this._binding(context),
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        memoryEpoch: this._epoch(context),
        refs,
      };
      this._authority(context);
      return clone({
        goalId: goal.id,
        goalRevision: goal.revision,
        memoryEpoch: outputToken.memoryEpoch,
        items,
        outputToken,
        nextCursor: rows.length > limit ? items.at(-1).memoryId : null,
      });
    });
  }
  revalidateOutput(token) {
    options(token, [
      "schema",
      "goalId",
      "actorDid",
      "storeId",
      "projectId",
      "scopeId",
      "sink",
      "goalRevision",
      "controlGeneration",
      "memoryEpoch",
      "refs",
    ]);
    if (
      token.schema !== "chainlesschain.goal-memory-output/v1" ||
      !Array.isArray(token.refs) ||
      token.refs.length > 50
    )
      fail("GOAL_MEMORY_INVALID_REQUEST");
    for (const ref of token.refs) {
      options(ref, ["kind", "id", "version"]);
      identifier(ref.id);
      parseVersion(ref.version);
    }
    if (new Set(token.refs.map((ref) => ref.id)).size !== token.refs.length)
      fail("GOAL_MEMORY_INVALID_REQUEST");
    const initial = this._tx(() => this._goal(token.goalId));
    const context = this._context(initial),
      host = this._host(context);
    return this._tx(() => {
      const goal = this._authority(context);
      if (
        digest(this._binding(context)) !==
          digest(
            Object.fromEntries(
              Object.keys(this._binding(context)).map((key) => [
                key,
                token[key],
              ]),
            ),
          ) ||
        token.goalRevision !== goal.revision ||
        token.controlGeneration !== goal.controlGeneration ||
        token.memoryEpoch !== this._epoch(context)
      )
        fail("GOAL_MEMORY_OUTPUT_STALE");
      const records = token.refs.map((ref) =>
        clone(this._verifyGrant(goal, context, ref, host)),
      );
      this._authority(context);
      return {
        goalId: goal.id,
        goalRevision: goal.revision,
        memoryEpoch: token.memoryEpoch,
        records,
      };
    });
  }
  operations(input) {
    options(input, ["goalId"], ["afterId", "limit"]);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_MEMORY_INVALID_LIMIT");
    if (input.afterId !== undefined) identifier(input.afterId);
    return this._tx(() => {
      const goal = this._goal(input.goalId),
        context = this._context(goal);
      const rows = this.db
        .prepare(
          "SELECT request_id FROM cc_project_goal_memory_operations WHERE goal_id=? AND actor_did=? AND request_id>? ORDER BY request_id LIMIT ?",
        )
        .all(goal.id, goal.ownerRef, input.afterId ?? "", limit + 1);
      const items = rows
        .slice(0, limit)
        .map((row) => this._operation(context, row.request_id));
      this._authority(context);
      return clone({
        goalId: goal.id,
        items,
        nextCursor: rows.length > limit ? items.at(-1).requestId : null,
      });
    });
  }
}

module.exports = {
  ProjectGoalMemoryService,
  GOAL_MEMORY_REFERENCE_KIND: KIND,
  GOAL_MEMORY_CATEGORIES: TYPES,
};
