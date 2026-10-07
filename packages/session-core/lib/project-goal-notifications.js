"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { PersonalProjectGoalService } = require("./project-goal-service.js");
const {
  ProjectRiskReviewService,
} = require("./project-risk-review-service.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  normalizeGoalNotificationPolicy,
  nextGoalNotificationDelivery,
} = require("./goal-notification-policy.js");
const SCHEMA = "chainlesschain.goal-notice-ref/v1";
const TABLES = Object.freeze({
  event: "cc_project_goal_notice_events",
  observation: "cc_project_goal_notice_observations",
  state: "cc_project_goal_notice_state",
});
const MAX_BYTES = 16384;
const RECORD_FIELDS = Object.freeze({
  event: [
    "schema",
    "id",
    "goalId",
    "actorDid",
    "projectId",
    "storeId",
    "kind",
    "signature",
    "controlGeneration",
    "source",
    "sourceVersion",
    "createdAt",
    "lastCheckedAt",
    "deliveryState",
    "deliveryReason",
    "dueAt",
    "deliveredAt",
  ],
  observation: [
    "schema",
    "id",
    "goalId",
    "actorDid",
    "sourceVersion",
    "eventIds",
  ],
  state: [
    "schema",
    "id",
    "goalId",
    "actorDid",
    "signature",
    "signal",
    "sourceVersion",
    "lastCheckedAt",
    "eventIds",
  ],
});
function exact(value, fields) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}
function validDigest(value) {
  return typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
}
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_NOTICE_INVALID_REQUEST");
  return value;
}
function options(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => ![...required, ...optional].includes(k))
  )
    fail("GOAL_NOTICE_INVALID_REQUEST");
  digest(value);
}
function limit(value = 50) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    fail("GOAL_NOTICE_INVALID_REQUEST");
  return value;
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("GOAL_NOTICE_INVALID_CLOCK");
  return value;
}
function parse(json, maximum = MAX_BYTES) {
  if (typeof json !== "string" || Buffer.byteLength(json) > maximum)
    fail("GOAL_NOTICE_SOURCE_CORRUPT");
  try {
    return JSON.parse(json);
  } catch {
    fail("GOAL_NOTICE_SOURCE_CORRUPT");
  }
}
function semantic(evaluation) {
  // Hash the validated, bounded RiskReview one task at a time. A large risk
  // snapshot must not inherit the smaller action-input JSON size limit.
  const taskHashes = evaluation.tasks
    .map((item) => ({
      id: item.taskRef.id,
      dueDate: item.dueDate,
      reasons: [...item.reasonCodes].sort(),
      blockedBy: item.blockingTaskRefs.map((ref) => ref.id).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => digest(item));
  return digest({
    ruleVersion: evaluation.ruleVersion,
    sourceSchema: evaluation.sourceSchema,
    status: evaluation.status,
    reasons: [...evaluation.reasonCodes].sort(),
    tasksDigest: createHash("sha256")
      .update(taskHashes.join("\n"))
      .digest("hex"),
  });
}

/** Durable metadata and an in-app projection share the source SQLite commit.
 * Instances must be initialized outside a transaction; injected domain services
 * retain their existing authority checks inside caller-owned transactions. */
class ProjectGoalNotificationService {
  constructor({ db, getActor, clock = Date.now, goals, risk }) {
    if (
      !db ||
      typeof db.prepare !== "function" ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean"
    )
      fail("GOAL_NOTICE_NATIVE_DATABASE_REQUIRED");
    if (db.inTransaction) fail("GOAL_NOTICE_TRANSACTION_BUSY");
    if (typeof getActor !== "function" || typeof clock !== "function")
      fail("GOAL_NOTICE_AUTHORITY_REQUIRED");
    this.db = db;
    this.clock = clock;
    this.goals =
      goals ??
      new PersonalProjectGoalService({
        db,
        getActor,
        now: () => new Date(epoch(clock())).toISOString(),
      });
    this.risk =
      risk ?? new ProjectRiskReviewService({ db, getActor, now: clock });
    this.adapter = this.goals.adapter;
    if (this.adapter.db !== db || this.risk.db !== db)
      fail("GOAL_NOTICE_DATABASE_MISMATCH");
    this.getActor = getActor;
    this._tx(() => {
      for (const table of Object.values(TABLES))
        db.exec(
          `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_${table}_goal ON ${table}(goal_id,actor_did,id);`,
        );
      db.exec(
        `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,user_did TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('friend_request','message','like','comment','system')),title TEXT NOT NULL,content TEXT,data TEXT,is_read INTEGER DEFAULT 0,created_at INTEGER NOT NULL);`,
      );
    });
  }
  _tx(operation) {
    if (this.db.inTransaction) fail("GOAL_NOTICE_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _actor() {
    const actor = this.getActor();
    if (
      typeof actor !== "string" ||
      !actor.startsWith("did:") ||
      actor !== this.adapter._actor()
    )
      fail("GOAL_NOTICE_IDENTITY_REQUIRED");
    return actor;
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _end(goal, actor) {
    if (actor !== this._actor()) fail("GOAL_NOTICE_IDENTITY_CHANGED");
    this.adapter._project(goal.projectRef.id, actor);
  }
  _save(kind, record) {
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > MAX_BYTES)
      fail("GOAL_NOTICE_RECORD_TOO_LARGE");
    const saved = this.db
      .prepare(
        `INSERT INTO ${TABLES[kind]} VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest WHERE goal_id=excluded.goal_id AND actor_did=excluded.actor_did`,
      )
      .run(record.id, record.goalId, record.actorDid, json, digest(record));
    if (saved.changes !== 1) fail("GOAL_NOTICE_SOURCE_CORRUPT");
    return record;
  }
  _read(kind, recordId, actor) {
    const row = this.db
      .prepare(
        `SELECT id,goal_id,actor_did,CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_BYTES} THEN record_json ELSE NULL END AS record_json,content_digest FROM ${TABLES[kind]} WHERE id=? AND actor_did=?`,
      )
      .get(recordId, actor);
    if (!row) return null;
    const record = parse(row.record_json);
    if (
      !exact(record, RECORD_FIELDS[kind]) ||
      record.schema !== `chainlesschain.goal-notice-${kind}/v1` ||
      record.id !== row.id ||
      record.goalId !== row.goal_id ||
      record.actorDid !== actor ||
      digest(record) !== row.content_digest ||
      !validDigest(record.sourceVersion)
    )
      fail("GOAL_NOTICE_SOURCE_CORRUPT");
    if (kind === "event") {
      if (
        !exact(record.source, [
          "occurrenceId",
          "reviewId",
          "payloadDigest",
          "resultDigest",
          "reviewDigest",
          "proposalDigest",
          "goalRevision",
          "controlGeneration",
          "checkedAt",
        ]) ||
        ![
          "risk-added",
          "risk-changed",
          "risk-cleared",
          "source-unknown",
          "decision-needed",
        ].includes(record.kind) ||
        !["pending", "held", "suppressed", "delivered"].includes(
          record.deliveryState,
        ) ||
        ![
          null,
          "goal-inactive-or-changed",
          "silent",
          "quiet-hours",
          "source-denied",
        ].includes(record.deliveryReason) ||
        !validDigest(record.signature) ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        record.controlGeneration > record.source.controlGeneration ||
        ![
          record.source.payloadDigest,
          record.source.resultDigest,
          record.source.reviewDigest,
        ].every(validDigest) ||
        (record.source.proposalDigest !== null &&
          !validDigest(record.source.proposalDigest))
      )
        fail("GOAL_NOTICE_SOURCE_CORRUPT");
      for (const stamp of [
        record.createdAt,
        record.lastCheckedAt,
        record.dueAt,
        ...(record.deliveredAt === null ? [] : [record.deliveredAt]),
      ])
        epoch(stamp);
      if (
        (record.deliveryState === "delivered") !==
        (record.deliveredAt !== null)
      )
        fail("GOAL_NOTICE_SOURCE_CORRUPT");
    } else {
      if (
        !Array.isArray(record.eventIds) ||
        record.eventIds.length > 3 ||
        record.eventIds.some(
          (value) => typeof value !== "string" || value.length > 256,
        )
      )
        fail("GOAL_NOTICE_SOURCE_CORRUPT");
      if (
        kind === "state" &&
        (!validDigest(record.signature) ||
          !["risk", "clear", "unknown"].includes(record.signal))
      )
        fail("GOAL_NOTICE_SOURCE_CORRUPT");
    }
    return record;
  }
  _source(goal, occurrenceId, actor) {
    const row = this.db
      .prepare(
        `SELECT occurrence_id,goal_id,actor_did,goal_revision,control_generation,request_digest,review_id,result_digest,checked_at,elapsed_ms,CASE WHEN length(CAST(payload_json AS BLOB))<=4096 THEN payload_json ELSE NULL END AS payload_json,CASE WHEN length(CAST(result_json AS BLOB))<=4096 THEN result_json ELSE NULL END AS result_json FROM cc_project_goal_checks WHERE occurrence_id=? AND actor_did=?`,
      )
      .get(id(occurrenceId), actor);
    if (!row) fail("GOAL_NOTICE_SOURCE_MISSING");
    const payload = parse(row.payload_json, 4096),
      result = parse(row.result_json, 4096);
    if (
      !exact(payload, [
        "storeId",
        "goalId",
        "goalRevision",
        "controlGeneration",
        "monitorRevision",
        "requestId",
        "schedulerPolicyRevision",
      ]) ||
      !Number.isSafeInteger(payload.schedulerPolicyRevision) ||
      payload.schedulerPolicyRevision < 1 ||
      (payload.requestId === null
        ? !Number.isSafeInteger(payload.monitorRevision) ||
          payload.monitorRevision < 1
        : typeof payload.requestId !== "string" ||
          payload.requestId.length > 256 ||
          payload.monitorRevision !== null)
    )
      fail("GOAL_NOTICE_SOURCE_CORRUPT");
    const review = this.risk.getReviewInTransaction({
      reviewId: row.review_id,
    });
    const expected = {
      goalId: goal.id,
      reviewId: review.review.id,
      checkedAt: review.review.createdAt,
      status: review.evaluation.status,
      riskTaskCount: review.evaluation.summary?.riskTaskCount ?? null,
    };
    if (
      row.goal_id !== goal.id ||
      payload.goalId !== goal.id ||
      payload.storeId !== goal.storeId ||
      payload.goalRevision !== row.goal_revision ||
      payload.controlGeneration !== row.control_generation ||
      !Number.isSafeInteger(payload.goalRevision) ||
      payload.goalRevision < 1 ||
      payload.goalRevision > goal.revision ||
      !Number.isSafeInteger(payload.controlGeneration) ||
      payload.controlGeneration < 0 ||
      payload.controlGeneration > goal.controlGeneration ||
      digest(payload) !== row.request_digest ||
      digest(result) !== row.result_digest ||
      digest(expected) !== row.result_digest ||
      review.review.actorDid !== actor ||
      review.review.projectId !== goal.projectRef.id ||
      epoch(row.checked_at) !== Date.parse(result.checkedAt) ||
      !Number.isSafeInteger(row.elapsed_ms) ||
      row.elapsed_ms < 0
    )
      fail("GOAL_NOTICE_SOURCE_CORRUPT");
    let proposalDigest = null,
      newCount = 0;
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_proposal_observations'",
        )
        .get()
    ) {
      const proposal = this.db
        .prepare(
          "SELECT CASE WHEN length(CAST(summary_json AS BLOB))<=4096 THEN summary_json ELSE NULL END AS summary_json,content_digest FROM cc_project_goal_proposal_observations WHERE review_id=? AND goal_id=? AND actor_did=?",
        )
        .get(row.review_id, goal.id, actor);
      if (proposal) {
        const summary = parse(proposal.summary_json, 4096);
        if (
          !exact(summary, [
            "schema",
            "goalId",
            "reviewId",
            "candidateCount",
            "savedCount",
            "omittedCount",
            "newCount",
            "status",
          ]) ||
          summary.schema !== "chainlesschain.goal-proposal-observation/v1" ||
          summary.goalId !== goal.id ||
          summary.reviewId !== row.review_id ||
          digest(summary) !== proposal.content_digest ||
          ![
            summary.candidateCount,
            summary.savedCount,
            summary.omittedCount,
            summary.newCount,
          ].every(
            (value) =>
              Number.isSafeInteger(value) && value >= 0 && value <= 10000,
          ) ||
          summary.newCount > summary.savedCount ||
          !["complete", "truncated"].includes(summary.status)
        )
          fail("GOAL_NOTICE_SOURCE_CORRUPT");
        proposalDigest = proposal.content_digest;
        newCount = summary.newCount;
      }
    }
    const source = {
      occurrenceId,
      reviewId: row.review_id,
      payloadDigest: row.request_digest,
      resultDigest: row.result_digest,
      // getReviewInTransaction already validates this canonical digest using
      // the RiskReview service's larger snapshot bound.
      reviewDigest: this.db
        .prepare(
          "SELECT content_digest FROM cc_project_risk_reviews WHERE id=? AND actor_did=?",
        )
        .get(row.review_id, actor).content_digest,
      proposalDigest,
      goalRevision: row.goal_revision,
      controlGeneration: row.control_generation,
      checkedAt: row.checked_at,
    };
    return {
      source,
      sourceVersion: digest(source),
      signature: semantic(review.evaluation),
      signal:
        review.evaluation.status !== "evaluated"
          ? "unknown"
          : review.evaluation.tasks.length
            ? "risk"
            : "clear",
      newCount,
    };
  }
  _validate(event, goal, actor) {
    if (
      event.storeId !== goal.storeId ||
      event.projectId !== goal.projectRef.id
    )
      fail("GOAL_NOTICE_SOURCE_CORRUPT");
    const current = this._source(goal, event.source.occurrenceId, actor);
    if (
      digest(event.source) !== digest(current.source) ||
      event.sourceVersion !== current.sourceVersion ||
      event.signature !== current.signature ||
      (event.kind === "decision-needed" && current.newCount === 0) ||
      (event.kind === "source-unknown" && current.signal !== "unknown") ||
      (["risk-added", "risk-changed"].includes(event.kind) &&
        current.signal !== "risk") ||
      (event.kind === "risk-cleared" && current.signal !== "clear")
    )
      fail("GOAL_NOTICE_SOURCE_CORRUPT");
    return current;
  }
  _reference(event) {
    return {
      schema: SCHEMA,
      eventId: event.id,
      goalId: event.goalId,
      projectId: event.projectId,
      storeId: event.storeId,
      sourceVersion: event.sourceVersion,
    };
  }
  _deliver(event, goal, now) {
    if (
      event.deliveryState === "delivered" ||
      event.deliveryState === "suppressed"
    )
      return event;
    const policy = normalizeGoalNotificationPolicy(goal.notificationPolicy);
    if (
      goal.status !== "active" ||
      goal.controlGeneration !== event.controlGeneration ||
      (goal.expiresAt !== null && Date.parse(goal.expiresAt) <= now)
    ) {
      event.deliveryState = goal.status === "paused" ? "held" : "suppressed";
      event.deliveryReason = "goal-inactive-or-changed";
    } else if (policy.mode === "silent") {
      event.deliveryState = "suppressed";
      event.deliveryReason = "silent";
    } else {
      event.dueAt = nextGoalNotificationDelivery(policy, now);
      if (event.dueAt > now) {
        event.deliveryState = "pending";
        event.deliveryReason = "quiet-hours";
      } else {
        this.db
          .prepare(
            "INSERT INTO notifications(id,user_did,type,title,content,data,is_read,created_at) VALUES (?,?,'system',?,?,?,0,?)",
          )
          .run(
            event.id,
            event.actorDid,
            "Project goal update",
            "A project goal update is available. Open the goal to review its current source.",
            JSON.stringify(this._reference(event)),
            now,
          );
        event.deliveryState = "delivered";
        event.deliveryReason = null;
        event.deliveredAt = now;
      }
    }
    return this._save("event", event);
  }
  observeInTransaction(input) {
    options(input, ["goalId", "occurrenceId"]);
    if (!this.db.inTransaction) fail("GOAL_NOTICE_TRANSACTION_REQUIRED");
    const actor = this._actor(),
      goal = this._goal(input.goalId, actor),
      current = this._source(goal, input.occurrenceId, actor);
    const old = this._read("observation", input.occurrenceId, actor);
    if (old) {
      if (old.goalId !== goal.id || old.sourceVersion !== current.sourceVersion)
        fail("GOAL_NOTICE_SOURCE_CORRUPT");
      this._end(goal, actor);
      return old;
    }
    const previous = this._read("state", goal.id, actor);
    const kinds = [];
    if (!previous || previous.signature !== current.signature) {
      if (current.signal === "unknown") kinds.push("source-unknown");
      else if (current.signal === "risk")
        kinds.push(previous?.signal === "risk" ? "risk-changed" : "risk-added");
      else if (previous && previous.signal !== "clear")
        kinds.push("risk-cleared");
    }
    if (current.newCount > 0) kinds.push("decision-needed");
    const now = epoch(this.clock()),
      eventIds = [];
    for (const kind of kinds) {
      const event = {
        schema: "chainlesschain.goal-notice-event/v1",
        id: `goal-notice-${randomUUID()}`,
        goalId: goal.id,
        actorDid: actor,
        projectId: goal.projectRef.id,
        storeId: goal.storeId,
        kind,
        signature: current.signature,
        controlGeneration: current.source.controlGeneration,
        source: current.source,
        sourceVersion: current.sourceVersion,
        createdAt: now,
        lastCheckedAt: current.source.checkedAt,
        deliveryState: "pending",
        deliveryReason: null,
        dueAt: now,
        deliveredAt: null,
      };
      this._save("event", event);
      this._deliver(event, goal, now);
      eventIds.push(event.id);
    }
    if (previous && previous.signature === current.signature) {
      for (const eventId of previous.eventIds) {
        const event = this._read("event", eventId, actor);
        if (!event) fail("GOAL_NOTICE_SOURCE_CORRUPT");
        this._validate(event, goal, actor);
        event.source = current.source;
        event.sourceVersion = current.sourceVersion;
        event.lastCheckedAt = current.source.checkedAt;
        this._save("event", event);
        if (event.deliveryState === "delivered")
          this.db
            .prepare(
              "UPDATE notifications SET data=? WHERE id=? AND user_did=?",
            )
            .run(JSON.stringify(this._reference(event)), event.id, actor);
        eventIds.push(event.id);
      }
    }
    const observation = {
      schema: "chainlesschain.goal-notice-observation/v1",
      id: input.occurrenceId,
      goalId: goal.id,
      actorDid: actor,
      sourceVersion: current.sourceVersion,
      eventIds,
    };
    this._save("observation", observation);
    this._save("state", {
      schema: "chainlesschain.goal-notice-state/v1",
      id: goal.id,
      goalId: goal.id,
      actorDid: actor,
      signature: current.signature,
      signal: current.signal,
      sourceVersion: current.sourceVersion,
      lastCheckedAt: current.source.checkedAt,
      eventIds: eventIds.filter(
        (eventId) =>
          this._read("event", eventId, actor).kind !== "decision-needed",
      ),
    });
    this._end(goal, actor);
    return observation;
  }
  flushDue(input = {}) {
    options(input, [], ["limit"]);
    const maximum = limit(input.limit);
    return this._tx(() => {
      const actor = this._actor(),
        now = epoch(this.clock());
      const ids = this.db
        .prepare(
          `SELECT id FROM ${TABLES.event} WHERE actor_did=? AND json_extract(record_json,'$.deliveryState')='pending' ORDER BY json_extract(record_json,'$.dueAt'),id LIMIT ?`,
        )
        .all(actor, maximum);
      const events = [];
      for (const row of ids) {
        const event = this._read("event", row.id, actor);
        let goal;
        try {
          goal = this._goal(event.goalId, actor);
          this._validate(event, goal, actor);
        } catch (error) {
          if (this._actor() !== actor) fail("GOAL_NOTICE_IDENTITY_CHANGED");
          if (
            !/^(GOAL_NOT_FOUND_OR_DENIED|GOAL_ORGANIZATION_UNSUPPORTED|PROJECT_RISK_NOT_FOUND_OR_DENIED|PROJECT_RISK_ORGANIZATION_UNSUPPORTED)$/u.test(
              error.code ?? "",
            )
          )
            throw error;
          event.deliveryState = "suppressed";
          event.deliveryReason = "source-denied";
          this._save("event", event);
          continue;
        }
        events.push(this._deliver(event, goal, now));
        this._end(goal, actor);
      }
      return { events };
    });
  }
  list(input) {
    options(input, ["goalId"], ["afterId", "limit"]);
    const maximum = limit(input.limit);
    if (input.afterId !== undefined) id(input.afterId);
    return this._tx(() => {
      const actor = this._actor(),
        goal = this._goal(input.goalId, actor);
      const rows = this.db
        .prepare(
          `SELECT id FROM ${TABLES.event} WHERE goal_id=? AND actor_did=? AND id>? ORDER BY id LIMIT ?`,
        )
        .all(goal.id, actor, input.afterId ?? "", maximum + 1);
      const events = rows.slice(0, maximum).map((row) => {
        const event = this._read("event", row.id, actor);
        this._validate(event, goal, actor);
        return event;
      });
      this._end(goal, actor);
      return {
        events,
        nextCursor: rows.length > maximum ? events.at(-1).id : null,
      };
    });
  }
  open(input) {
    options(input, ["id"]);
    id(input.id);
    return this._tx(() => {
      const actor = this._actor(),
        event = this._read("event", input.id, actor);
      if (!event) fail("GOAL_NOTICE_NOT_FOUND_OR_DENIED");
      const goal = this._goal(event.goalId, actor);
      this._validate(event, goal, actor);
      this._end(goal, actor);
      return {
        event,
        goal,
        source: {
          reviewId: event.source.reviewId,
          occurrenceId: event.source.occurrenceId,
          sourceVersion: event.sourceVersion,
        },
      };
    });
  }
  readProjection(input) {
    options(input, ["id"]);
    return this._tx(() => this.readProjectionInTransaction(input.id));
  }
  readProjectionInTransaction(eventId) {
    if (!this.db.inTransaction) fail("GOAL_NOTICE_TRANSACTION_REQUIRED");
    id(eventId);
    const actor = this._actor();
    try {
      const event = this._read("event", eventId, actor);
      if (!event || event.deliveryState !== "delivered") return null;
      const goal = this._goal(event.goalId, actor);
      this._validate(event, goal, actor);
      const row = this.db
        .prepare("SELECT * FROM notifications WHERE id=? AND user_did=?")
        .get(eventId, actor);
      if (
        !row ||
        row.type !== "system" ||
        digest(parse(row.data)) !== digest(this._reference(event))
      )
        return null;
      this._end(goal, actor);
      return {
        ...row,
        title: "Project goal update",
        content:
          "A project goal update is available. Open the goal to review its current source.",
      };
    } catch (error) {
      if (this._actor() !== actor) fail("GOAL_NOTICE_IDENTITY_CHANGED");
      if (
        /^(GOAL_NOTICE_SOURCE_|GOAL_NOT_FOUND_OR_DENIED|GOAL_ORGANIZATION_UNSUPPORTED|PROJECT_RISK_)/u.test(
          error.code ?? "",
        )
      )
        return null;
      throw error;
    }
  }
}
module.exports = { ProjectGoalNotificationService };
