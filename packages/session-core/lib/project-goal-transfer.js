"use strict";

const crypto = require("node:crypto");
const { SqliteProjectGoalAdapter } = require("./project-goal-service.js");
const {
  createGoalRecord,
  validateGoalRecord,
  upgradeLegacyGoal,
  goalError,
} = require("./goal-contract.js");
const {
  digestBusinessObjectContent,
} = require("./business-object-contract.js");
const {
  TARGET_SCHEMA,
  validateGoalImportTarget,
  validateGoalTransfer,
  rawDigest,
  signGoalTransferCancellation,
  verifyGoalTransferCancellation,
} = require("./goal-transfer-contract.js");

function request(input, keys) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    throw goalError("GOAL_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(input, k))
  )
    throw goalError("GOAL_INVALID_REQUEST");
}

/** Native personal-project handoff journal. Goal + backup + ID mapping commit
 * in one transaction. The CLI remains frozen until this host durably cancels
 * the target and signs a receipt; timeouts never authorize source restoration. */
class ProjectGoalTransferService {
  constructor({ db, getActor, clock = Date.now }) {
    this.db = db;
    this.adapter = new SqliteProjectGoalAdapter({ db, getActor });
    this.clock = clock;
    this.adapter._transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_transfers (
      id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,project_id TEXT NOT NULL,
      record_json TEXT NOT NULL,record_digest TEXT NOT NULL,private_key TEXT NOT NULL,source_key TEXT UNIQUE);
      CREATE INDEX IF NOT EXISTS idx_cc_goal_transfers_scope ON cc_project_goal_transfers(actor_did,project_id,id);`),
    );
  }
  _save(record, privateKey = null) {
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, "utf8") > 196608)
      throw goalError("GOAL_TRANSFER_INVALID");
    const sourceKey =
      record.state === "imported" ? this._sourceKey(record.transfer) : null;
    if (privateKey !== null)
      this.db
        .prepare("INSERT INTO cc_project_goal_transfers VALUES (?,?,?,?,?,?,?)")
        .run(
          record.target.id,
          record.target.ownerRef,
          record.target.projectRef.id,
          body,
          rawDigest(body),
          privateKey,
          sourceKey,
        );
    else if (
      this.db
        .prepare(
          "UPDATE cc_project_goal_transfers SET record_json=?,record_digest=?,source_key=? WHERE id=? AND actor_did=?",
        )
        .run(
          body,
          rawDigest(body),
          sourceKey,
          record.target.id,
          record.target.ownerRef,
        ).changes !== 1
    )
      throw goalError("GOAL_TRANSFER_CONFLICT");
  }
  _sourceKey(transfer) {
    return digestBusinessObjectContent({
      storeId: transfer.source.storeId,
      id: transfer.source.id,
    });
  }
  _read(id, actor) {
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(id)
    )
      throw goalError("GOAL_INVALID_ID");
    const row = this.db
      .prepare(
        `SELECT actor_did,project_id,record_digest,source_key,
      CASE WHEN length(CAST(record_json AS BLOB))<=196608 THEN record_json END AS body
      FROM cc_project_goal_transfers WHERE id=? AND actor_did=?`,
      )
      .get(id, actor);
    if (!row) throw goalError("GOAL_NOT_FOUND_OR_DENIED");
    this.adapter._project(row.project_id, actor);
    let record;
    try {
      if (
        typeof row.body !== "string" ||
        rawDigest(row.body) !== row.record_digest
      )
        throw new Error();
      record = JSON.parse(row.body);
      const target = validateGoalImportTarget(record.target);
      if (
        target.id !== id ||
        target.ownerRef !== actor ||
        target.projectRef.id !== row.project_id ||
        target.storeId !== this.adapter.storeId ||
        !["prepared", "imported", "cancelled"].includes(record.state)
      )
        throw new Error();
      if (record.transfer !== null) {
        const transfer = validateGoalTransfer(record.transfer);
        if (
          digestBusinessObjectContent(transfer.target) !==
          digestBusinessObjectContent(target)
        )
          throw new Error();
      }
      if (
        record.state === "imported" &&
        (!record.transfer ||
          typeof record.goalId !== "string" ||
          !/^sha256:[a-f0-9]{64}$/u.test(record.goalDigest))
      )
        throw new Error();
      if (
        row.source_key !==
        (record.state === "imported" ? this._sourceKey(record.transfer) : null)
      )
        throw new Error();
      if (record.state === "cancelled")
        verifyGoalTransferCancellation(record.cancellation, target);
    } catch {
      throw goalError("GOAL_TRANSFER_RECORD_CORRUPT");
    }
    return record;
  }
  _view(record) {
    return {
      target: record.target,
      state: record.state,
      source: record.transfer?.source ?? null,
      backupDigest: record.transfer?.backupDigest ?? null,
      goalRef:
        record.goalId === null
          ? null
          : { storeId: this.adapter.storeId, id: record.goalId },
      cancellation: record.cancellation,
    };
  }
  prepare(input) {
    request(input, ["projectId", "requestId"]);
    if (
      typeof input.requestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(input.requestId)
    )
      throw goalError("GOAL_INVALID_ID");
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor(),
        project = this.adapter._project(input.projectId, actor);
      if (!["draft", "active"].includes(project.status))
        throw goalError("GOAL_PROJECT_NOT_ACTIVE");
      if (
        this.db
          .prepare("SELECT 1 FROM cc_project_goal_transfers WHERE id=?")
          .get(input.requestId)
      ) {
        const record = this._read(input.requestId, actor);
        if (
          record.target.projectRef.id !== project.id ||
          record.state !== "prepared"
        )
          throw goalError("GOAL_TRANSFER_CONFLICT");
        return this._view(record);
      }
      if (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM cc_project_goal_transfers WHERE actor_did=?",
          )
          .get(actor).n >= 1000
      )
        throw goalError("GOAL_TRANSFER_CAPACITY");
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519"),
        at = this.clock();
      const target = validateGoalImportTarget({
        schema: TARGET_SCHEMA,
        id: input.requestId,
        storeId: this.adapter.storeId,
        ownerRef: actor,
        projectRef: this.adapter._projectRef(project, actor),
        publicKey: publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
        createdAt: new Date(at).toISOString(),
        expiresAt: new Date(at + 86400000).toISOString(),
      });
      const record = {
        target,
        state: "prepared",
        transfer: null,
        goalId: null,
        goalDigest: null,
        cancellation: null,
      };
      this._save(record, privateKey.export({ type: "pkcs8", format: "pem" }));
      return this._view(record);
    });
  }
  status(input) {
    request(input, ["targetId"]);
    return this.adapter._transaction(() =>
      this._view(this._read(input.targetId, this.adapter._actor())),
    );
  }
  list(input) {
    request(input, ["projectId", "afterId"]);
    if (typeof input.afterId !== "string" || input.afterId.length > 256)
      throw goalError("GOAL_INVALID_ID");
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor();
      this.adapter._project(input.projectId, actor);
      return this.db
        .prepare(
          "SELECT id FROM cc_project_goal_transfers WHERE actor_did=? AND project_id=? AND id>? ORDER BY id LIMIT 20",
        )
        .all(actor, input.projectId, input.afterId)
        .map(({ id }) => this._view(this._read(id, actor)));
    });
  }
  importTransfer(input) {
    const transfer = validateGoalTransfer(input);
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor(),
        record = this._read(transfer.target.id, actor);
      if (
        digestBusinessObjectContent(record.target) !==
        digestBusinessObjectContent(transfer.target)
      )
        throw goalError("GOAL_TRANSFER_TARGET_MISMATCH");
      if (record.state === "cancelled")
        throw goalError("GOAL_TRANSFER_CANCELLED");
      if (record.state === "imported") {
        if (record.transfer.digest !== transfer.digest)
          throw goalError("GOAL_TRANSFER_CONFLICT");
        const goal = this.adapter._read(record.goalId, actor);
        if (!goal) throw goalError("GOAL_TRANSFER_RECORD_CORRUPT");
        return { ...this._view(record), goal };
      }
      const project = this.adapter._project(record.target.projectRef.id, actor);
      if (
        !["draft", "active"].includes(project.status) ||
        this.adapter._projectRef(project, actor).version !==
          record.target.projectRef.version
      )
        throw goalError("GOAL_PROJECT_VERSION_CONFLICT");
      const stamp = new Date(this.clock()).toISOString();
      if (stamp < record.target.createdAt || stamp >= record.target.expiresAt)
        throw goalError("GOAL_TRANSFER_TARGET_EXPIRED");
      const source = upgradeLegacyGoal(
        JSON.parse(transfer.backup),
        transfer.source.storeId,
      );
      if (
        this.db
          .prepare("SELECT 1 FROM cc_project_goal_transfers WHERE source_key=?")
          .get(this._sourceKey(transfer))
      )
        throw goalError("GOAL_TRANSFER_SOURCE_ALREADY_IMPORTED");
      const base = createGoalRecord({
        storeId: this.adapter.storeId,
        ownerRef: actor,
        projectRef: record.target.projectRef,
        title: source.title,
        objective: source.objective,
        keyResults: source.keyResults,
        createdAt: stamp,
        acceptanceCriteria: source.acceptanceCriteria,
        budgetPolicy: source.budgetPolicy,
        expiresAt: source.expiresAt,
      });
      // Historical claims and permissions are retained only in the backup.
      // New project identity starts paused, with no triggers, grants or proofs.
      const goal = validateGoalRecord({
        ...base,
        status: "paused",
        progress: source.progress,
        notes: source.notes,
      });
      if (this.adapter._actor() !== actor)
        throw goalError("GOAL_IDENTITY_CHANGED");
      this.adapter._project(project.id, actor);
      this.db
        .prepare("INSERT INTO cc_project_goals VALUES (?,?,?,?,?)")
        .run(goal.id, actor, project.id, goal.revision, JSON.stringify(goal));
      record.transfer = transfer;
      record.state = "imported";
      record.goalId = goal.id;
      record.goalDigest = digestBusinessObjectContent(goal);
      this._save(record);
      return { ...this._view(record), goal };
    });
  }
  cancel(input) {
    request(input, ["targetId"]);
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor(),
        record = this._read(input.targetId, actor);
      if (record.state === "cancelled") return this._view(record);
      if (record.state === "imported") {
        const goal = this.adapter._read(record.goalId, actor);
        if (
          !goal ||
          goal.revision !== 1 ||
          digestBusinessObjectContent(goal) !== record.goalDigest
        )
          throw goalError("GOAL_TRANSFER_ROLLBACK_HAS_CHANGES");
        // Never restore over new project activity, including future extensions
        // which persist a goal_id without changing the goal's revision.
        for (const { name } of this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'cc_project_goal_*'",
          )
          .all()) {
          if (!/^[a-z0-9_]+$/u.test(name))
            throw goalError("GOAL_TRANSFER_ROLLBACK_HAS_CHANGES");
          const columns = this.db.prepare(`PRAGMA table_info("${name}")`).all();
          if (
            columns.some((c) => c.name === "goal_id") &&
            this.db
              .prepare(`SELECT 1 FROM "${name}" WHERE goal_id=? LIMIT 1`)
              .get(goal.id)
          )
            throw goalError("GOAL_TRANSFER_ROLLBACK_HAS_CHANGES");
        }
        if (
          this.db
            .prepare(
              "DELETE FROM cc_project_goals WHERE id=? AND actor_did=? AND revision=1",
            )
            .run(goal.id, actor).changes !== 1
        )
          throw goalError("GOAL_TRANSFER_CONFLICT");
      }
      const key = this.db
        .prepare(
          "SELECT private_key FROM cc_project_goal_transfers WHERE id=? AND actor_did=?",
        )
        .get(input.targetId, actor).private_key;
      record.cancellation = signGoalTransferCancellation(
        record.target,
        key,
        new Date(this.clock()).toISOString(),
      );
      verifyGoalTransferCancellation(record.cancellation, record.target);
      if (this.adapter._actor() !== actor)
        throw goalError("GOAL_IDENTITY_CHANGED");
      record.state = "cancelled";
      this._save(record);
      return this._view(record);
    });
  }
}

module.exports = { ProjectGoalTransferService };
