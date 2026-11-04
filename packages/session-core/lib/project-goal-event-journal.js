"use strict";
const {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");
const { goalExtensionRef } = require("./goal-extension-proposal-contract.js");
const { isReadOnlyNativeDatabase } = require("./read-only-native-database.js");
const RETENTION = 1000;
const MAX_KEYS = 4096;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mac = (key, value) =>
  createHmac("sha256", Buffer.from(key, "hex")).update(value).digest("hex");
const fail = (code = "GOAL_EVENT_HISTORY_INVALID") => {
  throw Object.assign(new Error(code), { code });
};
function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...fields].sort().join()
  )
    fail();
}
function safe(value, max = 256) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  )
    fail();
  return value;
}
function sequence(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail();
  return value;
}
function sameMac(a, b) {
  return (
    typeof a === "string" &&
    /^[a-f0-9]{64}$/u.test(a) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
/** Internal trusted writer. All appends must share the business transaction. */
class ProjectGoalEventJournal {
  constructor(db) {
    this.db = db;
    if (!isReadOnlyNativeDatabase(db)) {
      const initialize = () =>
        db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_event_heads(
        goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,epoch TEXT NOT NULL,secret TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,last_sequence INTEGER NOT NULL,anchor_digest TEXT NOT NULL,last_digest TEXT NOT NULL,
        PRIMARY KEY(goal_id,actor_did));
        CREATE TABLE IF NOT EXISTS cc_project_goal_event_journal(
        goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,sequence INTEGER NOT NULL,event_id TEXT NOT NULL,
        event_json TEXT NOT NULL,previous_digest TEXT NOT NULL,content_digest TEXT NOT NULL,signature TEXT NOT NULL,
        PRIMARY KEY(goal_id,actor_did,sequence));
        CREATE TABLE IF NOT EXISTS cc_project_goal_event_keys(
        event_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,sequence INTEGER NOT NULL,payload_digest TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_cc_goal_event_keys_scope ON cc_project_goal_event_keys(goal_id,actor_did);`);
      if (db.inTransaction) initialize();
      else db.transaction(initialize).immediate();
    }
  }
  _head(goalId, actor) {
    const row = this.db
      .prepare(
        "SELECT * FROM cc_project_goal_event_heads WHERE goal_id=? AND actor_did=?",
      )
      .get(goalId, actor);
    if (!row) return null;
    safe(row.epoch, 64);
    if (
      !/^[a-f0-9]{64}$/u.test(row.secret) ||
      !/^[a-f0-9]{64}$/u.test(row.anchor_digest) ||
      !/^[a-f0-9]{64}$/u.test(row.last_digest)
    )
      fail();
    sequence(row.first_sequence, 1);
    sequence(row.last_sequence, 1);
    if (
      row.first_sequence > row.last_sequence ||
      row.last_sequence - row.first_sequence >= RETENTION
    )
      fail();
    return row;
  }
  _entry(row, head) {
    if (
      !row ||
      row.goal_id !== head.goal_id ||
      row.actor_did !== head.actor_did ||
      Buffer.byteLength(row.event_json || "") > 4096
    )
      fail();
    const event = JSON.parse(row.event_json);
    exact(event, [
      "id",
      "sequence",
      "type",
      "sourceRef",
      "sourceId",
      "state",
      "actionType",
      "riskTaskCount",
      "recordedAt",
    ]);
    sequence(event.sequence, 1);
    safe(event.id);
    safe(event.sourceId);
    safe(event.recordedAt, 64);
    if (!Number.isFinite(Date.parse(event.recordedAt))) fail();
    goalExtensionRef(event.sourceRef);
    if (
      event.sourceRef.id !== head.goal_id ||
      event.sourceRef.revision < 1 ||
      event.sequence !== row.sequence ||
      event.id !== row.event_id
    )
      fail();
    if (event.type === "risk.review.completed") {
      if (
        !["evaluated", "insufficient-data"].includes(event.state) ||
        event.actionType !== null ||
        (event.state === "evaluated"
          ? !Number.isSafeInteger(event.riskTaskCount) ||
            event.riskTaskCount < 0
          : event.riskTaskCount !== null)
      )
        fail();
    } else if (event.type === "action.receipt.updated") {
      if (
        !["unresolved", "succeeded", "denied", "cancelled"].includes(
          event.state,
        ) ||
        !["task.create", "task.update-description"].includes(
          event.actionType,
        ) ||
        event.riskTaskCount !== null
      )
        fail();
    } else fail();
    const digest = hash({
      epoch: head.epoch,
      previous: row.previous_digest,
      event,
    });
    if (
      digest !== row.content_digest ||
      !sameMac(row.signature, mac(head.secret, digest))
    )
      fail();
    return event;
  }
  append({
    goalRef,
    actor,
    sourceId,
    type,
    state,
    actionType = null,
    riskTaskCount = null,
    recordedAt,
  }) {
    if (!this.db.inTransaction) fail("GOAL_EVENT_TRANSACTION_REQUIRED");
    goalRef = goalExtensionRef(goalRef);
    safe(actor);
    safe(sourceId);
    safe(recordedAt, 64);
    const eventId = `goal-event-${hash({ actor, goalRef, type, sourceId, state })}`;
    const payload = {
      type,
      sourceRef: goalRef,
      sourceId,
      state,
      actionType,
      riskTaskCount,
      recordedAt,
    };
    const prior = this.db
      .prepare("SELECT * FROM cc_project_goal_event_keys WHERE event_id=?")
      .get(eventId);
    if (prior) {
      if (
        prior.goal_id !== goalRef.id ||
        prior.actor_did !== actor ||
        prior.payload_digest !== hash(payload)
      )
        fail();
      return { id: eventId, sequence: prior.sequence };
    }
    let head = this._head(goalRef.id, actor);
    if (!head) {
      const epoch = randomBytes(16).toString("hex"),
        secret = randomBytes(32).toString("hex"),
        genesis = hash({ epoch, actor, goalId: goalRef.id });
      head = {
        goal_id: goalRef.id,
        actor_did: actor,
        epoch,
        secret,
        first_sequence: 1,
        last_sequence: 0,
        anchor_digest: genesis,
        last_digest: genesis,
      };
      this.db
        .prepare(
          "INSERT INTO cc_project_goal_event_heads VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(goalRef.id, actor, epoch, secret, 1, 0, genesis, genesis);
    } else {
      const tail = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_event_journal WHERE goal_id=? AND actor_did=? AND sequence=?",
        )
        .get(goalRef.id, actor, head.last_sequence);
      this._entry(tail, head);
      if (tail.content_digest !== head.last_digest) fail();
    }
    if (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_event_keys WHERE goal_id=? AND actor_did=?",
        )
        .get(goalRef.id, actor).n >= MAX_KEYS
    )
      fail("GOAL_EVENT_HISTORY_CAPACITY");
    const next = sequence(head.last_sequence + 1, 1),
      event = { id: eventId, sequence: next, ...payload };
    const contentDigest = hash({
      epoch: head.epoch,
      previous: head.last_digest,
      event,
    });
    const row = {
      goal_id: goalRef.id,
      actor_did: actor,
      sequence: next,
      event_id: eventId,
      event_json: JSON.stringify(event),
      previous_digest: head.last_digest,
      content_digest: contentDigest,
      signature: mac(head.secret, contentDigest),
    };
    this._entry(row, head);
    this.db
      .prepare(
        "INSERT INTO cc_project_goal_event_journal VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(...Object.values(row));
    this.db
      .prepare("INSERT INTO cc_project_goal_event_keys VALUES(?,?,?,?,?)")
      .run(eventId, goalRef.id, actor, next, hash(payload));
    let first = head.first_sequence,
      anchor = head.anchor_digest;
    if (next - first >= RETENTION) {
      const evicted = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_event_journal WHERE goal_id=? AND actor_did=? AND sequence=?",
        )
        .get(goalRef.id, actor, next - RETENTION);
      this._entry(evicted, head);
      first = next - RETENTION + 1;
      anchor = evicted.content_digest;
      this.db
        .prepare(
          "DELETE FROM cc_project_goal_event_journal WHERE goal_id=? AND actor_did=? AND sequence<?",
        )
        .run(goalRef.id, actor, first);
    }
    this.db
      .prepare(
        "UPDATE cc_project_goal_event_heads SET first_sequence=?,last_sequence=?,anchor_digest=?,last_digest=? WHERE goal_id=? AND actor_did=?",
      )
      .run(first, next, anchor, contentDigest, goalRef.id, actor);
    return { id: eventId, sequence: next };
  }
  _cursor(head, ref, actor, position, digest) {
    const body = JSON.stringify({
      epoch: head.epoch,
      scope: hash({ actor, goalRef: ref }),
      sequence: position,
      digest,
    });
    return Buffer.from(
      JSON.stringify({ body, signature: mac(head.secret, body) }),
    ).toString("base64url");
  }
  page(goalRef, actor, after) {
    if (!this.db.inTransaction) fail("GOAL_EVENT_TRANSACTION_REQUIRED");
    goalRef = goalExtensionRef(goalRef);
    safe(actor);
    for (const table of [
      "cc_project_goal_event_heads",
      "cc_project_goal_event_journal",
      "cc_project_goal_event_keys",
    ])
      if (
        !this.db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        fail("GOAL_EVENT_HISTORY_UNAVAILABLE");
    const head = this._head(goalRef.id, actor);
    if (!head) {
      if (after !== undefined) fail("GOAL_EVENT_CURSOR_INVALID");
      for (const table of [
        "cc_project_goal_event_journal",
        "cc_project_goal_event_keys",
      ])
        if (
          this.db
            .prepare(
              `SELECT 1 FROM ${table} WHERE goal_id=? AND actor_did=? LIMIT 1`,
            )
            .get(goalRef.id, actor)
        )
          fail();
      return {
        entries: [],
        nextCursor: null,
        hasMore: false,
        retainedFrom: 1,
        highWatermark: 0,
        truncated: false,
      };
    }
    let position = head.first_sequence - 1,
      previous = head.anchor_digest;
    if (after !== undefined) {
      try {
        if (
          typeof after !== "string" ||
          !/^[A-Za-z0-9_-]{1,2048}$/u.test(after)
        )
          fail();
        const decoded = Buffer.from(after, "base64url");
        if (decoded.toString("base64url") !== after) fail();
        const token = JSON.parse(decoded.toString("utf8"));
        exact(token, ["body", "signature"]);
        if (
          typeof token.body !== "string" ||
          !sameMac(token.signature, mac(head.secret, token.body))
        )
          fail();
        const cursor = JSON.parse(token.body);
        exact(cursor, ["epoch", "scope", "sequence", "digest"]);
        if (
          cursor.epoch !== head.epoch ||
          cursor.scope !== hash({ actor, goalRef }) ||
          !/^[a-f0-9]{64}$/u.test(cursor.digest)
        )
          fail();
        position = sequence(cursor.sequence);
        previous = cursor.digest;
      } catch {
        fail("GOAL_EVENT_CURSOR_INVALID");
      }
      if (position < head.first_sequence - 1) fail("GOAL_EVENT_HISTORY_GAP");
      if (position > head.last_sequence) fail("GOAL_EVENT_HISTORY_REGRESSED");
      if (position === head.first_sequence - 1) {
        if (previous !== head.anchor_digest) fail();
      } else {
        const row = this.db
          .prepare(
            "SELECT * FROM cc_project_goal_event_journal WHERE goal_id=? AND actor_did=? AND sequence=?",
          )
          .get(goalRef.id, actor, position);
        this._entry(row, head);
        if (row.content_digest !== previous) fail();
      }
    }
    const rows = this.db
      .prepare(
        `SELECT goal_id,actor_did,sequence,event_id,
      CASE WHEN length(CAST(event_json AS BLOB))<=4096 THEN event_json END AS event_json,
      previous_digest,content_digest,signature FROM cc_project_goal_event_journal
      WHERE goal_id=? AND actor_did=? AND sequence>? ORDER BY sequence LIMIT 20`,
      )
      .all(goalRef.id, actor, position);
    const entries = [];
    for (const row of rows) {
      if (row.sequence !== position + 1 || row.previous_digest !== previous)
        fail("GOAL_EVENT_HISTORY_GAP");
      const event = this._entry(row, head);
      if (
        event.sourceRef.storeId !== goalRef.storeId ||
        event.sourceRef.revision > goalRef.revision ||
        event.sourceRef.controlGeneration > goalRef.controlGeneration
      )
        fail();
      if (
        entries.length &&
        Buffer.byteLength(JSON.stringify([...entries, event])) > 12000
      )
        break;
      entries.push(event);
      position = row.sequence;
      previous = row.content_digest;
    }
    if (
      (rows.length < 20 &&
        entries.length === rows.length &&
        position !== head.last_sequence) ||
      (position === head.last_sequence && previous !== head.last_digest)
    )
      fail("GOAL_EVENT_HISTORY_GAP");
    return {
      entries,
      nextCursor: this._cursor(head, goalRef, actor, position, previous),
      hasMore: position < head.last_sequence,
      retainedFrom: head.first_sequence,
      highWatermark: head.last_sequence,
      truncated: after === undefined && head.first_sequence > 1,
    };
  }
}
module.exports = { ProjectGoalEventJournal };
