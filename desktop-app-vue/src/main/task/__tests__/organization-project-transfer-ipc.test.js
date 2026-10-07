import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const {
  TaskDescriptionActionService,
} = require("@chainlesschain/session-core/task-description-action-service");
describe("dual-principal migration through authenticated fixed IPC", () => {
  let f, dialog;
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    await f.setup({ bind: false });
    f.db
      .prepare("UPDATE projects SET user_id=? WHERE id='p1'")
      .run(f.identities.requester);
    dialog.mockClear();
    f.setActor(f.identities.requester);
  });
  afterEach(() => f.db.close());
  const input = {
    projectId: "p1",
    orgId: "org1",
    organizationProjectId: "op1",
  };
  async function consent() {
    const preview = f.host.previewTransfer(f.event, input);
    return f.host.submitTransfer(f.event, {
      ...input,
      expiresAt: preview.expiresAt,
      expectedDigest: preview.consentDigest,
    });
  }
  function binding() {
    return f.db
      .prepare(
        "SELECT * FROM cc_organization_project_bindings WHERE project_id='p1'",
      )
      .get();
  }
  it("exposes only the origin owner's necessary destination catalog", () => {
    expect(f.host.transferCatalog(f.event, { projectId: "p1" })).toMatchObject({
      canInitiate: true,
      organizations: [
        { id: "org1", ownerDid: f.identities.owner, projects: [{ id: "op1" }] },
      ],
    });
    expect(() =>
      f.host.transferCatalog(f.event, {
        projectId: "p1",
        actorDid: f.identities.owner,
      }),
    ).toThrow("ORG_AUTH_INVALID_REQUEST");
    f.setActor("did:outsider");
    expect(f.host.transferCatalog(f.event, { projectId: "p1" })).toEqual({
      canInitiate: false,
      organizations: [],
    });
    expect(() => f.host.previewTransfer(f.event, input)).toThrow();
  });
  it("lets the receiving owner configure its own organization using an opaque project hint", () => {
    f.setActor(f.identities.owner);
    const context = f.host.context(f.event, { projectId: "p1" });
    expect(context).toMatchObject({
      mode: "unbound",
      isProjectOwner: false,
      canManage: true,
      permissions: [],
    });
    const missing = f.host.context(f.event, {
      projectId: "missing-personal-project",
    });
    expect({ ...missing, projectId: "p1" }).toEqual(context);
    const setup = f.host.setup(f.event, { projectId: "p1", orgId: "org1" });
    expect(setup.members).toHaveLength(4);
    expect(JSON.stringify(setup)).not.toContain("Original task");
    expect(setup).not.toHaveProperty("project");
    expect(() => f.host.readTask(f.event, { taskId: "t1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });
  it("requires two actual identities and changes scope only after receiving native consent", async () => {
    const p = await consent();
    expect(p.status).toBe("pending");
    expect(binding()).toBeUndefined();
    const personal = new TaskDescriptionActionService({
      db: f.db,
      getActor: () => f.getActor(),
      approvalGate: {
        decide: () => {
          throw new Error("Unexpected execution");
        },
      },
      now: () => f.getNow(),
    });
    expect(personal.readTask("t1").description).toBe("Original task");
    await expect(
      f.host.acceptTransfer(f.event, { transferId: p.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    f.setActor(f.identities.owner);
    const result = await f.host.acceptTransfer(f.event, {
      transferId: p.transferId,
    });
    expect(result.status).toBe("bound");
    expect(binding()).toMatchObject({
      original_owner_did: f.identities.requester,
      bound_by_did: f.identities.owner,
      status: "active",
    });
    expect(
      f.db.prepare("SELECT user_id FROM projects WHERE id='p1'").get().user_id,
    ).toBe(f.identities.requester);
    expect(dialog).toHaveBeenCalledTimes(2);
    expect(dialog.mock.calls[0][1].detail).toContain(f.identities.requester);
    expect(dialog.mock.calls[1][1].detail).toContain(f.identities.owner);
    f.setActor(f.identities.requester);
    expect(() => personal.readTask("t1")).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
  });
  it("does not trust renderer replacement mapping or reader identities", async () => {
    const p = await consent();
    f.setActor(f.identities.owner);
    await expect(
      f.host.acceptTransfer(f.event, {
        transferId: p.transferId,
        orgId: "forged",
      }),
    ).rejects.toThrow("ORG_TRANSFER_INVALID_REQUEST");
    expect(binding()).toBeUndefined();
    f.setActor(f.identities.first);
    expect(f.host.listTransfers(f.event, { projectId: "p1" })).toEqual({
      transfers: [],
      nextCursor: null,
    });
    expect(() =>
      f.host.readTransfer(f.event, { transferId: p.transferId }),
    ).toThrow("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
  });
  it.each(["reauthenticate", "navigate"])(
    "rejects %s during recipient native confirmation",
    async (change) => {
      const p = await consent();
      f.setActor(f.identities.owner);
      dialog.mockImplementationOnce(async () => {
        if (change === "reauthenticate") f.setActor(f.identities.owner);
        else
          f.event.sender.emit(
            "did-start-navigation",
            {},
            "http://localhost:5173/other",
            false,
            true,
          );
        return { response: 1 };
      });
      await expect(
        f.host.acceptTransfer(f.event, { transferId: p.transferId }),
      ).rejects.toThrow(/ORG_AUTH_(IDENTITY_|WINDOW_)/);
      expect(binding()).toBeUndefined();
      expect(
        f.db
          .prepare("SELECT status FROM cc_organization_project_transfers")
          .get().status,
      ).toBe("pending");
    },
  );
  it("can recover the originator's terminal receipt even without post-binding task access", async () => {
    f.setActor(f.identities.owner);
    const setup = f.host.setup(f.event, { projectId: "p1", orgId: "org1" });
    const policy = {
      orgId: "org1",
      permissions: setup.policy.permissions.filter(
        (grant) => grant.actorDid !== f.identities.requester,
      ),
      workflowIds: setup.policy.workflows.map((pin) => pin.workflowId),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
    const p = await consent();
    f.setActor(f.identities.owner);
    await f.host.acceptTransfer(f.event, { transferId: p.transferId });
    f.setActor(f.identities.requester);
    expect(() => f.host.context(f.event, { projectId: "p1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    const recovered = f.host.readTransfer(f.event, {
      transferId: p.transferId,
    });
    expect(recovered).toMatchObject({
      status: "bound",
      terminalReceipt: { id: expect.any(String), digest: expect.any(String) },
    });
    expect(JSON.stringify(recovered)).not.toContain("Original task");
    expect(recovered).not.toHaveProperty("evidence");
  });
  it("rejects a task mutation between confirmations while allowing explicit withdrawal", async () => {
    const p = await consent();
    f.db
      .prepare(
        "UPDATE project_tasks SET description='Personal edit' WHERE id='t1'",
      )
      .run();
    f.setActor(f.identities.owner);
    await expect(
      f.host.acceptTransfer(f.event, { transferId: p.transferId }),
    ).rejects.toThrow("ORG_TRANSFER_VERSION_CONFLICT");
    expect(binding()).toBeUndefined();
    f.setActor(f.identities.requester);
    expect(
      (await f.host.cancelTransfer(f.event, { transferId: p.transferId }))
        .status,
    ).toBe("cancelled");
  });
});
