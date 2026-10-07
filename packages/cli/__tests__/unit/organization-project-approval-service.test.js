import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  OrganizationProjectApprovalService,
  organizationProjectActionTargetVersion,
} = require("../../../session-core/lib/organization-project-approval-service");
const {
  createBusinessActionRequest,
  createBusinessObjectRef,
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");

describe("immutable organization action approval companion", () => {
  const requester = "did:requester",
    first = "did:first",
    secondApprover = "did:second",
    third = "did:third";
  let directory, db, other, actor, clock, service, filename;

  // This adapter reads actual SQLite grants/fences on each call. It deliberately
  // has no cached permission answers; separate connections observe the same
  // revocation and source generations. The production adapter has its own suite.
  function makeAuthority(connection) {
    function snapshot() {
      const state = connection
        .prepare("SELECT * FROM test_authority_state")
        .get();
      return {
        scope: { kind: "organization", id: "org1" },
        mappingRevision: 1,
        authorityEpoch: state.epoch,
        sourceRevision: state.source_revision,
        projectSourceRevision: state.project_revision,
        policyDigest: digest({ epoch: state.epoch }),
      };
    }
    function check(subject, permission, expected) {
      if (!connection.inTransaction)
        throw new Error("TEST_AUTH_TRANSACTION_REQUIRED");
      const grant = connection
        .prepare("SELECT * FROM test_grants WHERE actor=?")
        .get(subject);
      if (
        !grant ||
        grant.active !== 1 ||
        grant.expires_at <= clock ||
        !JSON.parse(grant.permissions).includes(permission)
      )
        throw new Error("TEST_AUTH_DENIED");
      const current = snapshot();
      if (expected && digest(current) !== digest(expected))
        throw new Error("TEST_AUTH_CHANGED");
      return current;
    }
    return {
      assertAuthorizedInTransaction({
        projectId,
        actorDid,
        permission,
        expectedAuthority,
      }) {
        if (projectId !== "p1" || actorDid !== actor)
          throw new Error("TEST_AUTH_IDENTITY");
        return check(actorDid, permission, expectedAuthority);
      },
      assertApproverInTransaction({
        projectId,
        approverDid,
        expectedAuthority,
      }) {
        if (projectId !== "p1") throw new Error("TEST_AUTH_PROJECT");
        check(actor, "task.read", expectedAuthority);
        return check(approverDid, "task.approve", expectedAuthority);
      },
      assertWorkflowInTransaction({
        projectId,
        actorDid,
        workflowId,
        expectedAuthority,
      }) {
        if (actorDid !== actor || projectId !== "p1")
          throw new Error("TEST_AUTH_IDENTITY");
        const authority = check(actorDid, "task.read", expectedAuthority);
        return {
          authority,
          workflow: connection
            .prepare("SELECT * FROM approval_workflows WHERE id=?")
            .get(workflowId),
        };
      },
    };
  }
  function makeService(connection = db) {
    return new OrganizationProjectApprovalService({
      db: connection,
      getActor: () => actor,
      authority: makeAuthority(connection),
      now: () => clock,
    });
  }
  function request({
    actionType = "task.update-description",
    description = "PRIVATE TASK BODY",
    key = "key1",
    taskId = "t1",
  } = {}) {
    const authority = db
      .transaction(() =>
        makeAuthority(db).assertAuthorizedInTransaction({
          projectId: "p1",
          actorDid: actor,
          permission: actionType,
        }),
      )
      .immediate();
    const target = {
      type: actionType === "task.create" ? "Project" : "Task",
      id: actionType === "task.create" ? "p1" : taskId,
      sourceKind:
        actionType === "task.create"
          ? "desktop.project-task-owner"
          : "desktop.project-task",
      scope: authority.scope,
    };
    const version = organizationProjectActionTargetVersion(db, {
      projectId: "p1",
      target,
      authority,
    });
    return createBusinessActionRequest({
      actionType,
      actionVersion: 1,
      target: createBusinessObjectRef({ ...target, version }),
      expectedVersion: version,
      input:
        actionType === "task.create"
          ? { description, taskType: "query_info" }
          : { description },
      idempotencyKey: key,
    });
  }
  function submit(candidate = request()) {
    return {
      request: candidate,
      ...service.submit({
        request: candidate,
        projectId: "p1",
        workflowId: "wf1",
      }),
    };
  }
  function respond(approval, who, step = 0, decision = "approve") {
    actor = who;
    return service.respond({ approvalId: approval.approvalId, step, decision });
  }
  function consume(
    approval,
    runId = "run1",
    instance = service,
    connection = db,
  ) {
    actor = requester;
    return connection
      .transaction(() =>
        instance.consumeInTransaction({
          approvalId: approval.approvalId,
          request: approval.request,
          projectId: "p1",
          runId,
          actorDid: requester,
        }),
      )
      .immediate();
  }
  function workflow(type, steps) {
    db.prepare(
      "UPDATE approval_workflows SET approval_type=?,approvers=? WHERE id='wf1'",
    ).run(type, JSON.stringify(steps));
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-approval-"));
    filename = join(directory, "authority.db");
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    db.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,description TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      CREATE TABLE approval_workflows(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,trigger_resource_type TEXT,trigger_action TEXT,trigger_conditions TEXT,approval_type TEXT,approvers TEXT,timeout_hours REAL,on_timeout TEXT,enabled INTEGER,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE approval_requests(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES approval_workflows(id),org_id TEXT,requester_did TEXT,requester_name TEXT,resource_type TEXT,resource_id TEXT,action TEXT,request_data TEXT,status TEXT,current_step INTEGER,total_steps INTEGER,created_at INTEGER,updated_at INTEGER,completed_at INTEGER);
      CREATE TABLE approval_responses(id TEXT PRIMARY KEY,request_id TEXT REFERENCES approval_requests(id),approver_did TEXT,approver_name TEXT,step INTEGER,decision TEXT,delegated_to TEXT,comment TEXT,created_at INTEGER);
      CREATE TABLE test_grants(actor TEXT PRIMARY KEY,permissions TEXT,active INTEGER,expires_at INTEGER);
      CREATE TABLE test_authority_state(epoch INTEGER,source_revision INTEGER,project_revision INTEGER);
      INSERT INTO test_authority_state VALUES(1,1,1);
      CREATE TRIGGER test_grant_fence AFTER UPDATE ON test_grants BEGIN UPDATE test_authority_state SET source_revision=source_revision+1; END;
      CREATE TRIGGER test_workflow_fence AFTER UPDATE ON approval_workflows BEGIN UPDATE test_authority_state SET source_revision=source_revision+1; END;
      CREATE TRIGGER test_project_fence AFTER UPDATE ON projects BEGIN UPDATE test_authority_state SET project_revision=project_revision+1; END;
      INSERT INTO projects(id,user_id,status,updated_at,org_id) VALUES('p1','did:owner','active',1,'org1');
      INSERT INTO project_tasks(id,project_id,description,status,updated_at,org_id) VALUES('t1','p1','Before','pending',1,'org1');
      INSERT INTO approval_workflows VALUES('wf1','org1','Review','task','task.update-description',NULL,'sequential','["did:first","did:second"]',1,'approve',1,1,1);
    `);
    for (const did of [requester, first, secondApprover, third])
      db.prepare("INSERT INTO test_grants VALUES(?,?,1,10000000)").run(
        did,
        JSON.stringify(
          did === requester
            ? ["task.read", "task.create", "task.update-description"]
            : ["task.read", "task.approve"],
        ),
      );
    actor = requester;
    clock = 1000;
    other = null;
    service = makeService();
  });
  afterEach(() => {
    if (other?.open) other.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("requires native SQLite, authority and the existing approval tables", () => {
    expect(() => new OrganizationProjectApprovalService({ db: {} })).toThrow(
      "ORG_APPROVAL_NATIVE_DATABASE_REQUIRED",
    );
    expect(
      () =>
        new OrganizationProjectApprovalService({
          db,
          getActor: () => actor,
          authority: {},
        }),
    ).toThrow("ORG_APPROVAL_AUTHORITY_REQUIRED");
    const missing = new Database(":memory:");
    try {
      expect(
        () =>
          new OrganizationProjectApprovalService({
            db: missing,
            getActor: () => actor,
            authority: makeAuthority(db),
          }),
      ).toThrow("ORG_APPROVAL_SOURCE_INCOMPLETE");
    } finally {
      missing.close();
    }
  });
  it("completes sequential levels and consumes once, without persisting task content or raw keys", () => {
    const approval = submit(request({ key: "PRIVATE-IDEMPOTENCY-KEY" }));
    expect(respond(approval, first)).toMatchObject({
      status: "pending",
      currentStep: 1,
    });
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_NOT_APPROVED");
    expect(respond(approval, secondApprover, 1)).toMatchObject({
      status: "approved",
    });
    expect(consume(approval)).toMatchObject({
      approvalId: approval.approvalId,
      runId: "run1",
    });
    expect(() => consume(approval, "run2")).toThrow(
      "ORG_APPROVAL_ALREADY_CONSUMED",
    );
    const persisted =
      JSON.stringify(db.prepare("SELECT * FROM approval_requests").all()) +
      JSON.stringify(
        db.prepare("SELECT * FROM cc_organization_action_approvals").all(),
      );
    expect(persisted).not.toContain("PRIVATE TASK BODY");
    expect(persisted).not.toContain("PRIVATE-IDEMPOTENCY-KEY");
    expect(service.get({ approvalId: approval.approvalId }).status).toBe(
      "consumed",
    );
  });
  it("requires every parallel approver in each level", () => {
    workflow("parallel", [[first, secondApprover], third]);
    const approval = submit();
    expect(respond(approval, first)).toMatchObject({
      status: "pending",
      currentStep: 0,
    });
    expect(() => respond(approval, third, 1)).toThrow(
      "ORG_APPROVAL_NOT_FOUND_OR_DENIED",
    );
    expect(respond(approval, secondApprover)).toMatchObject({
      status: "pending",
      currentStep: 1,
    });
    expect(respond(approval, third, 1).status).toBe("approved");
    expect(consume(approval).runId).toBe("run1");
  });
  it.each(["sequential", "any_one"])(
    "preserves %s step semantics with explicit step retry protection",
    (type) => {
      workflow(type, [
        [first, secondApprover],
        [first, third],
      ]);
      const approval = submit();
      respond(approval, first, 0);
      expect(() => respond(approval, first, 0)).toThrow(
        "ORG_APPROVAL_STEP_CONFLICT",
      );
      expect(respond(approval, first, 1).status).toBe("approved");
      expect(consume(approval).runId).toBe("run1");
    },
  );
  it("prevents duplicate parallel responses and does not count retries", () => {
    workflow("parallel", [[first, secondApprover]]);
    const approval = submit();
    respond(approval, first);
    expect(() => respond(approval, first)).toThrow(
      "ORG_APPROVAL_ALREADY_RESPONDED",
    );
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(1);
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_NOT_APPROVED");
  });
  it("ends approval on rejection and never consumes it", () => {
    const approval = submit();
    expect(respond(approval, first, 0, "reject").status).toBe("rejected");
    expect(() => respond(approval, secondApprover, 1)).toThrow(
      "ORG_APPROVAL_NOT_PENDING",
    );
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_NOT_APPROVED");
  });
  it.each(
    [[], [[first, first]], [requester], [{}]].map((steps) => ({ steps })),
  )("rejects malformed or self-approval plan $steps", ({ steps }) => {
    workflow("parallel", steps);
    expect(() => submit()).toThrow(/ORG_APPROVAL_/);
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });
  it("supports Project-targeted creation and rejects wrong target mappings", () => {
    db.prepare(
      "UPDATE approval_workflows SET trigger_action='task.create' WHERE id='wf1'",
    ).run();
    const approval = submit(request({ actionType: "task.create" }));
    respond(approval, first);
    respond(approval, secondApprover, 1);
    expect(consume(approval).runId).toBe("run1");
    actor = requester;
    expect(() =>
      service.submit({
        request: approval.request,
        projectId: "different",
        workflowId: "wf1",
      }),
    ).toThrow("ORG_APPROVAL_UNSUPPORTED_REQUEST");
  });
  it("validates the actual source version and refuses changed task input", () => {
    const candidate = request();
    db.prepare(
      "UPDATE project_tasks SET description='Changed',updated_at=2 WHERE id='t1'",
    ).run();
    expect(() => submit(candidate)).toThrow("ORG_APPROVAL_VERSION_CONFLICT");
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    actor = requester;
    const changed = request({ description: "different" });
    expect(() => consume({ ...approval, request: changed })).toThrow(
      "ORG_APPROVAL_BINDING_MISMATCH",
    );
  });
  it("rejects cross-organization and workspace resource sources and oversized full tasks", () => {
    db.prepare("UPDATE project_tasks SET org_id='org2' WHERE id='t1'").run();
    expect(() => request()).toThrow("ORG_APPROVAL_TARGET_DENIED");
    db.prepare("UPDATE project_tasks SET org_id='org1' WHERE id='t1'").run();
    db.prepare(
      "INSERT INTO workspace_resources VALUES('w1','task','t1')",
    ).run();
    expect(() => request()).toThrow("ORG_APPROVAL_TARGET_DENIED");
    db.prepare("DELETE FROM workspace_resources").run();
    db.prepare("UPDATE project_tasks SET description=? WHERE id='t1'").run(
      "x".repeat(65537),
    );
    expect(() => request()).toThrow();
  });
  it("budgets every task column before loading the row, including quoted extension columns", () => {
    db.exec('ALTER TABLE project_tasks ADD COLUMN "extension""payload" BLOB');
    db.prepare(
      'UPDATE project_tasks SET "extension""payload"=? WHERE id=\'t1\'',
    ).run(Buffer.alloc(65537));
    const authority = db
      .transaction(() =>
        makeAuthority(db).assertAuthorizedInTransaction({
          projectId: "p1",
          actorDid: actor,
          permission: "task.read",
        }),
      )
      .immediate();
    let fullRowRead = false;
    const guarded = {
      prepare(sql) {
        if (/SELECT \* FROM project_tasks/u.test(sql)) fullRowRead = true;
        return db.prepare(sql);
      },
    };
    expect(() =>
      organizationProjectActionTargetVersion(guarded, {
        projectId: "p1",
        target: {
          type: "Task",
          id: "t1",
          sourceKind: "desktop.project-task",
          scope: authority.scope,
        },
        authority,
      }),
    ).toThrow("ORG_APPROVAL_SOURCE_TOO_LARGE");
    expect(fullRowRead).toBe(false);
  });
  it("uses idempotency binding and forbids another input under the same key", () => {
    const approval = submit();
    expect(submit(approval.request).approvalId).toBe(approval.approvalId);
    expect(() => submit(request({ description: "Different" }))).toThrow(
      "ORG_APPROVAL_IDEMPOTENCY_CONFLICT",
    );
  });
  it("blocks new keys and another workflow while the same target approval is pending", () => {
    const approval = submit();
    const alternative = request({ key: "key2" });
    db.prepare(
      `INSERT INTO approval_workflows SELECT 'wf2',org_id,'Other',trigger_resource_type,
      trigger_action,trigger_conditions,approval_type,approvers,timeout_hours,on_timeout,enabled,created_at,updated_at
      FROM approval_workflows WHERE id='wf1'`,
    ).run();
    expect(() => submit(alternative)).toThrow("ORG_APPROVAL_UNRESOLVED_TARGET");
    expect(() =>
      service.submit({
        request: alternative,
        projectId: "p1",
        workflowId: "wf2",
      }),
    ).toThrow("ORG_APPROVAL_UNRESOLVED_TARGET");
    expect(submit(approval.request).approvalId).toBe(approval.approvalId);
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(1);
  });
  it("keeps fully approved but unconsumed targets locked until requester cancellation", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    actor = requester;
    expect(() => submit(request({ key: "key2" }))).toThrow(
      "ORG_APPROVAL_UNRESOLVED_TARGET",
    );
    const before = db
      .prepare("SELECT * FROM project_tasks WHERE id='t1'")
      .get();
    expect(service.cancel({ approvalId: approval.approvalId })).toMatchObject({
      status: "cancelled",
      authority: "recorded-only",
    });
    expect(
      db.prepare("SELECT * FROM project_tasks WHERE id='t1'").get(),
    ).toEqual(before);
    expect(
      db
        .prepare("SELECT consumed_run_id FROM cc_organization_action_approvals")
        .get().consumed_run_id,
    ).toBeNull();
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_NOT_APPROVED");
    expect(submit(request({ key: "key2" })).status).toBe("pending");
  });
  it("lets the requester with current read permission cancel a stale version after write permission is withdrawn", () => {
    const approval = submit();
    db.prepare(
      "UPDATE project_tasks SET description='Changed',updated_at=2 WHERE id='t1'",
    ).run();
    db.prepare("UPDATE test_grants SET permissions=? WHERE actor=?").run(
      JSON.stringify(["task.read"]),
      requester,
    );
    expect(service.cancel({ approvalId: approval.approvalId }).status).toBe(
      "cancelled",
    );
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Changed");
  });
  it("allows neither another reader nor a requester without current read permission to cancel", () => {
    const approval = submit();
    actor = first;
    expect(() => service.cancel({ approvalId: approval.approvalId })).toThrow(
      "ORG_APPROVAL_NOT_FOUND_OR_DENIED",
    );
    actor = requester;
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(requester);
    expect(() => service.cancel({ approvalId: approval.approvalId })).toThrow(
      "TEST_AUTH_DENIED",
    );
    expect(
      db.prepare("SELECT status FROM approval_requests").get().status,
    ).toBe("pending");
  });
  it("refuses cancellation of consumed or already terminal approvals", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    consume(approval);
    expect(() => service.cancel({ approvalId: approval.approvalId })).toThrow(
      "ORG_APPROVAL_ALREADY_CONSUMED",
    );
    const pending = submit(request({ key: "key2" }));
    service.cancel({ approvalId: pending.approvalId });
    expect(() => service.cancel({ approvalId: pending.approvalId })).toThrow(
      "ORG_APPROVAL_NOT_PENDING",
    );
  });
  it("releases expired targets for a new key without claiming approval or successful execution", () => {
    const approval = submit();
    clock = approval.expiresAt;
    expect(service.get({ approvalId: approval.approvalId }).status).toBe(
      "expired",
    );
    const next = submit(request({ key: "key2" }));
    expect(next.status).toBe("pending");
    expect(service.cancel({ approvalId: approval.approvalId }).status).toBe(
      "expired",
    );
    expect(
      db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(approval.approvalId).consumed_run_id,
    ).toBeNull();
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_EXPIRED");
  });
  it("locks exact targets while allowing a distinct task in the same project", () => {
    submit();
    db.prepare(
      "INSERT INTO project_tasks(id,project_id,description,status,updated_at,org_id) VALUES('t2','p1','Other','pending',1,'org1')",
    ).run();
    expect(submit(request({ key: "key2", taskId: "t2" })).status).toBe(
      "pending",
    );
  });
  it("fails closed on malformed unresolved candidates instead of evading the target lock", () => {
    submit();
    db.exec("DROP TRIGGER cc_org_approval_binding_immutable");
    db.prepare(
      "UPDATE cc_organization_action_approvals SET binding_json='{' ",
    ).run();
    expect(() => submit(request({ key: "key2" }))).toThrow(
      "ORG_APPROVAL_CORRUPT",
    );
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(1);
  });
  it("replays a consumed admission after target mutation with current read/write authorization", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    consume(approval);
    db.prepare(
      "UPDATE project_tasks SET description='After',updated_at=2 WHERE id='t1'",
    ).run();
    db.prepare("UPDATE projects SET updated_at=2 WHERE id='p1'").run();
    const replay = submit(approval.request);
    expect(replay).toMatchObject({
      approvalId: approval.approvalId,
      status: "consumed",
      authority: "recorded-only",
      consumedRunId: "run1",
    });
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(1);
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(requester);
    expect(() => submit(approval.request)).toThrow("TEST_AUTH_DENIED");
  });
  it("refuses requester and approver claims from a different current actor", () => {
    const approval = submit();
    actor = third;
    expect(() =>
      service.respond({
        approvalId: approval.approvalId,
        step: 0,
        decision: "approve",
        actorDid: first,
      }),
    ).toThrow("ORG_APPROVAL_INVALID_REQUEST");
    expect(() => respond(approval, third)).toThrow(
      "ORG_APPROVAL_NOT_FOUND_OR_DENIED",
    );
    expect(() =>
      db
        .transaction(() =>
          service.consumeInTransaction({
            approvalId: approval.approvalId,
            request: approval.request,
            projectId: "p1",
            runId: "run1",
            actorDid: requester,
          }),
        )
        .immediate(),
    ).toThrow("ORG_APPROVAL_IDENTITY_CHANGED");
  });
  it("requires active approvers when the plan is admitted", () => {
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(first);
    expect(() => submit()).toThrow("TEST_AUTH_DENIED");
  });
  it("rechecks read permission for get and approve permission at response time", () => {
    const approval = submit();
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(first);
    expect(() => respond(approval, first)).toThrow("TEST_AUTH_DENIED");
    expect(() => service.get({ approvalId: approval.approvalId })).toThrow(
      "TEST_AUTH_DENIED",
    );
  });
  it.each([requester, first, secondApprover])(
    "rechecks %s revocation before consuming approved actions",
    (who) => {
      const approval = submit();
      respond(approval, first);
      respond(approval, secondApprover, 1);
      db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(who);
      expect(() => consume(approval)).toThrow(/TEST_AUTH_/);
      expect(
        db
          .prepare(
            "SELECT consumed_run_id FROM cc_organization_action_approvals",
          )
          .get().consumed_run_id,
      ).toBeNull();
    },
  );
  it("rejects revoked-then-restored membership and permission ABA across restart", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(first);
    db.prepare("UPDATE test_grants SET active=1 WHERE actor=?").run(first);
    db.close();
    db = new Database(filename);
    service = makeService();
    expect(() => consume(approval)).toThrow("TEST_AUTH_CHANGED");
  });
  it("refuses workflow edits and restoration without reusing the old approval", () => {
    const approval = submit();
    respond(approval, first);
    workflow("sequential", [third]);
    workflow("sequential", [first, secondApprover]);
    expect(() => respond(approval, secondApprover, 1)).toThrow(
      "TEST_AUTH_CHANGED",
    );
  });
  it("detects workflow mutation even if an adapter neglects its generation fence", () => {
    const approval = submit();
    db.exec("DROP TRIGGER test_workflow_fence");
    db.prepare(
      "UPDATE approval_workflows SET on_timeout='reject' WHERE id='wf1'",
    ).run();
    expect(() => respond(approval, first)).toThrow(
      "ORG_APPROVAL_WORKFLOW_CHANGED",
    );
  });
  it("does not treat timeout auto-approval as human confirmation", () => {
    const approval = submit();
    db.prepare("UPDATE approval_requests SET status='approved' WHERE id=?").run(
      approval.approvalId,
    );
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_CORRUPT");
    expect(() => service.get({ approvalId: approval.approvalId })).toThrow(
      "ORG_APPROVAL_CORRUPT",
    );
    db.prepare("UPDATE approval_requests SET status='pending' WHERE id=?").run(
      approval.approvalId,
    );
    clock += 3600000;
    expect(service.get({ approvalId: approval.approvalId }).status).toBe(
      "expired",
    );
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_EXPIRED");
  });
  it("rejects approvals that expire after completing all human steps", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    clock = approval.expiresAt;
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_EXPIRED");
  });
  it("rejects permissions that expire before the approval deadline", () => {
    db.prepare("UPDATE test_grants SET expires_at=2000 WHERE actor=?").run(
      first,
    );
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    clock = 2000;
    expect(() => consume(approval)).toThrow("TEST_AUTH_DENIED");
  });
  it("ignores legacy approvals without new companion provenance", () => {
    const candidate = request();
    db.prepare(
      "INSERT INTO approval_requests(id,workflow_id,status) VALUES('legacy','wf1','approved')",
    ).run();
    expect(() => consume({ approvalId: "legacy", request: candidate })).toThrow(
      "ORG_APPROVAL_NOT_FOUND_OR_DENIED",
    );
  });
  it("detects injected legacy responses and altered or deleted genuine responses", () => {
    const approval = submit();
    db.prepare(
      "INSERT INTO approval_responses(id,request_id,approver_did,step,decision,created_at) VALUES('forged',?,?,0,'approve',?)",
    ).run(approval.approvalId, first, clock);
    expect(() => respond(approval, first)).toThrow("ORG_APPROVAL_CORRUPT");
    db.prepare("DELETE FROM approval_responses WHERE id='forged'").run();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    db.prepare(
      "UPDATE approval_responses SET comment='altered' WHERE approver_did=?",
    ).run(first);
    expect(() => consume(approval)).toThrow("ORG_APPROVAL_CORRUPT");
  });
  it("makes immutable binding and response evidence resistant to old mutators", () => {
    const approval = submit();
    respond(approval, first);
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_action_approvals SET binding_json='{}'",
        )
        .run(),
    ).toThrow("ORG_APPROVAL_IMMUTABLE");
    expect(() =>
      db.prepare("DELETE FROM cc_organization_action_approvals").run(),
    ).toThrow("ORG_APPROVAL_IMMUTABLE");
    expect(() =>
      db
        .prepare("UPDATE cc_organization_action_approval_responses SET step=5")
        .run(),
    ).toThrow("ORG_APPROVAL_IMMUTABLE");
    expect(() =>
      db.prepare("DELETE FROM cc_organization_action_approval_responses").run(),
    ).toThrow("ORG_APPROVAL_IMMUTABLE");
  });
  it("rolls back original approval rows if companion admission fails", () => {
    db.exec(
      "CREATE TRIGGER break_admission BEFORE INSERT ON cc_organization_action_approvals BEGIN SELECT RAISE(ABORT,'admission failed'); END;",
    );
    expect(() => submit()).toThrow("admission failed");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });
  it("rolls back the response and step transition if evidence insertion fails", () => {
    const approval = submit();
    db.exec(
      "CREATE TRIGGER break_response BEFORE INSERT ON cc_organization_action_approval_responses BEGIN SELECT RAISE(ABORT,'response failed'); END;",
    );
    expect(() => respond(approval, first)).toThrow("response failed");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT current_step FROM approval_requests").get()
        .current_step,
    ).toBe(0);
  });
  it("requires an enclosing transaction and rolls back consumption with action failure", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    actor = requester;
    const input = {
      approvalId: approval.approvalId,
      request: approval.request,
      projectId: "p1",
      runId: "run1",
      actorDid: requester,
    };
    expect(() => service.consumeInTransaction(input)).toThrow(
      "ORG_APPROVAL_TRANSACTION_REQUIRED",
    );
    expect(() =>
      db
        .transaction(() => {
          service.consumeInTransaction(input);
          db.prepare(
            "UPDATE project_tasks SET description='After' WHERE id='t1'",
          ).run();
          throw new Error("receipt failed");
        })
        .immediate(),
    ).toThrow("receipt failed");
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Before");
    expect(consume(approval).runId).toBe("run1");
  });
  it("verifies approval read-only before native confirmation and verifies again at consumption", () => {
    const approval = submit();
    const input = {
      approvalId: approval.approvalId,
      request: approval.request,
      projectId: "p1",
      actorDid: requester,
    };
    const verify = () => {
      actor = requester;
      return db
        .transaction(() => service.verifyApprovedInTransaction(input))
        .immediate();
    };
    expect(() => service.verifyApprovedInTransaction(input)).toThrow(
      "ORG_APPROVAL_TRANSACTION_REQUIRED",
    );
    expect(verify).toThrow("ORG_APPROVAL_NOT_APPROVED");
    respond(approval, first);
    respond(approval, secondApprover, 1);
    const before = db
      .prepare("SELECT * FROM cc_organization_action_approvals")
      .get();
    expect(verify()).toMatchObject({
      approvalId: approval.approvalId,
      bindingDigest: approval.bindingDigest,
      expiresAt: approval.expiresAt,
    });
    expect(verify()).toMatchObject({ approvalId: approval.approvalId });
    expect(
      db.prepare("SELECT * FROM cc_organization_action_approvals").get(),
    ).toEqual(before);
    db.prepare("UPDATE test_grants SET active=0 WHERE actor=?").run(first);
    expect(verify).toThrow(/TEST_AUTH_/);
    expect(() => consume(approval)).toThrow(/TEST_AUTH_/);
    expect(
      db
        .prepare("SELECT consumed_run_id FROM cc_organization_action_approvals")
        .get().consumed_run_id,
    ).toBeNull();
  });
  it("read-only verification rejects an already consumed approval", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    consume(approval);
    expect(() =>
      db
        .transaction(() =>
          service.verifyApprovedInTransaction({
            approvalId: approval.approvalId,
            request: approval.request,
            projectId: "p1",
            actorDid: requester,
          }),
        )
        .immediate(),
    ).toThrow("ORG_APPROVAL_ALREADY_CONSUMED");
  });
  it("serializes competing native connections and commits consumption only once", () => {
    const approval = submit();
    respond(approval, first);
    respond(approval, secondApprover, 1);
    actor = requester;
    other = new Database(filename, { timeout: 0 });
    const otherService = makeService(other);
    db.transaction(() => {
      service.consumeInTransaction({
        approvalId: approval.approvalId,
        request: approval.request,
        projectId: "p1",
        runId: "run1",
        actorDid: requester,
      });
      expect(() => consume(approval, "run2", otherService, other)).toThrow(
        /locked/,
      );
    }).immediate();
    expect(() => consume(approval, "run2", otherService, other)).toThrow(
      "ORG_APPROVAL_ALREADY_CONSUMED",
    );
    expect(
      db
        .prepare("SELECT consumed_run_id FROM cc_organization_action_approvals")
        .get().consumed_run_id,
    ).toBe("run1");
  });
  it("integrates the actual owner-attested authority, pinned workflow and explicit mapping", async () => {
    const {
      OrganizationProjectAuthority,
    } = require("../../../session-core/lib/organization-project-authority");
    db.exec(`CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      INSERT INTO organization_info VALUES('org1','did:org:1','did:owner');
      INSERT INTO organization_projects VALUES('op1','org1','did:owner');`);
    for (const [index, did] of [
      "did:owner",
      requester,
      first,
      secondApprover,
    ].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?, 'active')",
      ).run(`m${index}`, did, index === 0 ? "owner" : "member");
    actor = "did:owner";
    const authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      confirm: async () => true,
      now: () => clock,
    });
    const policy = {
      orgId: "org1",
      workflowIds: ["wf1"],
      permissions: [
        {
          actorDid: requester,
          projectId: "p1",
          permissions: ["task.read", "task.update-description"],
          expiresAt: 10000000,
        },
        ...[first, secondApprover].map((actorDid) => ({
          actorDid,
          projectId: "p1",
          permissions: ["task.read", "task.approve"],
          expiresAt: 10000000,
        })),
      ],
    };
    await authority.attestPolicy({
      ...policy,
      expectedDigest: authority.previewPolicy(policy).digest,
    });
    const mapping = {
      projectId: "p1",
      organizationProjectId: "op1",
      orgId: "org1",
    };
    await authority.bindProject({
      ...mapping,
      expectedDigest: authority.previewBinding(mapping).digest,
    });
    service = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      now: () => clock,
    });
    actor = requester;
    const snapshot = db
      .transaction(() =>
        authority.assertAuthorizedInTransaction({
          projectId: "p1",
          actorDid: actor,
          permission: "task.update-description",
        }),
      )
      .immediate();
    const target = {
      type: "Task",
      id: "t1",
      sourceKind: "desktop.project-task",
      scope: snapshot.scope,
    };
    const version = organizationProjectActionTargetVersion(db, {
      projectId: "p1",
      target,
      authority: snapshot,
    });
    const candidate = createBusinessActionRequest({
      actionType: "task.update-description",
      actionVersion: 1,
      target: createBusinessObjectRef({ ...target, version }),
      expectedVersion: version,
      input: { description: "Authorized change" },
      idempotencyKey: "real-authority",
    });
    const approval = submit(candidate);
    respond(approval, first);
    respond(approval, secondApprover, 1);
    expect(consume(approval).runId).toBe("run1");
  });
});
