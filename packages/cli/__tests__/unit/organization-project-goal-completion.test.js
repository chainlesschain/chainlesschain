import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const {
  OrganizationProjectGoalCompletionService,
} = require("../../../session-core/lib/organization-project-goal-completion");
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

describe("organization independent acceptance and shared completion evidence", () => {
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
    store,
    completion;
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
    completion = new OrganizationProjectGoalCompletionService({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
      goals,
      risk,
      usage: goals.usage,
      workflow,
    });
    for (const entry of permissions) {
      entry.permissions.push("goal.read", "goal.accept");
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
        item.suggestion.goalRevision === goal.revision &&
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

  const taskCriterion = {
    id: "tasks",
    kind: "business-assertion",
    description: "All project tasks completed",
  };
  const actionCriterion = {
    id: "actions",
    kind: "business-assertion",
    description: "All goal actions resolved",
  };
  const manualCriterion = {
    id: "manual",
    kind: "manual",
    description: "Member accepts delivery",
  };
  function configInput(
    goal,
    criteria = [taskCriterion],
    assertions = [{ criterionId: "tasks", type: "all-tasks-completed" }],
    requestId = "configure1",
  ) {
    return {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId,
      acceptanceCriteria: criteria,
      assertions,
    };
  }
  function configure(goal, criteria, assertions, requestId) {
    const input = configInput(goal, criteria, assertions, requestId),
      prepared = completion.prepareConfigure(input);
    return completion.configure(input, {
      expectedAuthority: prepared.authority,
    });
  }
  const inspectInput = (goal, requestId = "inspect1") => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
  });
  function finish(goal, requestId = "complete1") {
    const input = inspectInput(goal, requestId),
      prepared = completion.prepareComplete(input);
    return completion.complete(input, {
      expectedAuthority: prepared.authority,
      expectedFreshnessDigest: prepared.freshnessDigest,
    });
  }
  function ack(goal, requestId = "ack1", confirmed = true) {
    const input = {
        ...inspectInput(goal, requestId),
        criterionIds: ["manual"],
      },
      prepared = completion.prepareAcknowledge(input);
    return completion.acknowledge(input, {
      expectedAuthority: prepared.authority,
      confirmed,
    });
  }
  const delivered = () =>
    db
      .prepare(
        "UPDATE project_tasks SET status='completed',updated_at=updated_at+1 WHERE id='t1'",
      )
      .run();
  const acceptanceCount = () =>
    count("cc_organization_project_goal_acceptance");
  it("shares plans and reports across actors, preserving actual attribution and the creator", () => {
    const original = createGoal({}, []),
      configured = configure(original),
      goal = configured.goal;
    expect(goal.revision).toBe(original.revision + 1);
    expect(goal.controlGeneration).toBe(original.controlGeneration + 1);
    expect(configured.plan.actorDid).toBe(requester);
    actor = owner;
    const result = completion.inspect(inspectInput(goal));
    expect(result.report.actorDid).toBe(owner);
    expect(result.report.met).toBe(false);
    actor = first;
    const status = completion.status({ goalId: goal.id });
    expect(status.goal.ownerRef).toBe(owner);
    expect(status.plan.id).toBe(configured.plan.id);
    expect(status.reports[0].id).toBe(result.report.id);
  });
  it("allows normal task progress under the fixed plan then completes with independent proof", () => {
    const original = createGoal({}, []),
      { goal } = configure(original);
    delivered();
    const checked = completion.inspect(inspectInput(goal));
    expect(checked.report.met).toBe(true);
    expect(goals.get({ id: goal.id }).status).toBe("active");
    const result = finish(goal);
    expect(result.completed).toBe(true);
    expect(result.goal).toMatchObject({
      status: "done",
      revision: goal.revision + 1,
      controlGeneration: goal.controlGeneration,
      progress: 100,
    });
    expect(result.goal.completion.evidenceRefs[0]).toMatchObject({
      kind: "native-goal-completion",
      id: result.report.id,
      version: digest(result.report),
    });
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(2);
  });
  it("requires a nonempty task set and checks selected risk signals independently", () => {
    db.prepare("DELETE FROM project_tasks").run();
    const original = createGoal({}, []),
      { goal } = configure(original);
    expect(
      completion.inspect(inspectInput(goal)).report.criteria[0],
    ).toMatchObject({ met: false, reason: "nonempty-project-required" });
    const risk = configure(
      goal,
      [
        {
          id: "risk",
          kind: "business-assertion",
          description: "No overdue signals",
        },
      ],
      [
        {
          criterionId: "risk",
          type: "selected-risk-signals-cleared",
          reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
        },
      ],
      "risk-plan",
    ).goal;
    expect(
      completion.inspect(inspectInput(risk, "risk-check")).report.met,
    ).toBe(true);
    expect(goals.get({ id: goal.id }).status).toBe("active");
  });
  it("keeps prepareComplete read-only and does not bind ordinary wall-clock delay into facts", () => {
    const { goal } = configure(createGoal({}, []));
    delivered();
    const input = inspectInput(goal, "native"),
      before = acceptanceCount(),
      reviews = count("cc_organization_project_risk_reviews"),
      prepared = completion.prepareComplete(input);
    expect(prepared.preview.met).toBe(true);
    expect(acceptanceCount()).toBe(before);
    expect(count("cc_organization_project_risk_reviews")).toBe(reviews);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
    now += 100;
    expect(
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
      }).completed,
    ).toBe(true);
  });
  it("supports manual acknowledgement with only accept/read and no risk side effects", async () => {
    permissions.find((entry) => entry.actorDid === reader).permissions = [
      "goal.read",
      "goal.accept",
    ];
    await reattest();
    const { goal } = configure(createGoal({}, []), [manualCriterion], []);
    const reviews = count("cc_organization_project_risk_reviews");
    actor = reader;
    expect(ack(goal).acknowledgement).toMatchObject({
      actorDid: reader,
      status: "accepted",
    });
    expect(count("cc_organization_project_risk_reviews")).toBe(reviews);
    actor = requester;
    expect(completion.inspect(inspectInput(goal)).report.met).toBe(true);
  });
  it("invalidates old manual acknowledgement after source change without invalidating the plan", () => {
    const { goal } = configure(
      createGoal({}, []),
      [taskCriterion, manualCriterion],
      [{ criterionId: "tasks", type: "all-tasks-completed" }],
    );
    ack(goal);
    delivered();
    const report = completion.inspect(inspectInput(goal)).report;
    expect(report.criteria.find((c) => c.id === "tasks").met).toBe(true);
    expect(report.criteria.find((c) => c.id === "manual").met).toBe(false);
    actor = owner;
    ack(goal, "fresh-ack");
    actor = requester;
    expect(finish(goal).completed).toBe(true);
  });
  it("persists cancelled acknowledgement and never upgrades its original nonce to accepted", () => {
    const { goal } = configure(createGoal({}, []), [manualCriterion], []);
    const cancelled = ack(goal, "cancelled", false);
    expect(cancelled.acknowledgement.status).toBe("cancelled");
    expect(ack(goal, "cancelled", true)).toMatchObject({
      replayed: true,
      acknowledgement: { status: "cancelled" },
    });
    expect(completion.inspect(inspectInput(goal)).report.met).toBe(false);
  });
  it("requires independent accept permission and update permission for configuration/completion", async () => {
    permissions.find((entry) => entry.actorDid === requester).permissions =
      permissions
        .find((entry) => entry.actorDid === requester)
        .permissions.filter((p) => p !== "goal.accept");
    await reattest();
    const goal = createGoal({}, []);
    expect(() => configure(goal)).toThrow(/ORG_AUTH/);
    actor = owner;
    const configured = configure(goal).goal;
    actor = first;
    expect(() => completion.prepareComplete(inspectInput(configured))).toThrow(
      /ORG_AUTH/,
    );
    expect(() => completion.inspect(inspectInput(configured))).toThrow(
      /ORG_AUTH/,
    );
  });
  it("rejects complete after another connection changes source facts during native confirmation", () => {
    const { goal } = configure(createGoal({}, []));
    delivered();
    const input = inspectInput(goal, "stale"),
      prepared = completion.prepareComplete(input),
      before = acceptanceCount();
    other = new Database(filename);
    other
      .prepare(
        "UPDATE project_tasks SET status='pending',updated_at=updated_at+1 WHERE id='t1'",
      )
      .run();
    expect(() =>
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
      }),
    ).toThrow(/ORG_AUTH|GOAL_COMPLETION_SOURCE/);
    expect(acceptanceCount()).toBe(before);
    expect(goals.get({ id: goal.id }).status).toBe("active");
  });
  it("recomputes time-sensitive risk signals after confirmation without allowing an old met check to complete", () => {
    db.prepare("UPDATE project_tasks SET due_date=? WHERE id='t1'").run(
      now + 10,
    );
    const { goal } = configure(
      createGoal({}, []),
      [
        {
          id: "risk",
          kind: "business-assertion",
          description: "No overdue risks",
        },
      ],
      [
        {
          criterionId: "risk",
          type: "selected-risk-signals-cleared",
          reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
        },
      ],
    );
    const input = inspectInput(goal, "due-boundary"),
      prepared = completion.prepareComplete(input);
    expect(prepared.preview.met).toBe(true);
    now += 11;
    expect(() =>
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
      }),
    ).toThrow("GOAL_COMPLETION_SOURCE_CHANGED");
    expect(finish(goal, "new-decision").completed).toBe(false);
  });
  it("fences same-DID session ABA before and after evidence writes", () => {
    const { goal } = configure(createGoal({}, []));
    delivered();
    const input = inspectInput(goal, "session"),
      prepared = completion.prepareComplete(input);
    let calls = 0;
    expect(() =>
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
        guard: () => {
          if (++calls >= 2)
            throw Object.assign(new Error("session changed"), {
              code: "ORG_AUTH_IDENTITY_CHANGED",
            });
          return actor;
        },
      }),
    ).toThrow("session changed");
    expect(goals.get({ id: goal.id }).status).toBe("active");
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
  });
  it("replays configure/inspect/complete receipts without new privileges or spending", async () => {
    const original = createGoal({}, []),
      input = configInput(original),
      configured = configure(original);
    delivered();
    const checkInput = inspectInput(configured.goal),
      report = completion.inspect(checkInput),
      done = finish(configured.goal);
    await reattest();
    permissions.find((entry) => entry.actorDid === requester).permissions = [
      "goal.read",
      "risk.read",
      "task.read",
    ];
    await reattest();
    expect(completion.configure(input)).toMatchObject({
      replayed: true,
      plan: { id: configured.plan.id },
    });
    expect(completion.inspect(checkInput)).toMatchObject({
      replayed: true,
      report: { id: report.report.id },
    });
    expect(
      completion.complete(inspectInput(configured.goal, "complete1")),
    ).toMatchObject({
      replayed: true,
      report: { id: done.report.id },
      completed: true,
    });
    expect(engine.status({ id: original.id }).usage.totalRuns).toBe(2);
  });
  it("rejects same-nonce changed operation mode and changed configuration", () => {
    const original = createGoal({}, []),
      input = configInput(original),
      { goal } = configure(original);
    completion.inspect(inspectInput(goal, "same"));
    expect(() =>
      completion.prepareComplete(inspectInput(goal, "same")),
    ).toThrow("GOAL_COMPLETION_REQUEST_CONFLICT");
    expect(() =>
      completion.configure({
        ...input,
        acceptanceCriteria: [manualCriterion],
        assertions: [],
      }),
    ).toThrow("GOAL_COMPLETION_REQUEST_CONFLICT");
  });
  it("shares verifier budget across actors and keeps exhausted calls atomic", () => {
    const { goal } = configure(
      createGoal({ budgetPolicy: { maxRuns: 1 } }, []),
    );
    completion.inspect(inspectInput(goal));
    actor = owner;
    expect(() => completion.inspect(inspectInput(goal, "other-actor"))).toThrow(
      /GOAL_USAGE_BUDGET/,
    );
    expect(count("cc_organization_project_risk_reviews")).toBe(1);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
  });
  it("invalidates plans after policy renewal or goal revival and rejects generic completion patches", async () => {
    const { goal } = configure(createGoal({}, []));
    await reattest();
    expect(() => completion.inspect(inspectInput(goal))).toThrow(
      "GOAL_COMPLETION_PLAN_STALE",
    );
    const renewed = configure(goal, undefined, undefined, "new-config").goal;
    delivered();
    const done = finish(renewed).goal;
    const revived = reviseGoal(done, { status: "active" });
    expect(() => completion.inspect(inspectInput(revived))).toThrow(
      "GOAL_COMPLETION_PLAN_REQUIRED",
    );
    for (const patch of [
      { status: "done" },
      { completion: {} },
      { acceptanceCriteria: [] },
    ])
      expect(() => reviseGoal(revived, patch)).toThrow("GOAL_INVALID_REQUEST");
  });
  it("includes submitted intents from previous goal generations and other actors", async () => {
    const original = createGoal();
    await check(original);
    const submitted = submitGoal(prepareGoal(original));
    actor = owner;
    const { goal } = configure(
      original,
      [actionCriterion],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    const report = completion.inspect(inspectInput(goal)).report;
    expect(report.met).toBe(false);
    expect(report.criteria[0].observation).toMatchObject({
      actionCount: 1,
      unresolvedCount: 1,
    });
    actor = requester;
    approvals.cancel({ approvalId: submitted.proposal.approvalId });
    actor = owner;
    expect(finish(goal).completed).toBe(true);
  });
  it("does not trust a forged mutable cancelled status without its immutable cancellation proof", async () => {
    const original = createGoal();
    await check(original);
    const submitted = submitGoal(prepareGoal(original));
    const { goal } = configure(
      original,
      [actionCriterion],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    db.prepare(
      "UPDATE approval_requests SET status='cancelled',completed_at=?,updated_at=? WHERE id=?",
    ).run(now, now, submitted.proposal.approvalId);
    expect(completion.inspect(inspectInput(goal)).report.met).toBe(false);
  });
  it("resolves a verified rejection and an explicit late cancellation without treating mere expiry as resolution", async () => {
    const original = createGoal();
    await check(original);
    const submitted = submitGoal(prepareGoal(original));
    actor = first;
    approvals.respond({
      approvalId: submitted.proposal.approvalId,
      step: 0,
      decision: "reject",
    });
    actor = requester;
    const { goal } = configure(
      original,
      [actionCriterion],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    expect(completion.inspect(inspectInput(goal)).report.met).toBe(true);
    await check(goal, "new-generation");
    const late = submitGoal(prepareGoal(goal, false, "later"), false, {
      timeoutMs: 10,
    });
    now += 11;
    expect(
      completion.inspect(inspectInput(goal, "expired-only")).report.met,
    ).toBe(false);
    approvals.cancel({ approvalId: late.proposal.approvalId });
    expect(finish(goal).completed).toBe(true);
  });
  it("rolls back done CAS, risk/report/fence evidence and usage when a SQLite trigger fails", () => {
    let armed = false,
      hits = 0;
    db.function("acceptance_fail_done", () => {
      if (armed) {
        hits++;
        throw new Error("disk fault");
      }
      return 1;
    });
    db.exec(
      "CREATE TRIGGER test_acceptance_done AFTER UPDATE OF goal_json ON cc_organization_project_goals WHEN json_extract(NEW.goal_json,'$.status')='done' BEGIN SELECT acceptance_fail_done(); END",
    );
    const { goal } = configure(createGoal({}, []));
    delivered();
    const input = inspectInput(goal, "failed-cas"),
      prepared = completion.prepareComplete(input),
      before = acceptanceCount();
    armed = true;
    expect(() =>
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
      }),
    ).toThrow();
    expect(hits).toBe(1);
    expect(acceptanceCount()).toBe(before);
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
    expect(goals.get({ id: goal.id }).status).toBe("active");
  });
  it("keeps a successful task action separate from actual project completion", async () => {
    const original = createGoal();
    await check(original);
    const submitted = submitGoal(prepareGoal(original));
    approveGoal(submitted);
    expect(
      (
        await action(submitted.proposal.approvalId).execute(
          submitted.preview.request,
        )
      ).run.status,
    ).toBe("succeeded");
    const { goal } = configure(
      original,
      [taskCriterion, actionCriterion],
      [
        { criterionId: "tasks", type: "all-tasks-completed" },
        { criterionId: "actions", type: "all-goal-actions-resolved" },
      ],
    );
    const report = completion.inspect(inspectInput(goal)).report;
    expect(report.criteria.find((c) => c.id === "actions").met).toBe(true);
    expect(report.criteria.find((c) => c.id === "tasks").met).toBe(false);
    expect(report.met).toBe(false);
  });
  it("hard-blocks running native actions even when the actions criterion is removed", async () => {
    const original = createGoal();
    await check(original);
    const submitted = submitGoal(prepareGoal(original));
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
    const { goal } = configure(original, [manualCriterion], []);
    ack(goal);
    expect(completion.inspect(inspectInput(goal)).report).toMatchObject({
      met: false,
      blockedReason: "GOAL_COMPLETION_ACTION_UNRESOLVED",
    });
    release(false);
    await expect(running).rejects.toThrow(/ACTION_GOAL_REVISION/);
  });
  it("rejects a changed cross-actor intent collection between preview and final completion", async () => {
    const original = createGoal();
    await check(original);
    const { goal } = configure(original, [manualCriterion], []);
    ack(goal);
    await check(goal, "after-config");
    const input = inspectInput(goal, "new-intent"),
      prepared = completion.prepareComplete(input);
    actor = owner;
    prepareGoal(goal);
    actor = requester;
    expect(() =>
      completion.complete(input, {
        expectedAuthority: prepared.authority,
        expectedFreshnessDigest: prepared.freshnessDigest,
      }),
    ).toThrow("GOAL_COMPLETION_SOURCE_CHANGED");
  });
  it("retains immutable acceptance evidence and catches corrupted report derivation", () => {
    const { goal } = configure(createGoal({}, []));
    const result = completion.inspect(inspectInput(goal));
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_goal_acceptance SET record_json='{}' WHERE id=?",
        )
        .run(result.report.id),
    ).toThrow("GOAL_RECORD_IMMUTABLE");
    expect(() =>
      db
        .prepare(
          "DELETE FROM cc_organization_project_goal_acceptance WHERE id=?",
        )
        .run(result.report.id),
    ).toThrow("GOAL_RECORD_IMMUTABLE");
    db.exec(
      "DROP TRIGGER cc_organization_project_goal_acceptance_update_immutable",
    );
    const corrupted = { ...result.report, met: true };
    db.prepare(
      "UPDATE cc_organization_project_goal_acceptance SET record_json=?,content_digest=? WHERE id=?",
    ).run(JSON.stringify(corrupted), digest(corrupted), corrupted.id);
    expect(() => completion.status({ goalId: goal.id })).toThrow(
      "GOAL_COMPLETION_RECORD_CORRUPT",
    );
  });
  it("disables periodic monitoring durably on done while preserving the pending occurrence projection", () => {
    const { goal } = configure(createGoal({}, []));
    delivered();
    const input = {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "monitor",
        intervalMs: 60000,
        expiresAt: now + 3600000,
      },
      prepared = engine.prepareStartMonitoring(input);
    engine.startMonitoring(input, {
      expectedAuthority: prepared.authority,
      expectedMonitorId: prepared.expectedMonitorId,
    });
    expect(finish(goal).completed).toBe(true);
    expect(engine.status({ id: goal.id }).monitor).toMatchObject({
      enabled: false,
      state: "blocked",
      blockedReason: "GOAL_COMPLETED",
    });
  });
});
