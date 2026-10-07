import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalMonitoringPanel.vue";
function goal(overrides = {}) {
  return {
    id: "g1",
    revision: 1,
    status: "active",
    objective: "Follow risk",
    ownerRef: "did:owner",
    projectRef: { id: "p1", scope: { kind: "personal", id: "did:owner" } },
    budgetPolicy: { maxRuns: 20 },
    ...overrides,
  };
}
function state(overrides = {}) {
  return {
    goal: goal(),
    executionState: "idle",
    blockedReason: null,
    monitor: null,
    usage: { checks: 0 },
    history: [],
    ...overrides,
  };
}
describe("personal project goal controls", () => {
  let wrapper: VueWrapper, api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      listGoals: vi.fn(async () => [goal()]),
      createGoal: vi.fn(async () => goal({ id: "g2", objective: "New goal" })),
      reviseGoal: vi.fn(async () => goal({ revision: 3 })),
      getGoalMonitoringStatus: vi.fn(async () => state()),
      startGoalMonitoring: vi.fn(async () =>
        state({ executionState: "waiting", monitor: { enabled: 1 } }),
      ),
      stopGoalMonitoring: vi.fn(async () =>
        state({
          goal: goal({ revision: 2, status: "paused" }),
          executionState: "paused",
          monitor: { enabled: 0 },
        }),
      ),
      checkGoalNow: vi.fn(async () => ({
        status: "succeeded",
        occurrenceId: "occ-1",
      })),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, {
      props: { projectId: "p1", identityKey: "owner" },
    });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  it("reads saved goals without enabling monitoring", async () => {
    await flushPromises();
    expect(wrapper.text()).toContain("尚未开启巡检");
    expect(api.listGoals).toHaveBeenCalledWith({ projectId: "p1", limit: 20 });
    expect(api.startGoalMonitoring).not.toHaveBeenCalled();
    expect(api.checkGoalNow).not.toHaveBeenCalled();
  });
  it("refreshes goal state after explicitly saving its notification policy", async () => {
    await flushPromises();
    api.reviseGoal.mockImplementation(async (input) =>
      goal({ revision: 2, notificationPolicy: input.patch.notificationPolicy }),
    );
    const policy = wrapper.findComponent({
      name: "ProjectGoalNotificationPolicyPanel",
    });
    expect(policy.props("identityKey")).toBe("owner");
    await policy
      .get('[data-testid="goal-notification-mode"]')
      .setValue("silent");
    expect(api.reviseGoal).not.toHaveBeenCalled();
    await policy.get("form").trigger("submit");
    await flushPromises();
    expect(api.reviseGoal).toHaveBeenCalledWith({
      id: "g1",
      expectedRevision: 1,
      patch: {
        notificationPolicy: {
          channel: "in-app",
          mode: "silent",
          quietHours: null,
        },
      },
    });
    expect(api.listGoals).toHaveBeenCalledTimes(2);
  });
  it("clears goal data when notification policy editing loses authority", async () => {
    await flushPromises();
    wrapper
      .findComponent({ name: "ProjectGoalNotificationPolicyPanel" })
      .vm.$emit("authority-error");
    await flushPromises();
    expect(wrapper.find('[data-goal-id="g1"]').exists()).toBe(false);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("clears all goal metadata when a nested governed panel reports revoked authority", async () => {
    await flushPromises();
    expect(wrapper.find('[data-goal-id="g1"]').exists()).toBe(true);
    wrapper
      .findComponent({ name: "ProjectGoalAcceptancePanel" })
      .vm.$emit("authority-error");
    await flushPromises();
    expect(wrapper.find('[data-goal-id="g1"]').exists()).toBe(false);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("stops one occurrence using its current fence and keeps future monitoring visible", async () => {
    await flushPromises();
    api.stopGoalOccurrence = vi.fn(async () => ({
      status: "stop-requested",
      goalId: "g1",
      occurrenceId: "occ1",
    }));
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({
        executionState: "running",
        monitor: { enabled: 1 },
        active: [{ id: "occ1", fence: 7 }],
        stops: [{ occurrenceId: "occ1", status: "stop-requested" }],
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="stop-goal-occurrence"]').trigger("click");
    await flushPromises();
    expect(api.stopGoalOccurrence.mock.calls[0][0]).toMatchObject({
      id: "g1",
      expectedRevision: 1,
      occurrenceId: "occ1",
      expectedFence: 7,
    });
    expect(api.stopGoalMonitoring).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("后续巡检仍启用");
    expect(wrapper.text()).toContain("等待宿主确认");
  });
  it("retries an uncertain occurrence stop with the original request identity", async () => {
    await flushPromises();
    api.stopGoalOccurrence = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({
        status: "stop-requested",
        goalId: "g1",
        occurrenceId: "occ1",
      });
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({
        executionState: "running",
        monitor: { enabled: 1 },
        active: [{ id: "occ1", fence: 7 }],
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="stop-goal-occurrence"]').trigger("click");
    await flushPromises();
    const original = api.stopGoalOccurrence.mock.calls[0][0];
    await wrapper.get('[data-testid="stop-goal-occurrence"]').trigger("click");
    await flushPromises();
    expect(api.stopGoalOccurrence.mock.calls[1][0]).toEqual(original);
  });
  it("ends long-term follow-up separately and keeps pending termination distinct from ended", async () => {
    await flushPromises();
    api.endGoalFollowUp = vi.fn(async () =>
      state({
        goal: goal({ revision: 2, status: "abandoned" }),
        executionState: "end-requested",
        monitor: { enabled: 0 },
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="end-goal-follow-up"]').trigger("click");
    await flushPromises();
    expect(api.endGoalFollowUp).toHaveBeenCalledWith({
      id: "g1",
      expectedRevision: 1,
    });
    expect(api.stopGoalMonitoring).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("正在结束跟进");
    expect(wrapper.find('[data-testid="resume-goal"]').exists()).toBe(false);
  });
  it("saves an explicitly bounded idle goal", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="goal-objective"]').setValue("New goal");
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({ goal: goal({ id: "g2", objective: "New goal" }) }),
    );
    await wrapper.get('[data-testid="create-goal"]').trigger("submit");
    await flushPromises();
    expect(api.createGoal).toHaveBeenCalledWith({
      projectId: "p1",
      objective: "New goal",
      budgetPolicy: { maxRuns: 20 },
    });
    expect(wrapper.text()).toContain("New goal");
    expect(api.startGoalMonitoring).not.toHaveBeenCalled();
  });
  it("explicitly starts monitoring against the current goal revision", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="start-goal"]').trigger("click");
    await flushPromises();
    expect(api.startGoalMonitoring).toHaveBeenCalledWith({
      id: "g1",
      expectedRevision: 1,
      intervalMs: 3_600_000,
    });
    expect(wrapper.text()).toContain("等待下次检查");
  });
  it("preserves manual request identity when the transport outcome is unknown", async () => {
    await flushPromises();
    api.checkGoalNow.mockRejectedValueOnce(new Error("transport timeout"));
    await wrapper.get('[data-testid="check-goal"]').trigger("click");
    await flushPromises();
    const first = api.checkGoalNow.mock.calls[0][0];
    expect(wrapper.text()).toContain("重试本次检查");
    await wrapper.get('[data-testid="check-goal"]').trigger("click");
    await flushPromises();
    expect(api.checkGoalNow.mock.calls[1][0]).toEqual(first);
    expect(wrapper.text()).not.toContain("重试本次检查");
  });
  it("does not label a requested stop as confirmed while work remains active", async () => {
    await flushPromises();
    api.stopGoalMonitoring.mockResolvedValue(
      state({
        goal: goal({ revision: 2, status: "paused" }),
        executionState: "pause-requested",
      }),
    );
    await wrapper.get('[data-testid="stop-goal"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("暂停中，等待在途检查结束");
    expect(
      wrapper.get('[data-testid="resume-goal"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("reopens a paused goal without automatically enabling a monitor", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="stop-goal"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="resume-goal"]').trigger("click");
    await flushPromises();
    expect(api.reviseGoal).toHaveBeenCalledWith({
      id: "g1",
      expectedRevision: 2,
      patch: { status: "active" },
    });
    expect(api.startGoalMonitoring).not.toHaveBeenCalled();
  });
  it("displays budget blocking and saved evidence without claiming goal completion", async () => {
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({
        executionState: "blocked",
        blockedReason: "GOAL_MONITOR_BUDGET_EXHAUSTED",
        usage: { checks: 20 },
        history: [
          {
            occurrenceId: "occ-1",
            reviewId: "r1",
            result: {
              checkedAt: "2026-10-07T00:00:00.000Z",
              status: "evaluated",
              riskTaskCount: 2,
            },
          },
        ],
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    // Initial load may still be pending, so explicitly refresh once settled.
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("预算已用完");
    expect(wrapper.text()).toContain("2 个信号");
    await wrapper
      .get('[data-testid="goal-check-history"] button')
      .trigger("click");
    expect(wrapper.emitted("review-id")![0]).toEqual(["r1"]);
    expect(
      wrapper.get('[data-testid="check-goal"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("permits explicit policy refresh and new manual checks after authorization revision changes", async () => {
    await flushPromises();
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({
        executionState: "blocked",
        blockedReason: "scheduler_authority_policy_stale",
        monitor: { enabled: 1 },
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.get('[data-testid="start-goal"]').attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper.get('[data-testid="check-goal"]').attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get('[data-testid="start-goal"]').trigger("click");
    await flushPromises();
    expect(api.startGoalMonitoring).toHaveBeenCalledOnce();
  });
  it("clears historical data and unknown requests after authority rejection", async () => {
    await flushPromises();
    api.checkGoalNow.mockRejectedValue(
      new Error("Error invoking channel: GOAL_IDENTITY_REQUIRED"),
    );
    await wrapper.get('[data-testid="check-goal"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-goal-id="g1"]').exists()).toBe(false);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Follow risk");
  });
  it("rejects goal responses from another personal project", async () => {
    await flushPromises();
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({
        goal: goal({
          projectRef: {
            id: "p2",
            scope: { kind: "personal", id: "did:owner" },
          },
        }),
      }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Follow risk");
  });
  it("discards responses arriving after an identity/project switch", async () => {
    await flushPromises();
    let release!: (value: unknown) => void;
    api.listGoals.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await wrapper.get('[data-testid="refresh-goals"]').trigger("click");
    api.listGoals.mockResolvedValue([]);
    await wrapper.setProps({ projectId: "p2", identityKey: "new-owner" });
    await flushPromises();
    release([goal()]);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Follow risk");
  });
  it("opens a directly referenced goal without reading or paginating the first 20 goals", async () => {
    await flushPromises();
    api.listGoals.mockClear();
    api.getGoalMonitoringStatus.mockClear();
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({ goal: goal({ id: "g-outside-first-page" }) }),
    );
    await wrapper.setProps({ focusGoalId: "g-outside-first-page" });
    await flushPromises();
    expect(api.listGoals).not.toHaveBeenCalled();
    expect(api.getGoalMonitoringStatus).toHaveBeenCalledExactlyOnceWith({
      id: "g-outside-first-page",
    });
    expect(wrapper.find('[data-goal-id="g-outside-first-page"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="create-goal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="more-goals"]').exists()).toBe(false);
  });
  it.each(["mismatched-id", "other-project", "organization", "wrong-owner"])(
    "rejects a focused goal with %s binding",
    async (mismatch) => {
      await flushPromises();
      const returned = goal({ id: "focused" });
      if (mismatch === "mismatched-id") returned.id = "different";
      if (mismatch === "other-project") returned.projectRef.id = "p2";
      if (mismatch === "organization")
        returned.projectRef.scope.kind = "organization";
      if (mismatch === "wrong-owner")
        returned.projectRef.scope.id = "did:other";
      api.getGoalMonitoringStatus.mockResolvedValue(state({ goal: returned }));
      await wrapper.setProps({ focusGoalId: "focused" });
      await flushPromises();
      expect(wrapper.find('[data-goal-id="focused"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Follow risk");
      expect(wrapper.emitted("authority-error")).toHaveLength(1);
    },
  );
  it("discards a late direct status after changing the focused goal", async () => {
    await flushPromises();
    let resolve!: (value: unknown) => void;
    api.getGoalMonitoringStatus.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    await wrapper.setProps({ focusGoalId: "old-goal" });
    api.getGoalMonitoringStatus.mockResolvedValue(
      state({ goal: goal({ id: "new-goal", objective: "Current goal" }) }),
    );
    await wrapper.setProps({ focusGoalId: "new-goal" });
    await flushPromises();
    resolve(
      state({ goal: goal({ id: "old-goal", objective: "Old secret goal" }) }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Current goal");
    expect(wrapper.text()).not.toContain("Old secret goal");
  });
  it("refuses malformed focused identifiers without falling back to a goal list", async () => {
    await flushPromises();
    api.listGoals.mockClear();
    api.getGoalMonitoringStatus.mockClear();
    await wrapper.setProps({ focusGoalId: "../other" });
    await flushPromises();
    expect(api.getGoalMonitoringStatus).not.toHaveBeenCalled();
    expect(api.listGoals).not.toHaveBeenCalled();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
});
