import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const {
  OrganizationProjectGoalService,
} = require("../../../session-core/lib/organization-project-goal-service");
const {
  OrganizationProjectGoalWorkflow,
} = require("../../../session-core/lib/organization-project-goal-workflow");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("../../../session-core/lib/organization-project-goal-monitoring");
const {
  OrganizationProjectProposalStore,
} = require("../../../session-core/lib/organization-project-proposal-store");
const {
  openSchedulerStore,
} = require("../../../session-core/lib/scheduler-store");
const {
  createBusinessActionRequest,
} = require("../../../session-core/lib/business-object-contract");
const {
  OrganizationProjectRiskReviewService,
} = require("../../../session-core/lib/organization-project-risk-review-service");
const {
  ProjectRiskReviewService,
} = require("../../../session-core/lib/project-risk-review-service");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract");
const Database = require("better-sqlite3");
const {
  OrganizationProjectAuthority,
} = require("@chainlesschain/session-core/organization-project-authority");
const {
  OrganizationProjectApprovalService,
} = require("@chainlesschain/session-core/organization-project-approval-service");
const {
  OrganizationTaskDescriptionActionService,
  OrganizationTaskCreateActionService,
} = require("@chainlesschain/session-core/organization-task-action-service");
const {
  TaskDescriptionActionService,
} = require("@chainlesschain/session-core/task-description-action-service");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

describe("organization goal suggestions, approvals, and native execution", () => {
  const owner = "did:owner",
    requester = "did:requester",
    first = "did:first",
    second = "did:second",
    reader = "did:reader";
  let risk,
    personal,
    personalReview,
    directory,
    filename,
    other,
    goals,
    workflow,
    proposals,
    engine,
    store;
  let db,
    actor,
    now,
    confirm,
    authority,
    approvals,
    descriptions,
    creation,
    permissions;
  function action(approvalId = null, create = false) {
    const Service = create
      ? OrganizationTaskCreateActionService
      : OrganizationTaskDescriptionActionService;
    return new Service({
      db,
      getActor: () => actor,
      now: () => now,
      approvalGate: new ApprovalGate({ confirm: (value) => confirm(value) }),
      authority,
      approvals,
      riskService: risk,
      approvalId,
      contextAdapter: workflow?.contextAdapter,
    });
  }
  async function attest() {
    const input = {
      orgId: "org1",
      permissions,
      workflowIds: ["wf-description", "wf-create"],
    };
    const preview = authority.previewPolicy(input);
    return authority.attestPolicy({ ...input, expectedDigest: preview.digest });
  }
  async function bind() {
    const input = {
      orgId: "org1",
      projectId: "p1",
      organizationProjectId: "op1",
    };
    return authority.bindProject({
      ...input,
      expectedDigest: authority.previewBinding(input).digest,
    });
  }
  function request(create = false, key = "change1", reviewId) {
    return (create ? creation : descriptions).preview(
      create
        ? {
            projectId: "p1",
            taskType: "query_info",
            description: "Approved new task",
            idempotencyKey: key,
            ...(reviewId ? { reviewId } : {}),
          }
        : {
            taskId: "t1",
            description: "Approved description",
            idempotencyKey: key,
            ...(reviewId ? { reviewId } : {}),
          },
    ).request;
  }
  function approve(candidate, create = false) {
    actor = requester;
    const submitted = approvals.submit({
      projectId: "p1",
      request: candidate,
      workflowId: create ? "wf-create" : "wf-description",
    });
    actor = first;
    approvals.respond({
      approvalId: submitted.approvalId,
      step: 0,
      decision: "approve",
    });
    actor = second;
    approvals.respond({
      approvalId: submitted.approvalId,
      step: 1,
      decision: "approve",
    });
    actor = requester;
    return submitted.approvalId;
  }
  function body() {
    return db
      .prepare("SELECT description FROM project_tasks WHERE id='t1'")
      .get().description;
  }
  function consumed(id) {
    return db
      .prepare(
        "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
      )
      .get(id).consumed_run_id;
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-risk-"));
    filename = join(directory, "risk.db");
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    db.exec(`
      CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,sync_status TEXT,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT,result_data TEXT,due_date INTEGER,blocked_by TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      CREATE TABLE approval_workflows(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,trigger_resource_type TEXT,trigger_action TEXT,trigger_conditions TEXT,approval_type TEXT,approvers TEXT,timeout_hours REAL,on_timeout TEXT,enabled INTEGER,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE approval_requests(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES approval_workflows(id),org_id TEXT,requester_did TEXT,requester_name TEXT,resource_type TEXT,resource_id TEXT,action TEXT,request_data TEXT,status TEXT,current_step INTEGER,total_steps INTEGER,created_at INTEGER,updated_at INTEGER,completed_at INTEGER);
      CREATE TABLE approval_responses(id TEXT PRIMARY KEY,request_id TEXT REFERENCES approval_requests(id),approver_did TEXT,approver_name TEXT,step INTEGER,decision TEXT,delegated_to TEXT,comment TEXT,created_at INTEGER);
      INSERT INTO organization_info VALUES('org1','did:org:1','${owner}');
      INSERT INTO organization_projects VALUES('op1','org1','${owner}');
      INSERT INTO projects(id,user_id,status,updated_at) VALUES('p1','${owner}','active',10);
      INSERT INTO project_tasks(id,project_id,task_type,description,status,created_at,updated_at,sync_status) VALUES('t1','p1','query_info','Original','pending',10,10,'synced');
      INSERT INTO approval_workflows VALUES('wf-description','org1','Review','task','task.update-description',NULL,'sequential','["${first}","${second}"]',1,'approve',1,10,10);
      INSERT INTO approval_workflows VALUES('wf-create','org1','Create review','project','task.create',NULL,'sequential','["${first}","${second}"]',1,'approve',1,10,10);
    `);
    for (const [index, did] of [
      owner,
      requester,
      first,
      second,
      reader,
    ].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?,'active')",
      ).run(`m${index}`, did, did === owner ? "owner" : "member");
    actor = owner;
    now = 1000;
    confirm = vi.fn(async () => true);
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      now: () => now,
      confirm: async () => true,
    });
    risk = new OrganizationProjectRiskReviewService({
      db,
      getActor: () => actor,
      authority,
      now: () => now,
    });
    personal = new ProjectRiskReviewService({
      db,
      getActor: () => actor,
      now: () => now,
    });
    db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    personalReview = personal.evaluate({ projectId: "p1" });
    approvals = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      riskService: risk,
      now: () => now,
    });
    descriptions = action();
    creation = action(null, true);
    permissions = [owner, requester, first, second, reader].map((actorDid) => ({
      actorDid,
      projectId: "p1",
      expiresAt: 10000000,
      permissions:
        actorDid === owner || actorDid === requester
          ? [
              "task.read",
              "task.create",
              "task.update-description",
              "risk.read",
              "risk.evaluate",
              "risk.feedback",
            ]
          : actorDid === reader
            ? ["risk.read"]
            : ["task.read", "task.approve", "risk.read", "risk.feedback"],
    }));
    goals = new OrganizationProjectGoalService({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
    });
    proposals = new OrganizationProjectProposalStore({
      db,
      getActor: () => actor,
      authority,
      approvals,
      now: () => now,
    });
    workflow = new OrganizationProjectGoalWorkflow({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
      goals,
      risk,
      usage: goals.usage,
      approvals,
      proposals,
    });
    descriptions = action();
    creation = action(null, true);
    workflow.descriptionActions = descriptions;
    workflow.createActions = creation;
    store = openSchedulerStore({
      file: join(directory, "scheduler.db"),
      Database,
      protectStorage: () => true,
      clock: () => now,
    });
    engine = new OrganizationProjectGoalMonitoringEngine({
      db,
      getActor: () => actor,
      authority,
      store,
      clock: () => now,
    });
    for (const entry of permissions) {
      entry.permissions.push("goal.read");
      if ([owner, requester].includes(entry.actorDid))
        entry.permissions.push(
          "goal.create",
          "goal.update",
          "goal.check",
          "goal.monitor",
          "goal.propose",
        );
    }
    await attest();
    await bind();
    actor = requester;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.close();
    store?.close();
    workflow = null;
    if (other?.open) other.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const evaluate = () => risk.evaluate({ projectId: "p1" });
  const feedback = (reviewId, extra = {}) =>
    risk.recordFeedback({
      reviewId,
      taskId: "t1",
      verdict: "affirmed",
      reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
      ...extra,
    });
  async function reattest() {
    actor = owner;
    await attest();
    actor = requester;
  }

  function createGoal(
    extra = {},
    types = ["task.update-description", "task.create"],
  ) {
    const current = actor;
    actor = owner;
    const input = {
      projectId: "p1",
      requestId: "create-goal",
      objective: "Reduce delivery risk",
      ...extra,
    };
    let goal = goals.create(input, {
      expectedAuthority: goals.prepareCreate(input).authority,
    }).goal;
    if (types.length) {
      const revision = {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "enable-actions",
        patch: { allowedActionTypes: types },
      };
      goal = goals.revise(revision, {
        expectedAuthority: goals.prepareRevise(revision).authority,
      }).goal;
    }
    actor = current;
    return goal;
  }
  function reviseGoal(goal, patch) {
    const input = {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "revise-later",
      patch,
    };
    return goals.revise(input, {
      expectedAuthority: goals.prepareRevise(input).authority,
    }).goal;
  }
  async function check(goal, requestId = "check1") {
    const result = await engine.checkNow({
      id: goal.id,
      expectedRevision: goal.revision,
      requestId,
    });
    expect(result.status).toBe("succeeded");
    return result;
  }
  function suggestions(goal) {
    return workflow.list({ goalId: goal.id });
  }
  function prepareGoal(goal, create = false, requestId = "prepare1") {
    const item = suggestions(goal).suggestions.find(
      (item) =>
        item.suggestion.actionType ===
        (create ? "task.create" : "task.update-description"),
    );
    return workflow.prepare({
      goalId: goal.id,
      suggestionId: item.suggestion.id,
      expectedRevision: goal.revision,
      requestId,
      description: "Goal-approved change",
      ...(create ? { taskType: "query_info" } : {}),
    });
  }
  function submitGoal(result, create = false, extra = {}) {
    return workflow.submit({
      intentId: result.intent.id,
      workflowId: create ? "wf-create" : "wf-description",
      ...extra,
    });
  }
  function approveGoal(result) {
    actor = first;
    approvals.respond({
      approvalId: result.proposal.approvalId,
      step: 0,
      decision: "approve",
    });
    actor = second;
    approvals.respond({
      approvalId: result.proposal.approvalId,
      step: 1,
      decision: "approve",
    });
    actor = requester;
  }
  const count = (table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  it("keeps actions disabled by default and generates bounded shared semantic suggestions only after native revision", async () => {
    let goal = createGoal({}, []);
    await check(goal);
    expect(suggestions(goal).suggestions).toEqual([]);
    goal = reviseGoal(goal, {
      allowedActionTypes: ["task.update-description", "task.create"],
    });
    await check(goal, "check2");
    const firstPage = suggestions(goal);
    expect(firstPage.suggestions).toHaveLength(2);
    actor = owner;
    await check(goal, "owner-check");
    expect(suggestions(goal).suggestions.map((x) => x.suggestion.id)).toEqual(
      firstPage.suggestions.map((x) => x.suggestion.id),
    );
    expect(firstPage.summary).toMatchObject({
      candidateCount: 2,
      newCount: 2,
      omittedCount: 0,
    });
  });
  it.each([false, true])(
    "uses actual proposer and atomically consumes multi-level approval, task, intent, and shared budget (create=%s)",
    async (create) => {
      const goal = createGoal();
      await check(goal);
      const prepared = prepareGoal(goal, create);
      expect(prepared.intent.actorDid).toBe(requester);
      expect(goal.ownerRef).toBe(owner);
      expect(prepared.preview.request.input.goalIntent.proposalId).toBe(
        prepared.intent.suggestionId,
      );
      const submitted = submitGoal(prepared, create);
      approveGoal(submitted);
      const result = await action(
        submitted.proposal.approvalId,
        create,
      ).execute(prepared.preview.request);
      expect(result.run.status).toBe("succeeded");
      expect(consumed(submitted.proposal.approvalId)).toBe(result.run.id);
      const final = workflow.getIntent({ intentId: prepared.intent.id });
      expect(final.intent.status).toBe("succeeded");
      expect(final.receipt.run.id).toBe(result.run.id);
      expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(2);
      expect(create ? count("project_tasks") : body()).toBe(
        create ? 2 : "Goal-approved change",
      );
      expect(
        (
          await action(submitted.proposal.approvalId, create).execute(
            prepared.preview.request,
          )
        ).replayed,
      ).toBe(true);
      expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(2);
    },
  );
  it("shares suggestion ownership across actors while hiding another proposer's draft body", async () => {
    const goal = createGoal();
    await check(goal);
    const prepared = prepareGoal(goal);
    actor = owner;
    const item = suggestions(goal).suggestions.find((x) => x.intent);
    expect(item.intent.intent.actorDid).toBe(requester);
    expect(item.intent.preview).toBeNull();
    expect(item.intent.intent.description).toBeUndefined();
    expect(() => prepareGoal(goal, false, "other-key")).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
    expect(() =>
      workflow.submit({
        intentId: prepared.intent.id,
        workflowId: "wf-description",
      }),
    ).toThrow("ACTION_GOAL_AUTHORITY_CHANGED");
  });
  it("requires explicit goal.propose and rejects goal-only readers from action bodies", async () => {
    permissions.find((x) => x.actorDid === requester).permissions = permissions
      .find((x) => x.actorDid === requester)
      .permissions.filter((x) => x !== "goal.propose");
    await reattest();
    const goal = createGoal();
    await check(goal);
    expect(() => prepareGoal(goal)).toThrow(/ORG_AUTH/);
    actor = reader;
    expect(() => suggestions(goal)).toThrow(/ORG_AUTH/);
  });
  it("requires goal.read for every designated approver at submission", async () => {
    permissions.find((x) => x.actorDid === second).permissions = permissions
      .find((x) => x.actorDid === second)
      .permissions.filter((x) => x !== "goal.read");
    await reattest();
    const goal = createGoal();
    await check(goal);
    const prepared = prepareGoal(goal);
    expect(() => submitGoal(prepared)).toThrow(/ORG_AUTH/);
    expect(count("cc_organization_project_proposals")).toBe(0);
    expect(count("cc_organization_action_approvals")).toBe(0);
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).intent.status,
    ).toBe("prepared");
  });
  it("blocks generic submit bypass and stripped goal binding with the reserved intent nonce", async () => {
    const goal = createGoal();
    await check(goal);
    const prepared = prepareGoal(goal),
      request = prepared.preview.request;
    expect(() =>
      proposals.submit({
        projectId: "p1",
        workflowId: "wf-description",
        request,
      }),
    ).toThrow("ACTION_GOAL_INTENT_CONSUMED");
    const { goalIntent, ...input } = request.input;
    const stripped = createBusinessActionRequest({
      actionType: request.actionType,
      actionVersion: 1,
      target: request.target,
      expectedVersion: request.expectedVersion,
      input,
      idempotencyKey: request.idempotencyKey,
    });
    expect(() =>
      approvals.submit({
        projectId: "p1",
        workflowId: "wf-description",
        request: stripped,
      }),
    ).toThrow("ORG_APPROVAL_GOAL_BINDING_REQUIRED");
    const bare = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      riskService: risk,
      now: () => now,
    });
    expect(() =>
      bare.submit({ projectId: "p1", workflowId: "wf-description", request }),
    ).toThrow("ORG_APPROVAL_GOAL_AUTHORITY_REQUIRED");
  });
  it("keeps original prepare/submit replay read-only and rejects changed request contents", async () => {
    const goal = createGoal();
    await check(goal);
    const prepared = prepareGoal(goal);
    expect(prepareGoal(goal).intent.id).toBe(prepared.intent.id);
    const submitted = submitGoal(prepared);
    expect(submitGoal(prepared).proposal.proposalId).toBe(
      submitted.proposal.proposalId,
    );
    expect(() => submitGoal(prepared, false, { timeoutMs: 5000 })).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
    expect(() => prepareGoal(goal, false, "changed")).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
  });
  it.each([
    { status: "paused" },
    { title: "revised" },
    { allowedActionTypes: [] },
  ])("rejects approval after changed goal %o", async (patch) => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    reviseGoal(goal, patch);
    actor = first;
    expect(() =>
      approvals.respond({
        approvalId: submitted.proposal.approvalId,
        step: 0,
        decision: "approve",
      }),
    ).toThrow(/ACTION_GOAL/);
    expect(body()).toBe("Original");
  });
  it("rejects source or policy ABA at multi-level approval", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    db.prepare(
      "UPDATE project_tasks SET description='temporary' WHERE id='t1'",
    ).run();
    db.prepare(
      "UPDATE project_tasks SET description='Original' WHERE id='t1'",
    ).run();
    actor = first;
    expect(() =>
      approvals.respond({
        approvalId: submitted.proposal.approvalId,
        step: 0,
        decision: "approve",
      }),
    ).toThrow(/ORG_AUTH|ACTION_GOAL|PROJECT_RISK/);
    actor = owner;
    await attest();
    actor = first;
    expect(() =>
      approvals.respond({
        approvalId: submitted.proposal.approvalId,
        step: 0,
        decision: "approve",
      }),
    ).toThrow(/ORG_AUTH|ACTION_GOAL/);
  });
  it("rejects goal revision during final native confirmation and leaves task/approval unconsumed", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    confirm.mockImplementation(async () => {
      reviseGoal(goal, { status: "paused" });
      return true;
    });
    await expect(
      action(submitted.proposal.approvalId).execute(submitted.preview.request),
    ).rejects.toThrow("ACTION_GOAL_REVISION_CONFLICT");
    expect(
      workflow.getIntent({ intentId: submitted.intent.id }).intent.status,
    ).toBe("denied");
    expect(body()).toBe("Original");
    expect(consumed(submitted.proposal.approvalId)).toBeNull();
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
  });
  it("makes cancellation and rejection single-use without occupying native-action budget", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approvals.cancel({ approvalId: submitted.proposal.approvalId });
    expect(submitGoal(submitted).proposal.approvalStatus).toBe("cancelled");
    expect(() => prepareGoal(goal, false, "replacement-key")).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
  });
  it("records native cancellation and prevents resubmission under another actor or nonce", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    confirm.mockResolvedValue(false);
    expect(
      (
        await action(submitted.proposal.approvalId).execute(
          submitted.preview.request,
        )
      ).run.status,
    ).toBe("cancelled");
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
    expect(() => prepareGoal(goal, false, "retry")).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
    expect(
      (
        await action(submitted.proposal.approvalId).execute(
          submitted.preview.request,
        )
      ).replayed,
    ).toBe(true);
  });
  it("rechecks shared budgets at native admission after approval", async () => {
    const goal = createGoal({ budgetPolicy: { maxRuns: 2 } });
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    actor = owner;
    await check(goal, "consume-last-run");
    actor = requester;
    await expect(
      action(submitted.proposal.approvalId).execute(submitted.preview.request),
    ).rejects.toThrow(/GOAL_USAGE_BUDGET/);
    expect(body()).toBe("Original");
    expect(consumed(submitted.proposal.approvalId)).toBeNull();
  });
  it("rolls back task, approval consumption, receipt, intent, and usage if success evidence persistence fails", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    const original = workflow._save.bind(workflow);
    vi.spyOn(workflow, "_save").mockImplementation((record, kind) => {
      if (kind === "intent" && record.status === "succeeded")
        throw new Error("disk failure");
      return original(record, kind);
    });
    await expect(
      action(submitted.proposal.approvalId).execute(submitted.preview.request),
    ).rejects.toThrow("ACTION_OUTCOME_UNKNOWN");
    expect(body()).toBe("Original");
    expect(consumed(submitted.proposal.approvalId)).toBeNull();
    const result = workflow.getIntent({ intentId: submitted.intent.id });
    expect(result.executionState).toBe("unresolved");
    expect(result.receipt.run.status).toBe("running");
    expect(
      (
        await action(submitted.proposal.approvalId).execute(
          submitted.preview.request,
        )
      ).executionState,
    ).toBe("unresolved");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(() => prepareGoal(goal, false, "fresh-nonce")).toThrow(
      "ACTION_GOAL_INTENT_CONFLICT",
    );
  });
  it("keeps generic independent organization actions compatible", async () => {
    const candidate = request(false, "independent");
    const approvalId = approve(candidate);
    expect((await action(approvalId).execute(candidate)).run.status).toBe(
      "succeeded",
    );
  });
  it("does not turn a live confirmation into unknown usage when the same request is read back concurrently", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    let release;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = action(submitted.proposal.approvalId).execute(
      submitted.preview.request,
    );
    const replay = await action(submitted.proposal.approvalId).execute(
      submitted.preview.request,
    );
    expect(replay.executionState).toBe("unresolved");
    const another = new OrganizationProjectGoalWorkflow({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
      goals,
      risk,
      usage: goals.usage,
      approvals,
      proposals,
    });
    expect(
      another.getIntent({ intentId: submitted.intent.id }).intent.status,
    ).toBe("running");
    expect(engine.status({ id: goal.id }).usage).toMatchObject({
      reservedRuns: 1,
      unknownTime: 0,
    });
    release(false);
    expect((await running).run.status).toBe("cancelled");
    expect(engine.status({ id: goal.id }).usage).toMatchObject({
      reservedRuns: 0,
      unknownTime: 0,
      totalRuns: 1,
    });
  });
  it("preserves an intent's original review and reports stale suggestions after a source update", async () => {
    const goal = createGoal();
    await check(goal);
    const prepared = prepareGoal(goal),
      reviewId = prepared.intent.reviewId;
    db.prepare(
      "UPDATE project_tasks SET updated_at=updated_at+1 WHERE id='t1'",
    ).run();
    expect(
      suggestions(goal).suggestions.every((x) => x.current === false),
    ).toBe(true);
    await check(goal, "updated-review");
    const item = suggestions(goal).suggestions.find((x) => x.intent);
    expect(item.suggestion.reviewId).not.toBe(reviewId);
    expect(item.intent.intent.reviewId).toBe(reviewId);
    expect(item.current).toBe(false);
    expect(() => submitGoal(prepared)).toThrow(/ORG_AUTH|PROJECT_RISK/);
  });
  it("reads terminal receipts after goal pause and policy renewal without granting a second execution", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    const run = await action(submitted.proposal.approvalId).execute(
      submitted.preview.request,
    );
    reviseGoal(goal, { status: "paused" });
    await reattest();
    expect(
      workflow.getIntent({ intentId: submitted.intent.id }).receipt.run.id,
    ).toBe(run.run.id);
    expect(submitGoal(submitted).receipt.run.id).toBe(run.run.id);
    expect(count("cc_business_action_runs")).toBe(1);
  });
  it("limits suggestions per observation while retaining semantic deduplication across checks", async () => {
    for (let i = 0; i < 80; i++)
      db.prepare(
        "INSERT INTO project_tasks(id,project_id,task_type,description,status,created_at,updated_at,sync_status,due_date) VALUES(?,'p1','query_info','Risk','pending',10,10,'synced',1)",
      ).run(`extra-${i}`);
    const goal = createGoal();
    await check(goal);
    expect(suggestions(goal).summary).toMatchObject({
      candidateCount: 162,
      newCount: 100,
      savedCount: 100,
      omittedCount: 62,
      status: "truncated",
    });
    await check(goal, "next-check");
    expect(suggestions(goal).summary).toMatchObject({
      candidateCount: 162,
      newCount: 62,
      savedCount: 162,
      omittedCount: 0,
      status: "complete",
    });
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_workflow WHERE kind='suggestion'",
        )
        .get().n,
    ).toBe(162);
  });
  it("keeps goal-linked proposal bodies behind current goal/risk permissions and honors bounded timeout", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal), false, { timeoutMs: 100 });
    expect(submitted.proposal.expiresAt).toBe(now + 100);
    permissions.find((x) => x.actorDid === first).permissions = permissions
      .find((x) => x.actorDid === first)
      .permissions.filter((x) => x !== "goal.read");
    await reattest();
    actor = first;
    expect(() =>
      proposals.get({ proposalId: submitted.proposal.proposalId }),
    ).toThrow(/ORG_AUTH/);
  });
  it("recovers a real exited process's admitted run as unknown without reopening native confirmation", async () => {
    const goal = createGoal();
    await check(goal);
    const submitted = submitGoal(prepareGoal(goal));
    approveGoal(submitted);
    const modules = {
      authority:
        require.resolve("../../../session-core/lib/organization-project-authority"),
      goals:
        require.resolve("../../../session-core/lib/organization-project-goal-service"),
      approvals:
        require.resolve("../../../session-core/lib/organization-project-approval-service"),
      proposals:
        require.resolve("../../../session-core/lib/organization-project-proposal-store"),
      workflow:
        require.resolve("../../../session-core/lib/organization-project-goal-workflow"),
      actions:
        require.resolve("../../../session-core/lib/organization-task-action-service"),
      gate: require.resolve("../../../session-core/lib/approval-gate"),
      sqlite: require.resolve("better-sqlite3"),
    };
    const script = `const paths=${JSON.stringify(modules)}; const db=new (require(paths.sqlite))(${JSON.stringify(filename)}); const getActor=()=>${JSON.stringify(requester)},now=()=>${now};
      const authority=new (require(paths.authority).OrganizationProjectAuthority)({db,getActor,now,confirm:async()=>true});
      const goals=new (require(paths.goals).OrganizationProjectGoalService)({db,getActor,authority,clock:now});
      const approvals=new (require(paths.approvals).OrganizationProjectApprovalService)({db,getActor,authority,riskService:goals.risk,now});
      const proposals=new (require(paths.proposals).OrganizationProjectProposalStore)({db,getActor,authority,approvals,now});
      const workflow=new (require(paths.workflow).OrganizationProjectGoalWorkflow)({db,getActor,authority,goals,approvals,proposals,clock:now});
      const approvalGate=new (require(paths.gate).ApprovalGate)({confirm:()=>{process.stdout.write('ADMITTED');return new Promise(()=>{});}});
      const action=new (require(paths.actions).OrganizationTaskDescriptionActionService)({db,getActor,authority,approvals,approvalId:${JSON.stringify(submitted.proposal.approvalId)},riskService:goals.risk,now,approvalGate,contextAdapter:workflow.contextAdapter});
      action.execute(${JSON.stringify(submitted.preview.request)}).catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
    const child = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("ADMITTED");
    const recovered = new OrganizationProjectGoalWorkflow({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
      goals,
      risk,
      usage: goals.usage,
      approvals,
      proposals,
    });
    expect(
      recovered.getIntent({ intentId: submitted.intent.id }).executionState,
    ).toBe("unresolved");
    expect(engine.status({ id: goal.id }).usage.unknownTime).toBe(1);
    expect(
      (
        await action(submitted.proposal.approvalId).execute(
          submitted.preview.request,
        )
      ).executionState,
    ).toBe("unresolved");
    expect(confirm).not.toHaveBeenCalled();
    expect(body()).toBe("Original");
  });
  it("restricts allowedActionTypes to the explicit organization goal set", () => {
    const goal = createGoal({}, []);
    for (const allowedActionTypes of [
      ["shell.exec"],
      ["task.create", "task.create"],
      ["memory.write"],
    ])
      expect(() => reviseGoal(goal, { allowedActionTypes })).toThrow(
        "GOAL_INVALID_ACTION_TYPE",
      );
    expect(
      reviseGoal(goal, { allowedActionTypes: ["project.risk.review"] })
        .allowedActionTypes,
    ).toEqual(["project.risk.review"]);
  });
});
