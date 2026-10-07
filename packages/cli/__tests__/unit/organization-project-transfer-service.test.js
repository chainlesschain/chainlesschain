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
} = require("../../../session-core/lib/organization-project-authority");
const {
  OrganizationProjectTransferService,
  MAX_LIFETIME_MS,
  SCHEMA,
} = require("../../../session-core/lib/organization-project-transfer-service");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract");
const {
  TaskDescriptionActionService,
  TaskCreateActionService,
} = require("../../../session-core/lib/task-description-action-service");
const {
  ProjectRiskReviewService,
} = require("../../../session-core/lib/project-risk-review-service");
const {
  PersonalProjectGoalService,
} = require("../../../session-core/lib/project-goal-service");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate");

describe("two-principal organization project transfers with real SQLite", () => {
  const original = "did:original",
    recipient = "did:organization-owner",
    reviewer = "did:reviewer";
  const target = {
    projectId: "p1",
    organizationProjectId: "op1",
    orgId: "org1",
  };
  let db,
    directory,
    filename,
    actor,
    clock,
    confirm,
    authority,
    service,
    descriptions,
    creates,
    risks,
    goals,
    second;
  function initialize(connection = db, getActor = () => actor) {
    const auth = new OrganizationProjectAuthority({
      db: connection,
      getActor,
      confirm: (value) => confirm(value),
      now: () => clock,
    });
    const transfer = new OrganizationProjectTransferService({
      db: connection,
      getActor,
      authority: auth,
      now: () => clock,
    });
    return { auth, transfer };
  }
  function personal() {
    const options = {
      db,
      getActor: () => actor,
      now: () => clock,
      approvalGate: new ApprovalGate({ confirm: async () => true }),
    };
    descriptions = new TaskDescriptionActionService(options);
    creates = new TaskCreateActionService(options);
    risks = new ProjectRiskReviewService(options);
    goals = new PersonalProjectGoalService(options);
  }
  async function attest(orgId = "org1") {
    const before = actor;
    actor = recipient;
    const policy = {
      orgId,
      permissions: [
        {
          actorDid: recipient,
          projectId: "p1",
          permissions: ["task.read"],
          expiresAt: 999999999,
        },
      ],
    };
    const preview = authority.previewPolicy(policy);
    await authority.attestPolicy({ ...policy, expectedDigest: preview.digest });
    actor = before;
  }
  function prepare(overrides = {}) {
    const input = { ...target, ...overrides };
    const preview = service.preview(input);
    return {
      ...input,
      expiresAt: preview.expiresAt,
      expectedDigest: preview.consentDigest,
    };
  }
  async function submit(overrides = {}) {
    return service.submit(prepare(overrides));
  }
  function binding() {
    return db
      .prepare(
        "SELECT * FROM cc_organization_project_bindings WHERE project_id='p1'",
      )
      .get();
  }
  function events(kind) {
    return db
      .prepare("SELECT * FROM cc_organization_authority_events WHERE kind=?")
      .all(kind);
  }
  function pending(id) {
    return db
      .prepare(
        "SELECT status FROM cc_organization_project_transfers WHERE id=?",
      )
      .get(id).status;
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-project-transfer-"));
    filename = join(directory, "transfers.db");
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    db.exec(`
      CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT,name TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT,name TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,sync_status TEXT,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT,result_data TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      INSERT INTO organization_info VALUES('org1','did:org:1','${recipient}','Destination'),('org2','did:org:2','${recipient}','Other destination');
      INSERT INTO organization_members VALUES('m1','org1','${recipient}','owner','active'),('m2','org1','${original}','member','active'),('m3','org1','${reviewer}','admin','active'),('m4','org2','${recipient}','owner','active'),('m5','org2','${original}','member','active');
      INSERT INTO organization_projects VALUES('op1','org1','${recipient}','Receiving project'),('op2','org1','${recipient}','Another target'),('op-other','org2','${recipient}','Other target');
      INSERT INTO projects(id,user_id,status,updated_at) VALUES('p1','${original}','active',10),('p2','${original}','active',10);
      INSERT INTO project_tasks(id,project_id,task_type,description,status,created_at,updated_at,sync_status) VALUES('t1','p1','query_info','Private original body','pending',10,10,'synced');
    `);
    actor = original;
    clock = 1000;
    confirm = vi.fn(async () => true);
    ({ auth: authority, transfer: service } = initialize());
    personal();
    await attest();
    await attest("org2");
    confirm.mockClear();
  });
  afterEach(() => {
    if (second?.open) second.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("binds only after two independently authenticated native confirmations of the same immutable evidence", async () => {
    const request = prepare();
    const consent = await service.submit(request);
    expect(consent).toMatchObject({
      status: "pending",
      originalOwnerDid: original,
      organizationOwnerDid: recipient,
      canAccept: false,
      canCancel: true,
    });
    expect(binding()).toBeUndefined();
    expect(descriptions.readTask("t1").description).toBe(
      "Private original body",
    );
    actor = recipient;
    expect(service.get({ transferId: consent.transferId }).canAccept).toBe(
      true,
    );
    const accepted = await service.accept({ transferId: consent.transferId });
    expect(accepted.status).toBe("bound");
    expect(binding()).toMatchObject({
      project_id: "p1",
      organization_project_id: "op1",
      org_id: "org1",
      original_owner_did: original,
      bound_by_did: recipient,
      status: "active",
      revision: 1,
    });
    expect(
      db.prepare("SELECT user_id FROM projects WHERE id='p1'").get().user_id,
    ).toBe(original);
    expect(confirm).toHaveBeenCalledTimes(2);
    const [first, secondConfirmation] = confirm.mock.calls.map(
      ([value]) => value,
    );
    expect(first).toMatchObject({
      kind: "consent-project-transfer",
      actorDid: original,
      consentDigest: request.expectedDigest,
    });
    expect(secondConfirmation).toMatchObject({
      kind: "accept-project-transfer",
      actorDid: recipient,
      consentDigest: request.expectedDigest,
    });
    expect(secondConfirmation.evidence).toEqual(first.evidence);
    expect(first.evidence.projectPermissions).toEqual([
      {
        actorDid: recipient,
        projectId: "p1",
        permissions: ["task.read"],
        expiresAt: 999999999,
      },
    ]);
    expect(events("project-transfer-consented")).toHaveLength(1);
    expect(events("project-transfer-accepted")).toHaveLength(1);
    expect(events("project-bound")).toHaveLength(1);
    expect(JSON.stringify(accepted)).not.toContain("Private original body");
    expect(accepted).not.toHaveProperty("evidence");
    expect(accepted).not.toHaveProperty("project");
  });

  it("replays lost consent and acceptance replies without reconfirming or renewing their deadline", async () => {
    const request = prepare(),
      consent = await service.submit(request);
    clock += 50;
    expect(await service.submit(request)).toEqual(
      service.get({ transferId: consent.transferId }),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    actor = recipient;
    await service.accept({ transferId: consent.transferId });
    clock += MAX_LIFETIME_MS;
    expect(
      (await service.accept({ transferId: consent.transferId })).status,
    ).toBe("bound");
    expect(confirm).toHaveBeenCalledTimes(2);
    actor = original;
    const recovered = await service.submit(request);
    expect(recovered).toMatchObject({
      status: "bound",
      expiresAt: consent.expiresAt,
      consentReceipt: consent.consentReceipt,
    });
    expect(() =>
      db
        .transaction(() =>
          authority.assertAuthorizedInTransaction({
            projectId: "p1",
            actorDid: original,
            permission: "task.read",
          }),
        )
        .immediate(),
    ).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(
      service.get({ transferId: consent.transferId }).terminalReceipt,
    ).toBeTruthy();
    expect(service.list({ projectId: "p1" }).transfers).toHaveLength(1);
  });

  it("shows only the transferring project's grants in both native evidence and preview", async () => {
    actor = recipient;
    const policy = {
      orgId: "org1",
      permissions: [
        {
          actorDid: recipient,
          projectId: "p1",
          permissions: ["task.read"],
          expiresAt: 999999999,
        },
        {
          actorDid: reviewer,
          projectId: "p2",
          permissions: ["task.read", "task.create"],
          expiresAt: 999999999,
        },
      ],
    };
    const prepared = authority.previewPolicy(policy);
    await authority.attestPolicy({
      ...policy,
      expectedDigest: prepared.digest,
    });
    actor = original;
    const preview = service.preview(target);
    expect(preview.evidence.projectPermissions).toEqual([
      policy.permissions[0],
    ]);
    const consent = await service.submit({
      ...target,
      expiresAt: preview.expiresAt,
      expectedDigest: preview.consentDigest,
    });
    expect(JSON.stringify(confirm.mock.calls.at(-1)[0])).not.toContain(
      reviewer,
    );
    expect(service.get({ transferId: consent.transferId })).not.toHaveProperty(
      "projectPermissions",
    );
    expect(service.list({ projectId: "p1" }).transfers[0]).not.toHaveProperty(
      "projectPermissions",
    );
  });

  it("survives a database reopen between the principals", async () => {
    const consent = await submit();
    db.close();
    db = new Database(filename);
    db.pragma("foreign_keys=ON");
    actor = recipient;
    ({ auth: authority, transfer: service } = initialize());
    expect(service.get({ transferId: consent.transferId }).canAccept).toBe(
      true,
    );
    expect(
      (await service.accept({ transferId: consent.transferId })).status,
    ).toBe("bound");
  });

  it("does not grant a pending recipient personal project read authority or admit forged actors", async () => {
    const consent = await submit();
    actor = recipient;
    expect(() => descriptions.readTask("t1")).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.preview(target)).toThrow(
      "ORG_TRANSFER_NOT_FOUND_OR_DENIED",
    );
    actor = reviewer;
    expect(() => service.get({ transferId: consent.transferId })).toThrow(
      "ORG_TRANSFER_NOT_FOUND_OR_DENIED",
    );
    expect(service.list({ projectId: "p1" })).toEqual({
      transfers: [],
      nextCursor: null,
    });
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    actor = original;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    await expect(
      service.submit({
        ...prepare({ projectId: "p2", organizationProjectId: "op2" }),
        actorDid: recipient,
      }),
    ).rejects.toThrow("ORG_TRANSFER_INVALID_REQUEST");
    await expect(
      service.accept({ transferId: consent.transferId, approved: true }),
    ).rejects.toThrow("ORG_TRANSFER_INVALID_REQUEST");
  });

  it.each(["inactive", "removed"])(
    "requires the original owner to be an active destination member (%s)",
    async (status) => {
      db.prepare(
        "UPDATE organization_members SET status=? WHERE org_id='org1' AND member_did=?",
      ).run(status, original);
      await attest();
      expect(() => service.preview(target)).toThrow(
        "ORG_AUTH_NOT_FOUND_OR_DENIED",
      );
      expect(
        confirm.mock.calls.some(
          ([value]) => value.kind === "consent-project-transfer",
        ),
      ).toBe(false);
    },
  );

  it("requires distinct principals, while retaining the old same-owner binding behavior", async () => {
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(recipient);
    actor = recipient;
    expect(() => service.preview(target)).toThrow(
      "ORG_AUTH_OWNER_CONSENT_REQUIRED",
    );
    const preview = authority.previewBinding(target);
    expect(
      (
        await authority.bindProject({
          ...target,
          expectedDigest: preview.digest,
        })
      ).status,
    ).toBe("bound");
  });

  it.each([
    { organizationProjectId: "op2" },
    { projectId: "p2" },
    { orgId: "org2", organizationProjectId: "op-other" },
  ])(
    "prevents pending consent bypass through a new target, project or organization: %j",
    async (overrides) => {
      await submit();
      expect(() => prepare(overrides)).toThrow("ORG_TRANSFER_PENDING_TRANSFER");
      const first = service.list({ projectId: "p1" }).transfers[0];
      await expect(
        service.submit({
          ...target,
          expiresAt: first.expiresAt - 1,
          expectedDigest: first.consentDigest,
        }),
      ).rejects.toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
      await expect(
        service.submit({
          ...target,
          expiresAt: first.expiresAt - 1,
          expectedDigest: digest({
            schema: SCHEMA,
            snapshotDigest: first.snapshotDigest,
            expiresAt: first.expiresAt - 1,
          }),
        }),
      ).rejects.toThrow("ORG_TRANSFER_PENDING_TRANSFER");
      expect(binding()).toBeUndefined();
    },
  );

  it("does not allow the old direct binding path to bypass another project's pending target reservation", async () => {
    await submit();
    db.prepare("UPDATE projects SET user_id=? WHERE id='p2'").run(recipient);
    actor = recipient;
    expect(() =>
      authority.previewBinding({ ...target, projectId: "p2" }),
    ).toThrow("ORG_AUTH_PENDING_ACTION");
  });

  it.each(["cancel", "reject"])(
    "allows %s of obsolete policy without binding and requires native consent",
    async (method) => {
      const consent = await submit();
      db.prepare(
        "UPDATE organization_projects SET name='Changed directory' WHERE id='op1'",
      ).run();
      actor = method === "cancel" ? original : recipient;
      confirm.mockResolvedValueOnce(false);
      expect(
        (await service[method]({ transferId: consent.transferId })).status,
      ).toBe("pending");
      expect(pending(consent.transferId)).toBe("pending");
      const closed = await service[method]({ transferId: consent.transferId });
      expect(closed.status).toBe(
        method === "cancel" ? "cancelled" : "rejected",
      );
      expect(binding()).toBeUndefined();
      const calls = confirm.mock.calls.length;
      expect(
        (await service[method]({ transferId: consent.transferId })).status,
      ).toBe(closed.status);
      expect(confirm).toHaveBeenCalledTimes(calls);
      actor = recipient;
      await expect(
        service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow("ORG_TRANSFER_NOT_PENDING");
    },
  );

  it("retains metadata and permits withdrawal after the original member is removed", async () => {
    const consent = await submit();
    db.prepare(
      "UPDATE organization_members SET status='removed' WHERE org_id='org1' AND member_did=?",
    ).run(original);
    expect(service.get({ transferId: consent.transferId })).toMatchObject({
      canAccept: false,
      canCancel: true,
    });
    expect(
      (await service.cancel({ transferId: consent.transferId })).status,
    ).toBe("cancelled");
  });

  it("detects recipient membership ABA during native rejection despite allowing stale-policy rejection", async () => {
    const consent = await submit();
    actor = recipient;
    confirm.mockImplementationOnce(async () => {
      db.prepare(
        "UPDATE organization_members SET status='removed' WHERE org_id='org1' AND member_did=?",
      ).run(recipient);
      db.prepare(
        "UPDATE organization_members SET status='active' WHERE org_id='org1' AND member_did=?",
      ).run(recipient);
      return true;
    });
    await expect(
      service.reject({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
    expect(pending(consent.transferId)).toBe("pending");
    expect(events("project-transfer-rejected")).toHaveLength(0);
  });

  it("does not allow a former recipient to accept or reject after losing active owner authority", async () => {
    const consent = await submit();
    actor = recipient;
    db.prepare(
      "UPDATE organization_members SET status='removed' WHERE org_id='org1' AND member_did=?",
    ).run(recipient);
    expect(service.get({ transferId: consent.transferId })).toMatchObject({
      canAccept: false,
      canReject: false,
    });
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    await expect(
      service.reject({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(binding()).toBeUndefined();
  });

  it("limits lifetime, rejects exact-deadline acceptance and never renews an expired retry", async () => {
    expect(() => prepare({ expiresAt: clock + MAX_LIFETIME_MS + 1 })).toThrow(
      "ORG_TRANSFER_INVALID_REQUEST",
    );
    expect(() => prepare({ expiresAt: clock })).toThrow("ORG_TRANSFER_EXPIRED");
    const request = prepare({ expiresAt: clock + 500 });
    const consent = await service.submit(request);
    clock = consent.expiresAt;
    actor = recipient;
    expect(service.get({ transferId: consent.transferId })).toMatchObject({
      status: "expired",
      canAccept: false,
    });
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_EXPIRED");
    actor = original;
    expect(await service.submit(request)).toMatchObject({
      status: "expired",
      expiresAt: request.expiresAt,
    });
    const next = await submit();
    expect(next.transferId).not.toBe(consent.transferId);
    expect(next.status).toBe("pending");
  });

  it.each(["submit", "accept"])(
    "rejects expiry while %s waits for native confirmation",
    async (operation) => {
      const request = prepare({ expiresAt: clock + 50 });
      let consent;
      if (operation === "accept") {
        consent = await service.submit(request);
        actor = recipient;
      }
      confirm.mockImplementationOnce(async () => {
        clock = request.expiresAt;
        return true;
      });
      await expect(
        operation === "submit"
          ? service.submit(request)
          : service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow("ORG_TRANSFER_EXPIRED");
      expect(binding()).toBeUndefined();
      expect(events("project-transfer-accepted")).toHaveLength(0);
    },
  );

  it.each(["submit", "accept", "cancel", "reject"])(
    "rejects identity changes during %s native confirmation",
    async (operation) => {
      const request = prepare();
      let consent;
      if (operation !== "submit") consent = await service.submit(request);
      if (["accept", "reject"].includes(operation)) actor = recipient;
      confirm.mockImplementationOnce(async () => {
        actor = reviewer;
        return true;
      });
      await expect(
        operation === "submit"
          ? service.submit(request)
          : service[operation]({ transferId: consent.transferId }),
      ).rejects.toThrow("ORG_TRANSFER_IDENTITY_CHANGED");
      expect(binding()).toBeUndefined();
      if (consent) expect(pending(consent.transferId)).toBe("pending");
    },
  );

  it("uses detached confirmation evidence and does not trust mutations to the supplied preview", async () => {
    const request = prepare();
    confirm.mockImplementationOnce(async (value) => {
      value.evidence.project.user_id = reviewer;
      value.evidence.organizationOwnerDid = reviewer;
      value.expiresAt = 999999999;
      return true;
    });
    const consent = await service.submit(request);
    expect(consent.originalOwnerDid).toBe(original);
    expect(consent.organizationOwnerDid).toBe(recipient);
    expect(consent.expiresAt).toBe(request.expiresAt);
  });

  it("leaves no consent when the native transfer dialog is cancelled", async () => {
    const request = prepare();
    confirm.mockResolvedValueOnce(false);
    expect(await service.submit(request)).toEqual({ status: "cancelled" });
    expect(service.list({ projectId: "p1" }).transfers).toHaveLength(0);
    expect(events("project-transfer-consented")).toHaveLength(0);
  });

  it("keeps the exact pending consent when the recipient cancels their native dialog", async () => {
    const consent = await submit();
    actor = recipient;
    confirm.mockResolvedValueOnce(false);
    expect(
      await service.accept({ transferId: consent.transferId }),
    ).toMatchObject({
      status: "pending",
      consentDigest: consent.consentDigest,
      expiresAt: consent.expiresAt,
    });
    expect(binding()).toBeUndefined();
  });

  const sourceChanges = [
    [
      "project owner ABA",
      `UPDATE projects SET user_id='${reviewer}' WHERE id='p1'; UPDATE projects SET user_id='${original}' WHERE id='p1'`,
      "ORG_TRANSFER_VERSION_CONFLICT",
    ],
    [
      "task body ABA",
      "UPDATE project_tasks SET description='Changed' WHERE id='t1'; UPDATE project_tasks SET description='Private original body' WHERE id='t1'",
      "ORG_TRANSFER_VERSION_CONFLICT",
    ],
    [
      "task reparent ABA",
      "UPDATE project_tasks SET project_id='p2' WHERE id='t1'; UPDATE project_tasks SET project_id='p1' WHERE id='t1'",
      "ORG_TRANSFER_VERSION_CONFLICT",
    ],
    [
      "member ABA",
      `UPDATE organization_members SET status='removed' WHERE member_did='${original}' AND org_id='org1'; UPDATE organization_members SET status='active' WHERE member_did='${original}' AND org_id='org1'`,
      "ORG_AUTH_POLICY_STALE",
    ],
    [
      "organization owner ABA",
      `UPDATE organization_info SET owner_did='${reviewer}' WHERE org_id='org1'; UPDATE organization_info SET owner_did='${recipient}' WHERE org_id='org1'`,
      "ORG_AUTH_POLICY_STALE",
    ],
    [
      "destination directory ABA",
      "UPDATE organization_projects SET name='Changed' WHERE id='op1'; UPDATE organization_projects SET name='Receiving project' WHERE id='op1'",
      "ORG_AUTH_POLICY_STALE",
    ],
    [
      "destination reparent ABA",
      "UPDATE organization_projects SET org_id='org2' WHERE id='op1'; UPDATE organization_projects SET org_id='org1' WHERE id='op1'",
      "ORG_AUTH_POLICY_STALE",
    ],
    [
      "workspace attachment",
      "INSERT INTO workspace_resources VALUES('w1','project','p1')",
      "ORG_AUTH_SCOPE_CONFLICT",
    ],
    [
      "workspace attachment ABA",
      "INSERT INTO workspace_resources VALUES('w1','task','t1'); DELETE FROM workspace_resources",
      "ORG_TRANSFER_VERSION_CONFLICT",
    ],
    [
      "schema changes",
      "CREATE TABLE later_business_table(id TEXT)",
      "ORG_TRANSFER_VERSION_CONFLICT",
    ],
  ];
  it.each(sourceChanges)(
    "rejects %s between the two principals",
    async (_label, sql, code) => {
      const consent = await submit();
      db.exec(sql);
      actor = recipient;
      expect(service.get({ transferId: consent.transferId })).toMatchObject({
        canAccept: false,
        eligibilityReason: code,
      });
      await expect(
        service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow(code);
      expect(binding()).toBeUndefined();
      expect(pending(consent.transferId)).toBe("pending");
    },
  );

  it("rejects reattestation of identical grants because the policy epoch changed", async () => {
    const consent = await submit();
    await attest();
    actor = recipient;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
  });

  it.each(["consent-project-transfer", "accept-project-transfer"])(
    "rechecks task changes after the %s native dialog",
    async (kind) => {
      const request = prepare();
      let consent;
      if (kind === "accept-project-transfer") {
        consent = await service.submit(request);
        actor = recipient;
      }
      confirm.mockImplementationOnce(async () => {
        db.prepare(
          "UPDATE project_tasks SET description='Concurrent change' WHERE id='t1'",
        ).run();
        return true;
      });
      await expect(
        kind === "consent-project-transfer"
          ? service.submit(request)
          : service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
      expect(binding()).toBeUndefined();
    },
  );

  it("permits a real personal task write while pending, which invalidates the old transfer", async () => {
    const consent = await submit();
    const request = descriptions.preview({
      taskId: "t1",
      description: "Personal edit before migration",
      idempotencyKey: "personal-while-pending",
    }).request;
    expect((await descriptions.execute(request)).run.status).toBe("succeeded");
    actor = recipient;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
    expect(binding()).toBeUndefined();
  });

  it.each(["running", "unknown", "malformed"])(
    "blocks acceptance over an unresolved %s personal action",
    async (status) => {
      const consent = await submit();
      db.prepare(
        "INSERT INTO cc_business_action_runs VALUES('r1',?,'t1','key','invocation',?,'{}')",
      ).run(
        original,
        status === "malformed" ? "{bad" : JSON.stringify({ status }),
      );
      actor = recipient;
      await expect(
        service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow("ORG_AUTH_PENDING_ACTION");
      expect(binding()).toBeUndefined();
    },
  );

  it("commits at most one acceptance across two SQLite connections and concurrent native dialogs", async () => {
    const consent = await submit();
    actor = recipient;
    second = new Database(filename);
    second.pragma("foreign_keys=ON");
    const other = initialize(second, () => recipient).transfer;
    let release;
    confirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const waiting = service.accept({ transferId: consent.transferId });
    expect(release).toBeTypeOf("function");
    expect(
      (await other.accept({ transferId: consent.transferId })).status,
    ).toBe("bound");
    release(true);
    expect((await waiting).status).toBe("bound");
    expect(events("project-bound")).toHaveLength(1);
    expect(events("project-transfer-accepted")).toHaveLength(1);
  });

  it.each([
    [
      "binding",
      "CREATE TRIGGER force_failure BEFORE INSERT ON cc_organization_project_bindings BEGIN SELECT RAISE(ABORT,'forced binding failure'); END",
    ],
    [
      "consumption",
      "CREATE TRIGGER force_failure BEFORE UPDATE ON cc_organization_project_transfers WHEN NEW.status='bound' BEGIN SELECT RAISE(ABORT,'forced consumption failure'); END",
    ],
    [
      "binding event",
      "CREATE TRIGGER force_failure BEFORE INSERT ON cc_organization_authority_events WHEN NEW.kind='project-bound' BEGIN SELECT RAISE(ABORT,'forced event failure'); END",
    ],
    [
      "acceptance event",
      "CREATE TRIGGER force_failure BEFORE INSERT ON cc_organization_authority_events WHEN NEW.kind='project-transfer-accepted' BEGIN SELECT RAISE(ABORT,'forced event failure'); END",
    ],
  ])(
    "rolls back the binding, both events and consumption on %s write failure",
    async (_label, trigger) => {
      db.exec(trigger);
      const consent = await submit();
      actor = recipient;
      await expect(
        service.accept({ transferId: consent.transferId }),
      ).rejects.toThrow("forced");
      expect(binding()).toBeUndefined();
      expect(pending(consent.transferId)).toBe("pending");
      expect(events("project-bound")).toHaveLength(0);
      expect(events("project-transfer-accepted")).toHaveLength(0);
      expect(events("project-transfer-consented")).toHaveLength(1);
    },
  );

  it("rolls back consent evidence when the pending record cannot be persisted", async () => {
    db.exec(
      "CREATE TRIGGER force_failure BEFORE INSERT ON cc_organization_project_transfers BEGIN SELECT RAISE(ABORT,'forced consent failure'); END",
    );
    await expect(submit()).rejects.toThrow("forced consent failure");
    expect(events("project-transfer-consented")).toHaveLength(0);
  });

  it("rejects source mutations performed by a binding trigger and rolls back all effects", async () => {
    db.exec(
      "CREATE TRIGGER mutate_source AFTER INSERT ON cc_organization_project_bindings BEGIN UPDATE project_tasks SET description='Changed from trigger' WHERE id='t1'; END",
    );
    const consent = await submit();
    actor = recipient;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
    expect(binding()).toBeUndefined();
    expect(pending(consent.transferId)).toBe("pending");
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Private original body");
    expect(events("project-bound")).toHaveLength(0);
  });

  it("protects immutable consent and detects tampering with its native evidence", async () => {
    const consent = await submit();
    expect(() =>
      db
        .prepare(
          "UPDATE cc_organization_project_transfers SET expires_at=expires_at+1 WHERE id=?",
        )
        .run(consent.transferId),
    ).toThrow("ORG_TRANSFER_IMMUTABLE");
    expect(() =>
      db
        .prepare("DELETE FROM cc_organization_project_transfers WHERE id=?")
        .run(consent.transferId),
    ).toThrow("ORG_TRANSFER_IMMUTABLE");
    db.prepare(
      "UPDATE cc_organization_authority_events SET evidence_json='{}' WHERE id=?",
    ).run(consent.consentReceipt.id);
    actor = recipient;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_RECORD_CORRUPT");
    expect(binding()).toBeUndefined();
  });

  it("rolls back a binding trigger that substitutes a different receiver in the canonical mapping", async () => {
    db.exec(
      `CREATE TRIGGER replace_receiver AFTER INSERT ON cc_organization_project_bindings BEGIN UPDATE cc_organization_project_bindings SET bound_by_did='${reviewer}' WHERE project_id=NEW.project_id; END`,
    );
    const consent = await submit();
    actor = recipient;
    await expect(
      service.accept({ transferId: consent.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_RECORD_CORRUPT");
    expect(binding()).toBeUndefined();
    expect(pending(consent.transferId)).toBe("pending");
    expect(events("project-bound")).toHaveLength(0);
  });

  it("paginates participant metadata without granting by project membership or role", async () => {
    const first = await submit();
    await service.cancel({ transferId: first.transferId });
    clock++;
    await submit();
    const page = service.list({ projectId: "p1", limit: 1 });
    expect(page.transfers).toHaveLength(1);
    const next = service.list({
      projectId: "p1",
      beforeId: page.nextCursor,
      limit: 1,
    });
    expect(next.transfers).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect(next.transfers[0].transferId).not.toBe(page.transfers[0].transferId);
    actor = reviewer;
    expect(service.list({ projectId: "p1" }).transfers).toHaveLength(0);
  });

  it("orders migration history by creation time despite reversed UUID order and rejects unrelated cursors", async () => {
    const modulePath =
      require.resolve("../../../session-core/lib/organization-project-transfer-service");
    const cachedModule = require.cache[modulePath];
    const uuid = vi
      .spyOn(require("node:crypto"), "randomUUID")
      .mockReturnValueOnce("ffffffff-ffff-4fff-afff-ffffffffffff")
      .mockReturnValueOnce("00000000-0000-4000-a000-000000000001");
    delete require.cache[modulePath];
    try {
      const { OrganizationProjectTransferService: OrderedTransfers } = require(
        modulePath,
      );
      service = new OrderedTransfers({
        db,
        getActor: () => actor,
        authority,
        now: () => clock,
      });
      const older = await submit();
      await service.cancel({ transferId: older.transferId });
      clock += 100;
      const newer = await submit();
      await service.cancel({ transferId: newer.transferId });
      expect(older.transferId > newer.transferId).toBe(true);
      expect(newer.createdAt).toBeGreaterThan(older.createdAt);

      const firstPage = service.list({ projectId: "p1", limit: 1 });
      expect(firstPage.transfers.map((item) => item.transferId)).toEqual([
        newer.transferId,
      ]);
      expect(firstPage.nextCursor).toBe(newer.transferId);
      const secondPage = service.list({
        projectId: "p1",
        limit: 1,
        beforeId: firstPage.nextCursor,
      });
      expect(secondPage.transfers.map((item) => item.transferId)).toEqual([
        older.transferId,
      ]);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        service.list({ projectId: "p1", beforeId: older.transferId }).transfers,
      ).toEqual([]);

      const foreign = await submit({
        projectId: "p2",
        organizationProjectId: "op2",
      });
      expect(() =>
        service.list({ projectId: "p1", beforeId: foreign.transferId }),
      ).toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
      expect(() =>
        service.list({ projectId: "p1", beforeId: "missing-transfer" }),
      ).toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
      actor = reviewer;
      expect(() =>
        service.list({ projectId: "p1", beforeId: newer.transferId }),
      ).toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    } finally {
      uuid.mockRestore();
      require.cache[modulePath] = cachedModule;
    }
  });

  it.each([false, true])(
    "retains scope tombstones and closes personal action, risk and goal routes (revoked=%s)",
    async (revoke) => {
      const consent = await submit();
      actor = recipient;
      await service.accept({ transferId: consent.transferId });
      if (revoke)
        await authority.revokeBinding({ projectId: "p1", expectedRevision: 1 });
      actor = original;
      expect(hasOrganizationProjectBinding(db, "p1")).toBe(true);
      expect(() => descriptions.readTask("t1")).toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(() =>
        creates.preview({
          projectId: "p1",
          taskType: "query_info",
          description: "No personal write",
          idempotencyKey: "no-personal-after-transfer",
        }),
      ).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
      expect(() => risks.evaluate({ projectId: "p1" })).toThrow(
        "PROJECT_RISK_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => goals.list({ projectId: "p1" })).toThrow(
        "GOAL_ORGANIZATION_UNSUPPORTED",
      );
      expect(service.get({ transferId: consent.transferId }).status).toBe(
        "bound",
      );
    },
  );
});
