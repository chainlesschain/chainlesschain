import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
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

describe("organization task changes with atomic approval consumption", () => {
  const owner = "did:owner",
    requester = "did:requester",
    first = "did:first",
    second = "did:second";
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
  function request(create = false, key = "change1") {
    return (create ? creation : descriptions).preview(
      create
        ? {
            projectId: "p1",
            taskType: "query_info",
            description: "Approved new task",
            idempotencyKey: key,
          }
        : {
            taskId: "t1",
            description: "Approved description",
            idempotencyKey: key,
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
    db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`
      CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,sync_status TEXT,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT,result_data TEXT);
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
    for (const [index, did] of [owner, requester, first, second].entries())
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
    approvals = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      now: () => now,
    });
    descriptions = action();
    creation = action(null, true);
    permissions = [owner, requester, first, second].map((actorDid) => ({
      actorDid,
      projectId: "p1",
      expiresAt: 10000000,
      permissions:
        actorDid === owner || actorDid === requester
          ? ["task.read", "task.create", "task.update-description"]
          : ["task.read", "task.approve"],
    }));
    await attest();
    await bind();
    actor = requester;
  });
  afterEach(() => db.close());

  it("commits a member's task edit, single approval consumption and durable receipt together", async () => {
    const candidate = request(),
      approvalId = approve(candidate);
    const service = action(approvalId);
    const result = await service.execute(candidate);
    expect(result.run.status).toBe("succeeded");
    expect(body()).toBe("Approved description");
    expect(consumed(approvalId)).toBe(result.run.id);
    expect(
      result.evidence.find(
        (item) => item.kind === "sqlite-task-description-update",
      ).organizationApproval,
    ).toMatchObject({ approvalId, runId: result.run.id });
    expect(service.getRun(result.run.id)).toEqual({
      run: result.run,
      evidence: result.evidence,
    });
    const saved = JSON.stringify(
      db.prepare("SELECT * FROM cc_business_action_runs").all(),
    );
    expect(saved).not.toContain("Approved description");
    expect(saved).not.toContain("Original");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("creates a canonical pending task for an authorized member without changing the project owner", async () => {
    const candidate = request(true),
      approvalId = approve(candidate, true),
      service = action(approvalId, true);
    const result = await service.execute(candidate);
    expect(result.run.status).toBe("succeeded");
    const created = result.evidence.find(
      (item) => item.kind === "sqlite-task-create",
    ).createdTaskRef;
    expect(created.scope).toEqual({ kind: "organization", id: "org1" });
    expect(
      db
        .prepare(
          "SELECT project_id,status,description FROM project_tasks WHERE id=?",
        )
        .get(created.id),
    ).toEqual({
      project_id: "p1",
      status: "pending",
      description: "Approved new task",
    });
    expect(
      db.prepare("SELECT user_id FROM projects WHERE id='p1'").get().user_id,
    ).toBe(owner);
    expect(consumed(approvalId)).toBe(result.run.id);
    expect(service.listProjectRuns({ projectId: "p1" }).runs[0].run.id).toBe(
      result.run.id,
    );
  });

  it("reads authorized bounded tasks and keeps read-only reviewers from proposing writes", () => {
    actor = first;
    expect(descriptions.readTask("t1")).toMatchObject({
      description: "Original",
      editable: false,
      reason: "ORG_AUTH_NOT_FOUND_OR_DENIED",
    });
    expect(descriptions.listTasks({ projectId: "p1" }).tasks[0].id).toBe("t1");
    expect(() => request()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
  });

  it("does not display confirmation or admit an action without a completed bound approval", async () => {
    const candidate = request();
    await expect(descriptions.execute(candidate)).rejects.toThrow(
      "ORG_APPROVAL_ID_REQUIRED",
    );
    const submitted = approvals.submit({
      projectId: "p1",
      request: candidate,
      workflowId: "wf-description",
    });
    await expect(
      action(submitted.approvalId).execute(candidate),
    ).rejects.toThrow("ORG_APPROVAL_NOT_APPROVED");
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
  });

  it("records native cancellation without consuming the organization approval", async () => {
    const candidate = request(),
      approvalId = approve(candidate);
    confirm.mockResolvedValue(false);
    const service = action(approvalId),
      result = await service.execute(candidate);
    expect(result.run.status).toBe("cancelled");
    expect(consumed(approvalId)).toBeNull();
    expect(body()).toBe("Original");
    expect(service.getRun(result.run.id).run.status).toBe("cancelled");
    expect((await service.execute(candidate)).replayed).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("replays a consumed action without another confirmation or side effect", async () => {
    const candidate = request(),
      approvalId = approve(candidate),
      service = action(approvalId);
    const firstResult = await service.execute(candidate),
      replay = await service.execute(candidate);
    expect(replay).toMatchObject({
      replayed: true,
      run: { id: firstResult.run.id, status: "succeeded" },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(1);
  });

  it("persists a definite denial when membership is revoked during confirmation", async () => {
    const candidate = request(),
      approvalId = approve(candidate);
    confirm.mockImplementation(async () => {
      db.prepare(
        "UPDATE organization_members SET status='removed' WHERE member_did=?",
      ).run(first);
      return true;
    });
    await expect(action(approvalId).execute(candidate)).rejects.toThrow(
      "ORG_AUTH_POLICY_STALE",
    );
    expect(body()).toBe("Original");
    expect(consumed(approvalId)).toBeNull();
    expect(
      JSON.parse(
        db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      ).status,
    ).toBe("denied");
  });

  it("persists denial if the task is reparented while native confirmation is open", async () => {
    const candidate = request(),
      approvalId = approve(candidate);
    confirm.mockImplementation(async () => {
      db.prepare(
        "UPDATE project_tasks SET project_id='other-project' WHERE id='t1'",
      ).run();
      return true;
    });
    await expect(action(approvalId).execute(candidate)).rejects.toThrow(
      /ORG_APPROVAL_|ORG_AUTH_/,
    );
    expect(body()).toBe("Original");
    expect(consumed(approvalId)).toBeNull();
    expect(
      JSON.parse(
        db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      ).status,
    ).toBe("denied");
  });

  it.each(["project", "task"])(
    "rejects %s workspace assignment followed by removal during confirmation",
    async (type) => {
      const candidate = request(),
        approvalId = approve(candidate);
      confirm.mockImplementation(async () => {
        db.prepare("INSERT INTO workspace_resources VALUES('w1',?,?)").run(
          type,
          type === "project" ? "p1" : "t1",
        );
        db.prepare(
          "DELETE FROM workspace_resources WHERE workspace_id='w1'",
        ).run();
        return true;
      });
      await expect(action(approvalId).execute(candidate)).rejects.toThrow(
        "ORG_AUTH_VERSION_CONFLICT",
      );
      expect(body()).toBe("Original");
      expect(consumed(approvalId)).toBeNull();
    },
  );

  it("rolls back consumed approval and task body when success receipt persistence fails", async () => {
    const candidate = request(),
      approvalId = approve(candidate),
      service = action(approvalId);
    db.exec(
      "CREATE TRIGGER fail_success BEFORE UPDATE ON cc_business_action_runs WHEN json_extract(NEW.run_json,'$.status')='succeeded' BEGIN SELECT RAISE(ABORT,'receipt failed'); END;",
    );
    // Schema migration invalidates admission; reprepare after the trigger is installed.
    const replacement = request(false, "replacement");
    approvals.cancel({ approvalId });
    const replacementApproval = approve(replacement);
    await expect(
      action(replacementApproval).execute(replacement),
    ).rejects.toThrow("ACTION_OUTCOME_UNKNOWN");
    expect(body()).toBe("Original");
    expect(consumed(replacementApproval)).toBeNull();
    expect(
      JSON.parse(
        db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      ).status,
    ).toBe("running");
    expect(() => request(false, "another-key")).toThrow(
      "ACTION_UNRESOLVED_ACTION",
    );
  });

  it("keeps legitimate personal history separate after explicit organization migration", async () => {
    // A trusted migration fixture retains a genuine personal success receipt.
    const legacyDb = new Database(":memory:");
    try {
      legacyDb.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER); CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,updated_at INTEGER,sync_status TEXT);",
      );
      legacyDb
        .prepare("INSERT INTO projects VALUES('p1',?,'active',10)")
        .run(requester);
      legacyDb
        .prepare(
          "INSERT INTO project_tasks VALUES('t1','p1','query_info','Original','pending',10,'synced')",
        )
        .run();
      const legacy = new TaskDescriptionActionService({
        db: legacyDb,
        getActor: () => requester,
        approvalGate: new ApprovalGate({ confirm: async () => true }),
      });
      const old = await legacy.execute(
        legacy.preview({
          taskId: "t1",
          description: "Legacy",
          idempotencyKey: "legacy1",
        }).request,
      );
      const row = legacyDb
        .prepare("SELECT * FROM cc_business_action_runs")
        .get();
      db.prepare(
        "INSERT INTO cc_business_action_runs VALUES(?,?,?,?,?,?,?)",
      ).run(
        row.id,
        row.actor_did,
        row.target_id,
        row.idempotency_digest,
        row.invocation_digest,
        row.run_json,
        row.evidence_json,
      );
      const candidate = request(),
        approvalId = approve(candidate),
        service = action(approvalId),
        result = await service.execute(candidate);
      const history = service.listRuns({ taskId: "t1" });
      expect(history.runs.map((item) => item.run.id)).toEqual([result.run.id]);
      expect(() =>
        service.listRuns({ taskId: "t1", beforeId: old.run.id }),
      ).toThrow("ACTION_INVALID_CURSOR");
    } finally {
      legacyDb.close();
    }
  });

  it("still rejects damaged organization receipt candidates", async () => {
    const candidate = request(),
      approvalId = approve(candidate),
      service = action(approvalId);
    const result = await service.execute(candidate);
    db.prepare(
      "UPDATE cc_business_action_runs SET run_json='broken' WHERE id=?",
    ).run(result.run.id);
    expect(() => service.listRuns({ taskId: "t1" })).toThrow(
      "ACTION_RECEIPT_CORRUPT",
    );
  });

  it("bounds metadata reads and refuses oversized full-row action versions", () => {
    db.prepare("UPDATE project_tasks SET result_data=? WHERE id='t1'").run(
      "x".repeat(70000),
    );
    expect(descriptions.readTask("t1")).toMatchObject({
      description: "Original",
      editable: false,
      reason: "ACTION_SOURCE_INVALID",
    });
    expect(() => request()).toThrow("ACTION_SOURCE_INVALID");
  });
});
