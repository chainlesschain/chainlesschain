import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  OrganizationProjectAuthority,
  hasOrganizationProjectBinding,
} = require("@chainlesschain/session-core/organization-project-authority");
const {
  TaskDescriptionActionService,
  TaskCreateActionService,
} = require("@chainlesschain/session-core/task-description-action-service");
const {
  ProjectRiskReviewService,
} = require("@chainlesschain/session-core/project-risk-review-service");
const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

describe("owner-attested canonical organization project authority", () => {
  const owner = "did:chainlesschain:owner";
  const member = "did:chainlesschain:member";
  let directory, filename, db, actor, clock, confirm, authority, second;

  function open() {
    db = new Database(filename);
    db.pragma("foreign_keys = ON");
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      confirm: (value) => confirm(value),
      now: () => clock,
    });
  }
  function policyInput(
    permissions = [
      "task.read",
      "task.update-description",
      "task.approve",
      "task.create",
    ],
  ) {
    return {
      orgId: "org-1",
      permissions: [
        { actorDid: member, projectId: "p1", permissions, expiresAt: 100000 },
      ],
    };
  }
  async function attest(input = policyInput()) {
    const preview = authority.previewPolicy(input);
    return authority.attestPolicy({ ...input, expectedDigest: preview.digest });
  }
  async function bind(overrides = {}) {
    const input = {
      projectId: "p1",
      organizationProjectId: "op1",
      orgId: "org-1",
      ...overrides,
    };
    const preview = authority.previewBinding(input);
    return authority.bindProject({ ...input, expectedDigest: preview.digest });
  }
  function authorized(permission = "task.read") {
    return db
      .transaction(() =>
        authority.assertAuthorizedInTransaction({
          projectId: "p1",
          actorDid: actor,
          permission,
        }),
      )
      .immediate();
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-authority-"));
    filename = join(directory, "authority.db");
    db = new Database(filename);
    db.exec(`
      CREATE TABLE organization_info (org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members (id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT,UNIQUE(org_id,member_did));
      CREATE TABLE organization_projects (id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE organization_roles (id TEXT PRIMARY KEY,org_id TEXT,name TEXT,permissions TEXT);
      CREATE TABLE permission_grants (id TEXT PRIMARY KEY,org_id TEXT,grantee_id TEXT,permission TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,updated_at INTEGER,created_at INTEGER,sync_status TEXT,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT,due_date INTEGER,blocked_by TEXT);
      CREATE TABLE workspace_resources (workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      INSERT INTO organization_info VALUES ('org-1','did:org:1','${owner}');
      INSERT INTO organization_info VALUES ('org-2','did:org:2','did:other:owner');
      INSERT INTO organization_members VALUES ('m-owner','org-1','${owner}','owner','active');
      INSERT INTO organization_members VALUES ('m-member','org-1','${member}','member','active');
      INSERT INTO organization_projects VALUES ('op1','org-1','${owner}');
      INSERT INTO organization_projects VALUES ('op2','org-2','did:other:owner');
      INSERT INTO projects (id,user_id,status,updated_at) VALUES ('p1','${owner}','active',10);
      INSERT INTO project_tasks (id,project_id,task_type,description,status,updated_at,created_at,sync_status)
        VALUES ('t1','p1','query_info','Original','pending',10,10,'synced');
    `);
    db.close();
    actor = owner;
    clock = 1000;
    confirm = vi.fn(async () => true);
    open();
  });

  afterEach(() => {
    if (second?.open) second.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("requires a canonical native database and all authoritative source columns", () => {
    expect(
      () =>
        new OrganizationProjectAuthority({
          db: {},
          getActor: () => owner,
          confirm,
        }),
    ).toThrow("ORG_AUTH_NATIVE_DATABASE_REQUIRED");
    const incomplete = new Database(":memory:");
    try {
      expect(
        () =>
          new OrganizationProjectAuthority({
            db: incomplete,
            getActor: () => owner,
            confirm,
          }),
      ).toThrow("ORG_AUTH_SOURCE_INCOMPLETE");
    } finally {
      incomplete.close();
    }
  });

  it("does not trust historical grants or wildcard role permissions", async () => {
    db.prepare(
      "INSERT INTO organization_roles VALUES ('r1','org-1','owner','[\"*\"]')",
    ).run();
    db.prepare("INSERT INTO permission_grants VALUES ('g1','org-1',?,'*')").run(
      member,
    );
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_POLICY_REQUIRED");
    await attest({ orgId: "org-1", permissions: [] });
    await bind();
    actor = member;
    expect(() => authorized()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
  });

  it("binds distinct explicit IDs and resolves only the attested organization scope", async () => {
    await attest();
    const result = await bind();
    expect(result.binding).toMatchObject({
      project_id: "p1",
      organization_project_id: "op1",
      org_id: "org-1",
      revision: 1,
      status: "active",
    });
    actor = member;
    expect(authorized()).toMatchObject({
      scope: { kind: "organization", id: "org-1" },
      authorityEpoch: 1,
      mappingRevision: 1,
    });
    expect(
      db.prepare("SELECT user_id FROM projects WHERE id='p1'").get().user_id,
    ).toBe(owner);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_authority_events")
        .get().n,
    ).toBe(2);
  });

  it("does not infer a binding from equal project IDs", async () => {
    db.prepare("INSERT INTO organization_projects VALUES ('p1','org-1',?)").run(
      owner,
    );
    await attest();
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(false);
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_SCOPE_CONFLICT");
    // Explicit owner consent can choose that row; equal IDs alone confer nothing.
    expect((await bind({ organizationProjectId: "p1" })).status).toBe("bound");
  });

  it.each(["inactive", "removed"])(
    "rejects policy attestation by an %s owner",
    (status) => {
      db.prepare(
        "UPDATE organization_members SET status=? WHERE member_did=?",
      ).run(status, owner);
      expect(() => authority.previewPolicy(policyInput())).toThrow(
        "ORG_AUTH_NOT_FOUND_OR_DENIED",
      );
    },
  );

  it("requires root owner identity, not a forged owner role or caller claim", () => {
    db.prepare(
      "UPDATE organization_members SET role='owner' WHERE member_did=?",
    ).run(member);
    actor = member;
    expect(() => authority.previewPolicy(policyInput())).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    actor = owner;
    expect(() =>
      authority.previewPolicy({ ...policyInput(), actorDid: owner }),
    ).toThrow("ORG_AUTH_INVALID_REQUEST");
  });

  it("requires consent from the actual canonical project owner", async () => {
    await attest();
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(member);
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_OWNER_CONSENT_REQUIRED");
  });

  it.each([
    [
      "actor not active",
      [
        {
          actorDid: "did:outsider",
          projectId: "p1",
          permissions: ["task.read"],
          expiresAt: 100000,
        },
      ],
    ],
    [
      "wildcard",
      [
        {
          actorDid: member,
          projectId: "p1",
          permissions: ["*"],
          expiresAt: 100000,
        },
      ],
    ],
    [
      "expired",
      [
        {
          actorDid: member,
          projectId: "p1",
          permissions: ["task.read"],
          expiresAt: 1000,
        },
      ],
    ],
    [
      "duplicate permission",
      [
        {
          actorDid: member,
          projectId: "p1",
          permissions: ["task.read", "task.read"],
          expiresAt: 100000,
        },
      ],
    ],
    [
      "duplicate grant",
      Array(2).fill({
        actorDid: member,
        projectId: "p1",
        permissions: ["task.read"],
        expiresAt: 100000,
      }),
    ],
  ])("rejects invalid policy: %s", (_name, permissions) => {
    expect(() =>
      authority.previewPolicy({ orgId: "org-1", permissions }),
    ).toThrow(/ORG_AUTH_/);
  });

  it("keeps native cancellation free of policy/mapping changes", async () => {
    confirm.mockResolvedValue(false);
    expect((await attest()).status).toBe("cancelled");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
    confirm.mockResolvedValue(true);
    await attest();
    confirm.mockResolvedValue(false);
    expect((await bind()).status).toBe("cancelled");
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(false);
  });

  it("does not treat truthy or failed confirmations as consent", async () => {
    confirm.mockResolvedValue({ response: 1 });
    expect((await attest()).status).toBe("cancelled");
    confirm.mockRejectedValue(new Error("unavailable"));
    await expect(attest()).rejects.toThrow("ORG_AUTH_CONFIRMATION_FAILED");
  });

  it("rechecks identity after native confirmation", async () => {
    confirm.mockImplementation(async () => {
      actor = member;
      return true;
    });
    await expect(attest()).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
  });

  it("detects revoked and restored membership even after process restart", async () => {
    await attest();
    await bind();
    const old = db
      .prepare(
        "SELECT revision FROM cc_organization_authority_revisions WHERE org_id='org-1'",
      )
      .get().revision;
    db.prepare(
      "UPDATE organization_members SET status='removed' WHERE member_did=?",
    ).run(member);
    db.prepare(
      "UPDATE organization_members SET status='active' WHERE member_did=?",
    ).run(member);
    db.close();
    open();
    actor = member;
    expect(() => authorized()).toThrow("ORG_AUTH_POLICY_STALE");
    expect(
      db
        .prepare(
          "SELECT revision FROM cc_organization_authority_revisions WHERE org_id='org-1'",
        )
        .get().revision,
    ).toBeGreaterThan(old);
    actor = owner;
    const renewed = await attest();
    expect(renewed.policy.epoch).toBe(2);
    actor = member;
    expect(authorized().authorityEpoch).toBe(2);
  });

  it("invalidates a preview when membership changes during confirmation", async () => {
    confirm.mockImplementation(async () => {
      db.prepare(
        "UPDATE organization_members SET role='viewer' WHERE member_did=?",
      ).run(member);
      return true;
    });
    await expect(attest()).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
  });

  it("detaches mutable request data before awaiting confirmation", async () => {
    const input = policyInput();
    const request = {
      ...input,
      expectedDigest: authority.previewPolicy(input).digest,
    };
    confirm.mockImplementation(async ({ policy }) => {
      policy.permissions[0].permissions.push("*");
      request.permissions[0].permissions = ["task.approve"];
      request.expectedDigest = authority.previewPolicy({
        orgId: request.orgId,
        permissions: request.permissions,
      }).digest;
      return true;
    });
    await authority.attestPolicy(request);
    actor = member;
    await expect(Promise.resolve().then(() => authorized())).rejects.toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    ); // No binding yet.
    const saved = JSON.parse(
      db
        .prepare("SELECT policy_json FROM cc_organization_project_policies")
        .get().policy_json,
    );
    expect(saved.permissions[0].permissions).toContain("task.read");
    expect(saved.permissions[0].permissions).not.toContain("*");
  });

  it("rejects cross-organization endpoints and task/workspace conflicts", async () => {
    await attest();
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op2",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_SCOPE_CONFLICT");
    db.prepare("UPDATE project_tasks SET org_id='org-2' WHERE id='t1'").run();
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_SCOPE_CONFLICT");
    db.prepare("UPDATE project_tasks SET org_id=NULL WHERE id='t1'").run();
    db.prepare(
      "INSERT INTO workspace_resources VALUES ('w1','task','t1')",
    ).run();
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_SCOPE_CONFLICT");
  });

  it("rejects canonical project mutation and restoration while binding is confirmed", async () => {
    await attest();
    confirm.mockImplementation(async () => {
      db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(member);
      db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(owner);
      return true;
    });
    await expect(bind()).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(false);
  });

  it("requires the final native transaction, current identity and exact permission", async () => {
    await attest(policyInput(["task.read"]));
    await bind();
    actor = member;
    expect(() =>
      authority.assertAuthorizedInTransaction({
        projectId: "p1",
        actorDid: member,
        permission: "task.read",
      }),
    ).toThrow("ORG_AUTH_TRANSACTION_REQUIRED");
    expect(() =>
      db
        .transaction(() =>
          authority.assertAuthorizedInTransaction({
            projectId: "p1",
            actorDid: owner,
            permission: "task.read",
          }),
        )
        .immediate(),
    ).toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(() => authorized("task.create")).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => authorized("project.write")).toThrow(
      "ORG_AUTH_INVALID_REQUEST",
    );
    expect(authorized().scope.id).toBe("org-1");
    clock = 100000;
    expect(() => authorized()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
  });

  it("exposes policy epoch changes to final action version binding", async () => {
    await attest();
    await bind();
    actor = member;
    const first = authorized();
    actor = owner;
    await attest(policyInput(["task.read"]));
    actor = member;
    expect(authorized().authorityEpoch).toBeGreaterThan(first.authorityEpoch);
    expect(authorized().policyDigest).not.toBe(first.policyDigest);
    expect(() => authorized("task.update-description")).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });

  it("rejects altered stored policy evidence", async () => {
    await attest();
    await bind();
    db.prepare(
      "UPDATE cc_organization_project_policies SET policy_json='{}'",
    ).run();
    actor = member;
    expect(() => authorized()).toThrow("ORG_AUTH_POLICY_CORRUPT");
  });

  it("rolls back binding and policy changes when receipt insertion fails", async () => {
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cc_organization_authority_events BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END;",
    );
    await expect(attest()).rejects.toThrow("receipt unavailable");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
    db.exec("DROP TRIGGER fail_receipt");
    await attest();
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cc_organization_authority_events BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END;",
    );
    await expect(bind()).rejects.toThrow("receipt unavailable");
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(false);
  });

  it("allows only one of two separately confirmed mapping attempts", async () => {
    await attest();
    second = new Database(filename);
    let release;
    const other = new OrganizationProjectAuthority({
      db: second,
      getActor: () => owner,
      confirm: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      now: () => clock,
    });
    const input = {
      projectId: "p1",
      organizationProjectId: "op1",
      orgId: "org-1",
    };
    const pending = other.bindProject({
      ...input,
      expectedDigest: other.previewBinding(input).digest,
    });
    await bind();
    release(true);
    await expect(pending).rejects.toThrow("ORG_AUTH_MAPPING_EXISTS");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_bindings")
        .get().n,
    ).toBe(1);
  });

  it("keeps revoked bindings as organization scope tombstones", async () => {
    await attest();
    await bind();
    expect(
      (await authority.revokeBinding({ projectId: "p1", expectedRevision: 1 }))
        .status,
    ).toBe("revoked");
    actor = member;
    expect(() => authorized()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    actor = owner;
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(true);
    expect(() =>
      authority.previewBinding({
        projectId: "p1",
        organizationProjectId: "op1",
        orgId: "org-1",
      }),
    ).toThrow("ORG_AUTH_MAPPING_EXISTS");
  });

  it.each(["membership", "root owner"])(
    "rejects %s ABA during revocation confirmation",
    async (source) => {
      await attest();
      await bind();
      confirm.mockImplementation(async () => {
        if (source === "membership") {
          db.prepare(
            "UPDATE organization_members SET status='removed' WHERE member_did=?",
          ).run(owner);
          db.prepare(
            "UPDATE organization_members SET status='active' WHERE member_did=?",
          ).run(owner);
        } else {
          db.prepare(
            "UPDATE organization_info SET owner_did=? WHERE org_id='org-1'",
          ).run(member);
          db.prepare(
            "UPDATE organization_info SET owner_did=? WHERE org_id='org-1'",
          ).run(owner);
        }
        return true;
      });
      await expect(
        authority.revokeBinding({ projectId: "p1", expectedRevision: 1 }),
      ).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
      expect(
        db
          .prepare(
            "SELECT status,revision FROM cc_organization_project_bindings WHERE project_id='p1'",
          )
          .get(),
      ).toEqual({ status: "active", revision: 1 });
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_authority_events WHERE kind='project-binding-revoked'",
          )
          .get().n,
      ).toBe(0);
    },
  );

  it("rejects oversized serialized policy before native confirmation or persistence", () => {
    const longMember = `did:${"m".repeat(252)}`;
    db.prepare(
      "UPDATE organization_members SET member_did=? WHERE member_did=?",
    ).run(longMember, member);
    const permissions = Array.from({ length: 100 }, (_, index) => ({
      actorDid: longMember,
      projectId: `p${String(index).padStart(3, "0")}${"x".repeat(252)}`,
      permissions: [
        "task.read",
        "task.create",
        "task.update-description",
        "task.approve",
      ],
      expiresAt: Number.MAX_SAFE_INTEGER,
    }));
    expect(() =>
      authority.previewPolicy({ orgId: "org-1", permissions }),
    ).toThrow("ORG_AUTH_POLICY_TOO_LARGE");
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
  });

  it("compares authority fences when a final action supplies its admitted snapshot", async () => {
    await attest();
    await bind();
    actor = member;
    const snapshot = authorized();
    db.prepare("UPDATE projects SET updated_at=11 WHERE id='p1'").run();
    expect(() =>
      db
        .transaction(() =>
          authority.assertAuthorizedInTransaction({
            projectId: "p1",
            actorDid: member,
            permission: "task.read",
            expectedAuthority: snapshot,
          }),
        )
        .immediate(),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(authorized().projectSourceRevision).toBeGreaterThan(
      snapshot.projectSourceRevision,
    );
  });

  it("rejects a late workspace table and reverted scope assignment during binding confirmation", async () => {
    db.exec("DROP TABLE workspace_resources");
    await attest();
    confirm.mockImplementation(async () => {
      db.exec(
        "CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT); INSERT INTO workspace_resources VALUES('late','project','p1'); DELETE FROM workspace_resources WHERE workspace_id='late';",
      );
      return true;
    });
    await expect(bind()).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(hasOrganizationProjectBinding(db, "p1")).toBe(false);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_authority_events WHERE kind='project-bound'",
        )
        .get().n,
    ).toBe(0);
  });

  it("installs workflow revocation fences when that source table is created after the authority", async () => {
    db.exec(
      "CREATE TABLE approval_workflows(id TEXT PRIMARY KEY,org_id TEXT,enabled INTEGER,approvers TEXT); INSERT INTO approval_workflows VALUES('late-workflow','org-1',1,'original');",
    );
    const input = { ...policyInput(), workflowIds: ["late-workflow"] };
    await attest(input);
    await bind();
    db.prepare(
      "UPDATE approval_workflows SET approvers='changed' WHERE id='late-workflow'",
    ).run();
    db.prepare(
      "UPDATE approval_workflows SET approvers='original' WHERE id='late-workflow'",
    ).run();
    actor = member;
    expect(() =>
      db
        .transaction(() =>
          authority.assertWorkflowInTransaction({
            projectId: "p1",
            actorDid: member,
            workflowId: "late-workflow",
          }),
        )
        .immediate(),
    ).toThrow("ORG_AUTH_POLICY_STALE");
  });

  it.each(["active", "revoked"])(
    "closes personal task, create, risk and goal reads for %s explicit bindings",
    async (status) => {
      await attest();
      await bind();
      if (status === "revoked")
        await authority.revokeBinding({ projectId: "p1", expectedRevision: 1 });
      const options = {
        db,
        getActor: () => actor,
        approvalGate: new ApprovalGate({ confirm: async () => true }),
      };
      const descriptions = new TaskDescriptionActionService(options);
      const creates = new TaskCreateActionService(options);
      const risks = new ProjectRiskReviewService(options);
      const goals = new PersonalProjectGoalService(options);
      expect(() => descriptions.readTask("t1")).toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(() =>
        creates.preview({
          projectId: "p1",
          taskType: "query_info",
          description: "x",
          idempotencyKey: "k1",
        }),
      ).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
      expect(() => risks.evaluate({ projectId: "p1" })).toThrow(
        "PROJECT_RISK_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => goals.list({ projectId: "p1" })).toThrow(
        "GOAL_ORGANIZATION_UNSUPPORTED",
      );
    },
  );
});
