"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  goalExtensionRef,
  normalizeGoalExtensionProposal,
  GOAL_EXTENSION_ACTION_MAP,
} = require("./goal-extension-proposal-contract.js");
const {
  readExtensionDraft,
  createExtensionConversion,
  readExtensionConversion,
  conversionRef,
  assertConversionDraft,
  readExtensionIntentBinding,
} = require("./project-goal-extension-conversion.js");
const {
  MAX_DESCRIPTION_BYTES,
} = require("./task-description-action-service.js");
const MAX_BYTES = 48 * 1024;
const MAX_RECORDS = 100;
const SCHEMA = "chainlesschain.project-goal-extension-draft/v1";
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function same(a, b) {
  return digest(a) === digest(b);
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("GOAL_EXTENSION_INVALID_REQUEST");
}

/** Plugins enqueue pending drafts only. Trusted hosts can prepare native intents;
 * the queue has no execution port. Identity and synchronous live admission come
 * from the host, never from plugin declarations or serialized receipts. */
class ProjectGoalExtensionQueue {
  constructor({
    workflow,
    plugin,
    authorizeExtension,
    origin = "extension-suggestion",
    clock = Date.now,
  }) {
    exact(plugin, ["name", "scope", "version"]);
    if (
      ![plugin.name, plugin.version].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
      ) ||
      !["user", "project", "local", "desktop-builtin"].includes(plugin.scope) ||
      typeof authorizeExtension !== "function" ||
      typeof clock !== "function" ||
      !["extension-suggestion", "builtin-rule", "user-edited"].includes(
        origin,
      ) ||
      typeof workflow?.assertExtensionSourceInTransaction !== "function"
    )
      fail("GOAL_EXTENSION_HOST_REQUIRED");
    this.workflow = workflow;
    this.db = workflow.db;
    this.plugin = Object.freeze({ ...plugin });
    this.authorizeExtension = authorizeExtension;
    this.origin = origin;
    this.clock = clock;
    this._tx(() =>
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_extension_drafts (
      id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,goal_id TEXT NOT NULL,plugin_key TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_goal_extension_drafts_scope
      ON cc_project_goal_extension_drafts(actor_did,goal_id,plugin_key,id);
      CREATE TABLE IF NOT EXISTS cc_project_goal_extension_conversions (
        id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,content_digest TEXT NOT NULL);`),
    );
  }
  _tx(operation) {
    if (this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _scope(goalRef) {
    goalRef = goalExtensionRef(goalRef);
    const scope = this.workflow.assertExtensionGoalInTransaction(goalRef);
    return {
      ...scope,
      goalRef,
      plugin: this.plugin,
      type: "task.description.update",
    };
  }
  _admission(context) {
    const epoch = this.authorizeExtension(Object.freeze({ ...context }));
    if (typeof epoch !== "string" || !epoch || epoch.length > 256)
      fail("GOAL_EXTENSION_NOT_ADMITTED");
    return epoch;
  }
  _source(proposal, extensionResume = null, fresh = true) {
    // task.create requires a taskType contract; it is deliberately not admitted
    // by this pending-draft adapter until that contract is implemented.
    if (proposal.type !== "task.description.update")
      fail("GOAL_EXTENSION_UNSUPPORTED_ACTION");
    return this.workflow.assertExtensionSourceInTransaction({
      goalRef: proposal.goalRef,
      sourceRef: proposal.sourceRef,
      nativeActionType: GOAL_EXTENSION_ACTION_MAP[proposal.type],
      extensionResume,
      fresh,
    });
  }
  _read(id, actorDid) {
    return readExtensionDraft(this.db, id, actorDid, this.plugin, this.origin);
  }
  _conversion(record) {
    const row = this.db
      .prepare(
        "SELECT id FROM cc_project_goal_extension_conversions WHERE draft_id=? AND actor_did=?",
      )
      .get(record.id, record.actorDid);
    if (!row) return null;
    const conversion = readExtensionConversion(
      this.db,
      row.id,
      record.actorDid,
    );
    assertConversionDraft(conversion, record);
    return conversion;
  }
  _resume(record) {
    const conversion = this._conversion(record);
    return conversion ? conversionRef(conversion) : null;
  }
  _view(record) {
    const conversion = this._conversion(record);
    if (!conversion) return { ...record, conversion: null };
    const row = this.db
      .prepare(
        "SELECT id FROM cc_project_goal_workflow WHERE id=? AND kind='intent' AND actor_did=?",
      )
      .get(conversion.intentId, record.actorDid);
    let status = "preparing";
    if (row) {
      const intent = this.workflow._read(row.id, "intent", record.actorDid);
      readExtensionIntentBinding({
        db: this.db,
        intent,
        actor: record.actorDid,
      });
      status = intent.status;
    }
    return {
      ...record,
      conversion: {
        intentId: conversion.intentId,
        status,
        extensionRef: conversionRef(conversion),
      },
    };
  }
  _current(record, fresh = true) {
    const context = this._scope(record.proposal.goalRef);
    const epoch = this._admission(context);
    if (
      epoch !== record.admissionEpoch ||
      !same(
        this._source(record.proposal, this._resume(record), fresh),
        record.source,
      )
    )
      fail("GOAL_EXTENSION_SOURCE_CHANGED");
    return { context, epoch };
  }
  enqueue(raw) {
    return this._tx(() => this.enqueueInTransaction(raw));
  }
  /** Trusted native composition: adoption and pending draft commit atomically. */
  enqueueInTransaction(raw) {
    if (!this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_REQUIRED");
    const proposal = normalizeGoalExtensionProposal(raw);
    {
      const context = this._scope(proposal.goalRef),
        epoch = this._admission(context);
      const id = `goal-extension-${digest({
        actorDid: context.actorDid,
        plugin: this.plugin,
        goalRef: proposal.goalRef,
        requestId: proposal.requestId,
      }).slice(7)}`;
      const existing = this.db
        .prepare("SELECT 1 FROM cc_project_goal_extension_drafts WHERE id=?")
        .get(id);
      const prior = existing ? this._read(id, context.actorDid) : null;
      const source = this._source(proposal, prior ? this._resume(prior) : null);
      if (existing) {
        if (!same(prior.proposal, proposal))
          fail("GOAL_EXTENSION_REQUEST_CONFLICT");
        this._current(prior);
      } else {
        if (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts WHERE actor_did=? AND goal_id=? AND plugin_key=?",
            )
            .get(context.actorDid, proposal.goalRef.id, digest(this.plugin))
            .n >= MAX_RECORDS
        )
          fail("GOAL_EXTENSION_QUEUE_FULL");
        const record = {
          schema: SCHEMA,
          id,
          actorDid: context.actorDid,
          plugin: this.plugin,
          admissionEpoch: epoch,
          origin: this.origin,
          proposal,
          source,
          state: "pending-confirmation",
          createdAt: this.clock(),
          inputDigest: digest(proposal),
        };
        const body = JSON.stringify(record);
        if (
          !Number.isSafeInteger(record.createdAt) ||
          record.createdAt < 0 ||
          Buffer.byteLength(body, "utf8") > MAX_BYTES
        )
          fail("GOAL_EXTENSION_RECORD_LIMIT");
        this.db
          .prepare(
            "INSERT INTO cc_project_goal_extension_drafts VALUES (?,?,?,?,?,?)",
          )
          .run(
            id,
            context.actorDid,
            proposal.goalRef.id,
            digest(this.plugin),
            body,
            digest(record),
          );
      }
      if (
        !same(this._scope(proposal.goalRef), context) ||
        this._admission(context) !== epoch ||
        !same(
          this._source(
            proposal,
            this._resume(this._read(id, context.actorDid)),
          ),
          source,
        )
      )
        fail("GOAL_EXTENSION_SOURCE_CHANGED");
      return { proposalId: id, state: "pending-confirmation" };
    }
  }
  /** Trusted host operation. Plugins retain only enqueueFromGoalExtension. */
  prepareDraft(input) {
    exact(input, ["id"]);
    const { record, conversion } = this._tx(() => {
      const actor = this.workflow.adapter._actor(),
        record = this._read(input.id, actor);
      this._current(record);
      if (
        Buffer.byteLength(record.proposal.description, "utf8") >
        MAX_DESCRIPTION_BYTES
      )
        fail("GOAL_EXTENSION_NATIVE_DESCRIPTION_LIMIT");
      let conversion = this._conversion(record);
      if (!conversion) {
        conversion = createExtensionConversion(record, this.clock());
        this.db
          .prepare(
            "INSERT INTO cc_project_goal_extension_conversions VALUES (?,?,?,?,?)",
          )
          .run(
            conversion.id,
            actor,
            record.id,
            JSON.stringify(conversion),
            digest(conversion),
          );
      }
      this._current(record);
      return { record, conversion };
    });
    this.workflow.prepare({
      goalId: record.proposal.goalRef.id,
      proposalId: record.source.proposalId,
      expectedRevision: record.proposal.goalRef.revision,
      requestId: conversion.requestId,
      description: record.proposal.description,
      extensionRef: conversionRef(conversion),
    });
    return this.workflow.getIntent({ intentId: conversion.intentId });
  }
  verifyIntentInTransaction({ intent, actor, phase }) {
    const { draft } = readExtensionIntentBinding({
      db: this.db,
      intent,
      actor,
    });
    if (!same(draft.plugin, this.plugin) || draft.origin !== this.origin)
      return false;
    this._current(draft, phase !== "record");
    this._current(draft, phase !== "record");
    return true;
  }
  enqueueFromGoalExtension(context) {
    exact(context, [
      "plugin",
      "goalRef",
      "operation",
      "type",
      "sourceRef",
      "requestId",
      "title",
      "description",
      "state",
    ]);
    if (
      !same(context.plugin, this.plugin) ||
      context.operation !== "propose-action" ||
      context.state !== "pending-confirmation"
    )
      fail("GOAL_EXTENSION_INVALID_REQUEST");
    return this.enqueue(
      Object.fromEntries(
        [
          "type",
          "goalRef",
          "sourceRef",
          "requestId",
          "title",
          "description",
        ].map((key) => [key, context[key]]),
      ),
    );
  }
  get(input) {
    exact(input, ["id"]);
    return this._tx(() => {
      const actor = this.workflow.adapter._actor();
      const record = this._read(input.id, actor);
      this._current(record);
      this._current(record);
      return JSON.parse(JSON.stringify(this._view(record)));
    });
  }
  list(input) {
    if (
      !input ||
      Object.keys(input).some(
        (key) => !["goalRef", "limit", "afterId"].includes(key),
      )
    )
      fail("GOAL_EXTENSION_INVALID_REQUEST");
    const goalRef = goalExtensionRef(input.goalRef),
      limit = input.limit ?? 20;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      (input.afterId !== undefined &&
        !/^goal-extension-[a-f0-9]{64}$/u.test(input.afterId))
    )
      fail("GOAL_EXTENSION_INVALID_REQUEST");
    return this._tx(() => {
      const context = this._scope(goalRef),
        epoch = this._admission(context);
      const rows = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_extension_drafts WHERE actor_did=? AND goal_id=? AND plugin_key=? AND id>? ORDER BY id LIMIT ?",
        )
        .all(
          context.actorDid,
          goalRef.id,
          digest(this.plugin),
          input.afterId ?? "",
          limit + 1,
        );
      const entries = [];
      let unavailableCount = 0;
      for (const row of rows.slice(0, limit)) {
        const record = this._read(row.id, context.actorDid);
        try {
          this._current(record);
          entries.push(record);
        } catch (error) {
          if (error.code === "GOAL_EXTENSION_RECORD_CORRUPT") throw error;
          unavailableCount++;
        }
      }
      for (const record of entries) this._current(record);
      if (
        !same(this._scope(goalRef), context) ||
        this._admission(context) !== epoch
      )
        fail("GOAL_EXTENSION_SOURCE_CHANGED");
      if (!same(this._scope(goalRef), context))
        fail("GOAL_EXTENSION_SOURCE_CHANGED");
      return {
        entries: JSON.parse(
          JSON.stringify(entries.map((record) => this._view(record))),
        ),
        unavailableCount,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }
}
module.exports = { ProjectGoalExtensionQueue };
