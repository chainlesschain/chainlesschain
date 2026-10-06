import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalWorkflow,
} = require("../../../session-core/lib/project-goal-workflow.js");
const {
  TaskDescriptionActionService,
} = require("../../../session-core/lib/task-description-action-service.js");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
const owner = "did:chainless:owner";

describe("durable personal goal proposals and native action lineage", () => {
  let directory, db, workflow, actor, now, confirm, g;
  function open() {
    db = new Database(join(directory, "project.sqlite"));
    workflow = new ProjectGoalWorkflow({
      db,
      getActor: () => actor,
      clock: () => now,
      approvalGate: new ApprovalGate({ confirm }),
    });
  }
  function reopen() {
    db.close();
    open();
  }
  function observe() {
    const review = workflow.risk.evaluate({ projectId: "p1" });
    db.transaction(() =>
      workflow.observeInTransaction({
        goalId: g.id,
        reviewId: review.review.id,
      }),
    ).immediate();
    return review;
  }
  function proposal(type = "task.update-description") {
    return workflow
      .list({ goalId: g.id })
      .proposals.find(
        (item) =>
          item.proposal.goalRevision === g.revision &&
          item.proposal.actionType === type,
      ).proposal;
  }
  function prepare(type = "task.update-description", extra = {}) {
    return workflow.prepare({
      goalId: g.id,
      proposalId: proposal(type).id,
      expectedRevision: g.revision,
      requestId: "owner-request",
      description: "Owner reviewed the delivery risk",
      ...(type === "task.create" ? { taskType: "query_info" } : {}),
      ...extra,
    });
  }
  function taskCount() {
    return db.prepare("SELECT count(*) AS n FROM project_tasks").get().n;
  }
  function usage() {
    return db.transaction(() => workflow.usage.summary(g, owner)).immediate();
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-goal-workflow-"));
    now = 1791244800000;
    actor = owner;
    confirm = vi.fn(async () => true);
    open();
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
    g = workflow.goals.create({
      projectId: "p1",
      objective: "Follow delivery",
      budgetPolicy: { maxRuns: 10 },
    });
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { allowedActionTypes: ["task.update-description", "task.create"] },
    });
    observe();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("generates only suggestions and deduplicates repeated checks including row update timestamps", () => {
    const first = workflow.list({ goalId: g.id });
    now += 1000;
    db.prepare("UPDATE project_tasks SET updated_at=11").run();
    observe();
    const second = workflow.list({ goalId: g.id });
    expect(second.proposals.map((item) => item.proposal.id)).toEqual(
      first.proposals.map((item) => item.proposal.id),
    );
    expect(second.proposals[0].proposal.lastSeenAt).toBe(now);
    expect(taskCount()).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(usage().totalRuns).toBe(0);
  });
  it.each(["task.update-description", "task.create"])(
    "stores exact source and atomically links native %s receipt",
    async (type) => {
      const prepared = prepare(type);
      const { request } = prepared.intent.preview;
      expect(prepared.intent.status).toBe("prepared");
      expect(request.input.goalIntent.id).toBe(prepared.intent.id);
      expect(prepare(type)).toEqual(prepared);
      const receipt = await workflow.execute({ intentId: prepared.intent.id });
      expect(receipt.run.status).toBe("succeeded");
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0].policy).toBe("strict");
      expect(confirm.mock.calls[0][0].riskLevel).toBe("high");
      const saved = workflow.getIntent({ intentId: prepared.intent.id });
      expect(saved.receipt.run).toEqual(receipt.run);
      expect(saved.intent.runId).toBe(receipt.run.id);
      expect(saved.intent.status).toBe("succeeded");
      const lineage = workflow.risk.getLineage({
        reviewId: prepared.intent.reviewId,
      });
      expect(lineage.actionRuns[0].run).toEqual(receipt.run);
      expect(lineage.actionRuns[0].evidence.map((item) => item.kind)).toEqual([
        "project-risk-review",
        "project-goal-intent",
        "local-user-confirmation",
        type === "task.create"
          ? "sqlite-task-create"
          : "sqlite-task-description-update",
      ]);
      expect(usage()).toMatchObject({
        totalRuns: 1,
        reservedRuns: 0,
        modelTokens: 0,
        modelCostUsd: 0,
      });
      expect(workflow.goals.get({ id: g.id })).toMatchObject({
        status: "active",
        completion: null,
      });
      // Changing a description or adding a follow-up task does not fix a deadline.
      expect(observe().evaluation.summary.riskTaskCount).toBe(1);
    },
  );
  it("replays persisted successful creation after reopen without dispatch or duplicate task", async () => {
    const prepared = prepare("task.create");
    const first = await workflow.execute({ intentId: prepared.intent.id });
    reopen();
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { status: "paused" },
    });
    const second = await workflow.execute({ intentId: prepared.intent.id });
    expect(second.run).toEqual(first.run);
    expect(second.replayed).toBe(true);
    expect(taskCount()).toBe(2);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(usage().totalRuns).toBe(1);
  });
  it("reconstructs a preview from a persisted draft without replacing its request or intent", () => {
    const preview = vi
      .spyOn(workflow.createActions, "preview")
      .mockImplementationOnce(() => {
        throw new Error("interrupted preview");
      });
    expect(() => prepare("task.create")).toThrow("interrupted preview");
    const draft = workflow
      .list({ goalId: g.id })
      .proposals.find((item) => item.proposal.actionType === "task.create")
      .intent.intent;
    expect(draft).toMatchObject({
      status: "draft",
      preview: null,
      requestId: "owner-request",
    });
    preview.mockRestore();
    reopen();
    const prepared = prepare("task.create");
    expect(prepared.intent.id).toBe(draft.id);
    expect(prepared.intent.requestId).toBe(draft.requestId);
    expect(prepared.intent.status).toBe("prepared");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("keeps a live same-process native confirmation reserved during host reconstruction", async () => {
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxTimeMs: 1000 } },
    });
    observe();
    const prepared = prepare("task.create");
    confirm.mockImplementation(async () => {
      const second = new ProjectGoalWorkflow({
        db,
        getActor: () => actor,
        clock: () => now,
      });
      expect(second.recoverUnresolved()).toEqual({ recovered: 0 });
      expect(usage()).toMatchObject({
        reservedRuns: 1,
        elapsedMs: 0,
        unknownTime: 0,
      });
      return true;
    });
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).run.status,
    ).toBe("succeeded");
    expect(taskCount()).toBe(2);
    expect(usage().unknownTime).toBe(0);
  });
  it.each(["pause", "revision", "expiry", "scope", "ownership", "logout"])(
    "invalidates pending native confirmation on %s and retains denied lineage",
    async (change) => {
      if (change === "expiry") {
        g = workflow.goals.revise({
          id: g.id,
          expectedRevision: g.revision,
          patch: { expiresAt: new Date(now + 1000).toISOString() },
        });
        observe();
      }
      const prepared = prepare("task.create");
      confirm.mockImplementation(async () => {
        if (change === "pause")
          g = workflow.goals.revise({
            id: g.id,
            expectedRevision: g.revision,
            patch: { status: "paused" },
          });
        if (change === "revision")
          g = workflow.goals.revise({
            id: g.id,
            expectedRevision: g.revision,
            patch: { objective: "Changed plan" },
          });
        if (change === "expiry") now += 1000;
        if (change === "ownership")
          db.prepare("UPDATE projects SET user_id='did:other'").run();
        if (change === "scope")
          db.exec(
            "CREATE TABLE workspace_resources(resource_type TEXT,resource_id TEXT); INSERT INTO workspace_resources VALUES ('project','p1')",
          );
        if (change === "logout") actor = null;
        return true;
      });
      await expect(
        workflow.execute({ intentId: prepared.intent.id }),
      ).rejects.toThrow();
      expect(taskCount()).toBe(1);
      const stored = JSON.parse(
        db
          .prepare(
            "SELECT record_json FROM cc_project_goal_workflow WHERE id=?",
          )
          .get(prepared.intent.id).record_json,
      );
      expect(stored.status).toBe("denied");
      expect(
        JSON.parse(
          db.prepare("SELECT run_json FROM cc_business_action_runs").get()
            .run_json,
        ).status,
      ).toBe("denied");
      actor = owner;
      db.prepare("UPDATE projects SET user_id=?").run(owner);
      if (change === "scope") db.exec("DELETE FROM workspace_resources");
      expect(
        workflow.getIntent({ intentId: prepared.intent.id }).receipt.run.status,
      ).toBe("denied");
      expect(usage().totalRuns).toBe(0);
    },
  );
  it("rejects stale risk fields before admission without asking or reserving", async () => {
    const prepared = prepare();
    db.prepare("UPDATE project_tasks SET due_date=30").run();
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("PROJECT_RISK_REVIEW_STALE");
    expect(confirm).not.toHaveBeenCalled();
    expect(usage().totalRuns).toBe(0);
  });
  it("never silently creates another action from a consumed proposal, even with a different key", async () => {
    const prepared = prepare("task.create");
    await workflow.execute({ intentId: prepared.intent.id });
    observe();
    expect(() =>
      prepare("task.create", { requestId: "new-owner-request" }),
    ).toThrow("ACTION_GOAL_INTENT_CONFLICT");
    expect(taskCount()).toBe(2);
  });
  it("refuses reused request IDs across different suggestions and parameters", () => {
    prepare();
    expect(() =>
      prepare(undefined, { description: "Changed parameters" }),
    ).toThrow("ACTION_GOAL_INTENT_CONFLICT");
    expect(() => prepare("task.create")).toThrow("ACTION_GOAL_INTENT_CONFLICT");
  });
  it("enforces scope ceiling independently from native confirmation", async () => {
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { allowedActionTypes: [] },
    });
    observe();
    expect(() => prepare()).toThrow("ACTION_GOAL_ACTION_OUT_OF_SCOPE");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("retains cancellation and releases the reservation", async () => {
    confirm.mockResolvedValue(false);
    const prepared = prepare("task.create");
    const receipt = await workflow.execute({ intentId: prepared.intent.id });
    expect(receipt.run.status).toBe("cancelled");
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).intent.status,
    ).toBe("cancelled");
    expect(usage()).toMatchObject({ totalRuns: 0, reservedRuns: 0 });
    expect(taskCount()).toBe(1);
  });
  it("keeps an unresolved receipt after confirmation loss, including restart, and blocks another key", async () => {
    let unblock;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          unblock = resolve;
        }),
    );
    const prepared = prepare("task.create");
    const pending = workflow.execute({ intentId: prepared.intent.id });
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).executionState,
    ).toBe("unresolved");
    const replay = await workflow.execute({ intentId: prepared.intent.id });
    expect(replay.executionState).toBe("unresolved");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(() => prepare("task.create", { requestId: "new-key" })).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
    expect(usage().reservedRuns).toBe(1);
    unblock(false);
    await pending;
    reopen();
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).intent.status,
    ).toBe("cancelled");
  });
  it("rolls back business writes if terminal lineage cannot commit and retains admission", async () => {
    const prepared = prepare("task.create");
    db.exec(`CREATE TRIGGER reject_terminal BEFORE UPDATE ON cc_project_goal_workflow
      WHEN NEW.kind='intent' AND json_extract(NEW.record_json,'$.status')='succeeded'
      BEGIN SELECT RAISE(ABORT,'intent terminal rejected'); END`);
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("ACTION_OUTCOME_UNKNOWN");
    expect(taskCount()).toBe(1);
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).executionState,
    ).toBe("unresolved");
    expect(usage().totalRuns).toBe(1);
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).executionState,
    ).toBe("unresolved");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(usage()).toMatchObject({
      elapsedMs: null,
      unknownTime: 1,
      modelCostUsd: 0,
    });
  });
  it("rolls back all admission artifacts if goal linkage fails", async () => {
    const prepared = prepare();
    db.exec(`CREATE TRIGGER reject_admission BEFORE UPDATE ON cc_project_goal_workflow
      WHEN NEW.kind='intent' AND json_extract(NEW.record_json,'$.status')='running'
      BEGIN SELECT RAISE(ABORT,'admission rejected'); END`);
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_risk_action_links").get()
        .n,
    ).toBe(0);
    expect(usage().totalRuns).toBe(0);
  });
  it("recovers unknown native time after reopen and blocks later finite-time dispatch", async () => {
    const prepared = prepare("task.create");
    db.exec(`CREATE TRIGGER reject_terminal BEFORE UPDATE ON cc_project_goal_workflow
      WHEN NEW.kind='intent' AND json_extract(NEW.record_json,'$.status')='succeeded'
      BEGIN SELECT RAISE(ABORT,'terminal rejected'); END`);
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("ACTION_OUTCOME_UNKNOWN");
    reopen();
    expect(usage()).toMatchObject({
      totalRuns: 1,
      elapsedMs: null,
      unknownTime: 1,
      modelCostUsd: 0,
    });
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxTimeMs: 1000 } },
    });
    observe();
    const next = prepare("task.update-description", {
      requestId: "next-request",
    });
    await expect(
      workflow.execute({ intentId: next.intent.id }),
    ).rejects.toThrow("ACTION_GOAL_USAGE_UNKNOWN");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(taskCount()).toBe(1);
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).executionState,
    ).toBe("unresolved");
  });
  it("does not relabel a ledger storage failure as budget exhaustion", async () => {
    const prepared = prepare("task.create");
    vi.spyOn(workflow.usage, "assertAvailable").mockImplementation(() => {
      throw Object.assign(new Error("ledger corrupted"), {
        code: "GOAL_USAGE_RECORD_CORRUPT",
      });
    });
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("ledger corrupted");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("applies one cumulative budget across both native action types", async () => {
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxRuns: 1 } },
    });
    observe();
    const first = prepare();
    await workflow.execute({ intentId: first.intent.id });
    observe();
    const next = prepare("task.create", { requestId: "creation-request" });
    await expect(
      workflow.execute({ intentId: next.intent.id }),
    ).rejects.toThrow("ACTION_GOAL_BUDGET_EXHAUSTED");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(taskCount()).toBe(1);
  });
  it("rolls back a native mutation that overruns the time budget", async () => {
    g = workflow.goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxTimeMs: 5 } },
    });
    observe();
    const prepared = prepare("task.create");
    const apply = workflow.createActions._applyRequest.bind(
      workflow.createActions,
    );
    vi.spyOn(workflow.createActions, "_applyRequest").mockImplementation(
      (...args) => {
        const result = apply(...args);
        now += 6;
        return result;
      },
    );
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("ACTION_GOAL_TIME_BUDGET_EXHAUSTED");
    expect(taskCount()).toBe(1);
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).receipt.run.status,
    ).toBe("denied");
    expect(usage().totalRuns).toBe(0);
  });
  it.each(["intent", "proposal", "receipt"])(
    "fails closed on %s corruption",
    async (kind) => {
      const prepared = prepare();
      await workflow.execute({ intentId: prepared.intent.id });
      if (kind === "receipt")
        db.exec("UPDATE cc_business_action_runs SET evidence_json='[]'");
      else
        db.prepare(
          "UPDATE cc_project_goal_workflow SET record_json='{}' WHERE kind=?",
        ).run(kind);
      expect(() =>
        workflow.getIntent({ intentId: prepared.intent.id }),
      ).toThrow();
    },
  );
  it.each([
    undefined,
    false,
    { allowed: false },
    Promise.resolve({ allowed: true }),
  ])(
    "requires explicit synchronous trusted verification: %j",
    async (result) => {
      const actions = new TaskDescriptionActionService({
        db,
        getActor: () => actor,
        approvalGate: new ApprovalGate({ confirm }),
        contextAdapter: {
          verify: () => result,
          record: () => ({ recorded: true }),
        },
      });
      const prepared = prepare();
      await expect(
        actions.execute(prepared.intent.preview.request),
      ).rejects.toThrow(/ACTION_GOAL_(CONTEXT_REJECTED|ASYNC_CONTEXT_DENIED)/);
      expect(confirm).not.toHaveBeenCalled();
    },
  );
  it("requires an explicit record acknowledgement before any confirmation", async () => {
    const actions = new TaskDescriptionActionService({
      db,
      getActor: () => actor,
      approvalGate: new ApprovalGate({ confirm }),
      contextAdapter: {
        verify: () => ({ allowed: true }),
        record: () => undefined,
      },
    });
    const prepared = prepare();
    await expect(
      actions.execute(prepared.intent.preview.request),
    ).rejects.toThrow("ACTION_GOAL_CONTEXT_REJECTED");
    expect(confirm).not.toHaveBeenCalled();
  });
});
