import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  OrganizationProjectProposalStore,
  MAX_ORGANIZATION_PROPOSAL_RETENTION_MS,
} = require("../../../session-core/lib/organization-project-proposal-store");
const {
  OrganizationProjectAuthority,
} = require("../../../session-core/lib/organization-project-authority");
const {
  OrganizationProjectApprovalService,
  organizationProjectActionTargetVersion,
} = require("../../../session-core/lib/organization-project-approval-service");
const {
  createBusinessActionRequest,
  createBusinessObjectRef,
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");

describe("private persisted organization proposals", () => {
  const owner = "did:owner",
    requester = "did:requester",
    reviewer = "did:reviewer",
    second = "did:second";
  let directory,
    filename,
    db,
    actor,
    clock,
    authority,
    approvals,
    store,
    permissions;
  function initialize() {
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      confirm: async () => true,
      now: () => clock,
    });
    approvals = new OrganizationProjectApprovalService({
      db,
      getActor: () => actor,
      authority,
      now: () => clock,
    });
    store = new OrganizationProjectProposalStore({
      db,
      getActor: () => actor,
      authority,
      approvals,
      now: () => clock,
    });
  }
  async function attest() {
    const input = {
      orgId: "org1",
      permissions,
      workflowIds: ["wf1", "wf-private", "wf-create"],
    };
    actor = owner;
    await authority.attestPolicy({
      ...input,
      expectedDigest: authority.previewPolicy(input).digest,
    });
    actor = requester;
  }
  function request({
    projectId = "p1",
    actionType = "task.update-description",
    description = "Proposed private description",
    key = "PRIVATE-RAW-IDEMPOTENCY-KEY",
  } = {}) {
    return db
      .transaction(() => {
        const snapshot = authority.assertAuthorizedInTransaction({
          projectId,
          actorDid: actor,
          permission: actionType,
        });
        const target = {
          type: actionType === "task.create" ? "Project" : "Task",
          id:
            actionType === "task.create"
              ? projectId
              : projectId === "p1"
                ? "t1"
                : "t2",
          sourceKind:
            actionType === "task.create"
              ? "desktop.project-task-owner"
              : "desktop.project-task",
          scope: snapshot.scope,
        };
        const version = organizationProjectActionTargetVersion(db, {
          projectId,
          target,
          authority: snapshot,
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
      })
      .immediate();
  }
  function submit(
    candidate = request(),
    projectId = "p1",
    workflowId = candidate.actionType === "task.create"
      ? "wf-create"
      : projectId === "p1"
        ? "wf1"
        : "wf-private",
  ) {
    return store.submit({ projectId, workflowId, request: candidate });
  }
  function approve(proposal) {
    actor = reviewer;
    approvals.respond({
      approvalId: proposal.approvalId,
      step: 0,
      decision: "approve",
    });
    if (proposal.target.type === "Task") {
      actor = second;
      approvals.respond({
        approvalId: proposal.approvalId,
        step: 1,
        decision: "approve",
      });
    }
    actor = requester;
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-proposal-"));
    filename = join(directory, "proposals.db");
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    actor = owner;
    clock = 1000;
    db.exec(`
      CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,description TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE approval_workflows(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,trigger_resource_type TEXT,trigger_action TEXT,trigger_conditions TEXT,approval_type TEXT,approvers TEXT,timeout_hours REAL,on_timeout TEXT,enabled INTEGER,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE approval_requests(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES approval_workflows(id),org_id TEXT,requester_did TEXT,requester_name TEXT,resource_type TEXT,resource_id TEXT,action TEXT,request_data TEXT,status TEXT,current_step INTEGER,total_steps INTEGER,created_at INTEGER,updated_at INTEGER,completed_at INTEGER);
      CREATE TABLE approval_responses(id TEXT PRIMARY KEY,request_id TEXT REFERENCES approval_requests(id),approver_did TEXT,approver_name TEXT,step INTEGER,decision TEXT,delegated_to TEXT,comment TEXT,created_at INTEGER);
      INSERT INTO organization_info VALUES('org1','did:org:1','did:owner');
      INSERT INTO organization_projects VALUES('op1','org1','did:owner'),('op2','org1','did:owner');
      INSERT INTO projects(id,user_id,status,updated_at) VALUES('p1','did:owner','active',1),('p2','did:owner','active',1);
      INSERT INTO project_tasks(id,project_id,description,status,updated_at) VALUES('t1','p1','Current confidential source','pending',1),('t2','p2','Other source','pending',1);
      INSERT INTO approval_workflows VALUES('wf1','org1','Review','task','task.update-description',NULL,'sequential','["did:reviewer","did:second"]',12,'approve',1,1,1);
      INSERT INTO approval_workflows VALUES('wf-create','org1','Create','project','task.create',NULL,'sequential','["did:reviewer"]',12,'reject',1,1,1);
      INSERT INTO approval_workflows VALUES('wf-private','org1','Other','task','task.update-description',NULL,'sequential','["did:second"]',12,'reject',1,1,1);
    `);
    for (const [index, did] of [owner, requester, reviewer, second].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?,'active')",
      ).run(`m${index}`, did, did === owner ? "owner" : "member");
    permissions = [
      ...["p1", "p2"].map((projectId) => ({
        actorDid: requester,
        projectId,
        permissions: ["task.read", "task.create", "task.update-description"],
        expiresAt: 30 * 86400000,
      })),
      {
        actorDid: reviewer,
        projectId: "p1",
        permissions: ["task.read", "task.approve"],
        expiresAt: 30 * 86400000,
      },
      ...["p1", "p2"].map((projectId) => ({
        actorDid: second,
        projectId,
        permissions: ["task.read", "task.approve"],
        expiresAt: 30 * 86400000,
      })),
    ];
    initialize();
    await attest();
    actor = owner;
    for (const [projectId, organizationProjectId] of [
      ["p1", "op1"],
      ["p2", "op2"],
    ]) {
      const mapping = { projectId, organizationProjectId, orgId: "org1" };
      await authority.bindProject({
        ...mapping,
        expectedDigest: authority.previewBinding(mapping).digest,
      });
    }
    actor = requester;
  });
  afterEach(() => {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("requires native transactions and trusted authority/protocol adapters", () => {
    expect(() => new OrganizationProjectProposalStore({ db: {} })).toThrow(
      "ORG_PROPOSAL_NATIVE_DATABASE_REQUIRED",
    );
    expect(
      () =>
        new OrganizationProjectProposalStore({
          db,
          getActor: () => actor,
          authority,
          approvals: {},
        }),
    ).toThrow("ORG_PROPOSAL_AUTHORITY_REQUIRED");
  });
  it("atomically stores a full recoverable request as private business data, while approval evidence stays body-free", () => {
    const candidate = request(),
      proposal = submit(candidate);
    expect(proposal).toMatchObject({
      projectId: "p1",
      requesterDid: requester,
      requestDigest: digest(candidate),
      approvalStatus: "pending",
      bodyAvailable: true,
    });
    expect(proposal).not.toHaveProperty("request");
    const restored = store.get({ proposalId: proposal.proposalId });
    expect(restored.request).toEqual(candidate);
    expect(restored.approval).toMatchObject({
      authority: "recorded-only",
      status: "pending",
      plan: { steps: [[reviewer], [second]] },
    });
    expect(
      JSON.parse(
        db
          .prepare("SELECT request_json FROM cc_organization_project_proposals")
          .get().request_json,
      ),
    ).toEqual(candidate);
    const audit =
      JSON.stringify(db.prepare("SELECT * FROM approval_requests").all()) +
      JSON.stringify(
        db.prepare("SELECT * FROM cc_organization_action_approvals").all(),
      );
    expect(audit).not.toContain(candidate.input.description);
    expect(audit).not.toContain(candidate.idempotencyKey);
  });
  it("lets another authorized reviewer restore the true proposal content without receiving requester write authority", () => {
    const proposal = submit();
    actor = reviewer;
    const restored = store.get({ proposalId: proposal.proposalId });
    expect(restored.request.input.description).toBe(
      "Proposed private description",
    );
    expect(restored.requesterDid).toBe(requester);
    expect(() =>
      store.submit({
        projectId: "p1",
        workflowId: "wf1",
        request: restored.request,
      }),
    ).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    approvals.respond({
      approvalId: proposal.approvalId,
      step: 0,
      decision: "approve",
    });
    expect(store.get({ proposalId: proposal.proposalId }).currentStep).toBe(1);
  });
  it("isolates project-specific proposals even when the actor belongs to the same organization", () => {
    const hidden = submit(request({ projectId: "p2" }), "p2");
    actor = reviewer;
    expect(() => store.get({ proposalId: hidden.proposalId })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => store.list({ projectId: "p2" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => store.purgeExpired({ projectId: "p2" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(store.list({ projectId: "p1" }).proposals).toEqual([]);
  });
  it("rejects self-reported actors, cross-project requests and tampered request bindings", () => {
    const candidate = request();
    expect(() =>
      store.submit({
        projectId: "p1",
        workflowId: "wf1",
        request: candidate,
        actorDid: owner,
      }),
    ).toThrow("ORG_PROPOSAL_INVALID_REQUEST");
    expect(() =>
      store.submit({
        projectId: "p2",
        workflowId: "wf-private",
        request: candidate,
      }),
    ).toThrow("ORG_APPROVAL_TARGET_DENIED");
    const changed = structuredClone(candidate);
    changed.input.description = "Injected";
    expect(() => submit(changed)).toThrow("ORG_PROPOSAL_INVALID_REQUEST");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });
  it("retains original proposal and deadline on exact retries, while blocking new-key pending-target bypass", () => {
    const candidate = request(),
      original = submit(candidate);
    clock += 100;
    expect(submit(candidate)).toEqual(original);
    expect(() => submit(request({ key: "new-key" }))).toThrow(
      "ORG_APPROVAL_UNRESOLVED_TARGET",
    );
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(1);
  });
  it("lists bounded metadata without loading request bodies and paginates within one project", () => {
    const first = submit();
    approvals.cancel({ approvalId: first.approvalId });
    clock++;
    const next = submit(request({ key: "second-key" }));
    const page = store.list({ projectId: "p1", limit: 1 });
    expect(page.proposals.map((item) => item.proposalId)).toEqual([
      next.proposalId,
    ]);
    expect(page.nextCursor).toBe(next.proposalId);
    expect(page.proposals[0]).not.toHaveProperty("request");
    expect(page.proposals[0]).not.toHaveProperty("approval");
    expect(JSON.stringify(page)).not.toContain("Proposed private description");
    expect(JSON.stringify(page)).not.toContain("PRIVATE-RAW-IDEMPOTENCY-KEY");
    expect(
      store.list({ projectId: "p1", beforeId: page.nextCursor, limit: 1 })
        .proposals[0].proposalId,
    ).toBe(first.proposalId);
    expect(() =>
      store.list({ projectId: "p2", beforeId: next.proposalId }),
    ).toThrow("ORG_PROPOSAL_INVALID_CURSOR");
    expect(() => store.list({ projectId: "p1", limit: 51 })).toThrow(
      "ORG_PROPOSAL_INVALID_REQUEST",
    );
  });
  it("does not disclose body after membership removal, grant withdrawal or binding revocation", async () => {
    const proposal = submit();
    actor = reviewer;
    db.prepare(
      "UPDATE organization_members SET status='removed' WHERE member_did=?",
    ).run(reviewer);
    expect(() => store.get({ proposalId: proposal.proposalId })).toThrow(
      /ORG_AUTH_/,
    );
    db.prepare(
      "UPDATE organization_members SET status='active' WHERE member_did=?",
    ).run(reviewer);
    permissions = permissions.filter((entry) => entry.actorDid !== reviewer);
    await attest();
    actor = reviewer;
    expect(() => store.get({ proposalId: proposal.proposalId })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    actor = owner;
    await authority.revokeBinding({ projectId: "p1", expectedRevision: 1 });
    actor = requester;
    expect(() => store.get({ proposalId: proposal.proposalId })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });
  it("keeps historical proposals readable after source-version drift while execution approval remains stale", () => {
    const proposal = submit(),
      original = store.get({ proposalId: proposal.proposalId }).request;
    db.prepare(
      "UPDATE project_tasks SET description='Later content',updated_at=2 WHERE id='t1'",
    ).run();
    expect(store.get({ proposalId: proposal.proposalId }).request).toEqual(
      original,
    );
    actor = reviewer;
    expect(() =>
      approvals.respond({
        approvalId: proposal.approvalId,
        step: 0,
        decision: "approve",
      }),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
  });
  it("withholds a proposal body when its Task is reparented out of the original project", () => {
    const proposal = submit();
    db.prepare("UPDATE project_tasks SET project_id='p2' WHERE id='t1'").run();
    actor = reviewer;
    expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
      bodyAvailable: false,
      unavailableReason: "target-unavailable",
      request: null,
    });
  });
  it.each(["cancelled", "rejected"])(
    "returns metadata but no body for %s proposals",
    (status) => {
      const proposal = submit();
      if (status === "cancelled")
        approvals.cancel({ approvalId: proposal.approvalId });
      else {
        actor = reviewer;
        approvals.respond({
          approvalId: proposal.approvalId,
          step: 0,
          decision: "reject",
        });
      }
      expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
        approvalStatus: status,
        bodyAvailable: false,
        request: null,
      });
    },
  );
  it("refuses expired body reads before cleanup and purges only body columns, retaining proposal and approval history", () => {
    const proposal = submit();
    clock = proposal.expiresAt;
    expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
      bodyAvailable: false,
      unavailableReason: "expired",
      request: null,
    });
    expect(
      db
        .prepare("SELECT request_json FROM cc_organization_project_proposals")
        .get().request_json,
    ).not.toBeNull();
    expect(store.purgeExpired({ projectId: "p1" })).toEqual({ purged: 1 });
    const row = db
      .prepare("SELECT * FROM cc_organization_project_proposals")
      .get();
    expect(row.request_json).toBeNull();
    expect(row.body_purged_at).toBe(clock);
    expect(row.request_digest).toBe(proposal.requestDigest);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_action_approvals")
        .get().n,
    ).toBe(1);
    expect(store.list({ projectId: "p1" }).proposals[0].proposalId).toBe(
      proposal.proposalId,
    );
    expect(store.purgeExpired({ projectId: "p1" })).toEqual({ purged: 0 });
  });
  it("does not purge live bodies or rehydrate expired bodies on an exact request retry", () => {
    const candidate = request(),
      proposal = submit(candidate);
    expect(store.purgeExpired({ projectId: "p1" })).toEqual({ purged: 0 });
    expect(store.get({ proposalId: proposal.proposalId }).request).toEqual(
      candidate,
    );
    clock = proposal.expiresAt;
    store.purgeExpired({ projectId: "p1" });
    expect(submit(candidate)).toMatchObject({
      proposalId: proposal.proposalId,
      bodyAvailable: false,
      expiresAt: proposal.expiresAt,
    });
    expect(
      db
        .prepare("SELECT request_json FROM cc_organization_project_proposals")
        .get().request_json,
    ).toBeNull();
  });
  it("rolls back a batch purge if a later body deletion fails", () => {
    const first = submit();
    approvals.cancel({ approvalId: first.approvalId });
    clock++;
    const last = submit(request({ key: "last-key" }));
    clock = last.expiresAt;
    db.exec(`CREATE TRIGGER break_purge BEFORE UPDATE ON cc_organization_project_proposals
      WHEN OLD.id='${last.proposalId}' BEGIN SELECT RAISE(ABORT,'purge failed'); END;`);
    expect(() => store.purgeExpired({ projectId: "p1" })).toThrow(
      "purge failed",
    );
    for (const row of db
      .prepare(
        "SELECT request_json,body_purged_at FROM cc_organization_project_proposals",
      )
      .all()) {
      expect(row.request_json).not.toBeNull();
      expect(row.body_purged_at).toBeNull();
    }
  });
  it("caps approved proposal body retention at seven days even when the workflow deadline is longer", async () => {
    db.prepare(
      "UPDATE approval_workflows SET timeout_hours=240 WHERE id='wf1'",
    ).run();
    await attest();
    const proposal = submit();
    approve(proposal);
    expect(proposal.expiresAt - proposal.createdAt).toBe(
      MAX_ORGANIZATION_PROPOSAL_RETENTION_MS,
    );
    expect(store.get({ proposalId: proposal.proposalId }).approvalStatus).toBe(
      "approved",
    );
    clock = proposal.expiresAt;
    expect(approvals.get({ approvalId: proposal.approvalId }).status).toBe(
      "approved",
    );
    expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
      request: null,
      bodyAvailable: false,
      unavailableReason: "expired",
    });
  });
  it("can restore a consumed request for an authorized original-key receipt replay until its fixed deadline", () => {
    const candidate = request(),
      proposal = submit(candidate);
    approve(proposal);
    db.transaction(() =>
      approvals.consumeInTransaction({
        approvalId: proposal.approvalId,
        projectId: "p1",
        request: candidate,
        runId: "run1",
        actorDid: requester,
      }),
    ).immediate();
    expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
      approvalStatus: "consumed",
      bodyAvailable: true,
      request: candidate,
    });
    clock = proposal.expiresAt;
    expect(store.get({ proposalId: proposal.proposalId }).request).toBeNull();
  });
  it("supports transaction-local proposal revalidation without opening a nested transaction", () => {
    const proposal = submit();
    expect(() =>
      store.getInTransaction({ proposalId: proposal.proposalId }),
    ).toThrow("ORG_PROPOSAL_TRANSACTION_REQUIRED");
    expect(
      db
        .transaction(() =>
          store.getInTransaction({ proposalId: proposal.proposalId }),
        )
        .immediate().bodyAvailable,
    ).toBe(true);
    clock = proposal.expiresAt;
    expect(
      db
        .transaction(() =>
          store.getInTransaction({ proposalId: proposal.proposalId }),
        )
        .immediate().request,
    ).toBeNull();
  });
  it("rolls back both approval and proposal when private request persistence fails", () => {
    db.exec(
      "CREATE TRIGGER break_proposal BEFORE INSERT ON cc_organization_project_proposals BEGIN SELECT RAISE(ABORT,'body unavailable'); END;",
    );
    const candidate = request();
    expect(() => submit(candidate)).toThrow("body unavailable");
    for (const table of [
      "approval_requests",
      "cc_organization_action_approvals",
      "cc_organization_project_proposals",
    ])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(0);
  });
  it("does not save a private proposal when approval admission fails", () => {
    const candidate = request();
    actor = reviewer;
    expect(() => submit(candidate)).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(0);
  });
  it("preserves the identical request across database reopening and a different logged-in reviewer", () => {
    const candidate = request(),
      proposal = submit(candidate);
    db.close();
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    actor = reviewer;
    initialize();
    expect(store.get({ proposalId: proposal.proposalId }).request).toEqual(
      candidate,
    );
    approvals.respond({
      approvalId: proposal.approvalId,
      step: 0,
      decision: "approve",
    });
    expect(store.get({ proposalId: proposal.proposalId }).currentStep).toBe(1);
  });
  it("prevents mutable proposal content, metadata deletion and body restoration after purge", () => {
    const proposal = submit();
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_proposals SET request_json='{}'",
        )
        .run(),
    ).toThrow("ORG_PROPOSAL_IMMUTABLE");
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_proposals SET expires_at=expires_at+1",
        )
        .run(),
    ).toThrow("ORG_PROPOSAL_IMMUTABLE");
    expect(() =>
      db.prepare("DELETE FROM cc_organization_project_proposals").run(),
    ).toThrow("ORG_PROPOSAL_IMMUTABLE");
    clock = proposal.expiresAt;
    store.purgeExpired({ projectId: "p1" });
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_proposals SET request_json='{}',body_purged_at=NULL",
        )
        .run(),
    ).toThrow("ORG_PROPOSAL_IMMUTABLE");
  });
  it("detects stored request corruption and size violations without trusting a digest-shaped payload", () => {
    const proposal = submit();
    db.exec("DROP TRIGGER cc_org_proposal_immutable");
    const valid = db
      .prepare("SELECT request_json FROM cc_organization_project_proposals")
      .get().request_json;
    const forged = JSON.parse(valid);
    forged.input.description = "Tampered";
    db.prepare(
      "UPDATE cc_organization_project_proposals SET request_json=?",
    ).run(JSON.stringify(forged));
    expect(() => store.get({ proposalId: proposal.proposalId })).toThrow(
      "ORG_PROPOSAL_CORRUPT",
    );
    db.prepare(
      "UPDATE cc_organization_project_proposals SET request_json=?",
    ).run("x".repeat(65537));
    expect(() => store.get({ proposalId: proposal.proposalId })).toThrow(
      "ORG_PROPOSAL_CORRUPT",
    );
  });
  it("enforces the description byte budget for valid signed request objects", () => {
    const candidate = request({ description: "界".repeat(2731) });
    expect(() => submit(candidate)).toThrow("ORG_PROPOSAL_INVALID_REQUEST");
    expect(
      db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });
  it("restores a Project-targeted task creation request for the actual multi-user approval path", () => {
    const candidate = request({ actionType: "task.create" }),
      proposal = submit(candidate);
    actor = reviewer;
    expect(store.get({ proposalId: proposal.proposalId }).request).toEqual(
      candidate,
    );
    approve(proposal);
    expect(store.get({ proposalId: proposal.proposalId })).toMatchObject({
      approvalStatus: "approved",
      bodyAvailable: true,
      target: { type: "Project", id: "p1" },
    });
  });
});
