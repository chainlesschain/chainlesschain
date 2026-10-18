import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalEvidenceReader,
} = require("../../../session-core/lib/project-goal-evidence-reader.js");
const {
  PersonalProjectGoalService,
} = require("../../../session-core/lib/project-goal-service.js");
const {
  ProjectGoalMonitoringState,
} = require("../../../session-core/lib/project-goal-monitoring.js");
const {
  readOnlyNativeDatabase,
} = require("../../../session-core/lib/read-only-native-database.js");
const {
  formatGoalEvidenceProjection,
} = require("../../../session-core/lib/goal-evidence-contract.js");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
let db, state, goal, actor, now, requestId;
const owner = "did:chainless:owner";
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
function setupState() {
  state = new ProjectGoalMonitoringState({
    db,
    getActor: () => actor,
    clock: () => now,
  });
  state.workflow.descriptionActions.approvalGate = new ApprovalGate({
    confirm: async () => true,
  });
  goal = state.goals.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description"] },
  });
}
function check() {
  now += 1000;
  const key = `check-${++requestId}`;
  state.prepareManual(
    { id: goal.id, expectedRevision: goal.revision, requestId: key },
    () => 1,
  );
  return state.perform(
    {
      occurrence: {
        id: key,
        payload: {
          storeId: goal.storeId,
          goalId: goal.id,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          monitorRevision: null,
          schedulerPolicyRevision: 1,
          requestId: key,
        },
      },
      renewLease: () => {},
      signal: { aborted: false },
    },
    () => {},
  );
}
function prepare(sourceTaskId = "t1", key = "prepare-1") {
  // Fixture selects an existing ID; native prepare still validates the full
  // proposal/source. Avoid repeatedly rendering every other historical intent.
  const row = db
    .prepare(
      "SELECT record_json FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind='proposal' AND json_extract(record_json,'$.sourceTaskId')=? AND json_extract(record_json,'$.actionType')='task.update-description' AND json_extract(record_json,'$.intentId') IS NULL LIMIT 1",
    )
    .get(goal.id, actor, sourceTaskId);
  const proposal = row ? JSON.parse(row.record_json) : null;
  if (!proposal) throw new Error(`No current proposal for ${sourceTaskId}`);
  return state.workflow.prepare({
    goalId: goal.id,
    proposalId: proposal.id,
    expectedRevision: goal.revision,
    requestId: key,
    description: `Native reviewed action ${key}`,
  });
}
function readonlyRead() {
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const schema = db
    .prepare("SELECT sql FROM sqlite_master ORDER BY name")
    .all();
  db.pragma("query_only = ON");
  try {
    const reader = new ProjectGoalEvidenceReader({
      db,
      getActor: () => actor,
      clock: () => now,
    });
    const result = reader.read(ref());
    expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(before);
    expect(
      db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(schema);
    return result;
  } finally {
    db.pragma("query_only = OFF");
  }
}
beforeEach(() => {
  db = new Database(":memory:");
  actor = owner;
  now = Date.now();
  requestId = 0;
  state = null;
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','${owner}','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','PRIVATE ORIGINAL','pending',10,10,0,'synced',20,NULL);`);
  goal = new PersonalProjectGoalService({
    db,
    getActor: () => actor,
    now: () => new Date(now).toISOString(),
  }).create({
    projectId: "p1",
    objective: "Track delivery",
    budgetPolicy: { maxRuns: 200 },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
});
describe("bounded zero-write goal evidence reader", () => {
  it("reports unavailable storage without creating risk, usage, workflow or action tables", () => {
    const value = readonlyRead();
    expect(value).toEqual({
      risk: { state: "unavailable" },
      receipts: { state: "unavailable", entries: [], hasMore: false },
    });
    expect(formatGoalEvidenceProjection(value).riskSummary).toContain(
      "unknown",
    );
  });
  it("distinguishes initialized storage with no check from a zero-risk result", () => {
    setupState();
    const value = readonlyRead();
    expect(value.risk).toEqual({ state: "not-recorded" });
    expect(value.receipts).toEqual({
      state: "recorded",
      entries: [],
      hasMore: false,
    });
  });
  it("reports unavailable receipts when the workflow exists but the action-run store is missing", () => {
    setupState();
    db.exec("DROP TABLE cc_business_action_runs");
    const value = readonlyRead();
    expect(value.receipts).toEqual({
      state: "unavailable",
      entries: [],
      hasMore: false,
    });
    expect(formatGoalEvidenceProjection(value).receiptSummary).toContain(
      "unavailable",
    );
  });
  it("projects validated historical checks and receipts without exposing task text, previews or approval evidence", async () => {
    setupState();
    const risk = check();
    const draft = prepare();
    const run = await state.workflow.execute({ intentId: draft.intent.id });
    const value = readonlyRead();
    expect(value.risk).toMatchObject({
      state: "evaluated",
      reviewId: risk.reviewId,
      riskTaskCount: 1,
      history: true,
      goalRevision: goal.revision,
    });
    expect(value.receipts.entries).toEqual([
      {
        id: run.run.id,
        status: "succeeded",
        actionType: "task.update-description",
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        history: true,
      },
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /PRIVATE ORIGINAL|Native reviewed action|approval|"description":/,
    );
    expect(formatGoalEvidenceProjection(value).riskSummary).toContain(
      "Historical",
    );
  });
  it("returns the newest incomplete check rather than an earlier evaluated observation", () => {
    setupState();
    check();
    db.exec("ALTER TABLE project_tasks DROP COLUMN due_date");
    const latest = check();
    const value = readonlyRead();
    expect(value.risk).toMatchObject({
      state: "insufficient-data",
      reviewId: latest.reviewId,
      riskTaskCount: null,
      reasonCodes: ["SOURCE_SCHEMA_INCOMPLETE"],
    });
    expect(formatGoalEvidenceProjection(value).riskSummary).toContain(
      "unknown",
    );
  });
  it("does not recover or settle a running native action while projecting its unresolved receipt", async () => {
    setupState();
    check();
    let finish;
    state.workflow.descriptionActions.approvalGate = new ApprovalGate({
      confirm: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const draft = prepare();
    const pending = state.workflow.execute({ intentId: draft.intent.id });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const usage = db.prepare("SELECT * FROM cc_project_goal_usage").all();
    try {
      expect(readonlyRead().receipts.entries[0].status).toBe("unresolved");
      expect(db.prepare("SELECT * FROM cc_project_goal_usage").all()).toEqual(
        usage,
      );
    } finally {
      finish(false);
      await pending;
    }
  });
  it.each(["actor", "project", "goal", "store"])(
    "rejects changed %s authority or binding",
    (kind) => {
      setupState();
      check();
      if (kind === "actor") actor = "did:chainless:other";
      if (kind === "project")
        db.exec("UPDATE projects SET user_id='did:chainless:other'");
      if (kind === "goal") goal = { ...goal, revision: goal.revision + 1 };
      if (kind === "store") goal = { ...goal, storeId: "foreign-store" };
      expect(() => readonlyRead()).toThrow();
    },
  );
  it("rejects a corrupt newest check instead of falling back", () => {
    setupState();
    check();
    check();
    db.exec(
      "UPDATE cc_project_goal_checks SET result_digest='bad' WHERE rowid=(SELECT MAX(rowid) FROM cc_project_goal_checks)",
    );
    expect(() => readonlyRead()).toThrow("CHECK_CORRUPT");
  });
  it("rejects oversized receipt evidence before materializing its JSON", async () => {
    setupState();
    check();
    const draft = prepare();
    const run = await state.workflow.execute({ intentId: draft.intent.id });
    db.prepare(
      "UPDATE cc_business_action_runs SET evidence_json=? WHERE id=?",
    ).run(" ".repeat(65537), run.run.id);
    expect(() => readonlyRead()).toThrow("GOAL_EVIDENCE_INVALID");
  });
  it("pages real runs before recent drafts and reports older receipts without claiming completion", async () => {
    setupState();
    const insert = db.prepare(
      "INSERT INTO project_tasks VALUES(?,'p1','query_info','PRIVATE','pending',10,10,0,'synced',20,NULL)",
    );
    for (let i = 2; i <= 48; i++) insert.run(`t${i}`);
    const runs = [];
    for (let i = 1; i <= 21; i++) {
      check();
      const draft = prepare(`t${i}`, `action-${i}`);
      runs.push(
        (await state.workflow.execute({ intentId: draft.intent.id })).run.id,
      );
    }
    check();
    for (let i = 22; i <= 45; i++) prepare(`t${i}`, `draft-${i}`);
    const value = readonlyRead();
    expect(value.receipts.hasMore).toBe(true);
    expect(value.receipts.entries.map((item) => item.id)).toEqual(
      runs.slice(-20).reverse(),
    );
    expect(formatGoalEvidenceProjection(value).receiptSummary).toContain(
      "does not prove goal completion",
    );
  }, 60000);
  it("the facade rejects mutations including row-returning SQL and schema writes", () => {
    const view = readOnlyNativeDatabase(db);
    expect(() => view.exec("CREATE TABLE bad(x)")).toThrow("READ_ONLY");
    expect(() =>
      view.prepare(
        "INSERT INTO projects VALUES('bad','x','active',1,0) RETURNING id",
      ),
    ).toThrow("READ_ONLY");
    expect(() => view.prepare("PRAGMA query_only=OFF")).toThrow("READ_ONLY");
    expect(view.prepare("SELECT COUNT(*) AS n FROM projects").get().n).toBe(1);
    expect(Object.keys(view.prepare("SELECT 1"))).toEqual(["get", "all"]);
  });
});
