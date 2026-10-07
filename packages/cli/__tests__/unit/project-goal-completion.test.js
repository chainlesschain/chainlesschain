import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalCompletionService,
} = require("../../../session-core/lib/project-goal-completion.js");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract.js");
const owner = "did:chainless:owner";
const tasksCriterion = {
  id: "tasks",
  kind: "business-assertion",
  description: "Every live task completed",
};
const manualCriterion = {
  id: "owner",
  kind: "manual",
  description: "Owner reviewed the delivered result",
};
const taskAssertion = { criterionId: "tasks", type: "all-tasks-completed" };

describe("independent native business completion and owner acceptance", () => {
  let db, actor, now, confirm, service, g;
  const request = (requestId = "check-1") => ({
    goalId: g.id,
    expectedRevision: g.revision,
    requestId,
  });
  function configure(
    criteria = [tasksCriterion],
    assertions = [taskAssertion],
  ) {
    const configured = service.configure({
      goalId: g.id,
      expectedRevision: g.revision,
      acceptanceCriteria: criteria,
      assertions,
    });
    g = configured.goal;
    return configured;
  }
  function usage() {
    const goal = service.goals.get({ id: g.id });
    return db.transaction(() => service.usage.summary(goal, owner)).immediate();
  }
  function doneTasks() {
    db.prepare(
      "UPDATE project_tasks SET status='completed',updated_at=11",
    ).run();
  }
  function rehash(recordId, change) {
    const row = db
      .prepare("SELECT record_json FROM cc_project_goal_acceptance WHERE id=?")
      .get(recordId);
    const value = JSON.parse(row.record_json);
    change(value);
    db.prepare(
      "UPDATE cc_project_goal_acceptance SET record_json=?,content_digest=? WHERE id=?",
    ).run(JSON.stringify(value), digest(value), recordId);
  }
  beforeEach(() => {
    db = new Database(":memory:");
    actor = owner;
    now = 1791244800000;
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
    confirm = vi.fn(async () => true);
    service = new ProjectGoalCompletionService({
      db,
      getActor: () => actor,
      clock: () => now,
      approvalGate: new ApprovalGate({ confirm }),
    });
    g = service.goals.create({
      projectId: "p1",
      objective: "Follow delivery",
      budgetPolicy: { maxRuns: 50 },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db?.open) db.close();
  });

  it("requires an explicit typed plan and does not infer conditions from prose", () => {
    expect(() => service.complete(request())).toThrow(
      "GOAL_COMPLETION_PLAN_REQUIRED",
    );
    expect(usage().totalRuns).toBe(0);
    expect(service.goals.get({ id: g.id }).status).toBe("active");
  });
  it("binds the configured plan to a new goal revision/control generation", () => {
    const old = g,
      result = configure([tasksCriterion, manualCriterion]);
    expect(result.goal.revision).toBe(old.revision + 1);
    expect(result.goal.controlGeneration).toBe(old.controlGeneration + 1);
    expect(result.plan.manualCriterionIds).toEqual(["owner"]);
    expect(service.status({ goalId: g.id }).plan).toEqual(result.plan);
  });
  it.each([
    [{ ...taskAssertion, type: "custom-sql", sql: "UPDATE projects" }],
    [{ ...taskAssertion, criterionId: "unknown" }],
    [taskAssertion, taskAssertion],
    [
      {
        criterionId: "tasks",
        type: "selected-risk-signals-cleared",
        reasonCodes: ["made-up"],
      },
    ],
  ])(
    "refuses unsupported or contradictory mappings atomically: %j",
    (assertions) => {
      expect(() => configure([tasksCriterion], assertions)).toThrow();
      expect(service.goals.get({ id: g.id }).revision).toBe(1);
      expect(
        db.prepare("SELECT count(*) AS n FROM cc_project_goal_acceptance").get()
          .n,
      ).toBe(0);
    },
  );
  it("retains a paid failed assertion and never completes from progress=100", () => {
    configure();
    db.prepare("UPDATE cc_project_goals SET goal_json=? WHERE id=?").run(
      JSON.stringify({ ...g, progress: 100 }),
      g.id,
    );
    const result = service.complete(request("complete-1"));
    expect(result).toMatchObject({
      completed: false,
      goal: { status: "active", completion: null, progress: 100 },
      report: { met: false },
    });
    expect(result.report.criteria[0]).toMatchObject({
      met: false,
      reason: "project-tasks-incomplete",
      observation: { taskCount: 1, incompleteCount: 1 },
    });
    expect(usage()).toMatchObject({
      totalRuns: 1,
      modelTokens: 0,
      modelCostUsd: 0,
    });
    expect(service.status({ goalId: g.id }).reports[0]).toEqual(result.report);
  });
  it.each(["empty", "cancelled", "incomplete-schema"])(
    "does not treat %s project data as all tasks completed",
    (kind) => {
      configure();
      if (kind === "empty") db.exec("DELETE FROM project_tasks");
      if (kind === "cancelled")
        db.exec("UPDATE project_tasks SET status='cancelled'");
      if (kind === "incomplete-schema")
        db.exec(
          "DROP TABLE project_tasks; CREATE TABLE project_tasks(id TEXT,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER)",
        );
      expect(service.complete(request()).completed).toBe(false);
      expect(usage().totalRuns).toBe(1);
    },
  );
  it("rechecks native rows at completion instead of using a previous positive inspection", () => {
    configure();
    doneTasks();
    expect(service.inspect(request()).report.met).toBe(true);
    db.exec("UPDATE project_tasks SET status='pending'");
    const result = service.complete(request("complete-current"));
    expect(result.completed).toBe(false);
    expect(result.goal.status).toBe("active");
    expect(usage().totalRuns).toBe(2);
  });
  it("commits completion, fresh proof, usage and disabling the monitor in one native transaction", () => {
    configure();
    doneTasks();
    db.exec(`CREATE TABLE cc_project_goal_monitors(goal_id TEXT PRIMARY KEY,actor_did TEXT,revision INTEGER,enabled INTEGER);
      INSERT INTO cc_project_goal_monitors VALUES ('${g.id}','${owner}',1,1)`);
    const params = request("complete-1"),
      result = service.complete(params);
    expect(result).toMatchObject({
      completed: true,
      goal: { status: "done", progress: 100 },
      report: { met: true },
    });
    expect(result.goal.completion.evidenceRefs).toEqual([
      {
        kind: "native-goal-completion",
        id: result.report.id,
        version: digest(result.report),
      },
    ]);
    expect(
      db.prepare("SELECT enabled,revision FROM cc_project_goal_monitors").get(),
    ).toEqual({ enabled: 0, revision: 2 });
    expect(usage().totalRuns).toBe(1);
    expect(service.complete(params)).toMatchObject({
      completed: true,
      replayed: true,
      report: result.report,
    });
    expect(usage().totalRuns).toBe(1);
  });
  it("allows acceptance of native completed projects instead of requiring them still active", () => {
    configure();
    doneTasks();
    db.exec("UPDATE projects SET status='completed'");
    expect(service.complete(request()).completed).toBe(true);
  });
  it("does not silently change the project lifecycle when a selected signal criterion passes", () => {
    configure(
      [
        {
          id: "deadline",
          kind: "business-assertion",
          description: "No overdue task signal",
        },
      ],
      [
        {
          criterionId: "deadline",
          type: "selected-risk-signals-cleared",
          reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
        },
      ],
    );
    db.exec(
      "UPDATE project_tasks SET due_date=1791244801000,blocked_by='[\"t2\"]'; INSERT INTO project_tasks VALUES ('t2','p1','query_info','Dependency','pending',10,10,0,'synced',NULL,NULL)",
    );
    const result = service.complete(request());
    expect(result.completed).toBe(true);
    expect(result.report.criteria[0].observation.reasonCodes).toEqual([
      "OVERDUE_INCOMPLETE_TASK",
    ]);
    expect(db.prepare("SELECT status FROM projects").get().status).toBe(
      "active",
    );
    expect(
      service.risk.evaluate({ projectId: "p1" }).evaluation.summary
        .blockedTaskCount,
    ).toBe(1);
  });
  it("requires an actual native owner confirmation for manual acceptance", async () => {
    configure([manualCriterion], []);
    expect(service.inspect(request()).report.met).toBe(false);
    const ackInput = request("owner-confirmation");
    const accepted = await service.acknowledge(ackInput);
    expect(accepted.acknowledgement.status).toBe("accepted");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      policy: "strict",
      riskLevel: "high",
      actorDid: owner,
      criteria: [manualCriterion],
    });
    const result = service.complete(request("complete-owner"));
    expect(result.completed).toBe(true);
    expect(result.report.ackIds).toEqual([accepted.acknowledgement.id]);
    expect((await service.acknowledge(ackInput)).replayed).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("keeps cancelled owner acceptance insufficient", async () => {
    configure([manualCriterion], []);
    confirm.mockResolvedValue(false);
    expect(
      (await service.acknowledge(request("ack"))).acknowledgement.status,
    ).toBe("cancelled");
    expect(service.complete(request()).completed).toBe(false);
  });
  it.each(["pause", "revision", "expiry", "identity", "ownership"])(
    "invalidates manual confirmation on %s before recording acceptance",
    async (change) => {
      if (change === "expiry")
        g = service.goals.revise({
          id: g.id,
          expectedRevision: g.revision,
          patch: { expiresAt: new Date(now + 1000).toISOString() },
        });
      configure([manualCriterion], []);
      const params = request("owner-confirmation");
      confirm.mockImplementation(async () => {
        if (change === "pause")
          service.goals.revise({
            id: g.id,
            expectedRevision: g.revision,
            patch: { status: "paused" },
          });
        if (change === "revision")
          service.goals.revise({
            id: g.id,
            expectedRevision: g.revision,
            patch: { objective: "Different acceptance scope" },
          });
        if (change === "expiry") now += 1000;
        if (change === "identity") actor = null;
        if (change === "ownership")
          db.exec("UPDATE projects SET user_id='did:other'");
        return true;
      });
      await expect(service.acknowledge(params)).rejects.toThrow();
      const ack = JSON.parse(
        db
          .prepare(
            "SELECT record_json FROM cc_project_goal_acceptance WHERE kind='ack'",
          )
          .get().record_json,
      );
      expect(ack.status).toBe("denied");
      expect(ack.decision.decision).toBe("deny");
    },
  );
  it("refuses backwards time as an accepted owner proof", async () => {
    configure([manualCriterion], []);
    confirm.mockImplementation(async () => {
      now -= 1;
      return true;
    });
    await expect(service.acknowledge(request("ack"))).rejects.toThrow(
      "GOAL_CLOCK_MOVED_BACKWARDS",
    );
    const ack = JSON.parse(
      db
        .prepare(
          "SELECT record_json FROM cc_project_goal_acceptance WHERE kind='ack'",
        )
        .get().record_json,
    );
    expect(ack.status).toBe("denied");
    expect(ack.completedAt).toBeGreaterThanOrEqual(ack.startedAt);
  });
  it("does not use old owner acceptance for a revised goal", async () => {
    configure([manualCriterion], []);
    await service.acknowledge(request("ack"));
    configure([manualCriterion], []);
    expect(service.complete(request()).completed).toBe(false);
  });
  it("blocks completion while a durable action remains prepared and preserves its historical check", async () => {
    g = service.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { allowedActionTypes: ["task.update-description"] },
    });
    configure(
      [
        {
          id: "actions",
          kind: "business-assertion",
          description: "All goal action intents resolved",
        },
      ],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    const review = service.risk.evaluate({ projectId: "p1" });
    db.transaction(() =>
      service.workflow.observeInTransaction({
        goalId: g.id,
        reviewId: review.review.id,
      }),
    ).immediate();
    const proposal = service.workflow
      .list({ goalId: g.id })
      .proposals.find(
        (item) => item.proposal.actionType === "task.update-description",
      ).proposal;
    const prepared = service.workflow.prepare({
      goalId: g.id,
      proposalId: proposal.id,
      expectedRevision: g.revision,
      requestId: "action-1",
      description: "Owner note",
    });
    const failed = service.inspect(request());
    expect(failed.report.met).toBe(false);
    expect(failed.report.criteria[0].observation).toEqual({
      actionCount: 1,
      unresolvedCount: 1,
    });
    await service.workflow.execute({ intentId: prepared.intent.id });
    expect(service.complete(request("complete-actions")).completed).toBe(true);
    expect(
      service
        .status({ goalId: g.id })
        .reports.find((report) => report.id === failed.report.id),
    ).toEqual(failed.report);
  });
  it("persists truthful time overruns but leaves the goal active and future bounded checks blocked", () => {
    g = service.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxTimeMs: 5 } },
    });
    configure();
    doneTasks();
    const evaluate = service.risk.evaluateInTransaction.bind(service.risk);
    vi.spyOn(service.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 6;
        return result;
      },
    );
    const result = service.complete(request());
    expect(result).toMatchObject({
      completed: false,
      goal: { status: "active" },
      report: {
        blockedReason: "GOAL_COMPLETION_BUDGET_EXCEEDED",
        elapsedMs: 6,
      },
    });
    expect(usage()).toMatchObject({ totalRuns: 1, elapsedMs: 6 });
    expect(() => service.complete(request("again"))).toThrow(
      "GOAL_USAGE_BUDGET_EXHAUSTED",
    );
  });
  it("does not complete if evidence persistence crosses the goal deadline, and retains usage", () => {
    g = service.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { expiresAt: new Date(now + 1000).toISOString() },
    });
    configure();
    doneTasks();
    const save = service._save.bind(service);
    let advanced = false;
    vi.spyOn(service, "_save").mockImplementation((record, kind) => {
      const result = save(record, kind);
      if (kind === "check" && !advanced) {
        advanced = true;
        now += 2000;
      }
      return result;
    });
    const result = service.complete(request());
    expect(result).toMatchObject({
      completed: false,
      goal: { status: "active", completion: null },
      report: { blockedReason: "GOAL_COMPLETION_EXPIRED", elapsedMs: 2000 },
    });
    expect(usage()).toMatchObject({ totalRuns: 1, elapsedMs: 2000 });
  });
  it("rolls back goal, receipt, source and usage if the completion CAS cannot commit", () => {
    configure();
    doneTasks();
    db.exec(
      "CREATE TRIGGER reject_goal BEFORE UPDATE ON cc_project_goals WHEN json_extract(NEW.goal_json,'$.status')='done' BEGIN SELECT RAISE(ABORT,'goal refused'); END",
    );
    expect(() => service.complete(request())).toThrow("GOAL_STORAGE_FAILED");
    expect(service.goals.get({ id: g.id }).status).toBe("active");
    expect(usage().totalRuns).toBe(0);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_project_goal_acceptance WHERE kind='check'",
        )
        .get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_risk_reviews").get().n,
    ).toBe(0);
  });
  it.each(["usage", "report", "proof-version", "plan", "manual-observation"])(
    "rejects corrupted %s history rather than replaying or recharging",
    async (kind) => {
      configure([tasksCriterion, manualCriterion]);
      doneTasks();
      await service.acknowledge(request("ack"));
      const params = request("complete-1"),
        result = service.complete(params);
      if (kind === "usage")
        db.prepare(
          "DELETE FROM cc_project_goal_usage WHERE operation_id=?",
        ).run(result.report.id);
      if (kind === "report")
        rehash(result.report.id, (report) => {
          report.criteria[0].observation.incompleteCount = 1;
        });
      if (kind === "manual-observation")
        rehash(result.report.id, (report) => {
          report.criteria.find(
            (criterion) => criterion.type === "manual",
          ).observation.acknowledgementId = "foreign";
        });
      if (kind === "plan")
        rehash(result.report.planId, (plan) => {
          plan.assertions[0].type = "all-goal-actions-resolved";
        });
      if (kind === "proof-version") {
        const goal = structuredClone(service.goals.get({ id: g.id }));
        goal.completion.evidenceRefs[0].version = "sha256:" + "f".repeat(64);
        db.prepare("UPDATE cc_project_goals SET goal_json=? WHERE id=?").run(
          JSON.stringify(goal),
          g.id,
        );
      }
      expect(() => service.complete(params)).toThrow(
        /GOAL_(COMPLETION_RECORD|RECORD|USAGE_RECORD)_CORRUPT/,
      );
    },
  );
  it("rejects serialized completion/approval claims and a changed request identity", () => {
    configure();
    expect(() =>
      service.complete({ ...request(), met: true, proof: {} }),
    ).toThrow("GOAL_COMPLETION_INVALID_REQUEST");
    service.inspect(request());
    expect(() => service.complete(request())).toThrow(
      "GOAL_COMPLETION_REQUEST_CONFLICT",
    );
  });
  it("requires native transaction ownership for composing a goal CAS", () => {
    expect(() =>
      service.adapter.compareAndSwapInTransaction(
        g.id,
        g.revision,
        (goal) => goal,
      ),
    ).toThrow("GOAL_TRANSACTION_REQUIRED");
  });
});
