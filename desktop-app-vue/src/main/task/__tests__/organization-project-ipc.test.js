import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const {
  CHANNELS,
  registerOrganizationProjectIPC,
} = require("../organization-project-ipc");
describe("organization project fixed IPC through actual services", () => {
  let f, dialog, workflowIds;
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    ({ workflowIds } = await f.setup());
    dialog.mockClear();
    f.setActor(f.identities.requester);
  });
  afterEach(() => f.db.close());
  function proposal(create = false, key = "intent1") {
    const prepared = create
      ? f.host.previewCreate(f.event, {
          projectId: "p1",
          taskType: "query_info",
          description: "Proposed task",
          idempotencyKey: key,
        })
      : f.host.previewDescription(f.event, {
          taskId: "t1",
          description: "Proposed description",
          idempotencyKey: key,
        });
    return f.host.submitProposal(f.event, {
      projectId: "p1",
      workflowId: workflowIds[create ? 1 : 0],
      request: prepared.request,
    });
  }
  async function approve(p) {
    f.setActor(f.identities.first);
    await f.host.respondProposal(f.event, {
      proposalId: p.proposalId,
      step: 0,
      decision: "approve",
    });
    f.setActor(f.identities.second);
    await f.host.respondProposal(f.event, {
      proposalId: p.proposalId,
      step: 1,
      decision: "approve",
    });
    f.setActor(f.identities.requester);
  }
  function body() {
    return f.db
      .prepare("SELECT description FROM project_tasks WHERE id='t1'")
      .get().description;
  }
  it("registers only the exact governed channels", () => {
    const handle = vi.fn();
    registerOrganizationProjectIPC(
      { getDatabase: () => f.db },
      { electron: { ...f.electron, ipcMain: { handle } } },
    );
    expect(handle.mock.calls.map(([name]) => name).sort()).toEqual(
      Object.values(CHANNELS).sort(),
    );
    expect(Object.values(CHANNELS).some((name) => name.includes("*"))).toBe(
      false,
    );
  });
  it("shows content to separate reviewers and executes the stored approved request", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    expect(
      f.host.readProposal(f.event, { proposalId: p.proposalId }).request.input
        .description,
    ).toBe("Proposed description");
    await f.host.respondProposal(f.event, {
      proposalId: p.proposalId,
      step: 0,
      decision: "approve",
    });
    expect(dialog.mock.calls[0][1].detail).toContain("Original task");
    expect(dialog.mock.calls[0][1].detail).toContain("Proposed description");
    f.setActor(f.identities.second);
    await f.host.respondProposal(f.event, {
      proposalId: p.proposalId,
      step: 1,
      decision: "approve",
    });
    f.setActor(f.identities.requester);
    const result = await f.host.executeProposal(f.event, {
      proposalId: p.proposalId,
    });
    expect(result.run.status).toBe("succeeded");
    expect(body()).toBe("Proposed description");
    expect(f.host.getRun(f.event, { runId: result.run.id }).run.id).toBe(
      result.run.id,
    );
    expect(
      (await f.host.executeProposal(f.event, { proposalId: p.proposalId }))
        .replayed,
    ).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(3);
  });
  it("creates a real canonical task through the same cross-identity flow", async () => {
    const p = proposal(true);
    await approve(p);
    const result = await f.host.executeProposal(f.event, {
      proposalId: p.proposalId,
    });
    expect(result.run.status).toBe("succeeded");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM project_tasks").get().n,
    ).toBe(2);
    expect(f.host.listRuns(f.event, { projectId: "p1" }).runs[0].run.id).toBe(
      result.run.id,
    );
  });
  it("returns authorized context without inheriting old role claims", () => {
    expect(f.host.context(f.event, { projectId: "p1" })).toMatchObject({
      mode: "organization",
      canManage: false,
      permissions: ["task.create", "task.read", "task.update-description"],
    });
    f.setActor("did:outsider");
    expect(() => f.host.context(f.event, { projectId: "p1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() =>
      f.host.context(f.event, {
        projectId: "p1",
        actorDid: f.identities.owner,
      }),
    ).toThrow("ORG_AUTH_INVALID_REQUEST");
    f.setTrusted(false);
    expect(() => f.host.context(f.event, { projectId: "p1" })).toThrow(
      "ORG_AUTH_UNTRUSTED_SENDER",
    );
  });
  it("rejects workflow creation before it exceeds the bounded setup catalog", async () => {
    f.setActor(f.identities.owner);
    for (let i = 0; i < 18; i++)
      f.db
        .prepare(
          "INSERT INTO approval_workflows(id,org_id,name,trigger_resource_type,trigger_action,approval_type,approvers,timeout_hours,on_timeout,enabled,created_at,updated_at) SELECT ?,org_id,name,trigger_resource_type,trigger_action,approval_type,approvers,timeout_hours,on_timeout,enabled,created_at,updated_at FROM approval_workflows WHERE id=?",
        )
        .run(`additional-${i}`, workflowIds[0]);
    const setup = f.host.setup(f.event, { projectId: "p1", orgId: "org1" });
    expect(setup.workflows).toHaveLength(20);
    await expect(
      f.host.configureWorkflow(f.event, {
        orgId: "org1",
        name: "Overflow",
        actionType: "task.create",
        steps: [[f.identities.first]],
        approvalType: "sequential",
        timeoutHours: 24,
        expectedSourceDigest: setup.sourceDigest,
      }),
    ).rejects.toThrow("ORG_AUTH_SOURCE_INVALID");
    expect(dialog).not.toHaveBeenCalled();
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_workflows").get().n,
    ).toBe(20);
  });
  it("refuses renderer request injection and execution by an approver", async () => {
    const p = proposal();
    await approve(p);
    f.setActor(f.identities.first);
    expect(() =>
      f.host.executeProposal(f.event, { proposalId: p.proposalId }),
    ).toThrow("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
    expect(() =>
      f.host.executeProposal(f.event, {
        proposalId: p.proposalId,
        request: { input: { description: "injected" } },
      }),
    ).toThrow("ORG_AUTH_INVALID_REQUEST");
    expect(body()).toBe("Original task");
  });
  it("does not approve on native dismissal or reauthentication during confirmation", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(
      await f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).toEqual({ status: "cancelled-confirmation" });
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
    dialog.mockImplementationOnce(async () => {
      f.setActor(f.identities.first);
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });
  it("rejects authority revocation while the approval dialog is open", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    dialog.mockImplementationOnce(async () => {
      f.db
        .prepare(
          "UPDATE organization_members SET status='removed' WHERE member_did=?",
        )
        .run(f.identities.first);
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_AUTH_POLICY_STALE");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });
  it("rejects approval content expiry during native confirmation", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    dialog.mockImplementationOnce(async () => {
      f.setNow(p.expiresAt);
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_PROPOSAL_BODY_UNAVAILABLE");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });
  it("records denied rather than replayable execution after proposal expiry in final confirmation", async () => {
    const p = proposal();
    await approve(p);
    dialog.mockImplementationOnce(async () => {
      f.setNow(p.expiresAt);
      return { response: 1 };
    });
    await expect(
      f.host.executeProposal(f.event, { proposalId: p.proposalId }),
    ).rejects.toThrow("ORG_PROPOSAL_BODY_UNAVAILABLE");
    expect(body()).toBe("Original task");
    expect(
      JSON.parse(
        f.db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      ).status,
    ).toBe("denied");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(p.approvalId).consumed_run_id,
    ).toBeNull();
  });
  it("drops approval when the renderer frame navigates during confirmation", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    dialog.mockImplementationOnce(async () => {
      f.event.senderFrame = {
        url: "http://localhost:5173/other",
        parent: null,
      };
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_AUTH_WINDOW_UNAVAILABLE");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });

  it("rejects a new current main frame while the old IPC event frame remains alive", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    const old = f.event.senderFrame;
    dialog.mockImplementationOnce(async () => {
      f.event.sender.mainFrame = { url: old.url, parent: null };
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_AUTH_WINDOW_UNAVAILABLE");
    expect(f.event.senderFrame).toBe(old);
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });

  it("rejects main-frame navigation and restoration during native confirmation", async () => {
    const p = proposal();
    f.setActor(f.identities.first);
    dialog.mockImplementationOnce(async () => {
      f.event.sender.emit(
        "did-start-navigation",
        {},
        "http://localhost:5173/other",
        false,
        true,
      );
      f.event.senderFrame.url = "http://localhost:5173/other";
      f.event.senderFrame.url = "http://localhost:5173";
      return { response: 1 };
    });
    await expect(
      f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step: 0,
        decision: "approve",
      }),
    ).rejects.toThrow("ORG_AUTH_WINDOW_UNAVAILABLE");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
  });
  it("cancels without changing task data and keeps proposal history without content", async () => {
    const p = proposal();
    expect(
      (await f.host.cancelProposal(f.event, { proposalId: p.proposalId }))
        .status,
    ).toBe("cancelled");
    expect(
      f.host.readProposal(f.event, { proposalId: p.proposalId }),
    ).toMatchObject({
      request: null,
      bodyAvailable: false,
      approvalStatus: "cancelled",
    });
    expect(
      f.host.listProposals(f.event, { projectId: "p1" }).proposals[0]
        .proposalId,
    ).toBe(p.proposalId);
    expect(body()).toBe("Original task");
  });
});
