import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Panel from "../ProjectGoalDraftImportsPanel.vue";
const goal = {
  id: "g1",
  storeId: "store",
  revision: 2,
  controlGeneration: 1,
  status: "active",
};
const entry = {
  id: "adoption-1",
  title: "Draft",
  requestId: "stable",
  enabled: true,
  epoch: 1,
  available: true,
  state: "saved",
  declaredPlugin: { name: "drafter", scope: "project", version: "0.1.0" },
};
let api: any;
beforeEach(() => {
  api = {
    listGoalDraftImports: vi.fn(async () => ({
      entries: [entry],
      nextCursor: null,
    })),
    importGoalDraftRequest: vi.fn(async () => entry),
    readGoalDraftImport: vi.fn(async () => ({
      ...entry,
      draft: { proposal: { description: "<script>inert</script>" } },
    })),
    prepareGoalDraftImport: vi.fn(async () => ({ intent: { id: "intent-1" } })),
    revokeGoalDraftImport: vi.fn(async () => ({
      ...entry,
      state: "revoked",
      enabled: false,
      epoch: 2,
    })),
  };
  (window as any).electronAPI = { project: api };
});
const create = () =>
  mount(Panel, {
    props: {
      goal,
      identityKey: "actor-1",
      sourceRefs: ["goal-proposal-native"],
    },
  });
describe("native adoption panel", () => {
  it("uses the native picker endpoint without renderer paths or plugin authority", async () => {
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="import-draft-request"]').trigger("click");
    await flushPromises();
    expect(api.importGoalDraftRequest).toHaveBeenCalledWith({
      goalRef: {
        id: "g1",
        storeId: "store",
        revision: 2,
        controlGeneration: 1,
      },
    });
    expect(wrapper.find("input[readonly]").element.getAttribute("value")).toBe(
      "goal-proposal-native",
    );
    wrapper.unmount();
  });
  it("renders imported content as text and prepares only the saved adoption id", async () => {
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="read-imported-draft"]').trigger("click");
    await flushPromises();
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>inert</script>");
    await wrapper
      .get('[data-testid="prepare-imported-draft"]')
      .trigger("click");
    await flushPromises();
    expect(api.prepareGoalDraftImport).toHaveBeenCalledWith({
      goalRef: {
        id: "g1",
        storeId: "store",
        revision: 2,
        controlGeneration: 1,
      },
      id: "adoption-1",
    });
    expect(wrapper.emitted("intent-prepared")).toHaveLength(1);
    wrapper.unmount();
  });
  it("invalidates prior previews immediately when revoking even if the response is lost", async () => {
    api.revokeGoalDraftImport.mockRejectedValue(new Error("response lost"));
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="revoke-imported-draft"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("extension-invalidated")?.length).toBeGreaterThan(0);
    expect(api.revokeGoalDraftImport).toHaveBeenCalledWith({
      goalRef: {
        id: "g1",
        storeId: "store",
        revision: 2,
        controlGeneration: 1,
      },
      id: "adoption-1",
      expectedEpoch: 1,
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    wrapper.unmount();
  });
  it("discards a late read after actor or goal changes", async () => {
    let finish: any;
    api.readGoalDraftImport.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="read-imported-draft"]').trigger("click");
    await wrapper.setProps({ identityKey: "actor-2" });
    await flushPromises();
    finish({ ...entry, draft: { proposal: { description: "OLD PRIVATE" } } });
    await flushPromises();
    expect(wrapper.text()).not.toContain("OLD PRIVATE");
    wrapper.unmount();
  });
  it("keeps unavailable historical records visible but disables continuation", async () => {
    api.listGoalDraftImports.mockResolvedValue({
      entries: [{ ...entry, available: false }],
      nextCursor: null,
    });
    const wrapper = create();
    await flushPromises();
    expect(wrapper.text()).toContain("此前已保存，当前来源不可继续");
    expect(
      wrapper.get('[data-testid="read-imported-draft"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper
        .get('[data-testid="revoke-imported-draft"]')
        .attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });
  it("clears an already displayed body when the risk source fingerprint changes", async () => {
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="read-imported-draft"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="imported-draft-body"]').exists()).toBe(
      true,
    );
    await wrapper.setProps({ sourceKey: "new-review" });
    await flushPromises();
    expect(wrapper.find('[data-testid="imported-draft-body"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
  it("clears stale records when refreshing fails", async () => {
    const wrapper = create();
    await flushPromises();
    api.listGoalDraftImports.mockRejectedValue(new Error("unavailable"));
    await wrapper.get('[data-testid="refresh-draft-imports"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll("article")).toHaveLength(0);
    wrapper.unmount();
  });
  it("invalidates the parent preview before a prepare request and on its unknown failure", async () => {
    api.prepareGoalDraftImport.mockRejectedValue(new Error("response lost"));
    const wrapper = create();
    await flushPromises();
    await wrapper.get('[data-testid="read-imported-draft"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="prepare-imported-draft"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.emitted("extension-invalidated")?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(wrapper.emitted("intent-prepared")).toBeUndefined();
    expect(wrapper.find('[data-testid="imported-draft-body"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
});
