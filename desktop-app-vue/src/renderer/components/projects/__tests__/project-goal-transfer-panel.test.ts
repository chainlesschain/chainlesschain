import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Panel from "../ProjectGoalTransferPanel.vue";
function row(projectId = "p1", state = "prepared") {
  return {
    target: { id: "t1", projectRef: { id: projectId }, ownerRef: "did:owner" },
    state,
    source: null,
    goalRef: null,
  };
}
describe("project goal transfer native UI", () => {
  let api: any, wrapper: any;
  beforeEach(() => {
    api = {
      listGoalTransfers: vi.fn(async () => [row()]),
      exportGoalTransferTarget: vi.fn(async () => row()),
      importGoalTransfer: vi.fn(async () => row("p1", "imported")),
      cancelGoalTransfer: vi.fn(async () => row("p1", "cancelled")),
    };
    (window as any).electronAPI = { project: api };
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });
  const render = async () => {
    wrapper = mount(Panel, { props: { projectId: "p1", identityKey: "a" } });
    await flushPromises();
  };
  it("delegates paths, source content and decisions to native dialogs", async () => {
    await render();
    await wrapper.get('[data-testid="goal-transfer-target"]').trigger("click");
    await flushPromises();
    expect(api.exportGoalTransferTarget).toHaveBeenCalledWith({
      projectId: "p1",
    });
    await wrapper.get('[data-testid="goal-transfer-import"]').trigger("click");
    await flushPromises();
    expect(api.importGoalTransfer).toHaveBeenCalledWith({ projectId: "p1" });
    expect(wrapper.emitted("changed")).toHaveLength(1);
    await wrapper.get('[data-testid="goal-transfer-cancel"]').trigger("click");
    await flushPromises();
    expect(api.cancelGoalTransfer).toHaveBeenCalledWith({
      projectId: "p1",
      targetId: "t1",
    });
    expect(wrapper.text()).toContain("签名回退回执已保存");
  });
  it("does not claim success after a cancelled native picker", async () => {
    api.importGoalTransfer.mockResolvedValue({ state: "cancelled" });
    await render();
    await wrapper.get('[data-testid="goal-transfer-import"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
  it("retains no stale record or success on native write/readback failure", async () => {
    api.importGoalTransfer.mockRejectedValue(new Error("unknown result"));
    await render();
    await wrapper.get('[data-testid="goal-transfer-import"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("t1");
    expect(wrapper.get('[role="alert"]').text()).toContain("刷新同一移交记录");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
  it.each(["projectId", "identityKey"])(
    "discards a delayed old %s result without unlocking a new operation",
    async (key) => {
      await render();
      let oldResolve: any, newResolve: any;
      api.importGoalTransfer.mockImplementation(
        () =>
          new Promise((resolve) => {
            oldResolve = resolve;
          }),
      );
      await wrapper
        .get('[data-testid="goal-transfer-import"]')
        .trigger("click");
      api.listGoalTransfers.mockImplementation(
        () =>
          new Promise((resolve) => {
            newResolve = resolve;
          }),
      );
      await wrapper.setProps({ [key]: key === "projectId" ? "p2" : "b" });
      oldResolve(row("p1", "imported"));
      await flushPromises();
      expect(wrapper.text()).not.toContain("移交记录已核实");
      expect(wrapper.emitted("changed")).toBeUndefined();
      expect(
        wrapper
          .get('[data-testid="goal-transfer-import"]')
          .attributes("disabled"),
      ).toBeDefined();
      newResolve([row(key === "projectId" ? "p2" : "p1")]);
      await flushPromises();
      expect(
        wrapper
          .get('[data-testid="goal-transfer-import"]')
          .attributes("disabled"),
      ).toBeUndefined();
    },
  );
  it("drops an old list page after project switching", async () => {
    let oldResolve: any;
    api.listGoalTransfers.mockImplementationOnce(
      () =>
        new Promise((r) => {
          oldResolve = r;
        }),
    );
    wrapper = mount(Panel, { props: { projectId: "p1", identityKey: "a" } });
    api.listGoalTransfers.mockResolvedValue([row("p2")]);
    await wrapper.setProps({ projectId: "p2" });
    await flushPromises();
    oldResolve([
      { ...row(), target: { ...row().target, id: "stale-secret-id" } },
    ]);
    await flushPromises();
    expect(wrapper.text()).not.toContain("stale-secret-id");
  });
  it("rejects a different project's returned descriptor and clears old records", async () => {
    api.importGoalTransfer.mockResolvedValue(row("p2", "imported"));
    await render();
    await wrapper.get('[data-testid="goal-transfer-import"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("尚未核实");
    expect(wrapper.text()).not.toContain("t1");
  });
  it("bounds each explicit list page to twenty records", async () => {
    api.listGoalTransfers.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        ...row(),
        target: { ...row().target, id: `t${i}` },
      })),
    );
    await render();
    api.listGoalTransfers.mockResolvedValue([row()]);
    await wrapper.get('[data-testid="goal-transfer-more"]').trigger("click");
    await flushPromises();
    expect(api.listGoalTransfers).toHaveBeenLastCalledWith({
      projectId: "p1",
      afterId: "t19",
    });
    expect(wrapper.findAll("li")).toHaveLength(1);
  });
  it("emits authority invalidation and clears records on lost access", async () => {
    await render();
    api.listGoalTransfers.mockRejectedValue(
      new Error("GOAL_NOT_FOUND_OR_DENIED"),
    );
    await wrapper.get('[data-testid="goal-transfer-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.findAll("li")).toHaveLength(0);
    expect(
      wrapper
        .get('[data-testid="goal-transfer-refresh"]')
        .attributes("disabled"),
    ).toBeUndefined();
  });
});
