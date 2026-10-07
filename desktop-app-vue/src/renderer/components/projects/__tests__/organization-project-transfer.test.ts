import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import OrganizationProjectWorkbench from "../OrganizationProjectWorkbench.vue";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("../../../../main/task/__tests__/fixtures/organization-project-host-fixture.cjs");
describe("dual-principal transfer UI with native host and SQLite", () => {
  let f: any, wrapper: VueWrapper<any>, api: any, dialog: any, login: number;
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    vi.spyOn(Date, "now").mockImplementation(() => f.getNow());
    await f.setup({ bind: false });
    f.db
      .prepare("UPDATE projects SET user_id=? WHERE id='p1'")
      .run(f.identities.requester);
    f.setActor(f.identities.requester);
    login = 0;
    dialog.mockClear();
    api = Object.fromEntries(
      Object.keys(f.host).map((method) => [
        method,
        vi.fn(async (input: any) =>
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
  async function prepare() {
    await wrapper.get('[data-testid="transfer-organization"]').setValue("org1");
    await wrapper.get('[data-testid="transfer-target"]').setValue("op1");
    await wrapper.get('[data-testid="preview-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="transfer-preview"]').text()).toContain(
      f.identities.owner,
    );
    expect(wrapper.get('[data-testid="transfer-preview"]').text()).toContain(
      "查看任务与提议",
    );
  }
  async function submit() {
    await prepare();
    await wrapper.get('[data-testid="submit-transfer"]').trigger("click");
    await flushPromises();
    return f.db
      .prepare("SELECT id FROM cc_organization_project_transfers")
      .get().id;
  }
  async function select(id: string) {
    await wrapper.get(`[data-transfer-id="${id}"]`).trigger("click");
    await flushPromises();
  }
  it("completes native consent and receipt across actual owners, with no task access before reception", async () => {
    await open();
    const id = await submit();
    expect(wrapper.text()).toContain("等待组织所有者接收");
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_bindings")
        .get().n,
    ).toBe(0);
    expect(wrapper.find('[data-testid="accept-transfer"]').exists()).toBe(
      false,
    );
    await switchActor(f.identities.owner);
    expect(wrapper.text()).not.toContain("Original task");
    await wrapper.get('[data-testid="setup-organization"]').setValue("org1");
    await flushPromises();
    expect(wrapper.find('[data-testid="bind-project"]').exists()).toBe(false);
    await select(id);
    await wrapper.get('[data-testid="accept-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
      "迁移已完成",
    );
    expect(wrapper.text()).toContain("Original task");
    expect(api.acceptTransfer).toHaveBeenCalledWith({ transferId: id });
    expect(dialog).toHaveBeenCalledTimes(2);
  });
  it("clears private task content when a migrated recipient's task read loses authority", async () => {
    await open();
    const id = await submit();
    await switchActor(f.identities.owner);
    await select(id);
    await wrapper.get('[data-testid="accept-transfer"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    expect(
      (
        wrapper.get('[data-testid="organization-description"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("Original task");
    f.db
      .prepare(
        "UPDATE organization_members SET status='removed' WHERE member_did=?",
      )
      .run(f.identities.owner);
    await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Original task");
    expect(
      wrapper.find('[data-testid="organization-description"]').exists(),
    ).toBe(false);
    expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
      "迁移已完成",
    );
  });
  it("reads the originator's receipt after migration even when ordinary organization context is denied", async () => {
    f.setActor(f.identities.owner);
    const setup = f.host.setup(f.event, { projectId: "p1", orgId: "org1" });
    const policy = {
      orgId: "org1",
      permissions: setup.policy.permissions.filter(
        (grant: any) => grant.actorDid !== f.identities.requester,
      ),
      workflowIds: setup.policy.workflows.map((pin: any) => pin.workflowId),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
    await open();
    const id = await submit();
    await switchActor(f.identities.owner);
    await select(id);
    await wrapper.get('[data-testid="accept-transfer"]').trigger("click");
    await flushPromises();
    await switchActor(f.identities.requester);
    await select(id);
    expect(wrapper.text()).not.toContain("Original task");
    expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
      "迁移已完成",
    );
    expect(wrapper.find('[data-testid="accept-transfer"]').exists()).toBe(
      false,
    );
  });
  it("recovers a lost consent reply through the fixed digest without resubmitting", async () => {
    api.submitTransfer.mockImplementationOnce(async (input: any) => {
      await f.host.submitTransfer(f.event, structuredClone(input));
      throw new Error("Reply lost");
    });
    await open();
    await prepare();
    await wrapper.get('[data-testid="submit-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("转出确认结果待核实");
    await wrapper.get('[data-testid="refresh-transfers"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("转出确认结果待核实");
    expect(wrapper.get('[data-testid="transfer-detail"]').text()).toContain(
      "等待组织所有者接收",
    );
    expect(api.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost reception reply by reading its terminal receipt", async () => {
    await open();
    const id = await submit();
    await switchActor(f.identities.owner);
    await select(id);
    api.acceptTransfer.mockImplementationOnce(async (input: any) => {
      await f.host.acceptTransfer(f.event, input);
      throw new Error("Reply lost");
    });
    await wrapper.get('[data-testid="accept-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("接收结果待核实");
    await wrapper.get('[data-testid="read-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("接收结果待核实");
    expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
      "迁移已完成",
    );
    expect(api.acceptTransfer).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Original task");
  });
  it.each(["cancel", "reject"])(
    "handles %s without changing personal ownership or creating a binding",
    async (decision) => {
      await open();
      const id = await submit();
      if (decision === "reject") {
        await switchActor(f.identities.owner);
        await select(id);
      }
      await wrapper
        .get(`[data-testid="${decision}-transfer"]`)
        .trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
        decision === "cancel" ? "已撤回" : "已拒绝接收",
      );
      expect(
        f.db
          .prepare("SELECT count(*) AS n FROM cc_organization_project_bindings")
          .get().n,
      ).toBe(0);
      expect(
        f.db.prepare("SELECT user_id FROM projects WHERE id='p1'").get()
          .user_id,
      ).toBe(f.identities.requester);
    },
  );
  it("retains the recipient's rejection and metadata after acceptance detects a stale policy", async () => {
    await open();
    const id = await submit();
    await switchActor(f.identities.owner);
    await select(id);
    f.db
      .prepare(
        "UPDATE organization_members SET display_name='Changed' WHERE member_did=?",
      )
      .run(f.identities.first);
    await wrapper.get('[data-testid="accept-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="transfer-detail"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="accept-transfer"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="reject-transfer"]').exists()).toBe(true);
    await wrapper.get('[data-testid="reject-transfer"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="transfer-receipt"]').text()).toContain(
      "已拒绝接收",
    );
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_bindings")
        .get().n,
    ).toBe(0);
  });
  it("does not restore a delayed prior-identity metadata reply", async () => {
    await open();
    const id = await submit();
    let release: any;
    api.readTransfer.mockImplementationOnce(async (input: any) => {
      const result = structuredClone(f.host.readTransfer(f.event, input));
      return new Promise((resolve) => {
        release = () => resolve(result);
      });
    });
    await wrapper.get(`[data-transfer-id="${id}"]`).trigger("click");
    await flushPromises();
    await switchActor(f.identities.first);
    release();
    await flushPromises();
    expect(wrapper.find('[data-testid="transfer-detail"]').exists()).toBe(
      false,
    );
  });
  it.each(["readTransfer", "previewTransfer"])(
    "invalidates a delayed %s reply when the parent loses its trusted session without a prop change",
    async (method) => {
      await open();
      const id = method === "readTransfer" ? await submit() : "";
      let release: any;
      api[method].mockImplementationOnce(async (input: any) => {
        const result = structuredClone(
          await f.host[method](f.event, structuredClone(input)),
        );
        return new Promise((resolve) => {
          release = () => resolve(result);
        });
      });
      if (method === "readTransfer")
        await wrapper.get(`[data-transfer-id="${id}"]`).trigger("click");
      else {
        await wrapper
          .get('[data-testid="transfer-organization"]')
          .setValue("org1");
        await wrapper.get('[data-testid="transfer-target"]').setValue("op1");
        await wrapper.get('[data-testid="preview-transfer"]').trigger("click");
      }
      await flushPromises();
      f.setTrusted(false);
      await wrapper
        .get('[data-testid="refresh-organization"]')
        .trigger("click");
      await flushPromises();
      release();
      await flushPromises();
      expect(wrapper.find('[data-testid="transfer-detail"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-testid="transfer-preview"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-testid="transfer-organization"]').exists(),
      ).toBe(false);
      f.setTrusted(true);
      await wrapper.get('[data-testid="refresh-transfers"]').trigger("click");
      await flushPromises();
      expect(
        wrapper.find('[data-testid="transfer-organization"]').exists(),
      ).toBe(true);
    },
  );
  it("disables reception when the fixed deadline passes while the view remains open", async () => {
    await open();
    const id = await submit();
    await switchActor(f.identities.owner);
    await select(id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Re-read under fake timer ownership before advancing its fixed deadline.
    await wrapper.get('[data-testid="read-transfer"]').trigger("click");
    await flushPromises();
    const expiry = f.db
      .prepare("SELECT expires_at FROM cc_organization_project_transfers")
      .get().expires_at;
    f.setNow(expiry);
    await vi.advanceTimersByTimeAsync(expiry - 1000);
    await flushPromises();
    expect(wrapper.get('[data-testid="transfer-detail"]').text()).toContain(
      "已过期",
    );
    expect(wrapper.find('[data-testid="accept-transfer"]').exists()).toBe(
      false,
    );
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_bindings")
        .get().n,
    ).toBe(0);
  });
});
