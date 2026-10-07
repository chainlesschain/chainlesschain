import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const auth = require("../project-goal-auth-session");
const {
  createOrganizationProjectAuthorityHost,
} = require("../organization-project-authority-host");

describe("organization authority native host", () => {
  const owner = "did:chainlesschain:owner";
  let db, actor, window, event, electron, host, trusted, generation;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE organization_info (org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members (id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects (id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT);
      INSERT INTO organization_info VALUES ('o1','did:org:1','${owner}');
      INSERT INTO organization_members VALUES ('m1','o1','${owner}','owner','active');
      INSERT INTO organization_projects VALUES ('op1','o1','${owner}');
      INSERT INTO projects VALUES ('p1','${owner}','active',10);
    `);
    actor = owner;
    generation = 1;
    trusted = true;
    const frame = { url: "http://localhost:5173", parent: null };
    event = { sender: { mainFrame: frame }, senderFrame: frame };
    window = { isDestroyed: vi.fn(() => false) };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
      ipcMain: { handle: vi.fn() },
    };
    host = createOrganizationProjectAuthorityHost({
      database: { getDatabase: () => db },
      getCurrentUserDid: () => actor,
      getAuthenticationGeneration: () => generation,
      validateSender: () => ({ trusted }),
      electron,
    });
  });
  afterEach(() => {
    db.close();
    auth.disposeProjectGoalAuth();
  });

  const policy = () => ({
    orgId: "o1",
    permissions: [
      {
        actorDid: owner,
        projectId: "p1",
        permissions: ["task.read"],
        expiresAt: Date.now() + 60000,
      },
    ],
  });
  async function attest() {
    const input = policy();
    return host.attestPolicy(event, {
      ...input,
      expectedDigest: host.previewPolicy(event, input).digest,
    });
  }

  it("confirms owner policy with a parented native dialog and defaults to cancellation", async () => {
    expect((await attest()).status).toBe("attested");
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        buttons: ["取消", "确认"],
      }),
    );
    const details = electron.dialog.showMessageBox.mock.calls[0][1].detail;
    expect(details).toContain(owner);
    expect(details).toContain("task.read");
    expect(details).toContain("sha256:");
  });

  it("requires current trusted identity rather than an actor claim", () => {
    const input = policy();
    actor = "did:attacker";
    expect(() =>
      host.previewPolicy(event, { ...input, actorDid: owner }),
    ).toThrow("ORG_AUTH_INVALID_REQUEST");
    expect(() => host.previewPolicy(event, input)).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it.each(["untrusted", "destroyed", "missing identity"])(
    "rejects %s native sender authority",
    (reason) => {
      if (reason === "untrusted") trusted = false;
      if (reason === "destroyed") window.isDestroyed.mockReturnValue(true);
      if (reason === "missing identity") actor = null;
      expect(() => host.previewPolicy(event, policy())).toThrow(/ORG_AUTH_/);
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='cc_organization_project_policies'",
          )
          .get(),
      ).toBeUndefined();
    },
  );

  it("does not attest after the native window is destroyed", async () => {
    electron.dialog.showMessageBox.mockImplementation(async () => {
      window.isDestroyed.mockReturnValue(true);
      return { response: 1 };
    });
    await expect(attest()).rejects.toThrow("ORG_AUTH_IDENTITY_REQUIRED");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
  });

  it("requires an authenticated session even when the default DID is loaded", () => {
    auth.configureProjectGoalAuth({
      getDid: () => actor,
      getUKeyManager: () => null,
    });
    const defaultHost = createOrganizationProjectAuthorityHost({
      database: db,
      validateSender: () => ({ trusted: true }),
      electron,
    });
    expect(() => defaultHost.previewPolicy(event, policy())).toThrow(
      "ORG_AUTH_IDENTITY_REQUIRED",
    );
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("rejects logout and same-DID reauthentication during native confirmation", async () => {
    auth.configureProjectGoalAuth({
      getDid: () => actor,
      getUKeyManager: () => null,
    });
    expect(
      auth.authenticateProjectGoalPassword(
        auth.beginProjectGoalAuthentication(),
      ),
    ).toBe(true);
    const defaultHost = createOrganizationProjectAuthorityHost({
      database: db,
      validateSender: () => ({ trusted: true }),
      electron,
    });
    const input = policy();
    const preview = defaultHost.previewPolicy(event, input);
    electron.dialog.showMessageBox.mockImplementation(async () => {
      auth.clearProjectGoalAuth();
      expect(
        auth.authenticateProjectGoalPassword(
          auth.beginProjectGoalAuthentication(),
        ),
      ).toBe(true);
      return { response: 1 };
    });
    await expect(
      defaultHost.attestPolicy(event, {
        ...input,
        expectedDigest: preview.digest,
      }),
    ).rejects.toThrow("ORG_AUTH_IDENTITY_REQUIRED");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_authority_events")
        .get().n,
    ).toBe(0);
  });

  it("rejects a replaced database connection after confirmation", async () => {
    let current = db;
    const dynamicHost = createOrganizationProjectAuthorityHost({
      database: { getDatabase: () => current },
      getCurrentUserDid: () => actor,
      getAuthenticationGeneration: () => generation,
      validateSender: () => ({ trusted: true }),
      electron,
    });
    const input = policy();
    const preview = dynamicHost.previewPolicy(event, input);
    electron.dialog.showMessageBox.mockImplementation(async () => {
      current = {};
      return { response: 1 };
    });
    await expect(
      dynamicHost.attestPolicy(event, {
        ...input,
        expectedDigest: preview.digest,
      }),
    ).rejects.toThrow("ORG_AUTH_IDENTITY_REQUIRED");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
  });

  it("cancels when the dialog is dismissed without a confirm response", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect((await attest()).status).toBe("cancelled");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
  });

  it("explains the persistent organization boundary before binding and revocation", async () => {
    await attest();
    const input = {
      projectId: "p1",
      organizationProjectId: "op1",
      orgId: "o1",
    };
    expect(
      (
        await host.bindProject(event, {
          ...input,
          expectedDigest: host.previewBinding(event, input).digest,
        })
      ).status,
    ).toBe("bound");
    expect(electron.dialog.showMessageBox.mock.lastCall[1].message).toContain(
      "个人任务、风险及目标入口将停止访问",
    );
    expect(
      (
        await host.revokeBinding(event, {
          projectId: "p1",
          expectedRevision: 1,
        })
      ).status,
    ).toBe("revoked");
    expect(electron.dialog.showMessageBox.mock.lastCall[1].message).toContain(
      "不会恢复个人访问",
    );
    expect(electron.ipcMain.handle).not.toHaveBeenCalled();
  });

  it("prevents the legacy approval manager from responding or auto-approving a controlled request", async () => {
    const Module = require("node:module");
    const load = Module._load;
    let Manager;
    try {
      Module._load = function (name, ...args) {
        if (name === "../utils/logger.js")
          return { logger: { info() {}, error() {} } };
        return load.call(this, name, ...args);
      };
      ({
        ApprovalWorkflowManager: Manager,
      } = require("../../permission/approval-workflow-manager"));
    } finally {
      Module._load = load;
    }
    db.exec(
      "CREATE TABLE approval_requests(id TEXT PRIMARY KEY,status TEXT,updated_at INTEGER,completed_at INTEGER); CREATE TABLE cc_organization_action_approvals(request_id TEXT PRIMARY KEY); INSERT INTO approval_requests VALUES('controlled','pending',1,NULL); INSERT INTO cc_organization_action_approvals VALUES('controlled');",
    );
    const manager = new Manager({ getDatabase: () => db });
    expect(await manager.approveRequest("controlled", owner)).toEqual({
      success: false,
      error: "CONTROLLED_APPROVAL_REQUIRED",
    });
    expect(await manager.rejectRequest("controlled", owner)).toEqual({
      success: false,
      error: "CONTROLLED_APPROVAL_REQUIRED",
    });
    expect(await manager._handleTimeout("controlled", "approve")).toEqual({
      success: false,
      error: "CONTROLLED_APPROVAL_REQUIRED",
    });
    expect(
      db
        .prepare("SELECT status FROM approval_requests WHERE id='controlled'")
        .get().status,
    ).toBe("pending");
  });
});
