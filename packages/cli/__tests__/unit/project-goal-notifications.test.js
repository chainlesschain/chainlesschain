import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalMonitoringState,
} = require("../../../session-core/lib/project-goal-monitoring.js");
const {
  ProjectGoalNotificationService,
} = require("../../../session-core/lib/project-goal-notifications.js");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract.js");
const owner = "did:chainless:owner",
  instant = Date.parse("2026-10-07T01:00:00Z");

describe("native SQLite goal notification source and projection lifecycle", () => {
  let directory, db, state, service, now, actor, sequence;
  function open() {
    db = new Database(join(directory, "project.db"));
    state = new ProjectGoalMonitoringState({
      db,
      getActor: () => actor,
      clock: () => now,
    });
    service = new ProjectGoalNotificationService({
      db,
      getActor: () => actor,
      clock: () => now,
      goals: state.goals,
      risk: state.risk,
    });
  }
  function goal(
    notificationPolicy = { channel: "in-app", mode: "changes-only" },
  ) {
    return state.goals.create({
      projectId: "p1",
      objective: "SECRET OBJECTIVE",
      notificationPolicy,
    });
  }
  // Engineering fixture: real native RiskReview and canonical saved monitoring
  // check; no scheduler claim, production ACL or real business evidence claim.
  function check(g, { decisions = false, abort = false } = {}) {
    const occurrenceId = `check-${++sequence}`;
    return db
      .transaction(() => {
        const review = state.risk.evaluateInTransaction({ projectId: "p1" });
        if (decisions)
          state.workflow.observeInTransaction({
            goalId: g.id,
            reviewId: review.review.id,
          });
        const payload = {
          storeId: g.storeId,
          goalId: g.id,
          goalRevision: g.revision,
          controlGeneration: g.controlGeneration,
          monitorRevision: null,
          requestId: occurrenceId,
          schedulerPolicyRevision: 1,
        };
        const result = {
          goalId: g.id,
          reviewId: review.review.id,
          checkedAt: review.review.createdAt,
          status: review.evaluation.status,
          riskTaskCount: review.evaluation.summary?.riskTaskCount ?? null,
        };
        db.prepare(
          "INSERT INTO cc_project_goal_checks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          occurrenceId,
          g.id,
          owner,
          g.revision,
          g.controlGeneration,
          digest(payload),
          JSON.stringify(payload),
          review.review.id,
          JSON.stringify(result),
          digest(result),
          now,
          0,
        );
        const observation = service.observeInTransaction({
          goalId: g.id,
          occurrenceId,
        });
        if (abort) throw new Error("crash before commit");
        return observation;
      })
      .immediate();
  }
  const notices = () => db.prepare("SELECT * FROM notifications").all();
  const events = (g) => service.list({ goalId: g.id }).events;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-goal-notice-"));
    actor = owner;
    now = instant;
    sequence = 0;
    open();
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES ('p1',?,'active',?,0)").run(
      owner,
      instant,
    );
    db.prepare(
      "INSERT INTO project_tasks VALUES ('t1','p1','pending',?,0,?,NULL,NULL,NULL)",
    ).run(instant, instant - 1);
  });
  afterEach(() => {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("projects only generic references and reopens the authorized goal and source", () => {
    const g = goal(),
      observed = check(g),
      row = notices()[0];
    expect(row.type).toBe("system");
    expect(JSON.parse(row.data)).toEqual({
      schema: "chainlesschain.goal-notice-ref/v1",
      eventId: row.id,
      goalId: g.id,
      projectId: "p1",
      storeId: g.storeId,
      sourceVersion: expect.any(String),
    });
    expect(JSON.stringify(notices())).not.toContain("SECRET OBJECTIVE");
    expect(service.open({ id: row.id })).toMatchObject({
      goal: { id: g.id },
      source: { occurrenceId: observed.id },
    });
    expect(service.readProjection({ id: row.id })).toEqual(row);
    for (const table of [
      "cc_project_goal_notice_events",
      "cc_project_goal_notice_observations",
      "cc_project_goal_notice_state",
    ])
      expect(
        JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()),
      ).not.toContain("SECRET OBJECTIVE");
  });
  it("repeated occurrence and unchanged semantic risk keep one read projection", () => {
    const g = goal(),
      first = check(g),
      row = notices()[0];
    db.prepare("UPDATE notifications SET is_read=1 WHERE id=?").run(row.id);
    expect(
      db
        .transaction(() =>
          service.observeInTransaction({
            goalId: g.id,
            occurrenceId: first.id,
          }),
        )
        .immediate(),
    ).toEqual(first);
    now += 60000;
    db.prepare("UPDATE project_tasks SET updated_at=?").run(now);
    const second = check(g);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].is_read).toBe(1);
    expect(events(g)[0]).toMatchObject({
      source: { occurrenceId: second.id },
      lastCheckedAt: now,
    });
    expect(JSON.parse(notices()[0].data).sourceVersion).not.toBe(
      JSON.parse(row.data).sourceVersion,
    );
  });
  it("records changed risk and clear then the same risk as a new episode", () => {
    const g = goal();
    check(g);
    db.prepare("UPDATE project_tasks SET due_date=?").run(instant - 2);
    now++;
    check(g);
    db.exec("UPDATE project_tasks SET status='completed'");
    now++;
    check(g);
    db.exec("UPDATE project_tasks SET status='pending'");
    now++;
    check(g);
    expect(
      events(g)
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["risk-added", "risk-added", "risk-changed", "risk-cleared"]);
    expect(notices()).toHaveLength(4);
  });
  it("persists source-unknown without claiming cleared risk", () => {
    const g = goal();
    check(g);
    db.exec("UPDATE project_tasks SET status='unrecognized'");
    now++;
    check(g);
    expect(
      events(g)
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["risk-added", "source-unknown"]);
  });
  it("uses saved native proposal observations for decision-needed", () => {
    const g = goal();
    check(g, { decisions: true });
    expect(
      events(g)
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["decision-needed", "risk-added"]);
    now++;
    check(g, { decisions: true });
    expect(events(g)).toHaveLength(2);
  });
  it("silent mode retains a queryable suppressed source without a notification", () => {
    const g = goal({ channel: "in-app", mode: "silent" });
    check(g);
    expect(notices()).toHaveLength(0);
    expect(events(g)[0]).toMatchObject({
      deliveryState: "suppressed",
      deliveryReason: "silent",
    });
    service.flushDue();
    expect(notices()).toHaveLength(0);
    expect(service.open({ id: events(g)[0].id }).source.reviewId).toBeTruthy();
  });
  it("quiet hours survive database reopen and flush once when due", () => {
    const g = goal({
      channel: "in-app",
      mode: "changes-only",
      quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
    });
    check(g);
    expect(events(g)[0]).toMatchObject({
      deliveryState: "pending",
      dueAt: instant + 3600000,
    });
    service.flushDue();
    expect(notices()).toHaveLength(0);
    db.close();
    open();
    now += 3600000;
    service.flushDue();
    service.flushDue();
    expect(notices()).toHaveLength(1);
    expect(events(g)[0].deliveryState).toBe("delivered");
  });
  it.each(["paused", "abandoned"])(
    "blocks old pending delivery after goal becomes %s",
    (status) => {
      let g = goal({
        channel: "in-app",
        mode: "changes-only",
        quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
      });
      check(g);
      g = state.goals.revise({
        id: g.id,
        expectedRevision: g.revision,
        patch: { status },
      });
      now += 3600000;
      service.flushDue();
      expect(notices()).toHaveLength(0);
      expect(events(g)[0].deliveryState).toBe(
        status === "paused" ? "held" : "suppressed",
      );
      if (status === "paused") {
        g = state.goals.revise({
          id: g.id,
          expectedRevision: g.revision,
          patch: { status: "active" },
        });
        service.flushDue();
        expect(notices()).toHaveLength(0);
      }
    },
  );
  it("rechecks ownership and actor before read and due delivery", () => {
    const g = goal();
    check(g);
    const row = notices()[0];
    actor = "did:chainless:other";
    expect(service.readProjection({ id: row.id })).toBeNull();
    expect(() => events(g)).toThrow();
    actor = owner;
    db.exec("UPDATE projects SET user_id='did:chainless:other'");
    expect(service.readProjection({ id: row.id })).toBeNull();
    expect(() => service.open({ id: row.id })).toThrow();
  });
  it("suppresses pending delivery whose personal project ownership was revoked", () => {
    const g = goal({
      channel: "in-app",
      mode: "changes-only",
      quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
    });
    check(g);
    db.exec("UPDATE projects SET user_id='did:chainless:other'");
    now += 3600000;
    service.flushDue();
    expect(notices()).toHaveLength(0);
    expect(
      JSON.parse(
        db
          .prepare("SELECT record_json FROM cc_project_goal_notice_events")
          .get().record_json,
      ),
    ).toMatchObject({
      deliveryState: "suppressed",
      deliveryReason: "source-denied",
    });
  });
  it("check, observation, event and projection all roll back together", () => {
    const g = goal();
    expect(() => check(g, { abort: true })).toThrow("crash before commit");
    for (const table of [
      "cc_project_goal_checks",
      "cc_project_risk_reviews",
      "cc_project_goal_notice_events",
      "cc_project_goal_notice_observations",
      "notifications",
    ])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0);
    check(g);
    expect(notices()).toHaveLength(1);
  });
  it.each(["payload_json", "result_json"])(
    "rejects tampered saved check %s",
    (column) => {
      const g = goal();
      check(g);
      const row = notices()[0];
      db.prepare(`UPDATE cc_project_goal_checks SET ${column}='{}'`).run();
      expect(service.readProjection({ id: row.id })).toBeNull();
      expect(() => events(g)).toThrow();
    },
  );
  it("rejects tampered event/source digests and notification references", () => {
    const g = goal();
    check(g);
    const row = notices()[0];
    db.prepare("UPDATE notifications SET data='{}'").run();
    expect(service.readProjection({ id: row.id })).toBeNull();
    db.prepare(
      "UPDATE cc_project_goal_notice_events SET content_digest='broken'",
    ).run();
    expect(() => events(g)).toThrow("GOAL_NOTICE_SOURCE_CORRUPT");
  });
  it("requires caller native transaction for observation and projection composition", () => {
    const g = goal();
    const observation = check(g);
    expect(() =>
      service.observeInTransaction({
        goalId: g.id,
        occurrenceId: observation.id,
      }),
    ).toThrow("GOAL_NOTICE_TRANSACTION_REQUIRED");
    expect(() => service.readProjectionInTransaction(notices()[0].id)).toThrow(
      "GOAL_NOTICE_TRANSACTION_REQUIRED",
    );
    expect(
      db
        .transaction(() => service.readProjectionInTransaction(notices()[0].id))
        .immediate(),
    ).toMatchObject({ type: "system" });
    expect(() =>
      db
        .transaction(
          () =>
            new ProjectGoalNotificationService({ db, getActor: () => actor }),
        )
        .immediate(),
    ).toThrow("GOAL_NOTICE_TRANSACTION_BUSY");
  });
  it("does not use source review data after task ownership becomes organizational", () => {
    const g = goal();
    check(g);
    const row = notices()[0];
    db.exec("UPDATE project_tasks SET org_id='org-other'");
    expect(service.readProjection({ id: row.id })).toBeNull();
    expect(() => service.open({ id: row.id })).toThrow();
  });
  it("rejects a changed RiskReview digest and unauthorized generic fallback text", () => {
    const g = goal();
    check(g);
    const row = notices()[0];
    db.exec(
      "UPDATE cc_project_risk_reviews SET content_digest='broken'; UPDATE notifications SET title='stale secret',content='stale body'",
    );
    expect(service.readProjection({ id: row.id })).toBeNull();
    expect(() => service.open({ id: row.id })).toThrow();
  });
  it("rejects extra event fields even with a recomputed metadata digest", () => {
    const g = goal();
    check(g);
    const row = db.prepare("SELECT * FROM cc_project_goal_notice_events").get();
    const record = {
      ...JSON.parse(row.record_json),
      objectiveBody: "unexpected body",
    };
    db.prepare(
      "UPDATE cc_project_goal_notice_events SET record_json=?,content_digest=? WHERE id=?",
    ).run(JSON.stringify(record), digest(record), row.id);
    expect(service.readProjection({ id: row.id })).toBeNull();
  });
  it("an identity change while validating a review rolls back source and projection", () => {
    const g = goal(),
      read = state.risk.getReviewInTransaction.bind(state.risk);
    state.risk.getReviewInTransaction = (input) => {
      const result = read(input);
      actor = "did:chainless:other";
      return result;
    };
    expect(() => check(g)).toThrow();
    expect(notices()).toHaveLength(0);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks").get().n,
    ).toBe(0);
  });
});
