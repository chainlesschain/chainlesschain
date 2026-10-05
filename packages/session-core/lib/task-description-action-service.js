"use strict";

const { randomUUID } = require("node:crypto");
const {
  createBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
  createBusinessActionRun,
  validateBusinessActionRun,
  digestBusinessObjectContent,
} = require("./business-object-contract");

const ACTION_TYPE = "task.update-description";
const SOURCE_KIND = "desktop.project-task";
const MAX_DESCRIPTION_BYTES = 8192;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(value)
  ) {
    fail("ACTION_INVALID_ID");
  }
  return value;
}

function description(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_DESCRIPTION_BYTES
  ) {
    fail("ACTION_INVALID_DESCRIPTION");
  }
  return value;
}

function validateRequest(value) {
  let request;
  try {
    request = validateBusinessActionRequest(value);
  } catch {
    fail("ACTION_INVALID_REQUEST");
  }
  if (
    request.actionType !== ACTION_TYPE ||
    request.actionVersion !== 1 ||
    request.target.type !== "Task" ||
    request.target.sourceKind !== SOURCE_KIND ||
    request.target.scope.kind !== "personal" ||
    Object.keys(request.input).length !== 1 ||
    !Object.hasOwn(request.input, "description")
  ) {
    fail("ACTION_UNSUPPORTED_REQUEST");
  }
  description(request.input.description);
  return request;
}

function snapshotReferences(task, project) {
  const projectSnapshot = {
    id: project.id,
    owner: project.user_id,
    status: project.status,
    updatedAt: project.updated_at,
    deleted: project.deleted ?? 0,
  };
  const scope = { kind: "personal", id: project.user_id };
  return {
    ref: createBusinessObjectRef({
      type: "Task",
      id: task.id,
      sourceKind: SOURCE_KIND,
      scope,
      version: digestBusinessObjectContent({ task, project: projectSnapshot }),
    }),
    projectRef: createBusinessObjectRef({
      type: "Project",
      id: project.id,
      sourceKind: "desktop.project-task-owner",
      scope,
      version: digestBusinessObjectContent(projectSnapshot),
    }),
  };
}

/** Offline request preparation only. Snapshot ownership is a claim; execution
 * always obtains identity and all canonical rows independently from the host. */
function createTaskDescriptionPreview(input) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    fail("ACTION_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "description,idempotencyKey,project,task"
  )
    fail("ACTION_INVALID_REQUEST");
  const { task, project } = input;
  if (
    !task ||
    !project ||
    task.project_id !== project.id ||
    typeof project.user_id !== "string" ||
    !project.user_id.startsWith("did:") ||
    (task.deleted != null && task.deleted !== 0) ||
    (project.deleted != null && project.deleted !== 0)
  )
    fail("ACTION_SOURCE_INVALID");
  if (
    task.org_id != null ||
    task.workspace_id != null ||
    project.org_id != null
  )
    fail("ACTION_ORGANIZATION_UNSUPPORTED");
  if (
    !["draft", "active"].includes(project.status) ||
    task.status !== "pending"
  )
    fail("ACTION_TARGET_NOT_EDITABLE");
  if (
    !Number.isSafeInteger(task.updated_at) ||
    !Number.isSafeInteger(project.updated_at)
  )
    fail("ACTION_SOURCE_INVALID");
  id(task.id);
  id(project.id);
  id(input.idempotencyKey);
  description(task.description);
  description(input.description);
  const { ref } = snapshotReferences(task, project);
  const request = createBusinessActionRequest({
    actionType: ACTION_TYPE,
    actionVersion: 1,
    target: ref,
    expectedVersion: ref.version,
    input: { description: input.description },
    idempotencyKey: input.idempotencyKey,
  });
  return Object.freeze({
    request,
    before: Object.freeze({ description: task.description }),
    after: request.input,
    authority: "unverified-snapshot",
  });
}

/**
 * Native SQLite implementation for a deliberately narrow personal-task action.
 * Authority comes from the host's current unlocked identity, never the request.
 * Organizations/workspaces are unsupported until their RBAC/workflow adapter is
 * available. Existing mutable project/task entrypoints are not replaced here.
 *
 * An admission receipt is durable before confirmation. No transaction spans an
 * await. Final ownership/version checks, mutation and success evidence commit in
 * one immediate transaction. Interrupted running receipts are never replayed.
 */
class TaskDescriptionActionService {
  constructor({ db, getActor, approvalGate, now = () => Date.now() } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ACTION_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof approvalGate?.decide !== "function"
    )
      fail("ACTION_AUTHORITY_UNAVAILABLE");
    this.db = db;
    this.getActor = getActor;
    this.approvalGate = approvalGate;
    this.now = now;
    this._transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_business_action_runs (
      id TEXT PRIMARY KEY,
      actor_did TEXT NOT NULL,
      target_id TEXT NOT NULL,
      idempotency_digest TEXT NOT NULL UNIQUE,
      invocation_digest TEXT NOT NULL,
      run_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    )`),
    );
  }

  _transaction(fn) {
    if (this.db.inTransaction) fail("ACTION_TRANSACTION_BUSY");
    return this.db.transaction(fn).immediate();
  }

  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("ACTION_AUTHORITY_UNAVAILABLE");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ACTION_AUTHENTICATION_REQUIRED");
    return id(actor);
  }

  _ownedTask(taskId, actor) {
    const task = this.db
      .prepare("SELECT * FROM project_tasks WHERE id=?")
      .get(id(taskId));
    if (!task || (task.deleted != null && task.deleted !== 0))
      fail("ACTION_NOT_FOUND_OR_DENIED");
    const project = this.db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(task.project_id);
    if (
      !project ||
      project.user_id !== actor ||
      (project.deleted != null && project.deleted !== 0)
    )
      fail("ACTION_NOT_FOUND_OR_DENIED");
    // The enterprise schema adds these columns; the baseline need not have them.
    if (
      task.org_id != null ||
      task.workspace_id != null ||
      project.org_id != null
    )
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
    const hasOrganizations = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_projects'",
      )
      .get();
    if (
      hasOrganizations &&
      this.db
        .prepare("SELECT 1 FROM organization_projects WHERE id=?")
        .get(project.id)
    )
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
    return { task, project };
  }

  _snapshot(taskId, actor, requireEditable = false) {
    const { task, project } = this._ownedTask(taskId, actor);
    if (
      requireEditable &&
      (!["draft", "active"].includes(project.status) ||
        task.status !== "pending")
    )
      fail("ACTION_TARGET_NOT_EDITABLE");
    if (
      !Number.isSafeInteger(task.updated_at) ||
      !Number.isSafeInteger(project.updated_at)
    )
      fail("ACTION_SOURCE_INVALID");
    description(task.description);
    let references;
    try {
      references = snapshotReferences(task, project);
    } catch {
      fail("ACTION_SOURCE_INVALID");
    }
    return { task, ...references };
  }

  getTask(taskId) {
    return this._transaction(() => {
      const snapshot = this._snapshot(taskId, this._actor());
      return {
        ref: snapshot.ref,
        description: snapshot.task.description,
        projectRef: snapshot.projectRef,
      };
    });
  }

  preview(input) {
    try {
      digestBusinessObjectContent(input);
    } catch {
      fail("ACTION_INVALID_REQUEST");
    }
    if (
      !input ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !==
        "description,idempotencyKey,taskId"
    )
      fail("ACTION_INVALID_REQUEST");
    description(input.description);
    id(input.idempotencyKey);
    return this._transaction(() => {
      const snapshot = this._snapshot(input.taskId, this._actor(), true);
      const request = createBusinessActionRequest({
        actionType: ACTION_TYPE,
        actionVersion: 1,
        target: snapshot.ref,
        expectedVersion: snapshot.ref.version,
        input: { description: input.description },
        idempotencyKey: input.idempotencyKey,
      });
      return Object.freeze({
        request,
        before: Object.freeze({ description: snapshot.task.description }),
        after: request.input,
      });
    });
  }

  _readRun(row) {
    try {
      const run = validateBusinessActionRun(JSON.parse(row.run_json));
      const evidence = JSON.parse(row.evidence_json);
      // Evidence must be exactly the records bound by the stored run, including
      // its host-observed actor and action binding. Never accept supplied proof.
      if (
        !Array.isArray(evidence) ||
        evidence.length !== run.evidenceRefs.length ||
        new Set(evidence.map((item) => item.id)).size !== evidence.length ||
        row.id !== run.id ||
        row.actor_did !== run.target.scope.id ||
        row.target_id !== run.target.id ||
        row.invocation_digest !== run.invocationDigest ||
        row.idempotency_digest !== run.idempotencyDigest
      )
        fail("ACTION_RECEIPT_CORRUPT");
      for (const item of evidence) {
        const reference = run.evidenceRefs.find((ref) => ref.id === item.id);
        if (
          !reference ||
          reference.digest !== digestBusinessObjectContent(item) ||
          item.actorDid !== row.actor_did ||
          item.invocationDigest !== run.invocationDigest
        )
          fail("ACTION_RECEIPT_CORRUPT");
      }
      const resolveEvidence = (reference) => {
        if (!reference) return null;
        if (
          !run.evidenceRefs.some(
            (item) =>
              item.id === reference.id && item.digest === reference.digest,
          )
        )
          fail("ACTION_RECEIPT_CORRUPT");
        return evidence.find((item) => item.id === reference.id);
      };
      const approval = resolveEvidence(run.approvalRef);
      const execution = resolveEvidence(run.executionRef);
      if (
        approval &&
        (approval.actionDigest !== run.actionDigest ||
          approval.expectedVersion !== run.expectedVersion)
      )
        fail("ACTION_RECEIPT_CORRUPT");
      if (
        run.status === "succeeded" &&
        (approval?.kind !== "local-user-confirmation" ||
          approval.decision !== "allow" ||
          approval.via !== "user-confirm" ||
          approval.policy !== "strict" ||
          approval.riskLevel !== "high" ||
          execution?.kind !== "sqlite-task-description-update" ||
          execution.affectedRows !== 1 ||
          execution.beforeVersion !== run.expectedVersion ||
          execution.afterVersion !== run.afterVersion)
      )
        fail("ACTION_RECEIPT_CORRUPT");
      return { run, evidence };
    } catch {
      fail("ACTION_RECEIPT_CORRUPT");
    }
  }

  getRun(runId) {
    return this._transaction(() => {
      const actor = this._actor();
      const row = this.db
        .prepare(
          "SELECT * FROM cc_business_action_runs WHERE id=? AND actor_did=?",
        )
        .get(id(runId), actor);
      if (!row) fail("ACTION_NOT_FOUND_OR_DENIED");
      this._ownedTask(row.target_id, actor);
      return this._readRun(row);
    });
  }

  _save(run, evidence, actor, insert = false) {
    if (insert) {
      this.db
        .prepare(
          `INSERT INTO cc_business_action_runs
        (id,actor_did,target_id,idempotency_digest,invocation_digest,run_json,evidence_json)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          run.id,
          actor,
          run.target.id,
          run.idempotencyDigest,
          run.invocationDigest,
          JSON.stringify(run),
          JSON.stringify(evidence),
        );
    } else {
      const saved = this.db
        .prepare(
          "UPDATE cc_business_action_runs SET run_json=?,evidence_json=? WHERE id=? AND actor_did=? AND invocation_digest=?",
        )
        .run(
          JSON.stringify(run),
          JSON.stringify(evidence),
          run.id,
          actor,
          run.invocationDigest,
        );
      if (saved.changes !== 1) fail("ACTION_RECEIPT_CONFLICT");
    }
  }

  async execute(input) {
    const request = validateRequest(input);
    const admitted = this._transaction(() => {
      const actor = this._actor();
      this._ownedTask(request.target.id, actor);
      if (request.target.scope.id !== actor) fail("ACTION_NOT_FOUND_OR_DENIED");
      const previous = this.db
        .prepare(
          "SELECT * FROM cc_business_action_runs WHERE idempotency_digest=?",
        )
        .get(request.idempotencyDigest);
      if (previous) {
        if (
          previous.actor_did !== actor ||
          previous.invocation_digest !== request.invocationDigest
        )
          fail("ACTION_IDEMPOTENCY_CONFLICT");
        return { previous: this._readRun(previous) };
      }
      const current = this._snapshot(request.target.id, actor, true);
      if (current.ref.version !== request.expectedVersion)
        fail("ACTION_VERSION_CONFLICT");
      const startedAt = new Date(this.now()).toISOString();
      const run = createBusinessActionRun({
        id: randomUUID(),
        request,
        status: "running",
        startedAt,
      });
      this._save(run, [], actor, true);
      return { actor, current, startedAt, runId: run.id };
    });
    if (admitted.previous)
      return {
        ...admitted.previous,
        replayed: true,
        executionState: ["queued", "running", "unknown"].includes(
          admitted.previous.run.status,
        )
          ? "unresolved"
          : "recorded",
      };

    const { actor, current, startedAt, runId } = admitted;
    let decision;
    try {
      decision = await this.approvalGate.decide(
        Object.freeze({
          sessionId: "business-actions",
          policy: "strict",
          riskLevel: "high",
          tool: ACTION_TYPE,
          request,
          actorDid: actor,
          before: Object.freeze({ description: current.task.description }),
          after: request.input,
        }),
      );
    } catch {
      decision = { decision: "deny", via: "confirm-error" };
    }
    const approved =
      decision?.decision === "allow" &&
      decision.via === "user-confirm" &&
      decision.policy === "strict" &&
      decision.riskLevel === "high" &&
      !decision.authorization;
    const cancelled =
      decision?.decision === "deny" &&
      decision.via === "user-deny" &&
      decision.policy === "strict" &&
      decision.riskLevel === "high" &&
      !decision.authorization;
    const vias = [
      "user-confirm",
      "user-deny",
      "no-confirmer",
      "confirm-error",
      "policy",
      "policy-store-error",
      "authorization-missing",
      "authorization-consumer-missing",
    ];
    const via = decision?.authorization
      ? "authorization-unconsumed"
      : vias.includes(decision?.via)
        ? decision.via
        : "invalid-decision";
    // No renderer input or serialized approval object can reach this receipt.
    const approval = {
      id: randomUUID(),
      kind:
        approved || cancelled
          ? "local-user-confirmation"
          : "approval-gate-decision",
      actorDid: actor,
      invocationDigest: request.invocationDigest,
      actionDigest: request.actionDigest,
      expectedVersion: request.expectedVersion,
      decision: approved ? "allow" : "deny",
      via,
      policy: "strict",
      riskLevel: "high",
      at: new Date(this.now()).toISOString(),
    };
    const approvalRef = {
      id: approval.id,
      digest: digestBusinessObjectContent(approval),
    };

    try {
      return this._transaction(() => {
        const currentActor = this._actor();
        if (currentActor !== actor) fail("ACTION_AUTHORITY_CHANGED");
        const latest = this._snapshot(request.target.id, actor, true);
        if (latest.ref.version !== request.expectedVersion)
          fail("ACTION_VERSION_CONFLICT");
        const row = this.db
          .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
          .get(runId);
        if (!row || this._readRun(row).run.status !== "running")
          fail("ACTION_RECEIPT_CONFLICT");
        const evidence = [approval];
        const evidenceRefs = [approvalRef];
        let afterVersion = null,
          executionRef = null;
        if (approved) {
          const updatedAt = Math.max(this.now(), latest.task.updated_at + 1);
          if (!Number.isSafeInteger(updatedAt)) fail("ACTION_SOURCE_INVALID");
          const result = this.db
            .prepare(
              "UPDATE project_tasks SET description=?,updated_at=?,sync_status='pending' WHERE id=? AND description=? AND updated_at=?",
            )
            .run(
              request.input.description,
              updatedAt,
              request.target.id,
              latest.task.description,
              latest.task.updated_at,
            );
          if (result.changes !== 1) fail("ACTION_VERSION_CONFLICT");
          const afterSnapshot = this._snapshot(request.target.id, actor);
          if (afterSnapshot.task.description !== request.input.description)
            fail("ACTION_POSTCONDITION_FAILED");
          afterVersion = afterSnapshot.ref.version;
          const execution = {
            id: randomUUID(),
            kind: "sqlite-task-description-update",
            actorDid: actor,
            invocationDigest: request.invocationDigest,
            beforeVersion: request.expectedVersion,
            afterVersion,
            affectedRows: result.changes,
            at: new Date(this.now()).toISOString(),
          };
          executionRef = {
            id: execution.id,
            digest: digestBusinessObjectContent(execution),
          };
          evidence.push(execution);
          evidenceRefs.push(executionRef);
        }
        const run = createBusinessActionRun({
          id: runId,
          request,
          status: approved ? "succeeded" : cancelled ? "cancelled" : "denied",
          startedAt,
          completedAt: new Date(this.now()).toISOString(),
          afterVersion,
          approvalRef,
          executionRef,
          evidenceRefs,
        });
        this._save(run, evidence, actor);
        return { run, evidence, replayed: false };
      });
    } catch (error) {
      // A changed identity/version is a known precondition failure before any
      // write. Other DB/commit errors retain running (unknown) and are not retried.
      if (
        [
          "ACTION_AUTHORITY_CHANGED",
          "ACTION_VERSION_CONFLICT",
          "ACTION_NOT_FOUND_OR_DENIED",
          "ACTION_TARGET_NOT_EDITABLE",
          "ACTION_ORGANIZATION_UNSUPPORTED",
          "ACTION_AUTHENTICATION_REQUIRED",
        ].includes(error.code)
      ) {
        this._transaction(() => {
          const row = this.db
            .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
            .get(runId);
          if (!row || this._readRun(row).run.status !== "running") return;
          const denied = createBusinessActionRun({
            id: runId,
            request,
            status: "denied",
            startedAt,
            completedAt: new Date(this.now()).toISOString(),
            approvalRef,
            evidenceRefs: [approvalRef],
          });
          this._save(denied, [approval], actor);
        });
        throw error;
      }
      fail("ACTION_OUTCOME_UNKNOWN");
    }
  }
}

module.exports = {
  TaskDescriptionActionService,
  createTaskDescriptionPreview,
  ACTION_TYPE,
  MAX_DESCRIPTION_BYTES,
};
