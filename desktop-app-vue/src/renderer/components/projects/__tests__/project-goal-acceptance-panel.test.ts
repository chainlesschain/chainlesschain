import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalAcceptancePanel.vue";
const goal = {
  id: "g1",
  revision: 2,
  status: "active",
  acceptanceCriteria: [
    {
      id: "tasks",
      kind: "business-assertion",
      description: "Every task completed",
    },
  ],
};
const report = {
  id: "report1",
  checkedAt: 1791244800000,
  met: false,
  blockedReason: null,
  appliedRevision: null,
  review: { id: "review1" },
  criteria: [{ id: "tasks", met: false, reason: "project-tasks-incomplete" }],
};
function status(
  plan: any = {
    assertions: [{ type: "all-tasks-completed" }],
    manualCriterionIds: ["owner"],
  },
) {
  return { goal, plan, reports: [], nextCursor: null };
}
describe("goal typed acceptance and independent completion UI", () => {
  let wrapper: VueWrapper, api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      getGoalAcceptanceStatus: vi.fn(async () => status()),
      configureGoalAcceptance: vi.fn(async () => ({
        goal: { ...goal, revision: 3 },
      })),
      acknowledgeGoalAcceptance: vi.fn(async () => ({
        acknowledgement: { status: "accepted" },
      })),
      checkGoalAcceptance: vi.fn(async () => ({
        goal,
        report,
        completed: false,
      })),
      completeGoal: vi.fn(async () => ({ goal, report, completed: false })),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, { props: { goal, identityKey: "owner" } });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  it("loads only existing acceptance metadata on mount", async () => {
    await flushPromises();
    expect(api.getGoalAcceptanceStatus).toHaveBeenCalledWith({
      goalId: "g1",
      limit: 20,
    });
    expect(api.checkGoalAcceptance).not.toHaveBeenCalled();
    expect(api.completeGoal).not.toHaveBeenCalled();
    expect(api.acknowledgeGoalAcceptance).not.toHaveBeenCalled();
  });
  it("clears previously displayed evidence when a later authoritative read fails", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="check-acceptance"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("仍有未完成任务");
    api.getGoalAcceptanceStatus.mockRejectedValue(
      new Error("GOAL_COMPLETION_RECORD_CORRUPT"),
    );
    await wrapper.get('[data-testid="refresh-acceptance"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("仍有未完成任务");
    expect(wrapper.text()).toContain("验收记录暂不可读取");
  });
  it("sets explicitly selected native criteria under the current goal revision", async () => {
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.configureGoalAcceptance.mock.calls[0][0]).toMatchObject({
      goalId: "g1",
      expectedRevision: 2,
      acceptanceCriteria: [
        {
          id: "tasks-completed",
          kind: "business-assertion",
          description: "项目非空且所有任务已完成",
        },
        {
          id: "owner-accepted",
          kind: "manual",
          description: "我已人工验收业务结果",
        },
      ],
      assertions: [
        { criterionId: "tasks-completed", type: "all-tasks-completed" },
      ],
    });
    expect(wrapper.emitted("goal-changed")).toHaveLength(1);
  });
  it("displays unmet native evidence without marking a goal completed", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="complete-goal"]').trigger("click");
    await flushPromises();
    expect(api.completeGoal.mock.calls[0][0]).toMatchObject({
      goalId: "g1",
      expectedRevision: 2,
    });
    expect(wrapper.text()).toContain("该次条件未满足");
    expect(wrapper.text()).toContain("仍有未完成任务");
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
  });
  it("opens the native owner acceptance endpoint without fabricating approval fields", async () => {
    await flushPromises();
    await wrapper
      .get('[data-testid="acknowledge-acceptance"]')
      .trigger("click");
    await flushPromises();
    expect(
      Object.keys(api.acknowledgeGoalAcceptance.mock.calls[0][0]).sort(),
    ).toEqual(["expectedRevision", "goalId", "requestId"]);
    expect(wrapper.text()).toContain("请重新检查全部业务条件");
    expect(api.completeGoal).not.toHaveBeenCalled();
  });
  it("preserves a completion request across an uncertain transport result", async () => {
    await flushPromises();
    api.completeGoal.mockRejectedValueOnce(new Error("timeout"));
    await wrapper.get('[data-testid="complete-goal"]').trigger("click");
    await flushPromises();
    const original = api.completeGoal.mock.calls[0][0];
    expect(wrapper.text()).toContain("核对本次完成结果");
    await wrapper.get('[data-testid="complete-goal"]').trigger("click");
    await flushPromises();
    expect(api.completeGoal.mock.calls[1][0]).toEqual(original);
  });
  it("requests the parent to show the canonical completed goal after an applied receipt", async () => {
    await flushPromises();
    api.completeGoal.mockResolvedValue({
      goal: { ...goal, status: "done", revision: 3 },
      report: {
        ...report,
        met: true,
        appliedRevision: 3,
        criteria: [
          { id: "tasks", met: true, reason: "project-tasks-completed" },
        ],
      },
      completed: true,
    });
    await wrapper.get('[data-testid="complete-goal"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("goal-changed")).toHaveLength(1);
    expect(wrapper.text()).toContain("该次条件满足");
    expect(wrapper.text()).toContain("完成目标版本 3");
  });
  it("discards late completion responses when the identity changes", async () => {
    await flushPromises();
    let resolve: any;
    api.completeGoal.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await wrapper.get('[data-testid="complete-goal"]').trigger("click");
    api.getGoalAcceptanceStatus.mockResolvedValue({
      ...status(null),
      goal: { ...goal, id: "g2", revision: 4 },
    });
    await wrapper.setProps({
      goal: { ...goal, id: "g2", revision: 4 },
      identityKey: "other",
    });
    await flushPromises();
    resolve({
      goal: { ...goal, status: "done" },
      report: { ...report, met: true, appliedRevision: 3 },
      completed: true,
    });
    await flushPromises();
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
    expect(wrapper.text()).not.toContain("完成目标版本 3");
  });
});
