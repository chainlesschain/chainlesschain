"use strict";
const {
  goalError,
  validateGoalRecord,
  GOAL_GRAPH_AWARE_SCHEMA,
  GOAL_GRAPH_AWARE_SCHEMA_VERSION,
} = require("./goal-contract.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");

/** A native participation/head watermark fences the separate Graph journal.
 * Missing or rolled-back Graph history cannot silently select legacy replay.
 * Neither journal replaces the native risk receipt or its authorization. */
class ProjectGoalGraphJournal {
  constructor({ state, authority }) {
    if (!authority || typeof authority.inspectOccurrence !== "function")
      throw goalError("GOAL_MONITOR_GRAPH_HOST_INVALID");
    this.state = state;
    this.db = state.db;
    this.authority = authority;
    this.mode = authority.mode;
    state.adapter._transaction(() =>
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_graph_occurrences(
      occurrence_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_goal_graph_occurrences_scope ON cc_project_goal_graph_occurrences(goal_id,actor_did);`),
    );
  }
  _binding(context) {
    return digest({
      jobId: context.job.id,
      jobRevision: context.occurrence.jobRevision,
      payload: context.occurrence.payload,
      authority: context.authority,
    });
  }
  _with(context, operation, renew = true) {
    return this.state._withGoal(
      context.occurrence.payload.goalId,
      (goal, actor) => {
        this.state._validateBinding(context.occurrence.payload, goal, actor);
        if (
          context.authority.principal.id !== actor ||
          context.authority.workspaceId !== actor
        )
          throw goalError("GOAL_MONITOR_AUTHORITY_MISMATCH");
        if (renew) context.renewLease();
        const row = this.db
          .prepare(
            `SELECT goal_id,actor_did,content_digest,
        CASE WHEN length(CAST(record_json AS BLOB))<=4096 THEN record_json END AS body
        FROM cc_project_goal_graph_occurrences WHERE occurrence_id=?`,
          )
          .get(context.occurrence.id);
        let record = null;
        if (row) {
          try {
            record = JSON.parse(row.body);
            if (
              !row.body ||
              digest(record) !== row.content_digest ||
              row.goal_id !== goal.id ||
              row.actor_did !== actor ||
              record.id !== context.occurrence.id ||
              record.goalId !== goal.id ||
              record.actorDid !== actor ||
              record.bindingDigest !== this._binding(context) ||
              !["initializing", "started", "settled"].includes(record.phase) ||
              !["shadow", "canonical"].includes(record.authorityMode) ||
              !Number.isSafeInteger(record.fence) ||
              record.fence < 1 ||
              (record.headHash !== null &&
                !/^sha256:[a-f0-9]{64}$/u.test(record.headHash))
            )
              throw new Error();
          } catch {
            throw goalError("GOAL_MONITOR_GRAPH_RECORD_CORRUPT");
          }
          if (record.fence > context.occurrence.fence)
            throw goalError("GOAL_MONITOR_GRAPH_FENCE_STALE");
        }
        return operation(record, goal, actor);
      },
    );
  }
  _save(record) {
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_graph_occurrences VALUES (?,?,?,?,?)
      ON CONFLICT(occurrence_id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest
      WHERE goal_id=excluded.goal_id AND actor_did=excluded.actor_did`,
      )
      .run(
        record.id,
        record.goalId,
        record.actorDid,
        JSON.stringify(record),
        digest(record),
      );
  }
  begin(context) {
    const before = this._with(context, (record) => record);
    const inspection = this.authority.inspectOccurrence(
      context,
      before?.headHash ?? null,
    );
    if (
      before &&
      ((!inspection.present && before.phase !== "initializing") ||
        !inspection.containsHead ||
        inspection.authorityMode !== before.authorityMode)
    )
      throw goalError("GOAL_MONITOR_GRAPH_HISTORY_MISSING");
    if (inspection.authorityMode === "legacy") return null;
    this._with(context, (record, goal, actor) => {
      if (goal.requiresGraphAwareHost !== true) {
        // This is an encoding/reader-floor migration, not a goal definition or
        // permission edit: keep its revision/control binding. Legacy validators
        // reject v2, so an old binary cannot silently bypass this journal.
        const upgraded = validateGoalRecord({
          ...goal,
          schema: GOAL_GRAPH_AWARE_SCHEMA,
          schemaVersion: GOAL_GRAPH_AWARE_SCHEMA_VERSION,
          requiresGraphAwareHost: true,
        });
        if (
          this.db
            .prepare(
              "UPDATE cc_project_goals SET goal_json=? WHERE id=? AND actor_did=? AND revision=?",
            )
            .run(JSON.stringify(upgraded), goal.id, actor, goal.revision)
            .changes !== 1
        )
          throw goalError("GOAL_REVISION_CONFLICT");
      }
      if (!record) {
        if (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM cc_project_goal_graph_occurrences WHERE goal_id=? AND actor_did=?",
            )
            .get(goal.id, actor).n >= 1000
        )
          throw goalError("GOAL_MONITOR_GRAPH_CAPACITY");
        this._save({
          id: context.occurrence.id,
          goalId: goal.id,
          actorDid: actor,
          bindingDigest: this._binding(context),
          phase: "initializing",
          authorityMode: inspection.authorityMode,
          headHash: null,
          fence: context.occurrence.fence,
        });
      }
    });
    const claim = this.authority.begin(context);
    if (!claim || claim.authorityMode !== inspection.authorityMode)
      throw goalError("GOAL_MONITOR_GRAPH_MODE_CHANGED");
    this._recordHead(context, claim.alreadySettled ? "settled" : "started");
    return claim;
  }
  _recordHead(context, phase) {
    const inspection = this.authority.inspectOccurrence(context);
    if (!inspection.present || !inspection.head)
      throw goalError("GOAL_MONITOR_GRAPH_HISTORY_MISSING");
    this._with(context, (record) => {
      if (!record || record.authorityMode !== inspection.authorityMode)
        throw goalError("GOAL_MONITOR_GRAPH_RECORD_CORRUPT");
      this._save({
        ...record,
        phase,
        headHash: inspection.head,
        fence: context.occurrence.fence,
      });
    });
  }
  settleSuccess(context, result) {
    const projection = this.authority.settleSuccess(context, result);
    this._recordHead(context, "settled");
    return projection;
  }
  settleFailure(context, error) {
    const projection = this.authority.settleFailure(context, error);
    if (projection)
      this._recordHead(
        context,
        projection.status === "reconciliation_required" ? "started" : "settled",
      );
    return projection;
  }
  validateCommittedResult(context, result) {
    const record = this._with(context, (value) => value, false);
    if (!record) {
      if (context.occurrence.result?.graphAuthority)
        throw goalError("GOAL_MONITOR_GRAPH_RECORD_CORRUPT");
      return null;
    }
    const inspection = this.authority.inspectOccurrence(
      context,
      record.headHash,
    );
    if (
      record.phase !== "settled" ||
      !inspection.present ||
      !inspection.containsHead ||
      inspection.authorityMode !== record.authorityMode
    )
      throw goalError("GOAL_MONITOR_GRAPH_HISTORY_MISSING");
    const verified = this.authority.validateCommittedResult(
      context,
      result,
      record.headHash,
    );
    if (digest(this.state.readCheck(context.occurrence)) !== digest(result))
      throw goalError("GOAL_MONITOR_CHECK_CORRUPT");
    return verified;
  }
  close() {
    return this.authority.close?.();
  }
}
module.exports = { ProjectGoalGraphJournal };
