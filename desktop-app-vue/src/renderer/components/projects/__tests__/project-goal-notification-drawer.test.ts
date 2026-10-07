import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Drawer from "../ProjectGoalNotificationDrawer.vue";
const GoalPanel = {
  name: "ProjectGoalMonitoringPanel",
  props: ["projectId", "focusGoalId", "identityKey"],
  emits: ["review-id", "authority-error"],
  template: '<div data-testid="focused-goal">Goal panel</div>',
};
const RiskPanel = {
  name: "ProjectRiskReviewPanel",
  props: ["projectId", "review", "identityKey"],
  emits: ["review", "authority-error"],
  template: '<div data-testid="selected-risk">{{ review.review.id }}</div>',
};
const Shell = {
  props: ["open"],
  emits: ["close"],
  template: '<div v-if="open"><slot /></div>',
};
const props = {
  projectId: "p1",
  goalId: "goal-21",
  noticeId: "notice1",
  identityKey: "did:owner:personal:db1",
  authenticated: true,
};
const review = (id = "review1", projectId = "p1") => ({
  review: { id, projectId, createdAt: "2026-10-07T00:00:00Z" },
  evaluation: {
    status: "evaluated",
    asOf: null,
    summary: null,
    reasonCodes: [],
    tasks: [],
  },
});
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("notification deep link goal drawer", () => {
  let wrapper: VueWrapper,
    api: any,
    invalidate: () => void,
    unsubscribe: ReturnType<typeof vi.fn>;
  const panel = () =>
    wrapper.findComponent({ name: "ProjectGoalMonitoringPanel" });
  beforeEach(() => {
    unsubscribe = vi.fn();
    api = {
      getGoalMonitoringStatus: vi.fn(),
      getRiskReview: vi.fn(async ({ reviewId }) => review(reviewId)),
    };
    (window as any).electronAPI = {
      project: api,
      notification: {
        onInvalidated: vi.fn((callback) => {
          invalidate = callback;
          return unsubscribe;
        }),
      },
    };
    wrapper = mount(Drawer, {
      props,
      global: {
        stubs: {
          "a-drawer": Shell,
          ProjectGoalMonitoringPanel: GoalPanel,
          ProjectRiskReviewPanel: RiskPanel,
        },
      },
    });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  it("opens a visible focused goal panel from navigation hints and labels notification evidence as historical", () => {
    expect(
      wrapper.find('[data-testid="goal-notification-drawer"]').exists(),
    ).toBe(true);
    expect(panel().props()).toMatchObject({
      projectId: "p1",
      focusGoalId: "goal-21",
      identityKey: props.identityKey,
    });
    expect(wrapper.text()).toContain("通知记录此前一次检查");
    expect(api.getRiskReview).not.toHaveBeenCalled();
  });
  it.each([
    { goalId: ["g1", "g2"] },
    { goalId: "../other" },
    { goalId: "" },
    { noticeId: ["n1", "n2"] },
    { projectId: "../project" },
    { authenticated: false },
  ])(
    "does not render goal data for invalid or unauthenticated navigation %j",
    async (change) => {
      await wrapper.setProps(change);
      expect(panel().exists()).toBe(false);
      expect(
        wrapper.find('[data-testid="goal-notification-drawer"]').exists(),
      ).toBe(false);
    },
  );
  it("loads a selected historical review through the project API", async () => {
    panel().vm.$emit("review-id", "review1");
    await flushPromises();
    expect(api.getRiskReview).toHaveBeenCalledExactlyOnceWith({
      reviewId: "review1",
    });
    expect(wrapper.get('[data-testid="selected-risk"]').text()).toBe("review1");
  });
  it.each(["projectId", "goalId", "identityKey", "noticeId", "authenticated"])(
    "clears prior review and discards delayed source after %s changes",
    async (field) => {
      panel().vm.$emit("review-id", "review1");
      await flushPromises();
      const pending = deferred();
      api.getRiskReview.mockReturnValueOnce(pending.promise);
      panel().vm.$emit("review-id", "old-review");
      await wrapper.setProps({
        [field]: field === "authenticated" ? false : "new-value",
      });
      pending.resolve(review("old-review"));
      await flushPromises();
      expect(wrapper.find('[data-testid="selected-risk"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain("old-review");
    },
  );
  it("discards an older selected review after a newer one succeeds", async () => {
    const pending = deferred();
    api.getRiskReview.mockReturnValueOnce(pending.promise);
    panel().vm.$emit("review-id", "old-review");
    panel().vm.$emit("review-id", "new-review");
    await flushPromises();
    pending.resolve(review("old-review"));
    await flushPromises();
    expect(wrapper.get('[data-testid="selected-risk"]').text()).toBe(
      "new-review",
    );
  });
  it.each(["wrong-id", "wrong-project"])(
    "rejects source results with %s",
    async (mismatch) => {
      api.getRiskReview.mockResolvedValue(
        review(
          mismatch === "wrong-id" ? "other" : "review1",
          mismatch === "wrong-project" ? "p2" : "p1",
        ),
      );
      panel().vm.$emit("review-id", "review1");
      await flushPromises();
      expect(wrapper.find('[data-testid="selected-risk"]').exists()).toBe(
        false,
      );
      expect(panel().exists()).toBe(false);
      expect(wrapper.emitted("authority-error")).toHaveLength(1);
    },
  );
  it("clears the entire goal and source view after child authorization fails", async () => {
    panel().vm.$emit("review-id", "review1");
    await flushPromises();
    panel().vm.$emit("authority-error");
    await flushPromises();
    expect(panel().exists()).toBe(false);
    expect(wrapper.find('[data-testid="selected-risk"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("当前身份已无法访问");
  });
  it("closes and clears a deep link after host invalidation, even with unchanged renderer identity props", async () => {
    const pending = deferred();
    api.getRiskReview.mockReturnValueOnce(pending.promise);
    panel().vm.$emit("review-id", "old-review");
    invalidate();
    await flushPromises();
    pending.resolve(review("old-review"));
    await flushPromises();
    expect(
      wrapper.find('[data-testid="goal-notification-drawer"]').exists(),
    ).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("old-review");
  });
  it("closes locally and discards delayed source work before parent query cleanup", async () => {
    const pending = deferred();
    api.getRiskReview.mockReturnValueOnce(pending.promise);
    panel().vm.$emit("review-id", "old-review");
    wrapper.findComponent(Shell).vm.$emit("close");
    await flushPromises();
    pending.resolve(review("old-review"));
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(panel().exists()).toBe(false);
    await wrapper.setProps({ noticeId: "notice2" });
    expect(panel().exists()).toBe(true);
  });
  it("removes the invalidation listener when the project page unmounts", () => {
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not reopen a dismissed drawer when the host invalidates its session", async () => {
    wrapper.findComponent(Shell).vm.$emit("close");
    await flushPromises();
    invalidate();
    await flushPromises();
    expect(panel().exists()).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("routes an actual focused read directly to the host and rejects an unauthorized project response", async () => {
    wrapper.unmount();
    Object.assign(api, {
      reviseGoal: vi.fn(),
      startGoalMonitoring: vi.fn(),
      stopGoalMonitoring: vi.fn(),
      checkGoalNow: vi.fn(),
      listGoals: vi.fn(),
      createGoal: vi.fn(),
    });
    api.getGoalMonitoringStatus.mockResolvedValue({
      goal: {
        id: "goal-21",
        projectRef: { id: "p2", scope: { kind: "personal", id: "did:owner" } },
        ownerRef: "did:owner",
        objective: "OTHER PROJECT SECRET",
      },
    });
    wrapper = mount(Drawer, {
      props,
      global: { stubs: { ADrawer: Shell, ProjectRiskReviewPanel: RiskPanel } },
    });
    await flushPromises();
    expect(api.getGoalMonitoringStatus).toHaveBeenCalledExactlyOnceWith({
      id: "goal-21",
    });
    expect(api.listGoals).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("OTHER PROJECT SECRET");
    expect(wrapper.text()).toContain("当前身份已无法访问");
  });
});
