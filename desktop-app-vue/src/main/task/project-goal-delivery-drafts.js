"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
const {
  goalExtensionRef,
} = require("@chainlesschain/session-core/goal-extension-proposal-contract");
const {
  ProjectGoalExtensionQueue,
} = require("@chainlesschain/session-core/project-goal-extension-queue");
const PLUGIN = Object.freeze({
  name: "project-delivery-drafts",
  scope: "desktop-builtin",
  version: "0.1.0",
});
const CAPABILITY = "proposal:task.description.update";
const CAPABILITY_DIGEST = digest({
  plugin: PLUGIN,
  capabilities: [CAPABILITY],
  rule: "delivery-description-draft/v1",
});
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function fields(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("GOAL_EXTENSION_INVALID_REQUEST");
}

/** Fixed trusted native rule, independent from the CLI plugin trust store. */
class ProjectGoalDeliveryDrafts {
  constructor({ workflow, confirm, clock = Date.now }) {
    this.workflow = workflow;
    this.db = workflow.db;
    this.confirm = confirm;
    this._tx(() =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_builtin_grants (
      id TEXT PRIMARY KEY,record_json TEXT NOT NULL,content_digest TEXT NOT NULL);`),
    );
    this.queue = new ProjectGoalExtensionQueue({
      workflow,
      plugin: PLUGIN,
      origin: "builtin-rule",
      clock,
      authorizeExtension: (context) => {
        const scope = this._context(context.goalRef);
        if (
          scope.actorDid !== context.actorDid ||
          scope.projectId !== context.projectId ||
          context.type !== "task.description.update" ||
          digest(context.plugin) !== digest(PLUGIN)
        )
          return null;
        const grant = this._grant(scope);
        return grant.enabled ? `${grant.id}:${grant.epoch}` : null;
      },
    });
  }
  _tx(operation) {
    if (this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _context(ref) {
    if (!this.db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_REQUIRED");
    const goalRef = goalExtensionRef(ref),
      actorDid = this.workflow.adapter._actor();
    const goal = this.workflow._goal(goalRef.id, actorDid);
    if (
      goal.storeId !== goalRef.storeId ||
      goal.revision !== goalRef.revision ||
      goal.controlGeneration !== goalRef.controlGeneration
    )
      fail("GOAL_EXTENSION_SOURCE_CHANGED");
    return {
      goal,
      actorDid,
      storeId: goal.storeId,
      projectId: goal.projectRef.id,
      goalId: goal.id,
    };
  }
  _grant(scope) {
    const binding = {
      actorDid: scope.actorDid,
      storeId: scope.storeId,
      projectId: scope.projectId,
      goalId: scope.goalId,
      plugin: PLUGIN,
      capabilityDigest: CAPABILITY_DIGEST,
    };
    const id = digest(binding),
      row = this.db
        .prepare(
          "SELECT CASE WHEN length(CAST(record_json AS BLOB))<=4096 THEN record_json ELSE NULL END AS record_json,content_digest FROM cc_project_goal_builtin_grants WHERE id=?",
        )
        .get(id);
    if (!row) return { id, ...binding, epoch: 0, enabled: false };
    try {
      if (
        typeof row.record_json !== "string" ||
        Buffer.byteLength(row.record_json, "utf8") > 4096
      )
        throw 0;
      const grant = JSON.parse(row.record_json);
      fields(grant, ["id", ...Object.keys(binding), "epoch", "enabled"]);
      if (
        digest(grant) !== row.content_digest ||
        grant.id !== id ||
        Object.keys(binding).some(
          (key) => digest(grant[key]) !== digest(binding[key]),
        ) ||
        !Number.isSafeInteger(grant.epoch) ||
        grant.epoch < 1 ||
        typeof grant.enabled !== "boolean"
      )
        throw 0;
      return grant;
    } catch {
      fail("GOAL_EXTENSION_GRANT_CORRUPT");
    }
  }
  status(input) {
    fields(input, ["goalRef"]);
    return this._tx(() => {
      const scope = this._context(input.goalRef),
        grant = this._grant(scope);
      const savedCount = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts WHERE actor_did=? AND goal_id=? AND plugin_key=?",
        )
        .get(scope.actorDid, scope.goalId, digest(PLUGIN)).n;
      this._context(input.goalRef);
      return {
        plugin: PLUGIN,
        capability: CAPABILITY,
        enabled: grant.enabled,
        epoch: grant.epoch,
        savedCount,
      };
    });
  }
  async configure(input) {
    fields(input, ["goalRef", "expectedEpoch", "enabled"]);
    if (
      !Number.isSafeInteger(input.expectedEpoch) ||
      input.expectedEpoch < 0 ||
      typeof input.enabled !== "boolean"
    )
      fail("GOAL_EXTENSION_INVALID_REQUEST");
    // Copy before a native dialog; callers cannot change the pending request.
    const goalRef = goalExtensionRef(input.goalRef),
      expectedEpoch = input.expectedEpoch,
      enabled = input.enabled;
    const before = this._tx(() => {
      const scope = this._context(goalRef),
        grant = this._grant(scope);
      if (grant.epoch !== expectedEpoch) fail("GOAL_EXTENSION_GRANT_CONFLICT");
      if (
        enabled &&
        (scope.goal.status !== "active" ||
          !scope.goal.allowedActionTypes.includes("task.update-description"))
      )
        fail("GOAL_EXTENSION_ACTION_OUT_OF_SCOPE");
      if (enabled) this.workflow.assertExtensionGoalInTransaction(goalRef);
      return { scope, grant };
    });
    if (before.grant.enabled === enabled) return this.status({ goalRef });
    if (enabled) {
      if (typeof this.confirm !== "function")
        fail("GOAL_EXTENSION_CONFIRMATION_REQUIRED");
      const allowed = await this.confirm({
        goal: before.scope.goal,
        actorDid: before.scope.actorDid,
        plugin: PLUGIN,
        capability: CAPABILITY,
      });
      this._tx(() => this._context(goalRef));
      if (allowed !== true) return this.status({ goalRef });
    }
    this._tx(() => {
      const scope = this._context(goalRef),
        grant = this._grant(scope);
      if (enabled) this.workflow.assertExtensionGoalInTransaction(goalRef);
      if (
        scope.actorDid !== before.scope.actorDid ||
        digest(grant) !== digest(before.grant)
      )
        fail("GOAL_EXTENSION_GRANT_CONFLICT");
      if (grant.epoch >= Number.MAX_SAFE_INTEGER)
        fail("GOAL_EXTENSION_GRANT_CONFLICT");
      const next = { ...grant, enabled, epoch: grant.epoch + 1 };
      this.db
        .prepare(
          "INSERT INTO cc_project_goal_builtin_grants VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest",
        )
        .run(next.id, JSON.stringify(next), digest(next));
      this._context(goalRef);
    });
    return this.status({ goalRef });
  }
  propose(input) {
    fields(input, ["goalRef", "sourceRef", "requestId"]);
    return this.queue.enqueue({
      type: "task.description.update",
      goalRef: input.goalRef,
      sourceRef: input.sourceRef,
      requestId: input.requestId,
      title: "跟进交付风险",
      description:
        "请核对当前风险证据、截止时间与直接依赖，记录后续处理安排。保存任务说明不会自动修正截止时间、解除阻塞或证明目标已完成。",
    });
  }
  list(input) {
    return this.queue.list(input);
  }
  read(input) {
    return this.queue.get(input);
  }
  prepare(input) {
    return this.queue.prepareDraft(input);
  }
}
module.exports = { ProjectGoalDeliveryDrafts, PLUGIN, CAPABILITY };
