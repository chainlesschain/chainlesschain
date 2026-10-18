import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalExtensionDraftsPanel.vue";
const goal = {
  id: "goal1",
  storeId: "project-goals-store",
  revision: 2,
  controlGeneration: 1,
  status: "active",
  allowedActionTypes: ["task.update-description"],
};
const ref = {
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
};
const draftId = "goal-extension-" + "a".repeat(64);
function draft() {
  return {
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
      goalRef: { ...ref },
      sourceRef: "native-proposal",
      title: "Delivery draft",
      description: "<img src=x onerror=alert(1)>",
    },
  };
}
describe("native delivery draft UI", () => {
  let wrapper: VueWrapper, api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      getGoalDeliveryDraftStatus: vi.fn(async () => ({
        enabled: false,
        epoch: 0,
        savedCount: 0,
      })),
      configureGoalDeliveryDrafts: vi.fn(async () => ({
        enabled: true,
        epoch: 1,
        savedCount: 0,
      })),
      proposeGoalDeliveryDraft: vi.fn(async () => ({
        proposalId: draftId,
        state: "pending-confirmation",
      })),
      listGoalDeliveryDrafts: vi.fn(async () => ({
        entries: [],
        unavailableCount: 0,
        nextCursor: null,
      })),
      readGoalDeliveryDraft: vi.fn(async () => draft()),
      prepareGoalDeliveryDraft: vi.fn(async () => ({
        intent: {
          id: "native-intent",
          goalId: goal.id,
          storeId: goal.storeId,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          proposalId: "native-proposal",
          description: draft().proposal.description,
          status: "prepared",
          extensionRef: { draftId },
        },
      })),
      prepareGoalIntent: vi.fn(),
      executeGoalIntent: vi.fn(),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, {
      props: {
        goal,
        identityKey: "owner",
        sources: [{ id: "native-proposal", sourceTaskId: "t1" }],
      },
    });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  async function enable() {
    await flushPromises();
    await wrapper
      .get('[data-testid="toggle-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
  }
  async function save() {
    await wrapper.get("select").setValue("native-proposal");
    await wrapper.get('[data-testid="save-delivery-draft"]').trigger("click");
    await flushPromises();
  }
  async function selectDraft() {
    await enable();
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: null,
    });
    await save();
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
  }
  it("creates a native preview only after an explicit request and sends just the persisted draft ID", async () => {
    await selectDraft();
    expect(api.prepareGoalDeliveryDraft).not.toHaveBeenCalled();
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await flushPromises();
    expect(api.prepareGoalDeliveryDraft).toHaveBeenCalledWith({ id: draftId });
    expect(wrapper.emitted("intent-prepared")).toHaveLength(1);
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it("retries an uncertain conversion on the same draft ID", async () => {
    await selectDraft();
    api.prepareGoalDeliveryDraft.mockRejectedValueOnce(
      new Error("response lost"),
    );
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="refresh-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    // The mock status mirrors the still-enabled persisted host grant.
    api.getGoalDeliveryDraftStatus.mockResolvedValue({
      enabled: true,
      epoch: 1,
      savedCount: 1,
    });
    await wrapper
      .get('[data-testid="refresh-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await flushPromises();
    expect(
      api.prepareGoalDeliveryDraft.mock.calls.map(([input]) => input),
    ).toEqual([{ id: draftId }, { id: draftId }]);
  });
  it("rejects another draft's conversion result", async () => {
    await selectDraft();
    const original = await api.prepareGoalDeliveryDraft();
    api.prepareGoalDeliveryDraft.mockResolvedValue({
      intent: { ...original.intent, extensionRef: { draftId: "another" } },
    });
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.emitted("intent-prepared")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted("extension-invalidated")).toHaveLength(2);
  });
  it("discards a conversion response after its source review changes", async () => {
    await selectDraft();
    let finish!: (value: any) => void;
    const original = await api.prepareGoalDeliveryDraft();
    api.prepareGoalDeliveryDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .get('[data-testid="prepare-delivery-draft"]')
      .trigger("click");
    await wrapper.setProps({
      sources: [
        { id: "native-proposal", sourceTaskId: "t1", reviewId: "updated" },
      ],
    });
    finish(original);
    await flushPromises();
    expect(wrapper.emitted("intent-prepared")).toBeUndefined();
  });
  it("starts disabled and sends only scoped native consent fields", async () => {
    await flushPromises();
    expect(wrapper.text()).toContain("重新启用不会自动恢复旧授权");
    expect(api.listGoalDeliveryDrafts).not.toHaveBeenCalled();
    await enable();
    expect(api.configureGoalDeliveryDrafts).toHaveBeenCalledWith({
      goalRef: ref,
      expectedEpoch: 0,
      enabled: true,
    });
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it("saves only after explicit source selection and reads a verified plaintext draft", async () => {
    await enable();
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: null,
    });
    await save();
    expect(api.proposeGoalDeliveryDraft.mock.calls[0][0]).toEqual({
      goalRef: ref,
      sourceRef: "native-proposal",
      requestId: expect.any(String),
    });
    expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
      false,
    );
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
    expect(api.readGoalDeliveryDraft).toHaveBeenCalledWith({ id: draftId });
    expect(wrapper.get('[data-testid="delivery-draft-body"]').text()).toContain(
      "<img",
    );
    expect(wrapper.find("img").exists()).toBe(false);
    expect(api.prepareGoalIntent).not.toHaveBeenCalled();
    expect(api.executeGoalIntent).not.toHaveBeenCalled();
  });
  it("retains request identity after uncertain save transport", async () => {
    await enable();
    api.proposeGoalDeliveryDraft.mockRejectedValueOnce(new Error("timeout"));
    await save();
    const request = api.proposeGoalDeliveryDraft.mock.calls[0][0];
    await save();
    expect(api.proposeGoalDeliveryDraft.mock.calls[1][0]).toEqual(request);
  });
  it("does not render a successful action claim as a pending saved draft", async () => {
    await enable();
    api.proposeGoalDeliveryDraft.mockResolvedValue({
      proposalId: draftId,
      state: "succeeded",
    });
    await save();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
      false,
    );
  });
  it("clears displayed content when disabling and leaves native history counts visible", async () => {
    await enable();
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: null,
    });
    await save();
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
    api.configureGoalDeliveryDrafts.mockResolvedValue({
      enabled: false,
      epoch: 2,
      savedCount: 1,
    });
    await wrapper
      .get('[data-testid="toggle-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("保留 1 份历史草稿");
    expect(wrapper.emitted("extension-invalidated")).toHaveLength(2);
  });
  it.each(["identity", "revision", "unmount"])(
    "discards late body after %s changes",
    async (change) => {
      await enable();
      api.listGoalDeliveryDrafts.mockResolvedValue({
        entries: [draft()],
        unavailableCount: 0,
        nextCursor: null,
      });
      await save();
      let finish!: (value: any) => void;
      api.readGoalDeliveryDraft.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
      if (change === "identity")
        await wrapper.setProps({ identityKey: "other" });
      if (change === "revision")
        await wrapper.setProps({ goal: { ...goal, revision: 3 } });
      if (change === "unmount") wrapper.unmount();
      finish(draft());
      await flushPromises();
      expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
        false,
      );
    },
  );
  it("clears old source content when native authorization is lost", async () => {
    await enable();
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: null,
    });
    await save();
    api.readGoalDeliveryDraft.mockRejectedValue(
      new Error("GOAL_AUTHORITY_UNAVAILABLE"),
    );
    await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
      false,
    );
  });
  it("rejects another goal/store/version or a non-builtin origin", async () => {
    await enable();
    for (const patch of [
      { goalRef: { ...ref, id: "other" } },
      { goalRef: { ...ref, storeId: "other" } },
      { goalRef: { ...ref, revision: 3 } },
    ]) {
      api.listGoalDeliveryDrafts.mockResolvedValue({
        entries: [{ ...draft(), proposal: { ...draft().proposal, ...patch } }],
        unavailableCount: 0,
        nextCursor: null,
      });
      api.getGoalDeliveryDraftStatus.mockResolvedValue({
        enabled: true,
        epoch: 1,
        savedCount: 1,
      });
      await wrapper
        .get('[data-testid="refresh-delivery-drafts"]')
        .trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-testid="read-delivery-draft"]').exists()).toBe(
        false,
      );
    }
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [{ ...draft(), origin: "plugin-claim" }],
      unavailableCount: 0,
      nextCursor: null,
    });
    await wrapper
      .get('[data-testid="refresh-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="read-delivery-draft"]').exists()).toBe(
      false,
    );
  });
  it("explicitly pages past unavailable history", async () => {
    await enable();
    api.getGoalDeliveryDraftStatus.mockResolvedValue({
      enabled: true,
      epoch: 3,
      savedCount: 2,
    });
    api.listGoalDeliveryDrafts.mockResolvedValueOnce({
      entries: [],
      unavailableCount: 1,
      nextCursor: draftId,
    });
    await wrapper
      .get('[data-testid="refresh-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("历史草稿的授权或来源已变化");
    await wrapper.get('[data-testid="more-delivery-drafts"]').trigger("click");
    await flushPromises();
    expect(api.listGoalDeliveryDrafts.mock.calls.at(-1)![0]).toEqual({
      goalRef: ref,
      limit: 20,
      afterId: draftId,
    });
  });
  it.each(["removed", "new-review"])(
    "discards a late body when its native source is %s",
    async (change) => {
      await enable();
      api.listGoalDeliveryDrafts.mockResolvedValue({
        entries: [draft()],
        unavailableCount: 0,
        nextCursor: null,
      });
      await save();
      let finish!: (value: any) => void;
      api.readGoalDeliveryDraft.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await wrapper.get('[data-testid="read-delivery-draft"]').trigger("click");
      await wrapper.setProps({
        sources:
          change === "removed"
            ? []
            : [
                {
                  id: "native-proposal",
                  sourceTaskId: "t1",
                  reviewId: "new-review",
                  reviewDigest: "new-digest",
                },
              ],
      });
      finish(draft());
      await flushPromises();
      expect(wrapper.find('[data-testid="delivery-draft-body"]').exists()).toBe(
        false,
      );
    },
  );
  it("discards a late list after the same proposal receives a new risk review", async () => {
    await enable();
    api.getGoalDeliveryDraftStatus.mockResolvedValue({
      enabled: true,
      epoch: 1,
      savedCount: 1,
    });
    let finish!: (value: any) => void;
    api.listGoalDeliveryDrafts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .get('[data-testid="refresh-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    await wrapper.setProps({
      sources: [
        {
          id: "native-proposal",
          sourceTaskId: "t1",
          reviewId: "new-review",
          reviewDigest: "new-digest",
        },
      ],
    });
    finish({ entries: [draft()], unavailableCount: 0, nextCursor: null });
    await flushPromises();
    expect(wrapper.find('[data-testid="read-delivery-draft"]').exists()).toBe(
      false,
    );
  });
  it("uses a new request after uncertain save followed by explicit disable/re-enable", async () => {
    await enable();
    api.listGoalDeliveryDrafts.mockRejectedValueOnce(new Error("read timeout"));
    await save();
    const request = api.proposeGoalDeliveryDraft.mock.calls[0][0];
    api.configureGoalDeliveryDrafts.mockResolvedValueOnce({
      enabled: false,
      epoch: 2,
      savedCount: 1,
    });
    await wrapper
      .get('[data-testid="toggle-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    api.configureGoalDeliveryDrafts.mockResolvedValueOnce({
      enabled: true,
      epoch: 3,
      savedCount: 1,
    });
    await wrapper
      .get('[data-testid="toggle-delivery-drafts"]')
      .trigger("click");
    await flushPromises();
    await save();
    expect(api.proposeGoalDeliveryDraft.mock.calls[1][0].requestId).not.toBe(
      request.requestId,
    );
  });
  it("drops old pages and cursor if a fresh status observes a new grant epoch", async () => {
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: draftId,
    });
    await enable();
    api.getGoalDeliveryDraftStatus.mockResolvedValue({
      enabled: true,
      epoch: 3,
      savedCount: 1,
    });
    api.listGoalDeliveryDrafts.mockResolvedValue({
      entries: [],
      unavailableCount: 1,
      nextCursor: null,
    });
    await wrapper.get('[data-testid="more-delivery-drafts"]').trigger("click");
    await flushPromises();
    expect(api.listGoalDeliveryDrafts.mock.calls.at(-1)![0]).toEqual({
      goalRef: ref,
      limit: 20,
    });
    expect(wrapper.find('[data-testid="read-delivery-draft"]').exists()).toBe(
      false,
    );
  });
});
