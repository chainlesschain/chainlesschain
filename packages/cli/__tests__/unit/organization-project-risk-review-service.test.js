import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
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

describe("organization project risk reviews and approved action lineage", () => {
  const owner = "did:owner",
    requester = "did:requester",
    first = "did:first",
    second = "did:second",
    reader = "did:reader";
  let risk, personal, personalReview, directory, filename, other;
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
    await attest();
    await bind();
    actor = requester;
  });
  afterEach(() => {
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

  it("stores organization evidence separately and shares history by current risk.read permission", () => {
    const result = evaluate();
    expect(Object.keys(result.sourceSnapshot).sort()).toEqual([
      "asOf",
      "project",
      "readStatus",
      "scope",
      "sourceSchema",
      "tasks",
    ]);
    expect(result.sourceSnapshot.scope).toEqual({
      kind: "organization",
      id: "org1",
    });
    expect(result.authority).toMatchObject({
      mappingRevision: 1,
      authorityEpoch: 1,
    });
    expect(result.evaluation.status).toBe("evaluated");
    expect(result.review.actorDid).toBe(requester);
    actor = reader;
    expect(risk.getReview({ reviewId: result.review.id })).toEqual(result);
    expect(
      risk.listReviews({ projectId: "p1" }).reviews.map((row) => row.review.id),
    ).toEqual([result.review.id]);
    expect(risk.getLineage({ reviewId: result.review.id }).contentDigest).toBe(
      digest(result),
    );
    expect(() => descriptions.listTasks({ projectId: "p1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() =>
      risk.getReview({ reviewId: personalReview.review.id }),
    ).toThrow("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    actor = owner;
    expect(() =>
      personal.getReview({ reviewId: personalReview.review.id }),
    ).toThrow("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    expect(() => personal.getReview({ reviewId: result.review.id })).toThrow(
      "PROJECT_RISK_NOT_FOUND_OR_DENIED",
    );
  });

  it("requires separate evaluate and feedback grants while a risk-only evaluator needs no task.read", async () => {
    const result = evaluate();
    actor = reader;
    expect(() => evaluate()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(() => feedback(result.review.id)).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    permissions
      .find((grant) => grant.actorDid === reader)
      .permissions.push("risk.evaluate");
    await reattest();
    actor = reader;
    expect(evaluate().review.actorDid).toBe(reader);
    permissions.find((grant) => grant.actorDid === requester).permissions = [
      "task.read",
      "task.create",
      "task.update-description",
      "risk.evaluate",
      "risk.feedback",
    ];
    await reattest();
    expect(() => evaluate()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(() => risk.getReview({ reviewId: result.review.id })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => feedback(result.review.id)).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });

  it("reads old history after reattestation while permanently fencing stale action contexts", async () => {
    const result = evaluate();
    const context = risk.getActionContext({
      reviewId: result.review.id,
      taskId: "t1",
    });
    expect(context).toEqual({
      id: result.review.id,
      contentDigest: digest(result),
    });
    await reattest();
    expect(risk.getReview({ reviewId: result.review.id })).toEqual(result);
    expect(() =>
      risk.getActionContext({ reviewId: result.review.id, taskId: "t1" }),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(feedback(result.review.id).feedback.actorDid).toBe(requester);
  });

  it.each([
    [
      "membership",
      "UPDATE organization_members SET status='inactive' WHERE member_did='did:requester'; UPDATE organization_members SET status='active' WHERE member_did='did:requester'",
    ],
    [
      "task",
      "UPDATE project_tasks SET description='temporary' WHERE id='t1'; UPDATE project_tasks SET description='Original' WHERE id='t1'",
    ],
    [
      "project",
      "UPDATE projects SET status='draft' WHERE id='p1'; UPDATE projects SET status='active' WHERE id='p1'",
    ],
  ])(
    "rejects %s ABA even when selected source fields return to their original values",
    async (_name, sql) => {
      const result = evaluate();
      db.exec(sql);
      if (_name === "membership") await reattest();
      expect(risk.getReview({ reviewId: result.review.id })).toEqual(result);
      expect(() =>
        risk.getActionContext({ reviewId: result.review.id, taskId: "t1" }),
      ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    },
  );

  it.each([false, true])(
    "binds risk evidence to actual two-step approval, native execution and cross-reader lineage (create=%s)",
    async (create) => {
      const review = evaluate();
      const candidate = request(create, "risk-action", review.review.id);
      expect(candidate.input.riskReview).toEqual({
        id: review.review.id,
        contentDigest: digest(review),
      });
      expect(candidate.expectedVersion).not.toBe(
        review.evaluation.taskRefs.find((ref) => ref.id === "t1").version,
      );
      const approvalId = approve(candidate, create);
      const result = await action(approvalId, create).execute(candidate);
      expect(result.run.status).toBe("succeeded");
      expect(confirm).toHaveBeenCalledTimes(1);
      const binding = JSON.parse(
        db
          .prepare(
            "SELECT binding_json FROM cc_organization_action_approvals WHERE request_id=?",
          )
          .get(approvalId).binding_json,
      );
      expect(binding.riskReview).toEqual(candidate.input.riskReview);
      expect(
        approvals.submit({
          projectId: "p1",
          request: candidate,
          workflowId: create ? "wf-create" : "wf-description",
        }),
      ).toMatchObject({
        approvalId,
        status: "consumed",
        consumedRunId: result.run.id,
      });
      actor = second;
      const item = feedback(review.review.id, {
        comment: "Confirmed with team",
      });
      actor = reader;
      const lineage = risk.getLineage({ reviewId: review.review.id });
      expect(lineage.actionRuns).toEqual([
        { run: result.run, evidence: result.evidence },
      ]);
      expect(lineage.feedback).toEqual([item]);
      expect(lineage.evaluation).toEqual(review.evaluation);
      expect(
        lineage.actionRuns[0].evidence.find(
          (row) => row.kind === "organization-project-authority",
        ).approvalId,
      ).toBe(approvalId);
      const targetId = create
        ? result.evidence.find((item) => item.kind === "sqlite-task-create")
            .createdTaskRef.id
        : "t1";
      db.prepare("UPDATE project_tasks SET project_id='other' WHERE id=?").run(
        targetId,
      );
      expect(() => risk.getLineage({ reviewId: review.review.id })).toThrow(
        /PROJECT_RISK_(NOT_FOUND_OR_DENIED|LINEAGE_CORRUPT)/,
      );
    },
  );

  it("requires risk.read for every named approver before admission", async () => {
    permissions.find((grant) => grant.actorDid === second).permissions = [
      "task.read",
      "task.approve",
    ];
    await reattest();
    const review = evaluate(),
      candidate = request(false, "missing-risk-reader", review.review.id);
    expect(() =>
      approvals.submit({
        projectId: "p1",
        workflowId: "wf-description",
        request: candidate,
      }),
    ).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });

  it("fails closed for missing risk service and strict malformed risk references", () => {
    const review = evaluate(),
      candidate = request(false, "risk-ref", review.review.id);
    const missing = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      now: () => now,
    });
    expect(() =>
      missing.submit({
        projectId: "p1",
        workflowId: "wf-description",
        request: candidate,
      }),
    ).toThrow("ORG_APPROVAL_RISK_SERVICE_REQUIRED");
    expect(() =>
      risk.getActionContext({
        reviewId: review.review.id,
        taskId: "t1",
        contentDigest: "sha256:" + "0".repeat(64),
      }),
    ).toThrow("PROJECT_RISK_REVIEW_CONFLICT");
    expect(() =>
      descriptions.preview({
        taskId: "t1",
        description: "body",
        idempotencyKey: "k",
        reviewId: review.review.id,
        extra: true,
      }),
    ).toThrow("ACTION_INVALID_REQUEST");
  });

  it("rechecks risk freshness before response and native execution", async () => {
    const review = evaluate(),
      candidate = request(false, "risk-fresh", review.review.id);
    const pending = approvals.submit({
      projectId: "p1",
      workflowId: "wf-description",
      request: candidate,
    });
    db.prepare("UPDATE project_tasks SET due_date=2 WHERE id='t1'").run();
    actor = first;
    expect(() =>
      approvals.respond({
        approvalId: pending.approvalId,
        step: 0,
        decision: "approve",
      }),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
    actor = requester;
    approvals.cancel({ approvalId: pending.approvalId });
    const fresh = evaluate(),
      next = request(false, "risk-fresh-2", fresh.review.id),
      id = approve(next);
    confirm.mockImplementation(async () => {
      db.prepare("UPDATE project_tasks SET due_date=3 WHERE id='t1'").run();
      return true;
    });
    await expect(action(id).execute(next)).rejects.toThrow(
      "ORG_AUTH_VERSION_CONFLICT",
    );
    expect(body()).toBe("Original");
    expect(consumed(id)).toBeNull();
    actor = reader;
    expect(
      risk.getLineage({ reviewId: fresh.review.id }).actionRuns[0].run.status,
    ).toBe("denied");
  });

  it("keeps feedback append-only and rechecks the native confirmation authority", async () => {
    const review = evaluate();
    const expectedAuthority = db
      .transaction(() =>
        authority.assertAuthorizedInTransaction({
          projectId: "p1",
          actorDid: actor,
          permission: "risk.feedback",
        }),
      )
      .immediate();
    const firstFeedback = feedback(review.review.id, { expectedAuthority });
    const secondFeedback = feedback(review.review.id, {
      verdict: "dismissed",
      reasonCodes: [],
    });
    expect(firstFeedback.feedback.id).not.toBe(secondFeedback.feedback.id);
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_risk_feedback SET feedback_json='{}'",
        )
        .run(),
    ).toThrow("PROJECT_RISK_IMMUTABLE");
    expect(() =>
      db.prepare("DELETE FROM cc_organization_project_risk_feedback").run(),
    ).toThrow("PROJECT_RISK_IMMUTABLE");
    await reattest();
    expect(() => feedback(review.review.id, { expectedAuthority })).toThrow(
      "ORG_AUTH_VERSION_CONFLICT",
    );
    expect(risk.getReview({ reviewId: review.review.id }).evaluation).toEqual(
      review.evaluation,
    );
    expect(body()).toBe("Original");
  });

  it("prepares fully validated feedback before native confirmation and reuses the validator at commit", () => {
    const review = evaluate();
    const input = {
      reviewId: review.review.id,
      taskId: "t1",
      verdict: "affirmed",
      reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
      comment: "reviewed",
    };
    const prepared = risk.prepareFeedback(input);
    expect(prepared).toMatchObject({
      review: review.review,
      evaluation: review.evaluation,
      actorDid: requester,
      taskId: "t1",
      authority: review.authority,
    });
    expect(
      db
        .transaction(() => risk.prepareFeedbackInTransaction(input))
        .immediate(),
    ).toEqual(prepared);
    expect(() => risk.prepareFeedbackInTransaction(input)).toThrow(
      "PROJECT_RISK_TRANSACTION_REQUIRED",
    );
    for (const extra of [
      { taskId: "missing" },
      { comment: "x".repeat(500000) },
      { comment: "界".repeat(1366) },
      { verdict: "invented" },
      { reasonCodes: ["BLOCKED_BY_INCOMPLETE_DEPENDENCY"] },
      { reasonCodes: ["OVERDUE_INCOMPLETE_TASK", "OVERDUE_INCOMPLETE_TASK"] },
      { verdict: "dismissed" },
      { unexpected: true },
      { expectedAuthority: null },
    ]) {
      expect(() => risk.prepareFeedback({ ...input, ...extra })).toThrow(
        /PROJECT_RISK_/,
      );
      expect(() => risk.recordFeedback({ ...input, ...extra })).toThrow(
        /PROJECT_RISK_/,
      );
    }
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
        )
        .get().n,
    ).toBe(0);
    actor = reader;
    expect(() => risk.prepareFeedback(input)).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });

  it("returns explicit incomplete source evidence and rejects oversized selected fields", () => {
    db.exec("ALTER TABLE project_tasks DROP COLUMN blocked_by");
    const result = evaluate();
    expect(result.sourceSnapshot.readStatus).toBe("schema-incomplete");
    expect(result.evaluation.reasonCodes).toEqual(["SOURCE_SCHEMA_INCOMPLETE"]);
    expect(() =>
      risk.getActionContext({ reviewId: result.review.id, taskId: "t1" }),
    ).toThrow("PROJECT_RISK_ACTION_SOURCE_INVALID");
    db.exec("ALTER TABLE project_tasks ADD COLUMN blocked_by TEXT");
    db.prepare("UPDATE project_tasks SET blocked_by=? WHERE id='t1'").run(
      "x".repeat(2 * 1024 * 1024 + 1),
    );
    expect(() => evaluate()).toThrow("PROJECT_RISK_EVIDENCE_TOO_LARGE");
  });

  it("records task overflow as unavailable without persisting a partial task list", () => {
    db.transaction(() => {
      const insert = db.prepare(
        "INSERT INTO project_tasks(id,project_id,status,updated_at) VALUES(?,'p1','pending',10)",
      );
      for (let i = 0; i < 1000; i++) insert.run(`extra-${i}`);
    }).immediate();
    const result = evaluate();
    expect(result.sourceSnapshot.tasks).toEqual([]);
    expect(result.evaluation.reasonCodes).toEqual(["TASK_LIMIT_EXCEEDED"]);
  });

  it.each(["source_json", "authority_json", "evaluation_json"])(
    "fails closed on corrupt %s and validates page cursors",
    (column) => {
      const review = evaluate();
      expect(() =>
        risk.listReviews({ projectId: "p1", beforeId: "missing" }),
      ).toThrow("PROJECT_RISK_INVALID_CURSOR");
      db.exec(
        "DROP TRIGGER cc_organization_project_risk_reviews_update_immutable",
      );
      db.prepare(
        `UPDATE cc_organization_project_risk_reviews SET ${column}='{}' WHERE id=?`,
      ).run(review.review.id);
      expect(() => risk.getReview({ reviewId: review.review.id })).toThrow(
        "PROJECT_RISK_REVIEW_CORRUPT",
      );
      expect(() => risk.listReviews({ projectId: "p1" })).toThrow(
        "PROJECT_RISK_REVIEW_CORRUPT",
      );
    },
  );

  it("rolls back collected reviews and approved task consumption when SQLite aborts", async () => {
    expect(() =>
      db
        .transaction(() => {
          risk.evaluateInTransaction({ projectId: "p1" });
          throw new Error("ROLLBACK");
        })
        .immediate(),
    ).toThrow("ROLLBACK");
    expect(risk.listReviews({ projectId: "p1" }).reviews).toEqual([]);
    const review = evaluate(),
      candidate = request(false, "rollback", review.review.id),
      id = approve(candidate);
    db.exec(
      "CREATE TRIGGER fail_risk_success BEFORE UPDATE ON cc_business_action_runs WHEN json_extract(NEW.run_json,'$.status')='succeeded' BEGIN SELECT RAISE(ABORT,'STOP'); END",
    );
    // Schema changes are authority fences, so refresh the review/proposal after installing fault injection.
    approvals.cancel({ approvalId: id });
    const fresh = evaluate(),
      next = request(false, "rollback-2", fresh.review.id),
      approvalId = approve(next);
    await expect(action(approvalId).execute(next)).rejects.toThrow(
      "ACTION_OUTCOME_UNKNOWN",
    );
    expect(body()).toBe("Original");
    expect(consumed(approvalId)).toBeNull();
    actor = reader;
    expect(
      risk.getLineage({ reviewId: fresh.review.id }).actionRuns[0].run.status,
    ).toBe("running");
  });

  it("persists shared history across native connections without cached permission answers", () => {
    const result = evaluate();
    other = new Database(filename);
    actor = reader;
    const otherAuthority = new OrganizationProjectAuthority({
      db: other,
      getActor: () => actor,
      confirm: async () => true,
      now: () => now,
    });
    const service = new OrganizationProjectRiskReviewService({
      db: other,
      getActor: () => actor,
      authority: otherAuthority,
      now: () => now,
    });
    expect(service.getReview({ reviewId: result.review.id })).toEqual(result);
    db.prepare(
      "UPDATE organization_members SET status='inactive' WHERE member_did=?",
    ).run(reader);
    expect(() => service.getReview({ reviewId: result.review.id })).toThrow(
      /ORG_AUTH_/,
    );
  });

  it.each(["evidence", "consumption", "missing-run", "oversized-run"])(
    "fails closed on malformed risk-linked %s proof",
    async (kind) => {
      const review = evaluate(),
        candidate = request(false, `corrupt-${kind}`, review.review.id),
        approvalId = approve(candidate);
      const result = await action(approvalId).execute(candidate);
      if (kind === "evidence") {
        const evidence = JSON.parse(JSON.stringify(result.evidence));
        evidence.find(
          (item) => item.kind === "project-risk-review",
        ).contentDigest = "sha256:" + "0".repeat(64);
        db.prepare(
          "UPDATE cc_business_action_runs SET evidence_json=? WHERE id=?",
        ).run(JSON.stringify(evidence), result.run.id);
      } else if (kind === "consumption") {
        db.exec("DROP TRIGGER cc_org_approval_binding_immutable");
        db.prepare(
          "UPDATE cc_organization_action_approvals SET consumed_run_id='wrong-run' WHERE request_id=?",
        ).run(approvalId);
      } else if (kind === "missing-run") {
        db.prepare("DELETE FROM cc_business_action_runs WHERE id=?").run(
          result.run.id,
        );
      } else {
        db.prepare(
          "UPDATE cc_business_action_runs SET run_json=? WHERE id=?",
        ).run("x".repeat(65537), result.run.id);
      }
      actor = reader;
      expect(() => risk.getLineage({ reviewId: review.review.id })).toThrow(
        "PROJECT_RISK_LINEAGE_CORRUPT",
      );
    },
  );

  it("rejects forged feedback rule claims even with a recomputed feedback digest", () => {
    const review = evaluate();
    const item = {
      id: "forged",
      reviewId: review.review.id,
      taskId: "t1",
      actorDid: requester,
      createdAt: new Date(now).toISOString(),
      verdict: "affirmed",
      reasonCodes: ["BLOCKED_BY_INCOMPLETE_DEPENDENCY"],
      comment: "",
    };
    db.prepare(
      "INSERT INTO cc_organization_project_risk_feedback VALUES(?,?,?,?,?)",
    ).run(
      item.id,
      item.reviewId,
      item.actorDid,
      JSON.stringify(item),
      digest(item),
    );
    expect(() => risk.getLineage({ reviewId: review.review.id })).toThrow(
      "PROJECT_RISK_FEEDBACK_CORRUPT",
    );
  });

  it("cannot attach a normal approved action to unrelated risk evidence", async () => {
    const review = evaluate(),
      candidate = request(),
      id = approve(candidate);
    const result = await action(id).execute(candidate);
    expect(() =>
      db
        .transaction(() =>
          risk.bindActionRun({
            reviewId: review.review.id,
            contentDigest: digest(review),
            run: result.run,
          }),
        )
        .immediate(),
    ).toThrow("PROJECT_RISK_LINEAGE_CORRUPT");
    expect(risk.getLineage({ reviewId: review.review.id }).actionRuns).toEqual(
      [],
    );
  });
});
