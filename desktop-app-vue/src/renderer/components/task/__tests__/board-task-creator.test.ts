import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import Component from "../BoardTaskCreator.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";
const digest = `sha256:${"a".repeat(64)}`;
const source = (extra = {}) => ({
  success: true,
  board: { id: "board-1", orgId: "org-1" },
  columns: [
    { id: "column-1", name: "待处理" },
    { id: "column-2", name: "进行中" },
  ],
  creatable: true,
  optionalFields: { assigneeDid: true },
  ...extra,
});
const data = (extra = {}) => ({
  columnId: "column-1",
  title: "New task",
  description: "",
  priority: "medium",
  assigneeDid: null,
  dueDate: null,
  estimatedHours: null,
  actualHours: null,
  position: 0,
  parentTaskId: null,
  ...extra,
});
const request = (input: any) => ({
  actionType: "board-task.create",
  actionVersion: 1,
  target: {
    type: "Task",
    id: "new-task",
    sourceKind: "desktop.board-task",
    scope: { kind: "organization", id: "org-1" },
    version: digest,
  },
  expectedVersion: digest,
  invocationDigest: digest,
  idempotencyKey: input.idempotencyKey,
  input: {
    boardId: input.boardId,
    taskData: input.taskData,
    previewId: "preview-1",
  },
});
const prepared = (input: any) => ({
  success: true,
  runId: "create-run",
  taskId: "new-task",
  request: request(input),
  before: null,
  after: {
    id: "new-task",
    boardId: input.boardId,
    ...input.taskData,
    status: "open",
    taskType: input.taskData.parentTaskId ? "subtask" : "task",
  },
});
const receipt = (status = "succeeded") => ({
  success: true,
  run: {
    id: "create-run",
    actionType: "board-task.create",
    actionVersion: 1,
    target: {
      type: "Task",
      id: "new-task",
      sourceKind: "desktop.board-task",
      scope: { kind: "organization", id: "org-1" },
    },
    status,
    invocationDigest: digest,
  },
  evidence: [],
  executionState:
    status === "unknown" || status === "running" ? "unresolved" : "recorded",
});
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise((value) => {
    resolve = value;
  });
  return { promise, resolve };
}
describe("controlled board task creator", () => {
  let wrapper: any, api: any, invalidate: () => void, unsubscribe: any;
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().isAuthenticated = true;
    api = {
      getBoardCreateSource: vi.fn().mockResolvedValue(source()),
      previewBoardCreate: vi
        .fn()
        .mockImplementation(async (input) => prepared(input)),
      executeBoardCreate: vi.fn().mockResolvedValue(receipt()),
      getBoardCreateRuns: vi.fn().mockResolvedValue({
        success: true,
        runs: [],
        unresolvedRun: null,
        nextCursor: null,
      }),
      cancelBoardCreate: vi.fn().mockResolvedValue(receipt("cancelled")),
      createTask: vi.fn(),
    };
    unsubscribe = vi.fn();
    (window as any).electronAPI = {
      task: api,
      invoke: vi.fn(),
      notification: {
        onInvalidated: vi.fn((fn) => {
          invalidate = fn;
          return unsubscribe;
        }),
      },
    };
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });
  async function render(props = {}) {
    wrapper = mount(Component, {
      props: { boardId: "board-1", ...props },
      global: { plugins: [pinia] },
    });
    await flushPromises();
  }
  async function action(name: string) {
    await wrapper.find(`[data-create-action="${name}"]`).trigger("click");
    await flushPromises();
  }
  async function preview() {
    await wrapper.find('[data-create-field="title"]').setValue("New task");
    await action("preview");
  }
  it("loads only current board source and bounded history with no implicit creation", async () => {
    await render({ initialColumnId: "column-2" });
    expect(api.getBoardCreateSource).toHaveBeenCalledWith({
      boardId: "board-1",
    });
    expect(api.getBoardCreateRuns).toHaveBeenCalledWith({
      boardId: "board-1",
      limit: 20,
    });
    expect(wrapper.find('[data-create-field="columnId"]').element.value).toBe(
      "column-2",
    );
    expect(api.previewBoardCreate).not.toHaveBeenCalled();
    expect(api.executeBoardCreate).not.toHaveBeenCalled();
  });
  it("previews normalized defaults against a fresh source and shows the host-allocated ID", async () => {
    await render();
    await preview();
    expect(api.getBoardCreateSource).toHaveBeenCalledTimes(2);
    expect(api.previewBoardCreate).toHaveBeenCalledWith({
      boardId: "board-1",
      taskData: data(),
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(wrapper.find("[data-create-preview]").text()).toContain("new-task");
    expect(
      wrapper.find('[data-create-field="title"]').attributes("disabled"),
    ).toBeDefined();
    expect(api.executeBoardCreate).not.toHaveBeenCalled();
  });
  it("supports a same-board parent with precise dates, zero and fractional hours", async () => {
    await render({ parentTaskId: "parent-1" });
    for (const [field, value] of Object.entries({
      dueDate: "1792281600123",
      estimatedHours: "0",
      actualHours: ".125",
      assigneeDid: "did:member:one",
      position: "1000000",
      priority: "critical",
    }))
      await wrapper.find(`[data-create-field="${field}"]`).setValue(value);
    await preview();
    expect(api.getBoardCreateSource).toHaveBeenLastCalledWith({
      boardId: "board-1",
      parentTaskId: "parent-1",
    });
    expect(api.previewBoardCreate.mock.calls[0][0].taskData).toEqual(
      data({
        parentTaskId: "parent-1",
        dueDate: 1792281600123,
        estimatedHours: 0,
        actualHours: 0.125,
        assigneeDid: "did:member:one",
        position: 1000000,
        priority: "critical",
      }),
    );
    expect(wrapper.find("[data-create-preview]").text()).toContain("子任务");
  });
  it("rechecks a newly entered parent before admitting the preview", async () => {
    await render();
    await wrapper
      .find('[data-create-field="parentTaskId"]')
      .setValue("parent-2");
    api.getBoardCreateSource.mockResolvedValue({
      success: false,
      error: "PRIVATE-PARENT",
    });
    await preview();
    expect(api.getBoardCreateSource).toHaveBeenLastCalledWith({
      boardId: "board-1",
      parentTaskId: "parent-2",
    });
    expect(api.previewBoardCreate).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("PRIVATE");
  });
  it("executes the exact preview request and emits only the authoritative task ID", async () => {
    await render();
    await preview();
    const req = wrapper.vm.previewRequest;
    await action("execute");
    expect(api.executeBoardCreate).toHaveBeenCalledWith({ request: req });
    expect(wrapper.emitted("created")).toEqual([["new-task"]]);
    expect(api.createTask).not.toHaveBeenCalled();
    expect((window as any).electronAPI.invoke).not.toHaveBeenCalled();
    expect(wrapper.find('[data-create-field="title"]').element.value).toBe("");
  });
  it.each(["cancelled", "denied", "failed", "running", "unknown"])(
    "does not claim %s creation succeeded or retry",
    async (status) => {
      api.executeBoardCreate.mockResolvedValue(receipt(status));
      await render();
      await preview();
      await action("execute");
      expect(wrapper.emitted("created")).toBeUndefined();
      expect(api.executeBoardCreate).toHaveBeenCalledTimes(1);
      expect(api.previewBoardCreate).toHaveBeenCalledTimes(1);
    },
  );
  it("turns a lost reply into an unresolved record and permits explicit cancellation", async () => {
    api.executeBoardCreate.mockRejectedValue(new Error("PRIVATE"));
    await render();
    await preview();
    await action("execute");
    expect(
      wrapper.find('[data-create-action="preview"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("不会自动重试");
    expect(wrapper.text()).not.toContain("PRIVATE");
    await action("cancel-recorded");
    expect(api.cancelBoardCreate).toHaveBeenCalledWith({
      boardId: "board-1",
      runId: "create-run",
    });
    expect(
      wrapper.find('[data-create-action="preview"]').attributes("disabled"),
    ).toBeUndefined();
  });
  it("cancels pending native confirmation and suppresses a late success", async () => {
    const delayed = deferred();
    api.executeBoardCreate.mockReturnValue(delayed.promise);
    await render();
    await preview();
    await action("execute");
    await action("cancel");
    delayed.resolve(receipt());
    await flushPromises();
    expect(wrapper.emitted("created")).toBeUndefined();
    expect(wrapper.text()).toContain("创建已取消");
  });
  it("refreshes success discovered during cancellation rather than creating again", async () => {
    api.cancelBoardCreate.mockResolvedValue(receipt());
    await render();
    await preview();
    await action("cancel");
    expect(wrapper.emitted("created")).toEqual([["new-task"]]);
    expect(api.executeBoardCreate).not.toHaveBeenCalled();
  });
  it.each(["running", "unknown"])(
    "restores older %s creation ahead of twenty queued records without replay",
    async (status) => {
      const rows = Array.from({ length: 20 }, (_, i) => {
        const row = receipt("queued");
        row.run.id = `queued-${i}`;
        return row;
      });
      api.getBoardCreateRuns.mockResolvedValue({
        success: true,
        runs: rows,
        unresolvedRun: receipt(status),
      });
      await render();
      expect(wrapper.vm.runs).toHaveLength(21);
      expect(wrapper.vm.runs[0].id).toBe("create-run");
      expect(
        wrapper.find('[data-create-action="preview"]').attributes("disabled"),
      ).toBeDefined();
      expect(api.executeBoardCreate).not.toHaveBeenCalled();
    },
  );
  it("allows a fresh preview after reloading queued metadata without retaining its body", async () => {
    api.getBoardCreateRuns.mockResolvedValue({
      success: true,
      runs: [receipt("queued")],
      unresolvedRun: null,
    });
    await render();
    expect(wrapper.find('[data-create-field="title"]').element.value).toBe("");
    expect(
      wrapper.find('[data-create-action="preview"]').attributes("disabled"),
    ).toBeUndefined();
  });
  it("disables assignment without permission and rejects an injected DID", async () => {
    api.getBoardCreateSource.mockResolvedValue(
      source({ optionalFields: { assigneeDid: false } }),
    );
    await render();
    expect(
      wrapper.find('[data-create-field="assigneeDid"]').attributes("disabled"),
    ).toBeDefined();
    wrapper.vm.draft.assigneeDid = "did:member:one";
    await preview();
    expect(api.previewBoardCreate).not.toHaveBeenCalled();
  });
  it("disables creation when the source has no create permission", async () => {
    api.getBoardCreateSource.mockResolvedValue(source({ creatable: false }));
    await render();
    await action("preview");
    expect(api.previewBoardCreate).not.toHaveBeenCalled();
  });
  it("escapes task and column text in the review", async () => {
    api.getBoardCreateSource.mockResolvedValue(
      source({ columns: [{ id: "column-1", name: "<img src=x>" }] }),
    );
    await render();
    await wrapper
      .find('[data-create-field="description"]')
      .setValue("<script>secret()</script>");
    await preview();
    expect(wrapper.find("[data-create-preview]").text()).toContain("<script>");
    expect(wrapper.find("[data-create-preview]").text()).toContain("<img");
    expect(wrapper.findAll("script,img,iframe")).toHaveLength(0);
  });
  it.each([
    ["title", "文".repeat(342)],
    ["description", "文".repeat(2731)],
    ["dueDate", "0.1"],
    ["dueDate", "8640000000000001"],
    ["dueDate", "2026-01-01"],
    ["estimatedHours", "-1"],
    ["actualHours", "1000001"],
    ["actualHours", "Infinity"],
    ["position", "0.5"],
    ["assigneeDid", "did:"],
    ["parentTaskId", "bad id"],
  ])("rejects invalid %s without creating", async (field, value) => {
    await render();
    await wrapper.find('[data-create-field="title"]').setValue("New task");
    await wrapper.find(`[data-create-field="${field}"]`).setValue(value);
    await action("preview");
    expect(api.previewBoardCreate).not.toHaveBeenCalled();
  });
  it.each(["taskId", "board", "org", "action", "before", "after", "input"])(
    "rejects mismatched %s create preview",
    async (kind) => {
      api.previewBoardCreate.mockImplementation(async (input) => {
        const result = prepared(input);
        if (kind === "taskId") result.taskId = "other";
        if (kind === "board") result.request.input.boardId = "other";
        if (kind === "org") result.request.target.scope.id = "other";
        if (kind === "action")
          result.request.actionType = "board-task.update-fields";
        if (kind === "before") (result as any).before = {};
        if (kind === "after") result.after.status = "done";
        if (kind === "input")
          result.request.input.taskData = {
            ...input.taskData,
            createdBy: "did:forged",
          };
        return result;
      });
      await render();
      await preview();
      expect(wrapper.find("[data-create-preview]").exists()).toBe(false);
      expect(api.executeBoardCreate).not.toHaveBeenCalled();
    },
  );
  it.each(["auth", "device", "identity", "board", "notification", "unmount"])(
    "fences delayed admission across %s changes",
    async (kind) => {
      const delayed = deferred();
      api.previewBoardCreate.mockReturnValue(delayed.promise);
      await render();
      await preview();
      const input = api.previewBoardCreate.mock.calls[0][0];
      if (kind === "auth") {
        useAppStore().isAuthenticated = false;
        useAppStore().isAuthenticated = true;
      }
      if (kind === "device") {
        useAppStore().deviceId = "other";
        useAppStore().deviceId = "";
      }
      if (kind === "identity") useIdentityStore().currentContext = "other";
      if (kind === "board") await wrapper.setProps({ boardId: "board-2" });
      if (kind === "notification") invalidate();
      if (kind === "unmount") wrapper.unmount();
      delayed.resolve(prepared(input));
      await flushPromises();
      if (kind !== "unmount")
        expect(wrapper.find("[data-create-preview]").exists()).toBe(false);
      expect(api.executeBoardCreate).not.toHaveBeenCalled();
    },
  );
  it.each(["scope", "action", "unresolved"])(
    "rejects corrupt %s history",
    async (kind) => {
      const row = receipt("unknown");
      if (kind === "scope") row.run.target.scope.id = "other";
      if (kind === "action") row.run.actionType = "board-task.move";
      if (kind === "unresolved") row.run.status = "queued";
      api.getBoardCreateRuns.mockResolvedValue({
        success: true,
        runs: [],
        unresolvedRun: row,
      });
      await render();
      expect(wrapper.find("form").exists()).toBe(false);
    },
  );
});
