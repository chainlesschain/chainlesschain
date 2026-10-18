import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import Panel from "../ProjectGoalCliConnectionPanel.vue";
const goal = {
  id: "g1",
  storeId: "store",
  revision: 1,
  controlGeneration: 0,
  status: "active",
};
let wrapper: any;
afterEach(() => {
  wrapper?.unmount();
  delete (window as any).electronAPI;
});
function setup() {
  const api = {
    getGoalCliConnectionStatus: vi.fn(async () => ({
      enabled: false,
      goalRef: null,
      expiresAt: null,
    })),
    openGoalCliConnection: vi.fn(async () => ({
      enabled: true,
      goalRef: { id: goal.id },
      expiresAt: 1,
    })),
    closeGoalCliConnection: vi.fn(async () => ({
      enabled: false,
      goalRef: null,
      expiresAt: null,
    })),
  };
  (window as any).electronAPI = { project: api };
  wrapper = mount(Panel, { props: { goal, identityKey: "owner" } });
  return api;
}
describe("explicit desktop connection controls", () => {
  it("requests drafts through its separate native consent endpoint without renderer paths", async () => {
    const api = setup();
    await flushPromises();
    await wrapper.get('[data-testid="open-goal-cli-drafts"]').trigger("click");
    await flushPromises();
    const { status, ...goalRef } = goal;
    expect(api.openGoalCliConnection).toHaveBeenCalledExactlyOnceWith({
      goalRef,
      drafts: true,
    });
  });
  it("requests a separate native evidence grant only after its dedicated click", async () => {
    const api = setup();
    await flushPromises();
    expect(api.openGoalCliConnection).not.toHaveBeenCalled();
    await wrapper
      .get('[data-testid="open-goal-cli-evidence"]')
      .trigger("click");
    await flushPromises();
    const { status, ...goalRef } = goal;
    expect(api.openGoalCliConnection).toHaveBeenCalledExactlyOnceWith({
      goalRef,
      evidence: true,
    });
  });
  it("loads status without granting access and opens only after the user's click", async () => {
    const api = setup();
    await flushPromises();
    expect(api.openGoalCliConnection).not.toHaveBeenCalled();
    await wrapper
      .get('[data-testid="open-goal-cli-connection"]')
      .trigger("click");
    await flushPromises();
    const { status, ...goalRef } = goal;
    expect(api.openGoalCliConnection).toHaveBeenCalledExactlyOnceWith({
      goalRef,
    });
    expect(wrapper.text()).toContain("g1");
    await wrapper
      .get('[data-testid="close-goal-cli-connection"]')
      .trigger("click");
    await flushPromises();
    expect(api.closeGoalCliConnection).toHaveBeenCalledExactlyOnceWith();
    expect(
      wrapper.find('[data-testid="close-goal-cli-connection"]').exists(),
    ).toBe(false);
  });
  it("drops a late open response after identity changes", async () => {
    const api = setup();
    await flushPromises();
    let finish!: (value: any) => void;
    api.openGoalCliConnection.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .get('[data-testid="open-goal-cli-connection"]')
      .trigger("click");
    await wrapper.setProps({ identityKey: "other" });
    await flushPromises();
    finish({ enabled: true, goalRef: { id: "secret" }, expiresAt: 1 });
    await flushPromises();
    expect(wrapper.text()).not.toContain("secret");
  });
  it("clears stale connection status after an error", async () => {
    const api = setup();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-goal-cli-connection"]')
      .trigger("click");
    await flushPromises();
    api.getGoalCliConnectionStatus.mockRejectedValue(new Error("unavailable"));
    await wrapper
      .get('[data-testid="refresh-goal-cli-connection"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="close-goal-cli-connection"]').exists(),
    ).toBe(false);
  });
});
