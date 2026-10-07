import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import OrganizationProjectWorkbench from "../OrganizationProjectWorkbench.vue";
import OrganizationProjectSetup from "../OrganizationProjectSetup.vue";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("../../../../main/task/__tests__/fixtures/organization-project-host-fixture.cjs");
describe("organization workbench with native host, stored requests and SQLite", () => {
  let f: any, wrapper: VueWrapper<any>, dialog: any, api: any;
  let login = 0;
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    vi.spyOn(Date, "now").mockImplementation(() => f.getNow());
    await f.setup();
    dialog.mockClear();
    f.setActor(f.identities.requester);
    login = 0;
    api = Object.fromEntries(
      Object.keys(f.host).map((method) => [
        method,
        vi.fn(async (input: unknown) =>
          structuredClone(
            await f.host[method](f.event, structuredClone(input)),
          ),
        ),
      ]),
    );
    (window as any).electronAPI = { organizationProject: api };
  });
  afterEach(() => {
    wrapper?.unmount();
    f.db.close();
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function open() {
    wrapper = mount(OrganizationProjectWorkbench, {
      props: { open: true, projectId: "p1", identityKey: f.getActor() },
      global: {
        stubs: {
          "a-drawer": {
            props: ["open"],
            template: '<div v-if="open"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();
  }
  async function switchActor(actor: string) {
    f.setActor(actor);
    await wrapper.setProps({ identityKey: `${actor}:${++login}` });
    await flushPromises();
  }
  async function prepare(create = false) {
    if (create)
      await wrapper.get('[data-testid="proposal-kind"]').setValue("create");
    else await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-description"]')
      .setValue(
        create ? "New organization task" : "Reviewed organization content",
      );
    await wrapper
      .get('[data-testid="preview-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-proposal-preview"]').exists(),
    ).toBe(true);
  }
  async function submit(create = false) {
    await prepare(create);
    await wrapper
      .get('[data-testid="submit-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    return f.db
      .prepare(
        "SELECT id FROM cc_organization_project_proposals ORDER BY created_at DESC LIMIT 1",
      )
      .get().id;
  }
  async function approve(id: string) {
    for (const actor of [f.identities.first, f.identities.second]) {
      await switchActor(actor);
      await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
      await flushPromises();
      expect(
        wrapper.get('[data-testid="stored-proposal-body"]').text(),
      ).toMatch(/organization/);
      await wrapper
        .get('[data-testid="approve-organization-proposal"]')
        .trigger("click");
      await flushPromises();
    }
    await switchActor(f.identities.requester);
    await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
    await flushPromises();
  }
  function body() {
    return f.db
      .prepare("SELECT description FROM project_tasks WHERE id='t1'")
      .get().description;
  }
  it("submits content without applying it, reviews across identities and commits the approved edit", async () => {
    await open();
    expect(wrapper.text()).toContain("Original task");
    const id = await submit();
    expect(body()).toBe("Original task");
    await approve(id);
    await wrapper
      .get('[data-testid="execute-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(body()).toBe("Reviewed organization content");
    expect(
      wrapper.get('[data-testid="organization-action-receipt"]').text(),
    ).toContain("修改已完成");
    expect(
      wrapper.find('[data-testid="execute-organization-proposal"]').exists(),
    ).toBe(false);
    expect(dialog).toHaveBeenCalledTimes(3);
    expect(api.executeProposal).toHaveBeenCalledWith({ proposalId: id });
  });
  it("creates a canonical pending task and never runs the selected task type", async () => {
    await open();
    const id = await submit(true);
    expect(
      f.db.prepare("SELECT count(*) AS n FROM project_tasks").get().n,
    ).toBe(1);
    await approve(id);
    await wrapper
      .get('[data-testid="execute-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(
      f.db
        .prepare("SELECT description,status FROM project_tasks WHERE id<>'t1'")
        .get(),
    ).toEqual({ description: "New organization task", status: "pending" });
    expect(wrapper.text()).toContain("New organization task");
  });
  it("offers no write editor to a read-only reviewer and rejects their refusal without mutating the task", async () => {
    await open();
    const id = await submit();
    await switchActor(f.identities.first);
    expect(
      wrapper.find('[data-testid="organization-description"]').exists(),
    ).toBe(false);
    await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="reject-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已拒绝");
    expect(wrapper.find('[data-testid="stored-proposal-body"]').exists()).toBe(
      false,
    );
    expect(body()).toBe("Original task");
  });
  it("reloads a persisted proposal after close without a new submission or lost body", async () => {
    await open();
    const id = await submit();
    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();
    await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="stored-proposal-body"]').text()).toBe(
      "Reviewed organization content",
    );
    expect(api.submitProposal).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost submit reply from metadata instead of issuing another submission", async () => {
    api.submitProposal.mockImplementationOnce(async (input: any) => {
      f.host.submitProposal(f.event, structuredClone(input));
      throw new Error("IPC reply lost");
    });
    await open();
    await prepare();
    await wrapper
      .get('[data-testid="submit-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("提交结果待核实");
    await wrapper
      .get('[data-testid="refresh-organization-proposals"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("提交结果待核实");
    expect(wrapper.get('[data-testid="stored-proposal-body"]').text()).toBe(
      "Reviewed organization content",
    );
    expect(api.submitProposal).toHaveBeenCalledTimes(1);
  });
  it("recovers a committed write with a lost reply by reading its receipt", async () => {
    await open();
    const id = await submit();
    await approve(id);
    api.executeProposal.mockImplementationOnce(async (input: any) => {
      await f.host.executeProposal(f.event, input);
      throw new Error("IPC reply lost");
    });
    await wrapper
      .get('[data-testid="execute-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("执行结果待核实");
    expect(body()).toBe("Reviewed organization content");
    await wrapper
      .get('[data-testid="refresh-selected-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("执行结果待核实");
    expect(
      wrapper.get('[data-testid="organization-action-receipt"]').text(),
    ).toContain("修改已完成");
    expect(api.executeProposal).toHaveBeenCalledTimes(1);
  });
  it("preserves lost-submit correlation through a full organization refresh", async () => {
    api.submitProposal.mockImplementationOnce(async (input: any) => {
      f.host.submitProposal(f.event, structuredClone(input));
      throw new Error("IPC reply lost");
    });
    await open();
    await prepare();
    await wrapper
      .get('[data-testid="submit-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("提交结果待核实");

    await wrapper.get('[data-testid="refresh-organization"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("提交结果待核实");
    expect(wrapper.get('[data-testid="stored-proposal-body"]').text()).toBe(
      "Reviewed organization content",
    );
    expect(api.submitProposal).toHaveBeenCalledTimes(1);
    expect(api.previewDescription).toHaveBeenCalledTimes(1);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(1);
  });
  it("retains native execution cancellation and reads it after reopening", async () => {
    await open();
    const id = await submit();
    await approve(id);
    dialog.mockResolvedValueOnce({ response: 0 });
    await wrapper
      .get('[data-testid="execute-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(body()).toBe("Original task");
    expect(
      wrapper.get('[data-testid="organization-action-receipt"]').text(),
    ).toContain("已取消");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
    await flushPromises();
    expect(
      wrapper.get('[data-testid="organization-action-receipt"]').text(),
    ).toContain("已取消");
    expect(
      wrapper.find('[data-testid="execute-organization-proposal"]').exists(),
    ).toBe(false);
  });
  it("cancels a pending proposal while keeping the task and metadata history", async () => {
    await open();
    const id = await submit();
    await wrapper
      .get('[data-testid="cancel-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已取消");
    expect(body()).toBe("Original task");
    expect(wrapper.find('[data-testid="stored-proposal-body"]').exists()).toBe(
      false,
    );
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_proposals WHERE id=?",
        )
        .get(id).n,
    ).toBe(1);
  });
  it("does not restore a late private proposal reply after leaving its project", async () => {
    await open();
    const id = await submit();
    let release: any;
    api.readProposal.mockImplementationOnce(async (input: any) => {
      const value = structuredClone(f.host.readProposal(f.event, input));
      return new Promise((resolve) => {
        release = () => resolve(value);
      });
    });
    await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
    await flushPromises();
    await wrapper.setProps({ projectId: "other-project" });
    await flushPromises();
    release();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Reviewed organization content");
    expect(
      wrapper.find('[data-testid="organization-proposal-detail"]').exists(),
    ).toBe(false);
  });
  it("clears task and proposal content when the caller loses current read authority", async () => {
    await open();
    await submit();
    f.db
      .prepare(
        "UPDATE organization_members SET status='removed' WHERE member_did=?",
      )
      .run(f.identities.requester);
    await wrapper
      .get('[data-testid="refresh-organization-proposals"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Reviewed organization content");
    expect(wrapper.text()).not.toContain("Original task");
  });
  it("disables approval and execution after the proposal content expires", async () => {
    await open();
    const id = await submit();
    const deadline = f.db
      .prepare(
        "SELECT expires_at FROM cc_organization_project_proposals WHERE id=?",
      )
      .get(id).expires_at;
    f.setNow(deadline);
    await wrapper
      .get('[data-testid="refresh-selected-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已过期");
    expect(wrapper.find('[data-testid="stored-proposal-body"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="execute-organization-proposal"]').exists(),
    ).toBe(false);
  });
  it.each(["requester", "first"])(
    "removes expired proposal content and cached input for idle %s",
    async (actor) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await open();
      const id = await submit();
      if (actor === "first") await switchActor(f.identities.first);
      await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
      await flushPromises();
      expect(
        wrapper.find('[data-testid="stored-proposal-body"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-testid="approve-organization-proposal"]').exists(),
      ).toBe(actor === "first");
      if (actor === "requester") {
        const editor = wrapper.get('[data-testid="organization-description"]')
          .element as HTMLTextAreaElement;
        expect(editor.disabled).toBe(true);
        expect(editor.value).toBe("Reviewed organization content");
      }
      const deadline = f.db
        .prepare(
          "SELECT expires_at FROM cc_organization_project_proposals WHERE id=?",
        )
        .get(id).expires_at;
      const elapsed = deadline - f.getNow();
      const reads = api.readProposal.mock.calls.length;

      f.setNow(deadline);
      await vi.advanceTimersByTimeAsync(elapsed);
      await flushPromises();

      expect(
        wrapper.find('[data-testid="stored-proposal-body"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-testid="approve-organization-proposal"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-testid="reject-organization-proposal"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain("Reviewed organization content");
      if (actor === "requester") {
        const editor = wrapper.get('[data-testid="organization-description"]')
          .element as HTMLTextAreaElement;
        expect(editor.disabled).toBe(true);
        expect(editor.value).toBe("");
      }
      expect(api.respondProposal).not.toHaveBeenCalled();
      expect(api.executeProposal).not.toHaveBeenCalled();
      expect(api.readProposal).toHaveBeenCalledTimes(reads);
      expect(body()).toBe("Original task");
    },
  );
  it.each(["preview-policy", "save-workflow"])(
    "clears owner setup and proposal content when %s discovers revoked membership",
    async (operation) => {
      f.setActor(f.identities.owner);
      await open();
      await submit();
      const setup = wrapper.findComponent(OrganizationProjectSetup);
      await setup
        .get('[data-testid="workflow-name"]')
        .setValue("Owner-only review draft");
      await setup
        .get('[data-testid="workflow-step-0"]')
        .setValue([f.identities.first]);
      await setup
        .get('[data-testid="workflow-step-1"]')
        .setValue([f.identities.second]);
      await setup.get('[data-testid="preview-policy"]').trigger("click");
      await flushPromises();
      expect(setup.findAll('[data-testid="policy-grant"]')).toHaveLength(4);
      expect(setup.find('[data-testid="policy-preview"]').exists()).toBe(true);
      expect(setup.text()).toContain("requester");
      expect(wrapper.get('[data-testid="stored-proposal-body"]').text()).toBe(
        "Reviewed organization content",
      );
      const workflowCount = f.db
        .prepare("SELECT count(*) AS n FROM approval_workflows")
        .get().n;
      f.db
        .prepare(
          "UPDATE organization_members SET status='removed' WHERE member_did=?",
        )
        .run(f.identities.owner);

      await setup.get(`[data-testid="${operation}"]`).trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-testid="organization-project-setup"]').exists(),
      ).toBe(false);
      expect(wrapper.find('[data-testid="policy-preview"]').exists()).toBe(
        false,
      );
      expect(wrapper.findAll('[data-testid="policy-grant"]')).toHaveLength(0);
      expect(
        wrapper.find('[data-testid="stored-proposal-body"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain("Reviewed organization content");
      expect(wrapper.text()).not.toContain("Original task");
      expect(wrapper.text()).not.toContain(f.identities.first);
      expect(wrapper.text()).not.toContain(f.identities.requester);
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(body()).toBe("Original task");
      expect(
        f.db.prepare("SELECT count(*) AS n FROM approval_workflows").get().n,
      ).toBe(workflowCount);
    },
  );
  it.each([
    [
      "ORG_AUTH_SCOPE_CONFLICT",
      "INSERT INTO workspace_resources VALUES('other-workspace','project','p1')",
    ],
    [
      "ORG_AUTH_POLICY_REQUIRED",
      "DELETE FROM cc_organization_project_policies WHERE org_id='org1'",
    ],
  ])(
    "clears retained bodies after a real %s read denial",
    async (code, sql) => {
      await open();
      await submit();
      expect(wrapper.get('[data-testid="stored-proposal-body"]').text()).toBe(
        "Reviewed organization content",
      );
      f.db.exec(sql);
      expect(() => f.host.listProposals(f.event, { projectId: "p1" })).toThrow(
        code,
      );

      await wrapper
        .get('[data-testid="refresh-organization-proposals"]')
        .trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-testid="stored-proposal-body"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-testid="organization-description"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain("Reviewed organization content");
      expect(wrapper.text()).not.toContain("Original task");
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(body()).toBe("Original task");
    },
  );
  it("configures and binds an unbound project through owner workflow, explicit grants and native consent", async () => {
    f.db.close();
    f = organizationProjectFixture(dialog);
    dialog.mockClear();
    await open();
    expect(wrapper.find('[data-task-id="t1"]').exists()).toBe(false);
    expect(f.host.context(f.event, { projectId: "p1" }).mode).toBe("unbound");
    let setup = wrapper.findComponent(OrganizationProjectSetup);
    await setup.get('[data-testid="setup-organization"]').setValue("org1");
    await flushPromises();
    expect(setup.findAll('[data-testid="policy-grant"]')).toHaveLength(0);
    await setup
      .get('[data-testid="workflow-name"]')
      .setValue("Owner-approved review");
    await setup
      .get('[data-testid="workflow-step-0"]')
      .setValue([f.identities.first]);
    await setup
      .get('[data-testid="workflow-step-1"]')
      .setValue([f.identities.second]);
    await setup.get('[data-testid="save-workflow"]').trigger("click");
    await flushPromises();
    expect(setup.text()).toContain("Owner-approved review");
    const workflow = f.db
      .prepare("SELECT id,approvers FROM approval_workflows")
      .get();
    expect(workflow).toBeTruthy();

    const expectedGrants = [
      {
        actorDid: f.identities.owner,
        permissions: ["task.read", "task.update-description"],
      },
      {
        actorDid: f.identities.first,
        permissions: ["task.read", "task.approve"],
      },
      {
        actorDid: f.identities.second,
        permissions: ["task.read", "task.approve"],
      },
    ];
    for (const [index, grant] of expectedGrants.entries()) {
      await setup.get('[data-testid="add-policy-grant"]').trigger("click");
      const row = setup.findAll('[data-testid="policy-grant"]')[index];
      await row.get("select").setValue(grant.actorDid);
      for (const permission of grant.permissions)
        await row
          .get(`input[type="checkbox"][value="${permission}"]`)
          .setValue(true);
    }
    await setup.get('[data-testid="preview-policy"]').trigger("click");
    await flushPromises();
    expect(setup.find('[data-testid="policy-preview"]').exists()).toBe(true);
    const policyInput = api.previewPolicy.mock.calls.at(-1)[0];
    expect(policyInput.workflowIds).toEqual([workflow.id]);
    expect(policyInput.permissions).toEqual(
      expectedGrants.map((grant) => ({
        ...grant,
        projectId: "p1",
        expiresAt: expect.any(Number),
      })),
    );
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_policies")
        .get().n,
    ).toBe(0);
    await setup.get('[data-testid="attest-policy"]').trigger("click");
    await flushPromises();
    expect(api.attestPolicy).toHaveBeenCalledTimes(1);
    const persisted = f.host.setup(f.event, { projectId: "p1", orgId: "org1" });
    expect(persisted.policyState).toBe("current");
    expect(persisted.policy.permissions).toHaveLength(
      policyInput.permissions.length,
    );
    for (const grant of policyInput.permissions) {
      const saved = persisted.policy.permissions.find(
        (entry: any) => entry.actorDid === grant.actorDid,
      );
      expect(saved).toEqual({
        ...grant,
        permissions: expect.arrayContaining(grant.permissions),
      });
      expect(saved.permissions).toHaveLength(grant.permissions.length);
    }
    expect(f.host.context(f.event, { projectId: "p1" }).mode).toBe("unbound");

    setup = wrapper.findComponent(OrganizationProjectSetup);
    expect(
      (
        setup.get('[data-testid="setup-organization"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("org1");
    await setup.get('[data-testid="binding-project"]').setValue("op1");
    await setup.get('[data-testid="bind-project"]').trigger("click");
    await flushPromises();

    const context = f.host.context(f.event, { projectId: "p1" });
    expect(context.mode).toBe("organization");
    expect(context.binding).toMatchObject({
      orgId: "org1",
      organizationProjectId: "op1",
      status: "active",
    });
    expect(context.permissions).toEqual(expectedGrants[0].permissions);
    expect(wrapper.get('[data-task-id="t1"]').text()).toContain(
      "Original task",
    );
    expect(api.configureWorkflow).toHaveBeenCalledTimes(1);
    expect(api.bindProject).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveBeenCalledTimes(3);
    expect(body()).toBe("Original task");
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_requests").get().n,
    ).toBe(0);
  });
  it("preserves both newly created workflow selections when the owner configures consecutive plans", async () => {
    f.setActor(f.identities.owner);
    await open();
    const setup = wrapper.findComponent(OrganizationProjectSetup);
    await setup
      .get('[data-testid="workflow-name"]')
      .setValue("Additional review 1");
    await setup
      .get('[data-testid="workflow-step-0"]')
      .setValue([f.identities.first]);
    await setup
      .get('[data-testid="workflow-step-1"]')
      .setValue([f.identities.second]);
    await setup.get('[data-testid="save-workflow"]').trigger("click");
    await flushPromises();
    await setup
      .get('[data-testid="workflow-name"]')
      .setValue("Additional review 2");
    await setup.get('[data-testid="workflow-action"]').setValue("task.create");
    await setup.get('[data-testid="save-workflow"]').trigger("click");
    await flushPromises();
    await setup.get('[data-testid="preview-policy"]').trigger("click");
    await flushPromises();
    const input = api.previewPolicy.mock.calls.at(-1)[0];
    expect(input.workflowIds).toHaveLength(4);
    expect(new Set(input.workflowIds).size).toBe(4);
    expect(input.permissions).toHaveLength(4);
    expect(setup.find('[data-testid="policy-preview"]').exists()).toBe(true);
  });
});
