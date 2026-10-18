"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  goalExtensionRef,
  normalizeGoalExtensionProposal,
} = require("./goal-extension-proposal-contract.js");
const {
  ProjectGoalExtensionQueue,
} = require("./project-goal-extension-queue.js");
const {
  readExtensionDraft,
  readExtensionIntentBinding,
} = require("./project-goal-extension-conversion.js");

const ACCESS_SCHEMA = "chainlesschain.goal-draft-access/v1";
const GRANT_SCHEMA = "chainlesschain.goal-external-grant/v1";
const ORIGIN = "extension-suggestion";
const ACTION = "task.description.update";
const MAX_GRANTS = 100;
const MAX_GRANT_BYTES = 8192;
const GRANT_ID = /^goal-external-grant-[a-f0-9]{64}$/u;
const DRAFT_ID = /^goal-extension-[a-f0-9]{64}$/u;
const SOURCE_ID = /^goal-proposal-[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const same = (a, b) => digest(a) === digest(b);
const copy = (value) => JSON.parse(JSON.stringify(value));
function fail(code = "GOAL_EXTERNAL_INVALID_REQUEST") {
  throw Object.assign(new Error(code), { code });
}
function exact(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail();
}
function accessValue(raw) {
  exact(raw, ["schema", "plugin", "declarationDigest"]);
  exact(raw.plugin, ["name", "scope", "version"]);
  if (
    raw.schema !== ACCESS_SCHEMA ||
    !DIGEST.test(raw.declarationDigest) ||
    typeof raw.declarationDigest !== "string" ||
    !["user", "project", "local"].includes(raw.plugin.scope) ||
    ![raw.plugin.name, raw.plugin.version].every(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/u.test(value),
    )
  )
    fail();
  return copy(raw);
}
function grantRefValue(raw) {
  exact(raw, ["id", "epoch"]);
  if (
    typeof raw.id !== "string" ||
    !GRANT_ID.test(raw.id) ||
    !Number.isSafeInteger(raw.epoch) ||
    raw.epoch < 1
  )
    fail();
  return { id: raw.id, epoch: raw.epoch };
}
function identity(actor, ref, plugin) {
  return `goal-external-grant-${digest({ actorDid: actor, storeId: ref.storeId, goalId: ref.id, plugin }).slice(7)}`;
}
function draftIdentity(actor, plugin, goalRef, requestId) {
  return `goal-extension-${digest({ actorDid: actor, plugin, goalRef, requestId }).slice(7)}`;
}
function externalBinding(draft) {
  if (!draft.admissionEpoch.startsWith("goal-external-grant-")) return null;
  const match = /^(goal-external-grant-[a-f0-9]{64}):([1-9][0-9]*)$/u.exec(
    draft.admissionEpoch,
  );
  if (
    !match ||
    !Number.isSafeInteger(Number(match[2])) ||
    draft.origin !== ORIGIN ||
    !["user", "project", "local"].includes(draft.plugin.scope) ||
    match[1] !== identity(draft.actorDid, draft.proposal.goalRef, draft.plugin)
  )
    fail("GOAL_EXTERNAL_BINDING_CORRUPT");
  return { id: match[1], epoch: Number(match[2]) };
}
function cursor(raw, expression) {
  if (raw !== undefined && (typeof raw !== "string" || !expression.test(raw)))
    fail();
  return raw ?? "";
}

/** Native host authority for pending suggestions. The plugin label is a grant
 * binding, not code authentication. No connection lifetime or execution port is
 * stored here; the native workflow still owns preview and actual confirmation. */
class ProjectGoalExternalDrafts {
  constructor({ workflow, clock = Date.now }) {
    if (
      typeof clock !== "function" ||
      typeof workflow?.assertExtensionSourceInTransaction !== "function"
    )
      fail();
    this.workflow = workflow;
    this.db = workflow.db;
    this.clock = clock;
    this.queues = new Map();
    this._tx(() =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_external_grants (
      id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,goal_id TEXT NOT NULL,plugin_key TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_goal_external_grants_scope
      ON cc_project_goal_external_grants(actor_did,goal_id,id);`),
    );
    // Initialize the shared queue schema once. Derived queues only replace the
    // immutable plugin binding and synchronous authorization callback.
    this.baseQueue = new ProjectGoalExtensionQueue({
      workflow,
      clock,
      origin: ORIGIN,
      plugin: {
        name: "external-draft-schema",
        scope: "desktop-builtin",
        version: "1",
      },
      authorizeExtension: () => null,
    });
  }
  _tx(operation, readOnly = false) {
    if (this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_BUSY");
    const transaction = this.db.transaction(operation);
    return readOnly ? transaction.deferred() : transaction.immediate();
  }
  _readTx(operation) {
    return this._tx(operation, true);
  }
  _required() {
    if (!this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_REQUIRED");
  }
  _scope(raw, live = false) {
    this._required();
    const ref = goalExtensionRef(raw),
      actor = this.workflow.adapter._actor();
    const goal = this.workflow._goal(ref.id, actor);
    if (
      goal.storeId !== ref.storeId ||
      goal.revision !== ref.revision ||
      goal.controlGeneration !== ref.controlGeneration
    )
      fail("GOAL_EXTERNAL_SOURCE_CHANGED");
    if (live) {
      this.workflow.assertExtensionGoalInTransaction(ref);
      if (!goal.allowedActionTypes.includes("task.update-description"))
        fail("ACTION_GOAL_ACTION_OUT_OF_SCOPE");
    }
    return { ref, actor, projectId: goal.projectRef.id };
  }
  _read(id, actor, missing = false) {
    this._required();
    if (typeof id !== "string" || !GRANT_ID.test(id)) fail();
    const row = this.db
      .prepare(
        `SELECT actor_did,goal_id,plugin_key,
      CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_GRANT_BYTES} THEN record_json END AS body,content_digest
      FROM cc_project_goal_external_grants WHERE id=? AND actor_did=?`,
      )
      .get(id, actor);
    if (!row) {
      if (missing) return null;
      fail("GOAL_EXTERNAL_GRANT_NOT_FOUND");
    }
    try {
      const record = JSON.parse(row.body);
      exact(record, [
        "schema",
        "id",
        "actorDid",
        "projectId",
        "goalRef",
        "plugin",
        "declarationDigest",
        "epoch",
        "enabled",
        "updatedAt",
      ]);
      const ref = goalExtensionRef(record.goalRef);
      accessValue({
        schema: ACCESS_SCHEMA,
        plugin: record.plugin,
        declarationDigest: record.declarationDigest,
      });
      if (
        record.schema !== GRANT_SCHEMA ||
        record.id !== id ||
        record.actorDid !== actor ||
        row.actor_did !== actor ||
        row.goal_id !== ref.id ||
        row.plugin_key !== digest(record.plugin) ||
        identity(actor, ref, record.plugin) !== id ||
        !same(record.goalRef, ref) ||
        typeof record.projectId !== "string" ||
        !record.projectId ||
        record.projectId.length > 256 ||
        typeof record.enabled !== "boolean" ||
        !Number.isSafeInteger(record.epoch) ||
        record.epoch < 1 ||
        !Number.isSafeInteger(record.updatedAt) ||
        record.updatedAt < 0 ||
        digest(record) !== row.content_digest
      )
        throw 0;
      return record;
    } catch {
      fail("GOAL_EXTERNAL_GRANT_CORRUPT");
    }
  }
  _bound(record, scope, live = false, expectedEpoch) {
    if (
      record.actorDid !== scope.actor ||
      record.goalRef.storeId !== scope.ref.storeId ||
      record.goalRef.id !== scope.ref.id ||
      record.projectId !== scope.projectId
    )
      fail("GOAL_EXTERNAL_GRANT_NOT_FOUND");
    if (
      live &&
      (!record.enabled ||
        !same(record.goalRef, scope.ref) ||
        (expectedEpoch !== undefined && record.epoch !== expectedEpoch))
    )
      fail("GOAL_EXTERNAL_GRANT_CHANGED");
  }
  _assert(rawRef, rawGrantRef) {
    const scope = this._scope(rawRef, true),
      grantRef = grantRefValue(rawGrantRef);
    const record = this._read(grantRef.id, scope.actor);
    this._bound(record, scope, true, grantRef.epoch);
    return { scope, record };
  }
  _view(record) {
    const savedCount = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts WHERE actor_did=? AND goal_id=? AND plugin_key=?",
      )
      .get(record.actorDid, record.goalRef.id, digest(record.plugin)).n;
    if (!Number.isSafeInteger(savedCount) || savedCount < 0 || savedCount > 100)
      fail("GOAL_EXTERNAL_GRANT_CORRUPT");
    return copy({
      id: record.id,
      goalRef: record.goalRef,
      plugin: record.plugin,
      declarationDigest: record.declarationDigest,
      epoch: record.epoch,
      enabled: record.enabled,
      savedCount,
    });
  }
  _save(record) {
    this._required();
    const body = JSON.stringify(record);
    if (
      !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt < 0 ||
      Buffer.byteLength(body, "utf8") > MAX_GRANT_BYTES
    )
      fail("GOAL_EXTERNAL_INVALID_CLOCK");
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_external_grants VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        record.id,
        record.actorDid,
        record.goalRef.id,
        digest(record.plugin),
        body,
        digest(record),
      );
  }
  _queue(record) {
    if (!this.queues.has(record.id)) {
      const queue = Object.create(this.baseQueue),
        grantId = record.id;
      queue.plugin = Object.freeze({ ...record.plugin });
      queue.authorizeExtension = (context) => {
        const scope = this._scope(context.goalRef, true),
          current = this._read(grantId, scope.actor);
        this._bound(current, scope, true);
        if (
          context.actorDid !== scope.actor ||
          context.projectId !== scope.projectId ||
          !same(context.plugin, current.plugin) ||
          context.type !== ACTION
        )
          fail("GOAL_EXTERNAL_GRANT_CHANGED");
        return `${current.id}:${current.epoch}`;
      };
      this.queues.set(record.id, queue);
    }
    return this.queues.get(record.id);
  }
  _draft(record, draft, live = true) {
    if (
      draft.actorDid !== record.actorDid ||
      draft.origin !== ORIGIN ||
      !same(draft.plugin, record.plugin) ||
      !same(draft.proposal.goalRef, record.goalRef) ||
      draft.proposal.type !== ACTION ||
      draft.admissionEpoch !== `${record.id}:${record.epoch}` ||
      draft.id !==
        draftIdentity(
          record.actorDid,
          record.plugin,
          record.goalRef,
          draft.proposal.requestId,
        ) ||
      draft.inputDigest !== digest(draft.proposal) ||
      (live && !record.enabled)
    )
      fail("GOAL_EXTERNAL_GRANT_CHANGED");
  }
  grantStatus(input) {
    exact(input, ["goalRef", "access"]);
    const access = accessValue(input.access);
    return this._readTx(() => {
      const scope = this._scope(input.goalRef),
        id = identity(scope.actor, scope.ref, access.plugin);
      const record = this._read(id, scope.actor, true);
      if (record) {
        this._bound(record, scope);
        return this._view(record);
      }
      return {
        id,
        goalRef: copy(scope.ref),
        plugin: access.plugin,
        declarationDigest: access.declarationDigest,
        epoch: 0,
        enabled: false,
        savedCount: 0,
      };
    });
  }
  /** Only the native host calls this after confirming the captured access and
   * goal; expectedEpoch prevents a late dialog from undoing a concurrent revoke. */
  grant(input) {
    exact(input, ["goalRef", "access", "expectedEpoch"]);
    const access = accessValue(input.access);
    if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 0)
      fail();
    return this._tx(() => {
      const scope = this._scope(input.goalRef, true),
        id = identity(scope.actor, scope.ref, access.plugin);
      const prior = this._read(id, scope.actor, true);
      if (prior) this._bound(prior, scope);
      if ((prior?.epoch ?? 0) !== input.expectedEpoch)
        fail("GOAL_EXTERNAL_GRANT_CONFLICT");
      if (
        prior?.enabled &&
        same(prior.goalRef, scope.ref) &&
        prior.declarationDigest === access.declarationDigest
      )
        return this._view(prior);
      if (prior?.epoch === Number.MAX_SAFE_INTEGER)
        fail("GOAL_EXTERNAL_GRANT_CONFLICT");
      if (
        !prior &&
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM cc_project_goal_external_grants WHERE actor_did=? AND goal_id=?",
          )
          .get(scope.actor, scope.ref.id).n >= MAX_GRANTS
      )
        fail("GOAL_EXTERNAL_GRANT_LIMIT");
      const record = {
        schema: GRANT_SCHEMA,
        id,
        actorDid: scope.actor,
        projectId: scope.projectId,
        goalRef: scope.ref,
        plugin: access.plugin,
        declarationDigest: access.declarationDigest,
        epoch: (prior?.epoch ?? 0) + 1,
        enabled: true,
        updatedAt: this.clock(),
      };
      this._save(record);
      this._bound(record, this._scope(scope.ref, true), true);
      return this._view(record);
    });
  }
  assertGrant(input) {
    exact(input, ["goalRef", "grantRef"]);
    return this._readTx(() =>
      this._view(this._assert(input.goalRef, input.grantRef).record),
    );
  }
  listGrants(input) {
    exact(input, ["goalRef"], ["afterId"]);
    const after = cursor(input.afterId, GRANT_ID);
    return this._readTx(() => {
      const scope = this._scope(input.goalRef);
      if (after) this._bound(this._read(after, scope.actor), scope);
      const rows = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_external_grants WHERE actor_did=? AND goal_id=? AND id>? ORDER BY id LIMIT 21",
        )
        .all(scope.actor, scope.ref.id, after);
      const entries = rows.slice(0, 20).map(({ id }) => {
        const record = this._read(id, scope.actor);
        this._bound(record, scope);
        return this._view(record);
      });
      this._scope(scope.ref);
      return { entries, nextCursor: rows.length > 20 ? rows[19].id : null };
    });
  }
  revoke(input) {
    exact(input, ["goalRef", "id", "expectedEpoch"]);
    if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1)
      fail();
    return this._tx(() => {
      const scope = this._scope(input.goalRef),
        record = this._read(input.id, scope.actor);
      this._bound(record, scope);
      if (record.epoch !== input.expectedEpoch)
        fail("GOAL_EXTERNAL_GRANT_CONFLICT");
      if (record.enabled) {
        if (record.epoch === Number.MAX_SAFE_INTEGER)
          fail("GOAL_EXTERNAL_GRANT_CONFLICT");
        record.epoch++;
        record.enabled = false;
        record.updatedAt = this.clock();
        this._save(record);
      }
      this._scope(scope.ref);
      return this._view(record);
    });
  }
  sourcePage(input) {
    exact(input, ["goalRef", "grantRef"], ["afterId"]);
    const after = cursor(input.afterId, SOURCE_ID);
    return this._readTx(() => {
      const { scope } = this._assert(input.goalRef, input.grantRef);
      if (after) {
        const previous = this.workflow._read(after, "proposal", scope.actor);
        if (
          previous.goalId !== scope.ref.id ||
          previous.storeId !== scope.ref.storeId
        )
          fail("GOAL_EXTERNAL_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_workflow WHERE actor_did=? AND goal_id=? AND kind='proposal' AND id>? ORDER BY id LIMIT 21",
        )
        .all(scope.actor, scope.ref.id, after);
      const entries = [];
      let unavailableCount = 0;
      for (const row of rows.slice(0, 20)) {
        const proposal = this.workflow._read(row.id, "proposal", scope.actor);
        if (
          proposal.actionType !== "task.update-description" ||
          proposal.intentId !== null
        ) {
          unavailableCount++;
          continue;
        }
        try {
          const source = this.workflow.assertExtensionSourceInTransaction({
            goalRef: scope.ref,
            sourceRef: row.id,
            nativeActionType: "task.update-description",
          });
          entries.push({
            id: row.id,
            sourceTaskId: source.sourceTaskId,
            reviewId: source.reviewId,
            reviewDigest: source.reviewDigest,
          });
        } catch (error) {
          if (
            ![
              "PROJECT_RISK_REVIEW_STALE",
              "ACTION_GOAL_REVISION_CONFLICT",
              "ACTION_GOAL_SOURCE_ALREADY_PREPARED",
            ].includes(error.code)
          )
            throw error;
          unavailableCount++;
        }
      }
      this._assert(scope.ref, input.grantRef);
      return {
        entries,
        scannedCount: Math.min(rows.length, 20),
        unavailableCount,
        nextCursor: rows.length > 20 ? rows[19].id : null,
      };
    });
  }
  enqueue(input) {
    exact(input, ["goalRef", "grantRef", "proposal"]);
    const proposal = normalizeGoalExtensionProposal(input.proposal);
    if (
      proposal.type !== ACTION ||
      !same(proposal.goalRef, goalExtensionRef(input.goalRef))
    )
      fail();
    return this._tx(() => {
      const { record } = this._assert(input.goalRef, input.grantRef);
      const result = this._queue(record).enqueueInTransaction(proposal);
      this._assert(input.goalRef, input.grantRef);
      return result;
    });
  }
  submissionReceipt(input) {
    exact(input, ["goalRef", "grantRef", "requestId", "inputDigest"]);
    if (
      typeof input.requestId !== "string" ||
      !input.requestId.trim() ||
      input.requestId.length > 128 ||
      typeof input.inputDigest !== "string" ||
      !DIGEST.test(input.inputDigest)
    )
      fail();
    return this._readTx(() => {
      const { record } = this._assert(input.goalRef, input.grantRef);
      const id = draftIdentity(
        record.actorDid,
        record.plugin,
        record.goalRef,
        input.requestId,
      );
      const exists = this.db
        .prepare("SELECT id FROM cc_project_goal_extension_drafts WHERE id=?")
        .get(id);
      if (exists) {
        const draft = readExtensionDraft(
          this.db,
          id,
          record.actorDid,
          record.plugin,
          ORIGIN,
        );
        this._draft(record, draft);
        if (
          draft.inputDigest !== input.inputDigest ||
          draft.proposal.requestId !== input.requestId
        )
          fail("GOAL_EXTENSION_REQUEST_CONFLICT");
      }
      this._assert(input.goalRef, input.grantRef);
      return {
        state: exists ? "saved" : "not-found",
        proposalId: exists ? id : null,
        requestId: input.requestId,
        inputDigest: input.inputDigest,
      };
    });
  }
  _native(input) {
    return this._readTx(() => {
      const scope = this._scope(input.goalRef, true),
        record = this._read(input.id, scope.actor);
      this._bound(record, scope, true);
      return record;
    });
  }
  listDrafts(input) {
    exact(input, ["goalRef", "id"], ["afterId"]);
    const record = this._native(input);
    return this._queue(record).list({
      goalRef: input.goalRef,
      ...(input.afterId === undefined ? {} : { afterId: input.afterId }),
    });
  }
  readDraft(input) {
    exact(input, ["goalRef", "id", "draftId"]);
    if (typeof input.draftId !== "string" || !DRAFT_ID.test(input.draftId))
      fail();
    const record = this._native(input),
      draft = this._queue(record).get({ id: input.draftId });
    this._draft(record, draft);
    return draft;
  }
  prepareDraft(input) {
    const draft = this.readDraft(input);
    const record = this._native(input);
    return this._queue(record).prepareDraft({ id: draft.id });
  }
  verifyIntentInTransaction(context) {
    this._required();
    exact(context, ["intent", "actor", "phase"]);
    const { draft } = readExtensionIntentBinding({
      db: this.db,
      intent: context.intent,
      actor: context.actor,
    });
    const binding = externalBinding(draft);
    if (!binding) return false;
    const { record } = this._assert(draft.proposal.goalRef, binding);
    this._draft(record, draft);
    return this._queue(record).verifyIntentInTransaction(context);
  }
  describeIntent(intentId) {
    return this._readTx(() => {
      const actor = this.workflow.adapter._actor(),
        intent = this.workflow._read(intentId, "intent", actor);
      if (!intent.extensionRef) return null;
      const { draft } = readExtensionIntentBinding({
        db: this.db,
        intent,
        actor,
      });
      const binding = externalBinding(draft);
      if (!binding) return null;
      const { record } = this._assert(draft.proposal.goalRef, binding);
      this._draft(record, draft);
      return {
        plugin: copy(record.plugin),
        declarationDigest: record.declarationDigest,
        grantId: record.id,
        epoch: record.epoch,
      };
    });
  }
}
module.exports = { ProjectGoalExternalDrafts };
