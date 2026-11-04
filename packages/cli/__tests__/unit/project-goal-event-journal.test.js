import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  PersonalProjectGoalService,
} = require("../../../session-core/lib/project-goal-service.js");
const {
  ProjectGoalMonitoringState,
} = require("../../../session-core/lib/project-goal-monitoring.js");
const {
  ProjectGoalEvidenceReader,
} = require("../../../session-core/lib/project-goal-evidence-reader.js");
const {
  ProjectGoalEventJournal,
} = require("../../../session-core/lib/project-goal-event-journal.js");
const {
  validateGoalEventHistoryPage,
} = require("../../../session-core/lib/goal-evidence-contract.js");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
let directory, file, db, goal, state, actor, now, request;
const owner = "did:chainless:owner";
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
function initialize() {
  state = new ProjectGoalMonitoringState({
    db,
    getActor: () => actor,
    clock: () => now,
  });
  state.workflow.descriptionActions.approvalGate = new ApprovalGate({
    confirm: async () => true,
  });
}
function check() {
  now += 1000;
  const requestId = `event-check-${++request}`;
  state.prepareManual(
    { id: goal.id, expectedRevision: goal.revision, requestId },
    () => 1,
  );
  return state.perform(
    {
      occurrence: {
        id: requestId,
        payload: {
          storeId: goal.storeId,
          goalId: goal.id,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          monitorRevision: null,
          schedulerPolicyRevision: 1,
          requestId,
        },
      },
      renewLease: () => {},
      signal: { aborted: false },
    },
    () => {},
  );
}
function page(after) {
  const changes = db.prepare("SELECT total_changes() AS n").get().n;
  const schema = db
    .prepare("SELECT sql FROM sqlite_master ORDER BY name")
    .all();
  db.pragma("query_only=ON");
  try {
    const value = new ProjectGoalEvidenceReader({
      db,
      getActor: () => actor,
      clock: () => now,
    }).readEventPage(ref(), after);
    expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(changes);
    expect(
      db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(schema);
    return validateGoalEventHistoryPage(value, ref(), after);
  } finally {
    db.pragma("query_only=OFF");
  }
}
function synthetic(journal, n, extra = {}) {
  return journal.append({
    goalRef: ref(),
    actor,
    sourceId: `synthetic-${n}`,
    type: "risk.review.completed",
    state: "evaluated",
    riskTaskCount: 1,
    recordedAt: new Date(now).toISOString(),
    ...extra,
  });
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-journal-"));
  file = path.join(directory, "project.sqlite");
  db = new Database(file);
  actor = owner;
  now = Date.now();
  request = 0;
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
  CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
  INSERT INTO projects VALUES('p1','${owner}','active',10,0);
  INSERT INTO project_tasks VALUES('t1','p1','query_info','PRIVATE ORIGINAL','pending',10,10,0,'synced',20,NULL);`);
  const service = new PersonalProjectGoalService({
    db,
    getActor: () => actor,
    now: () => new Date(now).toISOString(),
  });
  goal = service.create({
    projectId: "p1",
    objective: "PRIVATE OBJECTIVE",
    budgetPolicy: { maxRuns: 200 },
  });
  goal = service.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description"] },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe("transactional goal event history", () => {
  it("does not initialize missing history during read-only access", () => {
    expect(() => page()).toThrow("GOAL_EVENT_HISTORY_UNAVAILABLE");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='cc_project_goal_event_heads'",
        )
        .get(),
    ).toBeUndefined();
  });
  it("distinguishes initialized empty history from unavailable history", () => {
    initialize();
    expect(page()).toMatchObject({
      entries: [],
      nextCursor: null,
      highWatermark: 0,
      hasMore: false,
      truncated: false,
    });
  });
  it("pages real persisted checks in commit order and resumes after a full database restart", () => {
    initialize();
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push(check().reviewId);
    const first = page();
    expect(first.entries.map((x) => x.sourceId)).toEqual(ids.slice(0, 20));
    expect(first.hasMore).toBe(true);
    expect(first.highWatermark).toBe(25);
    db.close();
    db = new Database(file);
    const second = page(first.nextCursor);
    expect(second.entries.map((x) => x.sourceId)).toEqual(ids.slice(20));
    expect(second.hasMore).toBe(false);
    expect(page(second.nextCursor).entries).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(
      /PRIVATE|secret|actor_did|signature/,
    );
  });
  it("keeps both running and terminal action events in the native action transactions", async () => {
    initialize();
    check();
    const proposal = state.workflow
      .list({ goalId: goal.id })
      .proposals.find(
        (item) => item.proposal.actionType === "task.update-description",
      ).proposal;
    const prepared = state.workflow.prepare({
      goalId: goal.id,
      proposalId: proposal.id,
      expectedRevision: goal.revision,
      requestId: "event-action",
      description: "PRIVATE ACTION",
    });
    const result = await state.workflow.execute({
      intentId: prepared.intent.id,
    });
    const value = page();
    expect(value.entries.map((x) => x.state)).toEqual([
      "evaluated",
      "unresolved",
      "succeeded",
    ]);
    expect(value.entries.slice(1).map((x) => x.sourceId)).toEqual([
      result.run.id,
      result.run.id,
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /PRIVATE ACTION|approvalRef|preview/,
    );
    await state.workflow.execute({ intentId: prepared.intent.id });
    expect(page().entries).toEqual(value.entries);
  });
  it("rolls back the check when appending its event fails", () => {
    initialize();
    vi.spyOn(state.workflow.events, "append").mockImplementation(() => {
      throw new Error("EVENT_SAVE_FAILED");
    });
    expect(() => check()).toThrow("GOAL_STORAGE_FAILED");
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_goal_checks").get().n,
    ).toBe(0);
    expect(page().entries).toEqual([]);
  });
  it("rolls back the business write when its terminal event cannot be saved", async () => {
    initialize();
    check();
    const proposal = state.workflow
      .list({ goalId: goal.id })
      .proposals.find(
        (item) => item.proposal.actionType === "task.update-description",
      ).proposal;
    const prepared = state.workflow.prepare({
      goalId: goal.id,
      proposalId: proposal.id,
      expectedRevision: goal.revision,
      requestId: "event-failure",
      description: "MUST ROLLBACK",
    });
    const append = state.workflow.events.append.bind(state.workflow.events);
    vi.spyOn(state.workflow.events, "append").mockImplementation((input) => {
      if (input.state === "succeeded") throw new Error("EVENT_SAVE_FAILED");
      return append(input);
    });
    try {
      await state.workflow.execute({ intentId: prepared.intent.id });
    } catch {}
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("PRIVATE ORIGINAL");
    expect(page().entries.some((x) => x.state === "succeeded")).toBe(false);
  });
  it("does not append events or advance sequence for a rolled-back transaction", () => {
    initialize();
    const journal = state.workflow.events;
    expect(() =>
      db
        .transaction(() => {
          synthetic(journal, 1);
          throw new Error("rollback");
        })
        .immediate(),
    ).toThrow("rollback");
    expect(page().highWatermark).toBe(0);
    db.transaction(() => synthetic(journal, 1)).immediate();
    expect(page().entries[0].sequence).toBe(1);
  });
  it("requires a native transaction for journal writes", () => {
    initialize();
    expect(() => synthetic(state.workflow.events, 1)).toThrow(
      "TRANSACTION_REQUIRED",
    );
  });
  it("reports an explicit retention gap and preserves duplicate identity after eviction", () => {
    initialize();
    const journal = state.workflow.events;
    db.transaction(() => synthetic(journal, 0)).immediate();
    const old = page().nextCursor;
    db.transaction(() => {
      for (let i = 1; i <= 1001; i++) synthetic(journal, i);
    }).immediate();
    expect(() => page(old)).toThrow("HISTORY_GAP");
    const first = page();
    expect(first).toMatchObject({
      retainedFrom: 3,
      highWatermark: 1002,
      truncated: true,
    });
    db.transaction(() => synthetic(journal, 0)).immediate();
    expect(page().highWatermark).toBe(1002);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_project_goal_event_journal")
        .get().n,
    ).toBe(1000);
  });
  it("bounds pages by UTF-8 bytes without skipping sequences", () => {
    initialize();
    db.transaction(() => {
      for (let i = 0; i < 30; i++)
        synthetic(state.workflow.events, i, {
          sourceId: `${i}:` + "变".repeat(250),
        });
    }).immediate();
    let after,
      count = 0;
    do {
      const value = page(after);
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(
        16384,
      );
      count += value.entries.length;
      after = value.nextCursor;
      if (!value.hasMore) break;
    } while (count < 31);
    expect(count).toBe(30);
  });
  it("rejects forged, cross-goal and cross-revision cursors", () => {
    initialize();
    check();
    const token = page().nextCursor;
    const raw = JSON.parse(Buffer.from(token, "base64url").toString());
    raw.body = raw.body.replace('"sequence":1', '"sequence":0');
    expect(() =>
      page(Buffer.from(JSON.stringify(raw)).toString("base64url")),
    ).toThrow("CURSOR_INVALID");
    const originalGoal = goal;
    goal = state.goals.create({ projectId: "p1", objective: "Another goal" });
    db.transaction(() => synthetic(state.workflow.events, 9999)).immediate();
    expect(() => page(token)).toThrow("CURSOR_INVALID");
    goal = originalGoal;
    goal = state.goals.revise({
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { objective: "Revised" },
    });
    expect(() => page(token)).toThrow("CURSOR_INVALID");
  });
  it("rechecks current identity instead of treating a cursor as authorization", () => {
    initialize();
    check();
    const token = page().nextCursor;
    actor = "did:chainless:other";
    expect(() => page(token)).toThrow();
  });
  it.each(["delete-middle", "tamper-body", "delete-tail", "delete-head"])(
    "rejects %s instead of returning an empty successful page",
    (mode) => {
      initialize();
      check();
      check();
      check();
      if (mode === "delete-middle")
        db.prepare(
          "DELETE FROM cc_project_goal_event_journal WHERE sequence=2",
        ).run();
      if (mode === "delete-tail")
        db.prepare(
          "DELETE FROM cc_project_goal_event_journal WHERE sequence=3",
        ).run();
      if (mode === "tamper-body")
        db.prepare(
          "UPDATE cc_project_goal_event_journal SET event_json=json_set(event_json,'$.riskTaskCount',0) WHERE sequence=2",
        ).run();
      if (mode === "delete-head")
        db.prepare("DELETE FROM cc_project_goal_event_heads").run();
      expect(() => page()).toThrow();
    },
  );
  it("rejects a cursor ahead of a restored older journal", () => {
    initialize();
    check();
    check();
    const token = page().nextCursor;
    const prior = db
      .prepare(
        "SELECT content_digest FROM cc_project_goal_event_journal WHERE sequence=1",
      )
      .get();
    db.transaction(() => {
      db.prepare(
        "DELETE FROM cc_project_goal_event_journal WHERE sequence=2",
      ).run();
      db.prepare(
        "UPDATE cc_project_goal_event_heads SET last_sequence=1,last_digest=?",
      ).run(prior.content_digest);
    }).immediate();
    expect(() => page(token)).toThrow("HISTORY_REGRESSED");
  });
});
