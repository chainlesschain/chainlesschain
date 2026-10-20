import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalActionsPanel.vue";
import DraftPanel from "../ProjectGoalExtensionDraftsPanel.vue";
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
const draftId = "goal-extension-" + "a".repeat(64);
function converted(status = "prepared") {
  return {
    ...prepared(),
    intent: {
      ...prepared().intent,
      status,
      goalId: goal.id,
      storeId: "store1",
      goalRevision: goal.revision,
      controlGeneration: 1,
      proposalId: "proposal1",
      description: "Review deadline",
      requestId: "persisted-conversion-request",
      extensionRef: { draftId },
      preview: status === "draft" ? null : prepared().intent.preview,
    },
    executionState: status,
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
      prepareGoalDeliveryDraft: vi.fn(async () => converted()),
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
  async function loadConverted(status = "prepared") {
    api.listGoalProposals.mockResolvedValue({
      proposals: [item(converted(status))],
      nextCursor: null,
    });
    await flushPromises();
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    await flushPromises();
  }
  it("recovers converted drafts only through their persisted draft ID", async () => {
    await loadConverted("draft");
    await wrapper.get('[data-testid="recover-goal-draft"]').trigger("click");
    await flushPromises();
    expect(api.prepareGoalDeliveryDraft).toHaveBeenCalledExactlyOnceWith({
      id: draftId,
    });
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="execute-goal-intent"]').exists()).toBe(
      true,
    );
  });
  it.each(["prepareGoalDeliveryDraft", "executeGoalIntent"])(
    "redacts cached converted content after %s loses extension authority",
    async (method) => {
      await loadConverted(
        method === "prepareGoalDeliveryDraft" ? "draft" : "prepared",
      );
      api[method].mockRejectedValue(
        new Error("ACTION_GOAL_EXTENSION_REJECTED"),
      );
      await wrapper
        .get(
          method === "prepareGoalDeliveryDraft"
            ? '[data-testid="recover-goal-draft"]'
            : '[data-testid="execute-goal-intent"]',
        )
        .trigger("click");
      await flushPromises();
      expect(
        wrapper
          .find('[data-testid="goal-extension-intent-unavailable"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).not.toContain("Review deadline");
      expect(wrapper.find("form").exists()).toBe(false);
      expect(wrapper.find('[data-testid="execute-goal-intent"]').exists()).toBe(
        false,
      );
      expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    },
  );
  it("keeps an unavailable converted intent from falling back to a manual draft form", async () => {
    api.listGoalProposals.mockResolvedValue({
      proposals: [{ ...item(), intentUnavailable: true }],
      nextCursor: null,
    });
    await flushPromises();
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    await flushPromises();
    expect(
      wrapper
        .find('[data-testid="goal-extension-intent-unavailable"]')
        .exists(),
    ).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
  });
  it.each(["PROJECT_RISK_REVIEW_STALE", "ACTION_GOAL_SOURCE_CONFLICT"])(
    "redacts converted previews after a native source rejection: %s",
    async (code) => {
      await loadConverted();
      api.executeGoalIntent.mockRejectedValue(new Error(code));
      await wrapper.get('[data-testid="execute-goal-intent"]').trigger("click");
      await flushPromises();
      expect(
        wrapper
          .find('[data-testid="goal-extension-intent-unavailable"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).not.toContain("Review deadline");
    },
  );
  it("invalidates pending reads and converted previews on child grant changes while retaining a completed receipt", async () => {
    await loadConverted();
    let finish!: (value: any) => void;
    api.listGoalProposals.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    wrapper.findComponent(DraftPanel).vm.$emit("extension-invalidated");
    await flushPromises();
    finish({ proposals: [item(converted())], nextCursor: null });
    await flushPromises();
    expect(
      wrapper
        .find('[data-testid="goal-extension-intent-unavailable"]')
        .exists(),
    ).toBe(true);
    expect(wrapper.text()).not.toContain("Review deadline");
    api.listGoalProposals.mockResolvedValue({
      proposals: [
        item({
          ...converted("succeeded"),
          receipt: { run: { id: "completed-receipt", status: "succeeded" } },
        }),
      ],
      nextCursor: null,
    });
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    await flushPromises();
    wrapper.findComponent(DraftPanel).vm.$emit("extension-invalidated");
    await flushPromises();
    expect(wrapper.text()).toContain("completed-receipt");
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it.each(["storeId", "controlGeneration"])(
    "drops late native previews after %s changes",
    async (field) => {
      await flushPromises();
      let finish!: (value: any) => void;
      api.prepareGoalIntent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await wrapper
        .get('[data-testid="goal-action-description"]')
        .setValue("Review deadline");
      await wrapper.get("form").trigger("submit");
      api.listGoalProposals.mockResolvedValue({
        proposals: [],
        nextCursor: null,
      });
      await wrapper.setProps({
        goal: { ...goal, [field]: field === "storeId" ? "other-store" : 2 },
      });
      await flushPromises();
      finish(prepared());
      await flushPromises();
      expect(wrapper.find('[data-testid="execute-goal-intent"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain("Review deadline");
    },
  );
  it("loads the converted child draft into the native preview and waits for an explicit execution click", async () => {
    api.getGoalDeliveryDraftStatus = vi.fn(async () => ({
      enabled: true,
      epoch: 1,
      savedCount: 1,
    }));
    const draft = {
      id: draftId,
      state: "pending-confirmation",
      origin: "builtin-rule",
      plugin: {
        name: "project-delivery-drafts",
        scope: "desktop-builtin",
        version: "0.1.0",
      },
      proposal: {
        type: "task.description.update",
        goalRef: {
          id: goal.id,
          storeId: "store1",
          revision: goal.revision,
          controlGeneration: 1,
        },
        sourceRef: "proposal1",
        title: "Delivery",
        description: "Review deadline",
      },
    };
    api.listGoalDeliveryDrafts = vi.fn(async () => ({
      entries: [draft],
      unavailableCount: 0,
      nextCursor: null,
    }));
    api.readGoalDeliveryDraft = vi.fn(async () => draft);
    api.configureGoalDeliveryDrafts = vi.fn();
    api.proposeGoalDeliveryDraft = vi.fn();
    const proposal = {
      ...item().proposal,
      actionType: "task.update-description",
      reviewDigest: "review-digest",
    };
    api.listGoalProposals.mockResolvedValue({
      proposals: [{ ...item(), proposal }],
      nextCursor: null,
    });
    await wrapper.setProps({
      goal: { ...goal, storeId: "store1", controlGeneration: 1 },
    });
    await flushPromises();
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
    let finishOldList!: (value: any) => void;
    api.listGoalProposals.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldList = resolve;
        }),
    );
    await wrapper.get('[data-testid="refresh-goal-actions"]').trigger("click");
    const listCallsBeforeConversion = api.listGoalProposals.mock.calls.length;
    api.listGoalProposals.mockResolvedValue({
      proposals: [{ ...item(converted()), proposal }],
      nextCursor: null,
    });
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await flushPromises();
    expect(api.prepareGoalDeliveryDraft).toHaveBeenCalledExactlyOnceWith({
      id: draftId,
    });
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
    expect(api.listGoalProposals.mock.calls.length).toBe(
      listCallsBeforeConversion + 1,
    );
    finishOldList({ proposals: [{ ...item(), proposal }], nextCursor: null });
    await flushPromises();
    expect(wrapper.text()).toContain("拟保存说明：Review deadline");
    await wrapper.get('[data-testid="execute-goal-intent"]').trigger("click");
    await flushPromises();
    expect(api.executeGoalIntent).toHaveBeenCalledExactlyOnceWith({
      intentId: "intent1",
    });
    expect(wrapper.text()).toContain("receipt1");
  });
  it("retains request identity across uncertain preview transport", async () => {
    api.prepareGoalIntent.mockRejectedValueOnce(new Error("timeout"));
    await preview();
    const request = api.prepareGoalIntent.mock.calls[0][0];
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.prepareGoalIntent.mock.calls[1][0]).toEqual(request);
  });
  it("retains the manual draft and revision message when an ordinary preview has a version conflict", async () => {
    api.prepareGoalIntent.mockRejectedValue(
      new Error("ACTION_GOAL_REVISION_CONFLICT"),
    );
    await preview();
    expect(wrapper.text()).toContain("目标已更新，请刷新并重新检查。");
    expect(
      (
        wrapper.get('[data-testid="goal-action-description"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("Review deadline");
    expect(
      wrapper
        .find('[data-testid="goal-extension-intent-unavailable"]')
        .exists(),
    ).toBe(false);
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
