import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Panel from "../ProjectGoalModelDraftsPanel.vue";
const goal = {
  id: "g1",
  storeId: "store1",
  revision: 1,
  controlGeneration: 0,
  status: "active",
};
const source = `goal-proposal-${"b".repeat(64)}`,
  draftId = `goal-extension-${"a".repeat(64)}`;
const sources = [
  { id: source, sourceTaskId: "t1", actionType: "task.update-description" },
  {
    id: `goal-proposal-${"c".repeat(64)}`,
    sourceTaskId: "t1",
    actionType: "task.create",
  },
];
let api: any, w: any, invalidateMemory: () => void;
function draft() {
  return {
    id: draftId,
    plugin: {
      name: "project-delivery-model-drafts",
      scope: "desktop-builtin",
      version: "0.1.0",
    },
    origin: "builtin-rule",
    modelOutputExpiresAt: null,
    proposal: {
      type: "task.description.update",
      goalRef: {
        id: "g1",
        storeId: "store1",
        revision: 1,
        controlGeneration: 0,
      },
      sourceRef: source,
      requestId: "saved-request",
      title: "Model suggestion",
      description: "<script>inert suggestion</script>",
    },
  };
}
function setup() {
  w = mount(Panel, { props: { goal, sources, identityKey: "owner" } });
  return w;
}
async function select() {
  await flushPromises();
  await w.get('[data-testid="model-draft-source"]').setValue(source);
}
async function read() {
  await flushPromises();
  await w.get('[data-testid="read-model-draft"]').trigger("click");
  await flushPromises();
}
beforeEach(() => {
  api = {
    generateGoalModelDraft: vi.fn(async (input: any) => ({
      goalId: "g1",
      requestId: input.requestId,
      state: "saved",
      proposalId: draftId,
    })),
    getGoalModelDraftStatus: vi.fn(async (input: any) => ({
      goalId: "g1",
      requestId: input.requestId,
      state: "unknown",
      proposalId: null,
    })),
    listGoalModelDraftRequests: vi.fn(async () => ({
      entries: [
        {
          id: `goal-model-${"f".repeat(64)}`,
          goalId: "g1",
          requestId: "prior-request",
          state: "unknown",
          proposalId: null,
        },
      ],
      nextCursor: null,
    })),
    listGoalModelDrafts: vi.fn(async () => ({
      entries: [draft()],
      unavailableCount: 0,
      nextCursor: null,
    })),
    readGoalModelDraft: vi.fn(async () => draft()),
    prepareGoalModelDraft: vi.fn(async () => ({
      intent: { id: "i1", goalId: "g1", extensionRef: { draftId } },
    })),
    revokeGoalModelDraft: vi.fn(async (input: any) => ({
      goalId: "g1",
      requestId: input.requestId,
      state: "revoked",
      proposalId: null,
    })),
    onGoalMemoryInvalidated: vi.fn((fn: any) => {
      invalidateMemory = fn;
      return vi.fn();
    }),
  };
  (window as any).electronAPI = { project: api };
});
afterEach(() => {
  w?.unmount();
  delete (window as any).electronAPI;
  vi.useRealTimers();
});
describe("explicit local model drafting controls and output authorization", () => {
  it.each(["GOAL_EXTENSION_NOT_ADMITTED", "ACTION_GOAL_NOT_ACTIVE"])(
    "does not retry a rejected list when the parent rebinds equivalent sources (%s)",
    async (code) => {
      api.listGoalModelDrafts.mockRejectedValue(
        Object.assign(new Error(code), { code }),
      );
      setup();
      await flushPromises();
      expect(api.listGoalModelDrafts).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 3; index++) {
        await w.setProps({ sources: sources.map((entry) => ({ ...entry })) });
        await flushPromises();
      }
      expect(api.listGoalModelDrafts).toHaveBeenCalledTimes(1);
      expect(api.generateGoalModelDraft).not.toHaveBeenCalled();
      await w.setProps({ goal: { ...goal, revision: goal.revision + 1 } });
      await flushPromises();
      expect(api.listGoalModelDrafts).toHaveBeenCalledTimes(2);
    },
  );

  it("finds an unknown durable request after restart using body-free history and only queries it", async () => {
    setup();
    await flushPromises();
    await w.get('[data-testid="refresh-model-requests"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("prior-request");
    await w.get('[data-testid="recover-model-request"]').trigger("click");
    await flushPromises();
    expect(api.getGoalModelDraftStatus).toHaveBeenCalledExactlyOnceWith({
      goalId: "g1",
      requestId: "prior-request",
    });
    expect(api.generateGoalModelDraft).not.toHaveBeenCalled();
  });
  it("reports a definite preflight budget refusal and waits for a new explicit click", async () => {
    api.generateGoalModelDraft.mockRejectedValue(
      Object.assign(new Error("GOAL_USAGE_UNKNOWN"), {
        code: "GOAL_USAGE_UNKNOWN",
      }),
    );
    setup();
    await select();
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("未知 token 和费用不能按零处理");
    expect(
      w.get('[data-testid="generate-model-draft"]').attributes("disabled"),
    ).toBeUndefined();
    expect(api.generateGoalModelDraft).toHaveBeenCalledOnce();
  });
  it("never generates automatically, defaults memory off, and submits only fixed native binding selections", async () => {
    setup();
    await select();
    expect(api.generateGoalModelDraft).not.toHaveBeenCalled();
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await flushPromises();
    const request = api.generateGoalModelDraft.mock.calls[0][0];
    expect(request).toMatchObject({
      goalRef: {
        id: "g1",
        storeId: "store1",
        revision: 1,
        controlGeneration: 0,
      },
      sourceRef: source,
      type: "task.description.update",
      useMemory: false,
    });
    expect(Object.keys(request).sort()).toEqual(
      ["goalRef", "requestId", "sourceRef", "type", "useMemory"].sort(),
    );
    expect(w.text()).toContain(request.requestId);
    expect(w.text()).toContain("尚未修改或创建任务");
  });
  it("selects task type and memory explicitly without accepting output or approvals from the renderer", async () => {
    setup();
    await flushPromises();
    await w.get('[data-testid="model-draft-type"]').setValue("task.create");
    await flushPromises();
    await w
      .get('[data-testid="model-draft-task-type"]')
      .setValue("analyze_data");
    await flushPromises();
    await w.get('[data-testid="model-draft-source"]').setValue(sources[1].id);
    await w.get('[data-testid="model-draft-use-memory"]').setValue(true);
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await flushPromises();
    expect(api.generateGoalModelDraft.mock.calls[0][0]).toMatchObject({
      type: "task.create",
      taskType: "analyze_data",
      useMemory: true,
      sourceRef: sources[1].id,
    });
  });
  it("retains an unknown request ID and queries only that identity without re-generating", async () => {
    api.generateGoalModelDraft.mockRejectedValue(new Error("lost response"));
    setup();
    await select();
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await flushPromises();
    const id = api.generateGoalModelDraft.mock.calls[0][0].requestId;
    expect(w.text()).toContain(id);
    expect(
      w.get('[data-testid="generate-model-draft"]').attributes("disabled"),
    ).toBeDefined();
    await w.get('[data-testid="lookup-model-draft"]').trigger("click");
    await flushPromises();
    expect(api.getGoalModelDraftStatus).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: id,
    });
    expect(api.generateGoalModelDraft).toHaveBeenCalledOnce();
  });
  it("restores a request from an explicit ID and never treats not-found as a resend trigger", async () => {
    api.getGoalModelDraftStatus.mockImplementation(async (input: any) => ({
      goalId: "g1",
      requestId: input.requestId,
      state: "not-found",
      proposalId: null,
    }));
    setup();
    await flushPromises();
    await w
      .get('[data-testid="model-draft-lookup-id"]')
      .setValue("prior-request");
    await w.get('[data-testid="lookup-model-draft"]').trigger("click");
    await flushPromises();
    expect(api.generateGoalModelDraft).not.toHaveBeenCalled();
    expect(w.text()).toContain("查询时未找到，不自动重发");
  });
  it("renders saved text inertly and prepares only the saved native identifier", async () => {
    setup();
    await read();
    expect(w.find("script").exists()).toBe(false);
    expect(w.text()).toContain("<script>inert suggestion</script>");
    await w.get('[data-testid="prepare-model-draft"]').trigger("click");
    await flushPromises();
    expect(api.prepareGoalModelDraft).toHaveBeenCalledExactlyOnceWith({
      id: draftId,
    });
    expect(w.emitted("intent-prepared")).toHaveLength(1);
  });
  it("clears body/preview on Memory invalidation and discards a late read", async () => {
    setup();
    await read();
    invalidateMemory();
    await flushPromises();
    expect(w.find('[data-testid="model-draft-body"]').exists()).toBe(false);
    expect(w.emitted("extension-invalidated")).toBeTruthy();
    await w.get('[data-testid="refresh-model-drafts"]').trigger("click");
    await flushPromises();
    let finish: any;
    api.readGoalModelDraft.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await w.get('[data-testid="read-model-draft"]').trigger("click");
    invalidateMemory();
    finish(draft());
    await flushPromises();
    expect(w.find('[data-testid="model-draft-body"]').exists()).toBe(false);
  });
  it("clears already displayed memory-derived titles, body and parent preview at the native expiry", async () => {
    const expiry = new Date(Date.now() + 1000).toISOString();
    api.listGoalModelDrafts.mockResolvedValue({
      entries: [{ ...draft(), modelOutputExpiresAt: expiry }],
      unavailableCount: 0,
      nextCursor: null,
    });
    api.readGoalModelDraft.mockResolvedValue({
      ...draft(),
      modelOutputExpiresAt: expiry,
    });
    vi.useFakeTimers();
    setup();
    await read();
    expect(w.find('[data-testid="model-draft-body"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();
    expect(w.find('[data-testid="model-draft-body"]').exists()).toBe(false);
    expect(w.text()).not.toContain("Model suggestion");
    expect(w.emitted("extension-invalidated")).toBeTruthy();
  });
  it("discards late generation after identity changes and never exposes the old receipt", async () => {
    let finish: any;
    api.generateGoalModelDraft.mockImplementation(
      (request: any) =>
        new Promise(
          (resolve) =>
            (finish = () =>
              resolve({
                goalId: "g1",
                requestId: request.requestId,
                state: "saved",
                proposalId: draftId,
              })),
        ),
    );
    setup();
    await select();
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await w.setProps({ identityKey: "other" });
    finish();
    await flushPromises();
    expect(w.find('[data-testid="model-draft-receipt"]').exists()).toBe(false);
    expect(w.find('[data-testid="model-draft-reference"]').exists()).toBe(
      false,
    );
  });
  it("revokes an unknown original request without sending another model call", async () => {
    api.generateGoalModelDraft.mockImplementation(async (input: any) => ({
      goalId: "g1",
      requestId: input.requestId,
      state: "unknown",
      proposalId: null,
    }));
    setup();
    await select();
    await w.get('[data-testid="generate-model-draft"]').trigger("click");
    await flushPromises();
    const id = api.generateGoalModelDraft.mock.calls[0][0].requestId;
    await w.get('[data-testid="revoke-model-request"]').trigger("click");
    await flushPromises();
    expect(api.revokeGoalModelDraft).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: id,
    });
    expect(api.generateGoalModelDraft).toHaveBeenCalledOnce();
    expect(w.text()).toContain("已撤销");
  });
});
