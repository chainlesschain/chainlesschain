import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalActionsPanel.vue";
const goal = {
  id: "g1",
  revision: 2,
  status: "active",
  allowedActionTypes: ["task.create", "task.update-description"],
};
function item(intent: any = null) {
  return {
    proposal: {
      id: "proposal1",
      goalId: "g1",
      goalRevision: 2,
      actionType: "task.create",
      sourceTaskId: "t1",
      reviewId: "review1",
    },
    current: true,
    intent,
  };
}
function prepared() {
  return {
    intent: {
      id: "intent1",
      status: "prepared",
      preview: {
        before: { description: "" },
        after: { description: "Review deadline" },
      },
    },
    executionState: "prepared",
    receipt: null,
  };
}
describe("personal goal suggestions, native confirmation entry and receipts", () => {
  let wrapper: VueWrapper, api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      listGoalProposals: vi.fn(async () => ({
        proposals: [item()],
        nextCursor: null,
      })),
      prepareGoalIntent: vi.fn(async () => prepared()),
      executeGoalIntent: vi.fn(async () => ({ run: { status: "succeeded" } })),
      readGoalIntent: vi.fn(async () => ({
        ...prepared(),
        intent: { ...prepared().intent, status: "succeeded" },
        executionState: "succeeded",
        receipt: { run: { id: "receipt1", status: "succeeded" } },
      })),
      reviseGoal: vi.fn(async () => ({ ...goal, revision: 3 })),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, { props: { goal, identityKey: "owner" } });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  async function preview() {
    await flushPromises();
    await wrapper
      .get('[data-testid="goal-action-description"]')
      .setValue("Review deadline");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
  }
  it("loads suggestions without preparing or executing actions", async () => {
    await flushPromises();
    expect(wrapper.text()).toContain("创建风险处理任务");
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it("recovers a persisted draft using its original request and content", async () => {
    api.listGoalProposals.mockResolvedValue({
      proposals: [
        item({
          intent: {
            id: "intent1",
            status: "draft",
            requestId: "persisted-request",
            description: "Saved owner draft",
            taskType: "query_info",
            preview: null,
          },
          executionState: "draft",
          receipt: null,
        }),
      ],
      nextCursor: null,
    });
    await flushPromises();
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="recover-goal-draft"]').trigger("click");
    await flushPromises();
    expect(api.prepareGoalIntent).toHaveBeenCalledWith({
      goalId: "g1",
      proposalId: "proposal1",
      expectedRevision: 2,
      requestId: "persisted-request",
      description: "Saved owner draft",
      taskType: "query_info",
    });
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it("previews then passes only the durable intent ID to the native confirmation endpoint", async () => {
    await preview();
    expect(api.prepareGoalIntent.mock.calls[0][0]).toMatchObject({
      goalId: "g1",
      expectedRevision: 2,
      proposalId: "proposal1",
      taskType: "query_info",
      description: "Review deadline",
    });
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="execute-goal-intent"]').trigger("click");
    await flushPromises();
    expect(api.executeGoalIntent).toHaveBeenCalledWith({ intentId: "intent1" });
    expect(api.readGoalIntent).toHaveBeenCalledWith({ intentId: "intent1" });
    expect(wrapper.text()).toContain("操作已保存，仍需复查风险");
    expect(wrapper.text()).toContain("receipt1");
    expect(wrapper.emitted("goal-changed")).toHaveLength(1);
  });
  it("retains request identity across uncertain preview transport", async () => {
    api.prepareGoalIntent.mockRejectedValueOnce(new Error("timeout"));
    await preview();
    const request = api.prepareGoalIntent.mock.calls[0][0];
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.prepareGoalIntent.mock.calls[1][0]).toEqual(request);
  });
  it("keeps unknown action on its original intent and refreshes instead of changing keys", async () => {
    await preview();
    api.executeGoalIntent.mockRejectedValue(
      new Error("ACTION_OUTCOME_UNKNOWN"),
    );
    await wrapper.get('[data-testid="execute-goal-intent"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("保留原意图");
    api.listGoalProposals.mockResolvedValue({
      proposals: [
        item({
          ...prepared(),
          executionState: "unresolved",
          intent: { ...prepared().intent, status: "running" },
        }),
      ],
      nextCursor: null,
    });
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("结果待核查");
    expect(wrapper.find('[data-testid="execute-goal-intent"]').exists()).toBe(
      false,
    );
    expect(api.prepareGoalIntent).toHaveBeenCalledTimes(1);
  });
  it("discards late suggestions after identity or goal revision changes", async () => {
    await flushPromises();
    let resolve: any;
    api.listGoalProposals.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    api.listGoalProposals.mockResolvedValue({
      proposals: [],
      nextCursor: null,
    });
    await wrapper.setProps({
      goal: { ...goal, id: "g2", revision: 3 },
      identityKey: "other",
    });
    await flushPromises();
    resolve({ proposals: [item()], nextCursor: null });
    await flushPromises();
    expect(wrapper.text()).not.toContain("来源任务：t1");
  });
  it("uses a goal revision for widening the proposal ceiling, then requests a fresh check", async () => {
    await wrapper.setProps({ goal: { ...goal, allowedActionTypes: [] } });
    await flushPromises();
    await wrapper.get('[data-testid="enable-goal-actions"]').trigger("click");
    await flushPromises();
    expect(api.reviseGoal).toHaveBeenCalledWith({
      id: "g1",
      expectedRevision: 2,
      patch: { allowedActionTypes: ["task.create", "task.update-description"] },
    });
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("请立即检查");
  });
});
