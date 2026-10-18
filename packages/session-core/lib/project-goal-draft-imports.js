"use strict";
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const { goalExtensionRef } = require("./goal-extension-proposal-contract.js");
const {
  validateGoalDraftRequest,
} = require("./goal-draft-request-contract.js");
const {
  ProjectGoalExtensionQueue,
} = require("./project-goal-extension-queue.js");
const {
  readExtensionIntentBinding,
} = require("./project-goal-extension-conversion.js");
// Native importer identity. The request's declared plugin is untrusted metadata.
const IMPORT_PLUGIN = Object.freeze({
  name: "native-imported-description",
  scope: "desktop-builtin",
  version: "0.1.0",
});
const same = (a, b) => digest(a) === digest(b);
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("GOAL_DRAFT_IMPORT_INVALID");
}
function identity(actorDid, proposal) {
  return `native-adoption-${digest({ actorDid, storeId: proposal.goalRef.storeId, goalId: proposal.goalRef.id, requestId: proposal.requestId }).slice(7)}`;
}
function draftId(actorDid, proposal) {
  return `goal-extension-${digest({ actorDid, plugin: IMPORT_PLUGIN, goalRef: proposal.goalRef, requestId: proposal.requestId }).slice(7)}`;
}
class ProjectGoalDraftImports {
  constructor({ workflow, confirm, clock = Date.now }) {
    this.workflow = workflow;
    this.db = workflow.db;
    this.confirm = confirm;
    this.clock = clock;
    this.queues = new Map();
    this._tx(() =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_draft_imports (
      id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,goal_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_goal_draft_imports_scope ON cc_project_goal_draft_imports(actor_did,goal_id,id);`),
    );
    this.baseQueue = new ProjectGoalExtensionQueue({
      workflow,
      plugin: IMPORT_PLUGIN,
      origin: "user-edited",
      clock,
      authorizeExtension: () => null,
    });
  }
  _tx(fn) {
    if (this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_BUSY");
    return this.db.transaction(fn).immediate();
  }
  _scope(raw, live = false) {
    const ref = goalExtensionRef(raw),
      actor = this.workflow.adapter._actor(),
      goal = this.workflow._goal(ref.id, actor);
    if (
      goal.storeId !== ref.storeId ||
      goal.revision !== ref.revision ||
      goal.controlGeneration !== ref.controlGeneration
    )
      fail("GOAL_DRAFT_IMPORT_SOURCE_CHANGED");
    if (live) this.workflow.assertExtensionGoalInTransaction(ref);
    return { actor, goal, ref };
  }
  _read(id, actor) {
    if (typeof id !== "string" || !/^native-adoption-[a-f0-9]{64}$/u.test(id))
      fail("GOAL_DRAFT_IMPORT_INVALID");
    const row = this.db
      .prepare(
        "SELECT actor_did,goal_id,draft_id,CASE WHEN length(CAST(record_json AS BLOB))<=24576 THEN record_json END AS body,content_digest FROM cc_project_goal_draft_imports WHERE id=? AND actor_did=?",
      )
      .get(id, actor);
    if (!row) fail("GOAL_DRAFT_IMPORT_NOT_FOUND");
    try {
      const record = JSON.parse(row.body);
      exact(record, [
        "id",
        "actorDid",
        "goalId",
        "draftId",
        "envelope",
        "enabled",
        "epoch",
        "adoptedAt",
      ]);
      const envelope = validateGoalDraftRequest(record.envelope);
      if (
        record.id !== id ||
        record.id !== identity(actor, envelope.proposal) ||
        record.actorDid !== actor ||
        row.actor_did !== actor ||
        record.goalId !== row.goal_id ||
        record.goalId !== envelope.proposal.goalRef.id ||
        record.draftId !== row.draft_id ||
        record.draftId !== draftId(actor, envelope.proposal) ||
        !same(envelope, record.envelope) ||
        digest(record) !== row.content_digest ||
        typeof record.enabled !== "boolean" ||
        !Number.isSafeInteger(record.epoch) ||
        record.epoch < 1 ||
        !Number.isSafeInteger(record.adoptedAt) ||
        record.adoptedAt < 0
      )
        throw 0;
      return record;
    } catch {
      fail("GOAL_DRAFT_IMPORT_CORRUPT");
    }
  }
  _queue(id) {
    if (!this.queues.has(id)) {
      const queue = Object.create(this.baseQueue);
      queue.authorizeExtension = (context) => {
        const record = this._read(id, context.actorDid);
        if (
          !record.enabled ||
          !same(context.plugin, IMPORT_PLUGIN) ||
          !same(context.goalRef, record.envelope.proposal.goalRef) ||
          context.type !== "task.description.update"
        )
          return null;
        return `${record.id}:${record.epoch}`;
      };
      this.queues.set(id, queue);
    }
    return this.queues.get(id);
  }
  _assertDraft(record, draft) {
    if (
      draft.id !== record.draftId ||
      draft.actorDid !== record.actorDid ||
      draft.origin !== "user-edited" ||
      !same(draft.plugin, IMPORT_PLUGIN) ||
      !same(draft.proposal, record.envelope.proposal) ||
      draft.inputDigest !== digest(record.envelope.proposal) ||
      draft.admissionEpoch !== `${record.id}:${record.epoch}` ||
      !record.enabled
    )
      fail("GOAL_DRAFT_IMPORT_NOT_ADOPTED");
  }
  _saved(record) {
    const row = this.db
      .prepare(
        "SELECT id FROM cc_project_goal_extension_drafts WHERE id=? AND actor_did=?",
      )
      .get(record.draftId, record.actorDid);
    if (!row) fail("GOAL_DRAFT_IMPORT_CORRUPT");
    const {
      readExtensionDraft,
    } = require("./project-goal-extension-conversion.js");
    const draft = readExtensionDraft(
      this.db,
      record.draftId,
      record.actorDid,
      IMPORT_PLUGIN,
      "user-edited",
    );
    // Revocation retains the immutable saved draft and its previous epoch.
    if (
      !same(draft.proposal, record.envelope.proposal) ||
      draft.inputDigest !== digest(record.envelope.proposal) ||
      draft.admissionEpoch !== `${record.id}:1`
    )
      fail("GOAL_DRAFT_IMPORT_CORRUPT");
    return draft;
  }
  _view(record, available = false) {
    return {
      id: record.id,
      draftId: record.draftId,
      declaredPlugin: record.envelope.declaredPlugin,
      requestId: record.envelope.proposal.requestId,
      title: record.envelope.proposal.title,
      contentDigest: record.envelope.contentDigest,
      enabled: record.enabled,
      epoch: record.epoch,
      available,
      state: record.enabled ? "saved" : "revoked",
    };
  }
  async adopt(input) {
    exact(input, ["goalRef", "envelope"]);
    const ref = goalExtensionRef(input.goalRef),
      envelope = validateGoalDraftRequest(input.envelope);
    const before = this._tx(() => {
      const scope = this._scope(ref),
        id = identity(scope.actor, envelope.proposal);
      const exists = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_draft_imports WHERE id=? AND actor_did=?",
        )
        .get(id, scope.actor);
      if (exists) {
        const record = this._read(id, scope.actor);
        if (!same(record.envelope, envelope))
          fail("GOAL_DRAFT_IMPORT_REQUEST_CONFLICT");
        this._saved(record);
        return { prior: record };
      }
      if (!same(ref, envelope.proposal.goalRef))
        fail("GOAL_DRAFT_IMPORT_SOURCE_CHANGED");
      this._scope(ref, true);
      const source = this.workflow.assertExtensionSourceInTransaction({
        goalRef: ref,
        sourceRef: envelope.proposal.sourceRef,
        nativeActionType: "task.update-description",
      });
      return { scope, id, source };
    });
    if (before.prior) return this.status({ goalRef: ref, id: before.prior.id });
    if (typeof this.confirm !== "function")
      fail("GOAL_DRAFT_IMPORT_CONFIRMATION_REQUIRED");
    // The copy displayed here is also the only copy saved after confirmation.
    const confirmed = await this.confirm(
      JSON.parse(
        JSON.stringify({
          goal: before.scope.goal,
          actorDid: before.scope.actor,
          envelope,
        }),
      ),
    );
    if (confirmed !== true) {
      this._tx(() => this._scope(ref));
      return { state: "cancelled" };
    }
    const queue = this._queue(before.id);
    this._tx(() => {
      const scope = this._scope(ref, true);
      if (
        scope.actor !== before.scope.actor ||
        !same(
          this.workflow.assertExtensionSourceInTransaction({
            goalRef: ref,
            sourceRef: envelope.proposal.sourceRef,
            nativeActionType: "task.update-description",
          }),
          before.source,
        )
      )
        fail("GOAL_DRAFT_IMPORT_SOURCE_CHANGED");
      const exists = this.db
        .prepare("SELECT id FROM cc_project_goal_draft_imports WHERE id=?")
        .get(before.id);
      if (exists) {
        const record = this._read(before.id, scope.actor);
        if (!record.enabled || !same(record.envelope, envelope))
          fail("GOAL_DRAFT_IMPORT_REQUEST_CONFLICT");
        this._saved(record);
        return;
      }
      if (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM cc_project_goal_draft_imports WHERE actor_did=? AND goal_id=?",
          )
          .get(scope.actor, ref.id).n >= 100
      )
        fail("GOAL_DRAFT_IMPORT_LIMIT");
      const record = {
        id: before.id,
        actorDid: scope.actor,
        goalId: ref.id,
        draftId: draftId(scope.actor, envelope.proposal),
        envelope,
        enabled: true,
        epoch: 1,
        adoptedAt: this.clock(),
      };
      if (!Number.isSafeInteger(record.adoptedAt) || record.adoptedAt < 0)
        fail("GOAL_DRAFT_IMPORT_INVALID");
      this.db
        .prepare(
          "INSERT INTO cc_project_goal_draft_imports VALUES (?,?,?,?,?,?)",
        )
        .run(
          record.id,
          record.actorDid,
          record.goalId,
          record.draftId,
          JSON.stringify(record),
          digest(record),
        );
      const saved = queue.enqueueInTransaction(envelope.proposal);
      if (saved.proposalId !== record.draftId)
        fail("GOAL_DRAFT_IMPORT_CORRUPT");
      this._assertDraft(record, this._saved(record));
      this._scope(ref, true);
    });
    return this.status({ goalRef: ref, id: before.id });
  }
  status(input) {
    exact(input, ["goalRef", "id"]);
    const record = this._tx(() => {
      const scope = this._scope(input.goalRef),
        record = this._read(input.id, scope.actor);
      if (record.goalId !== scope.ref.id) fail("GOAL_DRAFT_IMPORT_NOT_FOUND");
      this._saved(record);
      return record;
    });
    let available = false;
    try {
      const draft = this._queue(record.id).get({ id: record.draftId });
      this._assertDraft(record, draft);
      available = true;
    } catch (error) {
      if (/CORRUPT/u.test(error.code || "")) throw error;
    }
    this._tx(() => this._scope(input.goalRef));
    return this._view(record, available);
  }
  list(input) {
    exact(
      input,
      input.afterId === undefined ? ["goalRef"] : ["goalRef", "afterId"],
    );
    if (
      input.afterId !== undefined &&
      !/^native-adoption-[a-f0-9]{64}$/u.test(input.afterId)
    )
      fail("GOAL_DRAFT_IMPORT_INVALID");
    const rows = this._tx(() => {
      const scope = this._scope(input.goalRef);
      return this.db
        .prepare(
          "SELECT id FROM cc_project_goal_draft_imports WHERE actor_did=? AND goal_id=? AND id>? ORDER BY id LIMIT 21",
        )
        .all(scope.actor, scope.ref.id, input.afterId || "");
    });
    return {
      entries: rows
        .slice(0, 20)
        .map((row) => this.status({ goalRef: input.goalRef, id: row.id })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  read(input) {
    exact(input, ["goalRef", "id"]);
    const record = this._tx(() => {
      const scope = this._scope(input.goalRef);
      const record = this._read(input.id, scope.actor);
      if (record.goalId !== scope.ref.id) fail("GOAL_DRAFT_IMPORT_NOT_FOUND");
      return record;
    });
    const draft = this._queue(record.id).get({ id: record.draftId });
    this._assertDraft(record, draft);
    return { ...this.status(input), draft };
  }
  prepare(input) {
    const value = this.read(input);
    return this._queue(value.id).prepareDraft({ id: value.draftId });
  }
  describeIntent(intentId) {
    return this._tx(() => {
      const actor = this.workflow.adapter._actor(),
        intent = this.workflow._read(intentId, "intent", actor);
      if (!intent.extensionRef) return null;
      const { draft } = readExtensionIntentBinding({
        db: this.db,
        intent,
        actor,
      });
      if (!same(draft.plugin, IMPORT_PLUGIN) || draft.origin !== "user-edited")
        return null;
      const record = this._read(identity(actor, draft.proposal), actor);
      if (!same(record.envelope.proposal, draft.proposal))
        fail("GOAL_DRAFT_IMPORT_CORRUPT");
      return {
        declaredPlugin: record.envelope.declaredPlugin,
        contentDigest: record.envelope.contentDigest,
      };
    });
  }
  revoke(input) {
    exact(input, ["goalRef", "id", "expectedEpoch"]);
    if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1)
      fail("GOAL_DRAFT_IMPORT_INVALID");
    this._tx(() => {
      const scope = this._scope(input.goalRef),
        record = this._read(input.id, scope.actor);
      if (record.goalId !== scope.ref.id) fail("GOAL_DRAFT_IMPORT_NOT_FOUND");
      if (record.epoch !== input.expectedEpoch)
        fail("GOAL_DRAFT_IMPORT_CONFLICT");
      if (record.enabled) {
        record.enabled = false;
        record.epoch++;
        this.db
          .prepare(
            "UPDATE cc_project_goal_draft_imports SET record_json=?,content_digest=? WHERE id=?",
          )
          .run(JSON.stringify(record), digest(record), record.id);
      }
      this._scope(input.goalRef);
    });
    return this.status({ goalRef: input.goalRef, id: input.id });
  }
  verifyIntentInTransaction(context) {
    const { draft } = readExtensionIntentBinding({
      db: this.db,
      intent: context.intent,
      actor: context.actor,
    });
    if (!same(draft.plugin, IMPORT_PLUGIN) || draft.origin !== "user-edited")
      return false;
    const id = identity(context.actor, draft.proposal),
      record = this._read(id, context.actor);
    this._assertDraft(record, draft);
    return this._queue(id).verifyIntentInTransaction(context);
  }
}
module.exports = {
  ProjectGoalDraftImports,
  IMPORT_PLUGIN,
  readExtensionIntentBinding,
};
