import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import List from "../GoalNotificationList.vue";
import { useAppStore } from "../../../stores/app";
const data = {
  schema: "chainlesschain.goal-notice-ref/v1",
  eventId: "n1",
  goalId: "g1",
  projectId: "cached-project",
  storeId: "s1",
  sourceVersion: "v1",
};
const row = {
  id: "n1",
  title: "SECRET TITLE",
  content: "SECRET OBJECTIVE",
  data: JSON.stringify(data),
  created_at: 1,
  is_read: 0,
};
const target = {
  goalId: "g1",
  projectId: "authorized-project",
  storeId: "s1",
  sourceVersion: "v1",
};
describe("Goal notice center navigation", () => {
  let wrapper: VueWrapper, api: any;
  let pinia: ReturnType<typeof createPinia>;
  const render = (props = {}) =>
    mount(List, {
      props,
      global: {
        plugins: [pinia],
        stubs: { "a-button": { template: "<button><slot /></button>" } },
      },
    });
  beforeEach(() => {
    vi.useFakeTimers();
    pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().isAuthenticated = true;
    api = {
      getGoals: vi
        .fn()
        .mockResolvedValue({ success: true, notifications: [row] }),
      markRead: vi.fn().mockResolvedValue({ success: true }),
      openGoal: vi.fn().mockResolvedValue({ success: true, target }),
      onInvalidated: vi.fn(() => vi.fn()),
    };
    (window as any).electronAPI = { notification: api };
    push.mockReset();
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });
  it("renders generic historical check wording, excluding cached source bodies", async () => {
    wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("此前一次检查");
    expect(wrapper.text()).not.toContain("SECRET");
  });
  it("uses two host source rechecks and routes using the authorized target", async () => {
    wrapper = render();
    await flushPromises();
    await wrapper.find('[data-notice-id="n1"] button').trigger("click");
    await flushPromises();
    expect(api.openGoal).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith({
      name: "ProjectDetail",
      params: { id: "authorized-project" },
      query: { goalId: "g1", goalNoticeId: "n1" },
    });
  });
  it("clears and does not navigate after a source denial", async () => {
    api.openGoal.mockResolvedValue({ success: false });
    wrapper = render();
    await flushPromises();
    await wrapper.find('[data-notice-id="n1"] button').trigger("click");
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(wrapper.findAll("[data-notice-id]")).toHaveLength(0);
  });
  it("marks read through the host and updates the unread filter", async () => {
    wrapper = render({ unreadOnly: true });
    await flushPromises();
    await wrapper.findAll('[data-notice-id="n1"] button')[1].trigger("click");
    await flushPromises();
    expect(api.markRead).toHaveBeenCalledWith("n1");
    expect(wrapper.findAll("[data-notice-id]")).toHaveLength(0);
  });
  it("clears on logout and removes polling and its listener on unmount", async () => {
    wrapper = render();
    await flushPromises();
    useAppStore().isAuthenticated = false;
    await flushPromises();
    expect(wrapper.findAll("[data-notice-id]")).toHaveLength(0);
    wrapper.unmount();
    expect(api.onInvalidated.mock.results[0].value).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
