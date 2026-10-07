import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalMemoryPanel.vue";

const goal = { id: "g1", revision: 2, status: "active" };
const reference = {
  kind: "context-memory-kernel",
  id: "m1",
  version: "v1:r1:sha256:original",
};
function item(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: "m1",
    reference,
    currentVersion: reference.version,
    grantState: "active",
    state: "active",
    record: {
      content: "Owner's sensitive fact",
      category: "user-fact",
      revision: 1,
      updatedAt: "2026-10-07T00:00:00.000Z",
      provenance: {
        source: "goal-memory.user-fact",
        observedAt: "2026-10-07T00:00:00.000Z",
      },
      retentionPolicy: {},
    },
    ...overrides,
  };
}
function operation(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "original-op",
    type: "create",
    status: "prepared",
    result: null,
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("goal memory renderer with fresh authority and durable request identity", () => {
  let wrapper: VueWrapper,
    api: Record<string, any>,
    invalidated: () => void,
    unsubscribe: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    unsubscribe = vi.fn();
    api = {
      listGoalMemories: vi.fn(async () => ({
        goalId: "g1",
        goalRevision: 2,
        items: [item()],
        nextCursor: null,
      })),
      listGoalMemoryOperations: vi.fn(async () => ({
        goalId: "g1",
        items: [],
        nextCursor: null,
      })),
      createGoalMemory: vi.fn(async () => ({
        goal,
        operation: operation({ status: "complete" }),
      })),
      correctGoalMemory: vi.fn(async () => ({
        goal,
        operation: operation({ type: "correct", status: "complete" }),
      })),
      revokeGoalMemory: vi.fn(async () => ({
        goal,
        operation: operation({ type: "revoke", status: "complete" }),
      })),
      deleteGoalMemory: vi.fn(async () => ({
        goal,
        operation: operation({
          type: "delete",
          status: "complete",
          result: { receipt: { status: "purged" } },
        }),
      })),
      recoverGoalMemoryOperation: vi.fn(async () => ({
        goal,
        operation: operation({ status: "complete" }),
      })),
      discardGoalMemoryOperation: vi.fn(async () => ({
        goal,
        operation: operation({ status: "discarded" }),
      })),
      onGoalMemoryInvalidated: vi.fn((callback) => {
        invalidated = callback;
        return unsubscribe;
      }),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, { props: { goal, identityKey: "owner-auth-1" } });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const refresh = () =>
    wrapper.get('[data-testid="refresh-memories"]').trigger("click");
  const submit = () => wrapper.get("form").trigger("submit");
  function button(label: string) {
    const found = wrapper
      .findAll("button")
      .find((candidate) => candidate.text() === label);
    if (!found) throw new Error("Missing button: " + label);
    return found;
  }

  it("reads existing memory and source metadata without creating or restoring facts automatically", async () => {
    await flushPromises();
    expect(api.listGoalMemories).toHaveBeenCalledWith({
      goalId: "g1",
      limit: 20,
    });
    expect(api.createGoalMemory).not.toHaveBeenCalled();
    expect(api.recoverGoalMemoryOperation).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Owner's sensitive fact");
    expect(wrapper.text()).toContain("用户明确事实");
    expect(wrapper.text()).toContain("版本 1");
  });

  it("submits only explicit content/classification and current revision, without authority claims", async () => {
    await flushPromises();
    await wrapper.get("textarea").setValue("An explicitly recorded inference");
    await wrapper
      .get('[data-testid="memory-category"]')
      .setValue("agent-inference");
    await submit();
    await flushPromises();
    const request = api.createGoalMemory.mock.calls[0][0];
    expect(request).toMatchObject({
      goalId: "g1",
      expectedRevision: 2,
      content: "An explicitly recorded inference",
      category: "agent-inference",
    });
    expect(Object.keys(request).sort()).toEqual([
      "category",
      "content",
      "expectedRevision",
      "goalId",
      "requestId",
    ]);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("corrects through the existing canonical version and clears copied body after refresh failure", async () => {
    await flushPromises();
    await button("修正").trigger("click");
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "Owner's sensitive fact",
    );
    api.listGoalMemories.mockRejectedValueOnce(
      new Error("GOAL_MEMORY_RECORD_CORRUPT"),
    );
    await refresh();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Owner's sensitive fact");
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    await refresh();
    await flushPromises();
    await button("修正").trigger("click");
    await wrapper.get("textarea").setValue("Corrected fact");
    await submit();
    await flushPromises();
    expect(api.correctGoalMemory.mock.calls[0][0]).toMatchObject({
      memoryId: "m1",
      memoryVersion: reference.version,
      content: "Corrected fact",
    });
  });

  it("revokes the grant version even when canonical version changed and clears the displayed body before waiting", async () => {
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [item({ currentVersion: "v1:r2:sha256:reinforced" })],
      nextCursor: null,
    });
    await flushPromises();
    await refresh();
    await flushPromises();
    const pending = deferred<any>();
    api.revokeGoalMemory.mockReturnValueOnce(pending.promise);
    await wrapper.get('[data-testid="revoke-memory"]').trigger("click");
    expect(wrapper.find('[data-testid="memory-body"]').exists()).toBe(false);
    expect(api.revokeGoalMemory.mock.calls[0][0].memoryVersion).toBe(
      reference.version,
    );
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [item({ grantState: "revoked", record: null })],
      nextCursor: null,
    });
    pending.resolve({
      goal,
      operation: operation({ type: "revoke", status: "complete" }),
    });
    await flushPromises();
    expect(wrapper.text()).toContain("使用权已撤销");
  });

  it("requires an explicit second delete click and binds the current canonical version", async () => {
    await flushPromises();
    await wrapper.get('[data-testid="delete-memory"]').trigger("click");
    expect(api.deleteGoalMemory).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="confirm-memory-delete"]').trigger("click");
    await flushPromises();
    expect(api.deleteGoalMemory.mock.calls[0][0]).toMatchObject({
      goalId: "g1",
      memoryId: "m1",
      memoryVersion: reference.version,
    });
  });

  it("shows partial deletion as unreadable and pending cleanup, without claiming purged", async () => {
    await flushPromises();
    api.deleteGoalMemory.mockResolvedValue({
      goal,
      operation: operation({ type: "delete", status: "denied" }),
      receipt: { status: "partial" },
    });
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [item({ grantState: "deleted", state: "deleted", record: null })],
      nextCursor: null,
    });
    api.listGoalMemoryOperations.mockResolvedValue({
      goalId: "g1",
      items: [operation({ type: "delete", status: "denied" })],
      nextCursor: null,
    });
    await wrapper.get('[data-testid="delete-memory"]').trigger("click");
    await wrapper.get('[data-testid="confirm-memory-delete"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("清理尚未完成");
    expect(wrapper.text()).not.toContain("清理已完成");
    expect(wrapper.text()).not.toContain("Owner's sensitive fact");
    expect(wrapper.find('[data-testid="recover-memory"]').exists()).toBe(true);
  });

  it("keeps the exact create request and locks draft fields after an uncertain transport result", async () => {
    await flushPromises();
    api.createGoalMemory.mockRejectedValueOnce(new Error("timeout"));
    await wrapper.get("textarea").setValue("Original explicit fact");
    await submit();
    await flushPromises();
    const request = api.createGoalMemory.mock.calls[0][0];
    expect(wrapper.get("textarea").attributes("disabled")).toBeDefined();
    await submit();
    await flushPromises();
    expect(api.createGoalMemory.mock.calls[1][0]).toEqual(request);
  });

  it("discards late reads and mutation responses after the same DID reauthenticates", async () => {
    await flushPromises();
    const pending = deferred<any>();
    api.createGoalMemory.mockReturnValueOnce(pending.promise);
    await wrapper.get("textarea").setValue("Old draft");
    await submit();
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [],
      nextCursor: null,
    });
    await wrapper.setProps({ identityKey: "owner-auth-2" });
    await flushPromises();
    pending.resolve({
      goal: { ...goal, revision: 3 },
      operation: operation({ status: "complete" }),
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Owner's sensitive fact");
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("invalidates an older in-flight memory read before applying a fresh denial response", async () => {
    await flushPromises();
    const stale = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(stale.promise);
    await refresh();
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [item({ grantState: "revoked", record: null })],
      nextCursor: null,
    });
    invalidated();
    await flushPromises();
    stale.resolve({
      goalId: "g1",
      goalRevision: 2,
      items: [item()],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.text()).toContain("使用权已撤销");
    expect(wrapper.text()).not.toContain("Owner's sensitive fact");
  });

  it("drops copied correction payload after uncertain transport and only recovers by its request ID", async () => {
    await flushPromises();
    await button("修正").trigger("click");
    api.correctGoalMemory.mockRejectedValueOnce(new Error("timeout"));
    await submit();
    await flushPromises();
    const original = api.correctGoalMemory.mock.calls[0][0];
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(wrapper.get('[data-testid="save-memory"]').text()).toBe(
      "核对本次修正结果",
    );
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [item({ grantState: "revoked", record: null })],
      nextCursor: null,
    });
    invalidated();
    await flushPromises();
    await submit();
    await flushPromises();
    expect(api.correctGoalMemory).toHaveBeenCalledTimes(1);
    expect(api.recoverGoalMemoryOperation).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: original.requestId,
    });
    expect(api.recoverGoalMemoryOperation.mock.calls[0][0]).not.toHaveProperty(
      "content",
    );
  });

  it("discards uncertain writes and ignores their late response after identity changes", async () => {
    await flushPromises();
    const pending = deferred<any>();
    api.createGoalMemory.mockReturnValueOnce(pending.promise);
    await wrapper.get("textarea").setValue("Old identity explicit fact");
    await submit();
    await wrapper.setProps({ identityKey: "different-login" });
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(wrapper.get('[data-testid="save-memory"]').text()).toBe(
      "保存新记忆",
    );
    pending.resolve({
      goal: { ...goal, revision: 3 },
      operation: operation({ status: "complete" }),
    });
    await flushPromises();
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
    expect(wrapper.text()).not.toContain("操作结果已记录");
  });

  it("fences a late operation page and keeps a newer authoritative load busy until it finishes", async () => {
    await flushPromises();
    api.listGoalMemoryOperations.mockResolvedValueOnce({
      goalId: "g1",
      items: [],
      nextCursor: "older",
    });
    await refresh();
    await flushPromises();
    const old = deferred<any>();
    api.listGoalMemoryOperations.mockReturnValueOnce(old.promise);
    await button("下一页操作记录").trigger("click");
    const fresh = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(fresh.promise);
    api.listGoalMemoryOperations.mockResolvedValueOnce({
      goalId: "g1",
      items: [operation({ status: "complete" })],
      nextCursor: null,
    });
    invalidated();
    old.resolve({
      goalId: "g1",
      items: [operation({ status: "prepared" })],
      nextCursor: null,
    });
    await flushPromises();
    expect(
      wrapper.get('[data-testid="refresh-memories"]').attributes("disabled"),
    ).toBeDefined();
    fresh.resolve({
      goalId: "g1",
      goalRevision: 2,
      items: [item()],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="recover-memory"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("保存：已完成");
  });

  it("unlocks explicit input when body-free correction recovery proves no operation was recorded", async () => {
    await flushPromises();
    await button("修正").trigger("click");
    api.correctGoalMemory.mockRejectedValueOnce(
      new Error("transport before dispatch"),
    );
    await submit();
    await flushPromises();
    api.recoverGoalMemoryOperation.mockRejectedValueOnce(
      new Error("GOAL_MEMORY_OPERATION_NOT_FOUND"),
    );
    await submit();
    await flushPromises();
    expect(wrapper.get("textarea").attributes("disabled")).toBeUndefined();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(wrapper.get('[data-testid="save-memory"]').text()).toBe(
      "保存新记忆",
    );
    expect(wrapper.text()).toContain("请重新输入内容");
    expect(api.correctGoalMemory).toHaveBeenCalledTimes(1);
  });

  it("clears a copied correction and history on authoritative permission failure", async () => {
    await flushPromises();
    await button("修正").trigger("click");
    api.listGoalMemories.mockRejectedValueOnce(
      new Error("GOAL_NOT_FOUND_OR_DENIED"),
    );
    await refresh();
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-body"]').exists()).toBe(false);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });

  it("replaces a memory page instead of retaining previously authorized body text", async () => {
    await flushPromises();
    api.listGoalMemories.mockResolvedValueOnce({
      goalId: "g1",
      goalRevision: 2,
      items: [item()],
      nextCursor: "m1",
    });
    await refresh();
    await flushPromises();
    api.listGoalMemories.mockResolvedValueOnce({
      goalId: "g1",
      goalRevision: 2,
      items: [
        item({
          memoryId: "m2",
          record: { ...item().record, content: "Next page fact" },
        }),
      ],
      nextCursor: null,
    });
    await button("下一页记忆（替换当前显示）").trigger("click");
    await flushPromises();
    expect(api.listGoalMemories.mock.calls.at(-1)[0].afterId).toBe("m1");
    expect(wrapper.text()).toContain("Next page fact");
    expect(wrapper.text()).not.toContain("Owner's sensitive fact");
  });

  it("expires body and copied correction text locally even if the transport still returns the old record", async () => {
    await flushPromises();
    expect(
      wrapper.get('[data-testid="refresh-memories"]').attributes("disabled"),
    ).toBeUndefined();
    const start = Date.now() + 100000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    let expire: () => void = () => {
      throw new Error("Expiry not scheduled");
    };
    const timer = vi.spyOn(window, "setTimeout").mockImplementation(((
      callback: () => void,
    ) => {
      expire = callback;
      return 1;
    }) as typeof setTimeout);
    api.listGoalMemories.mockResolvedValue({
      goalId: "g1",
      goalRevision: 2,
      items: [
        item({
          record: {
            ...item().record,
            retentionPolicy: {
              expiresAt: new Date(start + 1000).toISOString(),
            },
          },
        }),
      ],
      nextCursor: null,
    });
    await refresh();
    await flushPromises();
    expect(api.listGoalMemories).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain(new Date(start + 1000).toISOString());
    await button("修正").trigger("click");
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 1000);
    vi.setSystemTime(start + 1000);
    expire();
    expect(Date.now()).toBe(start + 1000);
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-body"]').exists()).toBe(false);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(timer).toHaveBeenCalledTimes(1);
  });

  it("recovers using the persisted operation identity and permits explicit stale-candidate discard", async () => {
    await flushPromises();
    api.listGoalMemoryOperations.mockResolvedValue({
      goalId: "g1",
      items: [operation()],
      nextCursor: null,
    });
    await refresh();
    await flushPromises();
    api.recoverGoalMemoryOperation.mockResolvedValue({
      goal,
      operation: operation(),
      blockedReason: "GOAL_REVISION_CONFLICT",
    });
    await wrapper.get('[data-testid="recover-memory"]').trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemoryOperation).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: "original-op",
    });
    expect(wrapper.text()).toContain("原操作尚未完成");
    api.discardGoalMemoryOperation.mockRejectedValueOnce(new Error("timeout"));
    await wrapper
      .get('[data-testid="discard-memory-operation"]')
      .trigger("click");
    await flushPromises();
    const request = api.discardGoalMemoryOperation.mock.calls[0][0];
    await refresh();
    await flushPromises();
    await wrapper
      .get('[data-testid="discard-memory-operation"]')
      .trigger("click");
    await flushPromises();
    expect(api.discardGoalMemoryOperation.mock.calls[1][0]).toEqual(request);
    expect(request.operationRequestId).toBe("original-op");
  });

  it("does not cancel an active save when its body-free invalidation arrives before its response", async () => {
    await flushPromises();
    const pending = deferred<any>();
    api.createGoalMemory.mockReturnValueOnce(pending.promise);
    await wrapper.get("textarea").setValue("New fact");
    await submit();
    invalidated();
    pending.resolve({ goal, operation: operation({ status: "complete" }) });
    await flushPromises();
    expect(wrapper.text()).toContain("操作结果已记录");
    expect(wrapper.get('[data-testid="save-memory"]').text()).toBe(
      "保存新记忆",
    );
  });

  it("retains privacy controls but hides creation on an independently completed goal", async () => {
    await flushPromises();
    await wrapper.setProps({ goal: { ...goal, status: "done" } });
    await flushPromises();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find('[data-testid="revoke-memory"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="delete-memory"]').exists()).toBe(true);
  });

  it("unsubscribes invalidation and ignores late responses on unmount", async () => {
    await flushPromises();
    const pending = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(pending.promise);
    await refresh();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    pending.resolve({
      goalId: "g1",
      goalRevision: 2,
      items: [item()],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
  });
});
