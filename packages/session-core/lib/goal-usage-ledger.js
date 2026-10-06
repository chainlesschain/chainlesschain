"use strict";

const { goalError, validateGoalRecord } = require("./goal-contract.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const MAX_OPERATIONS = 1000;
const MAX_RECORD_BYTES = 8192;
const RECORD_FIELDS =
  "actorDid,controlGeneration,domain,estimate,goalId,goalRevision,operationId,schema,status,usage";
const RECORD_COLUMNS = `operation_id,goal_id,actor_did,
  CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_RECORD_BYTES} THEN record_json ELSE NULL END AS record_json,
  content_digest`;

function fail(code) {
  throw goalError(code);
}
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_USAGE_INVALID_REQUEST");
  return value;
}
function quantities(value, nullable) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "costUsd,elapsedMs,runs,tokens"
  )
    fail("GOAL_USAGE_INVALID_REQUEST");
  if (
    !Number.isSafeInteger(value.runs) ||
    value.runs < 0 ||
    value.runs > MAX_OPERATIONS
  )
    fail("GOAL_USAGE_INVALID_REQUEST");
  for (const key of ["tokens", "elapsedMs"])
    if (
      !(nullable && value[key] === null) &&
      (!Number.isSafeInteger(value[key]) || value[key] < 0)
    )
      fail("GOAL_USAGE_INVALID_REQUEST");
  if (
    !(nullable && value.costUsd === null) &&
    (typeof value.costUsd !== "number" ||
      !Number.isFinite(value.costUsd) ||
      value.costUsd < 0)
  )
    fail("GOAL_USAGE_INVALID_REQUEST");
  return value;
}

/** Domain hosts reserve before dispatch and record actual usage afterwards.
 * This ledger grants no authority and performs no model/network calls. Existing
 * risk-check evidence remains the canonical source for that domain's usage. */
class GoalUsageLedger {
  constructor({ db }) {
    if (
      !db ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction !== "function" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("GOAL_NATIVE_DATABASE_REQUIRED");
    this.db = db;
    if (db.inTransaction) fail("GOAL_USAGE_TRANSACTION_REQUIRED");
    db.transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_usage (
      operation_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_cc_project_goal_usage_goal ON cc_project_goal_usage(goal_id,actor_did);`),
    ).immediate();
  }
  _transaction() {
    if (!this.db.inTransaction) fail("GOAL_USAGE_TRANSACTION_REQUIRED");
  }
  _scope(goal, actor) {
    if (
      goal?.ownerRef !== actor ||
      goal?.projectRef?.scope?.kind !== "personal" ||
      goal.projectRef.scope.id !== actor
    )
      fail("GOAL_USAGE_SCOPE_DENIED");
    identifier(goal.id);
    identifier(actor);
    try {
      validateGoalRecord(goal);
    } catch {
      fail("GOAL_USAGE_INVALID_REQUEST");
    }
  }
  _read(row) {
    if (!row) return null;
    try {
      if (
        typeof row.record_json !== "string" ||
        Buffer.byteLength(row.record_json, "utf8") > MAX_RECORD_BYTES
      )
        throw new Error();
      const record = JSON.parse(row.record_json);
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        Object.keys(record).sort().join(",") !== RECORD_FIELDS ||
        record.schema !== "chainlesschain.goal-usage/v1" ||
        record.operationId !== row.operation_id ||
        record.goalId !== row.goal_id ||
        record.actorDid !== row.actor_did ||
        digest(record) !== row.content_digest ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        !["native-action", "model"].includes(record.domain) ||
        !["reserved", "settled", "released", "unknown"].includes(record.status)
      )
        throw new Error();
      identifier(record.operationId);
      identifier(record.goalId);
      identifier(record.actorDid);
      quantities(record.estimate, true);
      if (record.usage !== null) quantities(record.usage, true);
      if (
        record.domain === "native-action" &&
        (record.estimate.tokens !== 0 ||
          record.estimate.costUsd !== 0 ||
          (record.usage &&
            (record.usage.tokens !== 0 || record.usage.costUsd !== 0)))
      )
        throw new Error();
      if (record.status === "settled" && record.usage === null)
        throw new Error();
      if (
        ["reserved", "released"].includes(record.status) &&
        record.usage !== null
      )
        throw new Error();
      return record;
    } catch {
      fail("GOAL_USAGE_RECORD_CORRUPT");
    }
  }
  _save(record) {
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, "utf8") > MAX_RECORD_BYTES)
      fail("GOAL_USAGE_RECORD_CORRUPT");
    this._read({
      operation_id: record.operationId,
      goal_id: record.goalId,
      actor_did: record.actorDid,
      record_json: body,
      content_digest: digest(record),
    });
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_usage VALUES (?,?,?,?,?) ON CONFLICT(operation_id)
      DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        record.operationId,
        record.goalId,
        record.actorDid,
        body,
        digest(record),
      );
    return record;
  }
  summary(goal, actor) {
    this._transaction();
    this._scope(goal, actor);
    const hasChecks = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_checks'",
      )
      .get();
    const checkRows = hasChecks
      ? this.db
          .prepare(
            `SELECT CASE WHEN typeof(elapsed_ms)='integer' THEN elapsed_ms ELSE NULL END AS elapsedMs
      FROM cc_project_goal_checks WHERE goal_id=? AND actor_did=? LIMIT ?`,
          )
          .all(goal.id, actor, MAX_OPERATIONS + 1)
      : [];
    const checks = { checks: checkRows.length, elapsedMs: 0 };
    for (const row of checkRows) {
      if (!Number.isSafeInteger(row.elapsedMs) || row.elapsedMs < 0)
        fail("GOAL_USAGE_RECORD_CORRUPT");
      checks.elapsedMs += row.elapsedMs;
    }
    if (
      !Number.isSafeInteger(checks.checks) ||
      checks.checks > MAX_OPERATIONS ||
      !Number.isSafeInteger(checks.elapsedMs) ||
      checks.elapsedMs < 0
    )
      fail("GOAL_USAGE_RECORD_CORRUPT");
    const rows = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS} FROM cc_project_goal_usage WHERE goal_id=? AND actor_did=? LIMIT ?`,
      )
      .all(goal.id, actor, MAX_OPERATIONS + 1);
    if (rows.length > MAX_OPERATIONS) fail("GOAL_USAGE_RECORD_CORRUPT");
    const records = rows.map((row) => this._read(row));
    let totalRuns = checks.checks,
      knownElapsedMs = checks.elapsedMs,
      modelTokens = 0,
      modelCostUsd = 0;
    let reservedTokens = 0,
      reservedCostUsd = 0,
      reservedElapsedMs = 0,
      reservedRuns = 0,
      unknownTime = 0,
      unknownTokens = 0,
      unknownCost = 0;
    for (const record of records) {
      if (
        record.goalRevision > goal.revision ||
        record.controlGeneration > goal.controlGeneration
      )
        fail("GOAL_USAGE_RECORD_CORRUPT");
      if (record.status === "released") continue;
      if (record.status === "settled") {
        totalRuns += record.usage.runs;
        if (record.usage.elapsedMs === null) unknownTime++;
        else knownElapsedMs += record.usage.elapsedMs;
        if (record.usage.tokens === null) unknownTokens++;
        else modelTokens += record.usage.tokens;
        if (record.usage.costUsd === null) unknownCost++;
        else modelCostUsd += record.usage.costUsd;
      } else {
        // Unknown usage is a lower bound. Keep it visible and retain only the
        // remainder of the estimate as a hold, without charging it twice.
        const actual = record.usage;
        totalRuns += Math.max(record.estimate.runs, actual?.runs ?? 0);
        reservedRuns += Math.max(0, record.estimate.runs - (actual?.runs ?? 0));
        modelTokens += actual?.tokens ?? 0;
        modelCostUsd += actual?.costUsd ?? 0;
        knownElapsedMs += actual?.elapsedMs ?? 0;
        reservedTokens += Math.max(
          0,
          (record.estimate.tokens ?? 0) - (actual?.tokens ?? 0),
        );
        reservedCostUsd += Math.max(
          0,
          (record.estimate.costUsd ?? 0) - (actual?.costUsd ?? 0),
        );
        reservedElapsedMs += Math.max(
          0,
          (record.estimate.elapsedMs ?? 0) - (actual?.elapsedMs ?? 0),
        );
        if (
          record.status === "unknown" ||
          record.domain === "model" ||
          record.estimate.elapsedMs === null
        )
          unknownTime++;
        if (record.domain === "model") {
          unknownTokens++;
          unknownCost++;
        }
      }
    }
    if (
      ![
        totalRuns,
        knownElapsedMs,
        modelTokens,
        reservedTokens,
        reservedElapsedMs,
        reservedRuns,
        knownElapsedMs + reservedElapsedMs,
        modelTokens + reservedTokens,
      ].every(Number.isSafeInteger) ||
      !Number.isFinite(modelCostUsd) ||
      !Number.isFinite(reservedCostUsd) ||
      !Number.isFinite(modelCostUsd + reservedCostUsd)
    )
      fail("GOAL_USAGE_RECORD_CORRUPT");
    return {
      checks: checks.checks,
      totalRuns,
      reservedRuns,
      knownElapsedMs,
      elapsedMs: unknownTime ? null : knownElapsedMs,
      modelTokens: unknownTokens ? null : modelTokens,
      modelCostUsd: unknownCost ? null : modelCostUsd,
      knownModelTokens: modelTokens,
      knownModelCostUsd: modelCostUsd,
      reservedTokens,
      reservedCostUsd,
      reservedElapsedMs,
      unknownTime,
      unknownTokens,
      unknownCost,
    };
  }
  assertAvailable(
    goal,
    actor,
    estimate = { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 },
  ) {
    quantities(estimate, true);
    const usage = this.summary(goal, actor);
    const policy = goal.budgetPolicy;
    if (
      usage.totalRuns + estimate.runs >
      Math.min(policy.maxRuns ?? MAX_OPERATIONS, MAX_OPERATIONS)
    )
      fail("GOAL_USAGE_BUDGET_EXHAUSTED");
    if (
      (policy.maxTokens !== null &&
        (estimate.tokens === null || usage.unknownTokens)) ||
      (policy.maxCostUsd !== null &&
        (estimate.costUsd === null || usage.unknownCost)) ||
      (policy.maxTimeMs !== null &&
        (estimate.elapsedMs === null || usage.unknownTime))
    )
      fail("GOAL_USAGE_UNKNOWN");
    if (
      (policy.maxTokens !== null &&
        usage.knownModelTokens + usage.reservedTokens + estimate.tokens >
          policy.maxTokens) ||
      (policy.maxCostUsd !== null &&
        usage.knownModelCostUsd + usage.reservedCostUsd + estimate.costUsd >
          policy.maxCostUsd) ||
      (policy.maxTimeMs !== null &&
        usage.knownElapsedMs + usage.reservedElapsedMs + estimate.elapsedMs >
          policy.maxTimeMs)
    )
      fail("GOAL_USAGE_BUDGET_EXHAUSTED");
    return usage;
  }
  reserve({
    goal,
    actor,
    operationId,
    domain = "native-action",
    estimate = { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 },
  }) {
    this._transaction();
    this._scope(goal, actor);
    identifier(operationId);
    quantities(estimate, true);
    if (
      !["native-action", "model"].includes(domain) ||
      (domain === "native-action" &&
        (estimate.tokens !== 0 || estimate.costUsd !== 0))
    )
      fail("GOAL_USAGE_INVALID_REQUEST");
    const prior = this._read(
      this.db
        .prepare(
          `SELECT ${RECORD_COLUMNS} FROM cc_project_goal_usage WHERE operation_id=?`,
        )
        .get(operationId),
    );
    if (prior) {
      if (
        prior.goalId !== goal.id ||
        prior.actorDid !== actor ||
        prior.goalRevision !== goal.revision ||
        prior.controlGeneration !== goal.controlGeneration ||
        prior.domain !== domain ||
        digest(prior.estimate) !== digest(estimate)
      )
        fail("GOAL_USAGE_OPERATION_CONFLICT");
      if (prior.status !== "reserved") fail("GOAL_USAGE_OPERATION_TERMINAL");
      return prior;
    }
    if (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_usage WHERE goal_id=? AND actor_did=?",
        )
        .get(goal.id, actor).n >= MAX_OPERATIONS
    )
      fail("GOAL_USAGE_OPERATION_LIMIT");
    this.assertAvailable(goal, actor, estimate);
    return this._save({
      schema: "chainlesschain.goal-usage/v1",
      operationId,
      goalId: goal.id,
      actorDid: actor,
      goalRevision: goal.revision,
      controlGeneration: goal.controlGeneration,
      domain,
      estimate,
      status: "reserved",
      usage: null,
    });
  }
  settle({ operationId, actor, goalId, status, usage = null }) {
    this._transaction();
    identifier(operationId);
    identifier(actor);
    identifier(goalId);
    if (!["settled", "released", "unknown"].includes(status))
      fail("GOAL_USAGE_INVALID_REQUEST");
    if (usage !== null) quantities(usage, true);
    const prior = this._read(
      this.db
        .prepare(
          `SELECT ${RECORD_COLUMNS} FROM cc_project_goal_usage WHERE operation_id=?`,
        )
        .get(operationId),
    );
    if (!prior || prior.actorDid !== actor || prior.goalId !== goalId)
      fail("GOAL_USAGE_OPERATION_CONFLICT");
    if (prior.status === "settled" || prior.status === "released") {
      if (prior.status !== status || digest(prior.usage) !== digest(usage))
        fail("GOAL_USAGE_OPERATION_CONFLICT");
      return prior;
    }
    if (status === "settled" && usage === null)
      fail("GOAL_USAGE_INVALID_REQUEST");
    if (status === "released" && usage !== null)
      fail("GOAL_USAGE_INVALID_REQUEST");
    if (prior.status === "unknown") {
      if (status === "released") fail("GOAL_USAGE_OPERATION_CONFLICT");
      if (
        prior.usage &&
        ["runs", "tokens", "costUsd", "elapsedMs"].some(
          (key) =>
            prior.usage[key] !== null &&
            (usage?.[key] === null ||
              usage?.[key] === undefined ||
              usage[key] < prior.usage[key]),
        )
      )
        fail("GOAL_USAGE_OPERATION_CONFLICT");
    }
    if (
      prior.domain === "native-action" &&
      usage &&
      (usage.tokens !== 0 || usage.costUsd !== 0)
    )
      fail("GOAL_USAGE_INVALID_REQUEST");
    return this._save({ ...prior, status, usage });
  }
}

module.exports = { GoalUsageLedger, MAX_OPERATIONS };
