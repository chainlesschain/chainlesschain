import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import Component from "../BoardTaskEditor.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";
const digest = `sha256:${"a".repeat(64)}`;
const original = {
  title: "Task title",
  description: "Task description",
  status: "open",
  priority: "medium",
  assigneeDid: "did:member:original",
  dueDate: 1792281600123,
  estimatedHours: 2.5,
  actualHours: 1.25,
};
const task = (extra = {}) => ({
  id: "task-1",
  orgId: "org-1",
  boardId: "board-1",
  ...original,
  ...extra,
});
const source = (extra = {}) => ({
  success: true,
  task: task(),
  editable: true,
  editableFields: Object.keys(original),
  ...extra,
});
const request = (input: any) => ({
  schema: "chainlesschain.business-action-request/v1",
  schemaVersion: 1,
  actionType: "board-task.update-fields",
  actionVersion: 1,
  target: {
    type: "Task",
    id: input.taskId,
    sourceKind: "desktop.board-task",
    scope: { kind: "organization", id: "org-1" },
    version: digest,
  },
  expectedVersion: digest,
  idempotencyKey: input.idempotencyKey,
  invocationDigest: digest,
  input: { updates: input.updates, previewId: "preview-1" },
});
const runResult = (status = "succeeded", extra = {}) => ({
  success: true,
  run: {
    id: "run-1",
    actionType: "board-task.update",
    actionVersion: 1,
    status,
    target: {
      id: "task-1",
      sourceKind: "desktop.board-task",
      scope: { kind: "organization", id: "org-1" },
    },
    invocationDigest: digest,
  },
  evidence: [],
  replayed: false,
  executionState: "recorded",
  ...extra,
});
function pending() {
  let resolve!: (v: any) => void, reject!: (v: any) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}

describe("controlled board task editor", () => {
  let wrapper: any, api: any, invalidate: () => void, unsubscribe: any;
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().isAuthenticated = true;
    useAppStore().deviceId = "device-1";
    api = {
      getBoardEditSource: vi.fn().mockResolvedValue(source()),
      getBoardUpdateRuns: vi
        .fn()
        .mockResolvedValue({ success: true, runs: [], nextCursor: null }),
      previewBoardUpdate: vi.fn().mockImplementation(async (input) => ({
        success: true,
        request: request(input),
        runId: "run-1",
        before: original,
        after: { ...original, ...input.updates },
      })),
      executeBoardUpdate: vi.fn().mockResolvedValue(runResult()),
      cancelBoardUpdate: vi.fn().mockResolvedValue(runResult("cancelled")),
      updateTask: vi.fn(),
    };
    unsubscribe = vi.fn();
    (window as any).electronAPI = {
      task: api,
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
  async function render() {
    wrapper = mount(Component, {
      props: { taskId: "task-1" },
      global: {
        stubs: { "a-button": { template: "<button><slot /></button>" } },
      },
    });
    await flushPromises();
  }
  async function action(name: string) {
    await wrapper.find(`[data-action="${name}"]`).trigger("click");
    await flushPromises();
  }
  async function edit() {
    await wrapper.find('[data-field="title"]').setValue("New title");
    await action("preview-update");
  }
  function enableMovement(extra = {}) {
    const movement = {
      editable: true,
      columnId: "column-1",
      position: 4,
      columns: [
        { id: "column-1", name: "待处理" },
        { id: "column-2", name: "进行中" },
      ],
      ...extra,
    };
    api.getBoardEditSource.mockResolvedValue(source({ movement }));
    api.previewBoardUpdate.mockImplementation(async (input) => ({
      success: true,
      runId: "move-run",
      request: { ...request(input), actionType: "board-task.move" },
      before: { columnId: "column-1", position: 4 },
      after: { ...input.updates },
    }));
    const cancelled = runResult("cancelled");
    cancelled.run.id = "move-run";
    cancelled.run.actionType = "board-task.move";
    api.cancelBoardUpdate.mockResolvedValue(cancelled);
    return movement;
  }
  async function move(position = "0") {
    await wrapper.find('[data-move-field="columnId"]').setValue("column-2");
    await wrapper.find('[data-move-field="position"]').setValue(position);
    await action("preview-move");
  }
  it("fills from fresh native source, retains no unrelated fields, and reads bounded history", async () => {
    api.getBoardEditSource.mockResolvedValue(
      source({ task: task({ secret: "SECRET" }) }),
    );
    await render();
    expect(api.getBoardEditSource).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(api.getBoardUpdateRuns).toHaveBeenCalledWith({
      taskId: "task-1",
      limit: 20,
    });
    expect(wrapper.find("input").element.value).toBe("Task title");
    expect(JSON.stringify(wrapper.vm.source)).not.toContain("SECRET");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it("previews only changed supported fields with a fresh nonce and does not execute", async () => {
    await render();
    await edit();
    expect(api.previewBoardUpdate).toHaveBeenCalledWith({
      taskId: "task-1",
      updates: { title: "New title" },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(wrapper.find("[data-update-preview]").text()).toContain(
      "Task title",
    );
    expect(wrapper.find("[data-update-preview]").text()).toContain("New title");
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
  });
  it("executes the exact host request only on explicit confirmation, then fresh-reads source", async () => {
    await render();
    await edit();
    const previewed = wrapper.vm.previewRequest;
    api.getBoardEditSource.mockResolvedValue(
      source({ task: task({ title: "Server title" }) }),
    );
    await action("execute-update");
    expect(api.executeBoardUpdate).toHaveBeenCalledWith({ request: previewed });
    expect(wrapper.emitted("updated")).toHaveLength(1);
    expect(wrapper.find("input").element.value).toBe("Server title");
    expect(api.updateTask).not.toHaveBeenCalled();
  });
  it("does not send no-op changes", async () => {
    await render();
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("没有需要保存");
  });
  it("previews one atomic patch across all eight fields with exact UTC milliseconds and fractional hours", async () => {
    await render();
    const values = {
      title: "Mixed title",
      description: "Mixed description",
      status: "review",
      priority: "critical",
      assigneeDid: "did:member:new",
      dueDate: "1792281600456",
      estimatedHours: "3.125",
      actualHours: "0",
    };
    for (const [field, value] of Object.entries(values))
      await wrapper.find(`[data-field="${field}"]`).setValue(value);
    await action("preview-update");
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
    expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
      ...values,
      dueDate: 1792281600456,
      estimatedHours: 3.125,
      actualHours: 0,
    });
    expect(wrapper.find("[data-update-preview]").text()).toContain(
      "1792281600456",
    );
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
  });
  it("clears nullable fields explicitly without converting zero to null", async () => {
    await render();
    for (const field of [
      "assigneeDid",
      "dueDate",
      "estimatedHours",
      "actualHours",
    ])
      await wrapper.find(`[data-field="${field}"]`).setValue("");
    await action("preview-update");
    expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
      assigneeDid: null,
      dueDate: null,
      estimatedHours: null,
      actualHours: null,
    });
    expect(wrapper.find("[data-update-preview]").text()).toContain("未设置");
  });
  it("preserves null and zero when reading and editing source fields", async () => {
    api.getBoardEditSource.mockResolvedValue(
      source({
        task: task({
          assigneeDid: null,
          dueDate: 0,
          estimatedHours: 0,
          actualHours: null,
        }),
      }),
    );
    await render();
    expect(wrapper.find('[data-field="assigneeDid"]').element.value).toBe("");
    expect(wrapper.find('[data-field="dueDate"]').element.value).toBe("0");
    expect(wrapper.find('[data-field="estimatedHours"]').element.value).toBe(
      "0",
    );
    expect(wrapper.find('[data-field="actualHours"]').element.value).toBe("");
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it("round-trips small finite source hours while editing another field", async () => {
    api.getBoardEditSource.mockResolvedValue(
      source({ task: task({ estimatedHours: 1e-7, actualHours: 5e-324 }) }),
    );
    await render();
    await edit();
    expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
      title: "New title",
    });
  });
  it.each([
    ["dueDate", "0", 0],
    ["dueDate", "8640000000000000", 8640000000000000],
    ["estimatedHours", "1000000", 1000000],
    ["actualHours", ".125", 0.125],
  ])("preserves valid %s boundary %s", async (field, input, expected) => {
    await render();
    await wrapper.find(`[data-field="${field}"]`).setValue(input);
    await action("preview-update");
    expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
      [field]: expected,
    });
  });
  it.each([
    ["dueDate", "1792281600123.1"],
    ["dueDate", "8640000000000001"],
    ["dueDate", "-1"],
    ["dueDate", "1e3"],
    ["dueDate", "2026-10-18T00:00:00+08:00"],
    ["estimatedHours", "-0.5"],
    ["actualHours", "1000000.1"],
    ["actualHours", "Infinity"],
    ["actualHours", "NaN"],
    ["assigneeDid", "did:"],
    ["assigneeDid", "did:bad member"],
    ["assigneeDid", `did:${"文".repeat(85)}`],
  ])("rejects invalid %s input without IPC: %s", async (field, value) => {
    await render();
    await wrapper.find(`[data-field="${field}"]`).setValue(value);
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it("enables only host-authorized fields and rejects a programmatic forbidden change", async () => {
    api.getBoardEditSource.mockResolvedValue(
      source({
        editableFields: [
          "title",
          "description",
          "status",
          "estimatedHours",
          "actualHours",
        ],
      }),
    );
    await render();
    for (const field of ["priority", "assigneeDid", "dueDate"])
      expect(
        wrapper.find(`[data-field="${field}"]`).attributes("disabled"),
      ).toBeDefined();
    expect(
      wrapper.find('[data-field="estimatedHours"]').attributes("disabled"),
    ).toBeUndefined();
    wrapper.vm.draft.priority = "critical";
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it("offers critical priority and rejects the unsupported urgent value", async () => {
    await render();
    expect(
      wrapper.find('[data-field="priority"] option[value="critical"]').text(),
    ).toBe("紧急");
    expect(
      wrapper.find('[data-field="priority"] option[value="urgent"]').exists(),
    ).toBe(false);
    wrapper.vm.draft.priority = "urgent";
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it.each([
    ["title", "unknown"],
    ["title", "title"],
  ])("rejects malformed editableFields %j", async (...editableFields) => {
    api.getBoardEditSource.mockResolvedValue(source({ editableFields }));
    await render();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it("rejects a legacy action preview while continuing to display legacy history", async () => {
    api.getBoardUpdateRuns.mockResolvedValue({
      success: true,
      runs: [runResult("cancelled")],
    });
    api.previewBoardUpdate.mockImplementation(async (input) => ({
      success: true,
      runId: "run-new",
      request: { ...request(input), actionType: "board-task.update" },
      before: original,
      after: { ...original, ...input.updates },
    }));
    await render();
    expect(wrapper.vm.runs).toHaveLength(1);
    await edit();
    expect(wrapper.find("[data-update-preview]").exists()).toBe(false);
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
  });
  it.each(["board-task.update-fields", "board-task.create"])(
    "accepts %s history and rejects unknown versions",
    async (actionType) => {
      const currentRun = runResult("cancelled");
      currentRun.run.actionType = actionType;
      api.getBoardUpdateRuns.mockResolvedValue({
        success: true,
        runs: [currentRun],
      });
      await render();
      expect(wrapper.vm.runs).toHaveLength(1);
      currentRun.run.actionVersion = 2;
      await action("refresh-editor");
      expect(wrapper.find("form").exists()).toBe(false);
    },
  );
  it("locks an admitted preview until explicit cancellation", async () => {
    await render();
    await edit();
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
    await action("preview-update");
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
    await action("cancel-update");
    expect(api.cancelBoardUpdate).toHaveBeenCalledWith({
      taskId: "task-1",
      runId: "run-1",
    });
    expect(wrapper.find("[data-update-preview]").exists()).toBe(false);
    expect(wrapper.find("input").attributes("disabled")).toBeUndefined();
  });
  it("cancels while native review is pending and suppresses a late success", async () => {
    const call = pending();
    api.executeBoardUpdate.mockReturnValue(call.promise);
    await render();
    await edit();
    await action("execute-update");
    await action("cancel-update");
    call.resolve(runResult());
    await flushPromises();
    expect(wrapper.text()).toContain("修改已取消");
    expect(wrapper.emitted("updated")).toBeUndefined();
    expect(api.getBoardEditSource).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "denied", "failed", "unknown"])(
    "does not publish or retry terminal %s",
    async (status) => {
      api.executeBoardUpdate.mockResolvedValue(runResult(status));
      await render();
      await edit();
      await action("execute-update");
      expect(wrapper.emitted("updated")).toBeUndefined();
      expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
      expect(wrapper.find("input").element.value).toBe("New title");
    },
  );
  it("marks a lost execution reply unknown and requires ending wait before another preview", async () => {
    api.executeBoardUpdate.mockRejectedValue(new Error("SECRET-PATH BODY"));
    await render();
    await edit();
    await action("execute-update");
    expect(wrapper.text()).toContain("系统不会自动重试");
    expect(wrapper.text()).not.toContain("SECRET");
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
    await action("cancel-recorded-update");
    expect(api.cancelBoardUpdate).toHaveBeenCalledWith({
      taskId: "task-1",
      runId: "run-1",
    });
  });
  it.each(["running", "unknown"])(
    "restores %s metadata without resuming execution",
    async (status) => {
      api.getBoardUpdateRuns.mockResolvedValue({
        success: true,
        runs: [runResult(status)],
      });
      await render();
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
      expect(wrapper.find("input").attributes("disabled")).toBeDefined();
      await action("cancel-recorded-update");
      expect(api.cancelBoardUpdate).toHaveBeenCalledTimes(1);
    },
  );
  it("allows a new edit after reloading an unexecuted queued preview", async () => {
    api.getBoardUpdateRuns.mockResolvedValue({
      success: true,
      runs: [runResult("queued")],
      unresolvedRun: null,
    });
    await render();
    expect(wrapper.find("input").attributes("disabled")).toBeUndefined();
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    await edit();
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });
  it.each(["running", "unknown"])(
    "recovers an older %s run ahead of twenty recent records and preserves it while cancelling them",
    async (status) => {
      const recent = Array.from({ length: 20 }, (_, index) => {
        const row = runResult("queued");
        row.run.id = `recent-${index}`;
        return row;
      });
      api.getBoardUpdateRuns.mockResolvedValue({
        success: true,
        runs: recent,
        unresolvedRun: runResult(status),
      });
      await render();
      expect(wrapper.vm.runs).toHaveLength(21);
      expect(wrapper.vm.runs[0].id).toBe("run-1");
      expect(wrapper.find("input").attributes("disabled")).toBeDefined();
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
      for (const row of recent) {
        const cancelled = runResult("cancelled");
        cancelled.run.id = row.run.id;
        api.cancelBoardUpdate.mockResolvedValueOnce(cancelled);
        await wrapper.vm.cancelRecorded(row.run.id);
      }
      expect(wrapper.vm.runs[0].id).toBe("run-1");
      expect(wrapper.find("input").attributes("disabled")).toBeDefined();
      await action("cancel-recorded-update");
      expect(api.cancelBoardUpdate).toHaveBeenLastCalledWith({
        taskId: "task-1",
        runId: "run-1",
      });
      expect(wrapper.find("input").attributes("disabled")).toBeUndefined();
    },
  );
  it("deduplicates the separately recovered run and places it first", async () => {
    const recent = runResult("cancelled");
    recent.run.id = "recent-1";
    api.getBoardUpdateRuns.mockResolvedValue({
      success: true,
      runs: [recent, runResult("running")],
      unresolvedRun: runResult("running"),
    });
    await render();
    expect(wrapper.vm.runs.map((row: any) => row.id)).toEqual([
      "run-1",
      "recent-1",
    ]);
  });
  it.each(["queued", "succeeded", "cancelled", "denied", "failed"])(
    "rejects a %s row supplied as the unresolved run",
    async (status) => {
      api.getBoardUpdateRuns.mockResolvedValue({
        success: true,
        runs: [],
        unresolvedRun: runResult(status),
      });
      await render();
      expect(wrapper.find("form").exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    },
  );
  it("rejects an unresolved run for a different task", async () => {
    const other = runResult("unknown");
    other.run.target.id = "other-task";
    api.getBoardUpdateRuns.mockResolvedValue({
      success: true,
      runs: [],
      unresolvedRun: other,
    });
    await render();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it("renders source and preview text without interpreting HTML", async () => {
    await render();
    await wrapper.find("textarea").setValue('<img src=x onerror="oops()">');
    await action("preview-update");
    expect(wrapper.text()).toContain("<img");
    expect(wrapper.findAll("img,iframe,object,script")).toHaveLength(0);
  });
  it("rejects oversized descriptions before preview IPC", async () => {
    await render();
    await wrapper.find("textarea").setValue("文".repeat(3000));
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it.each(["target", "scope", "action", "after"])(
    "rejects a mismatched %s preview",
    async (kind) => {
      api.previewBoardUpdate.mockImplementation(async (input) => {
        const req = request(input),
          after = { ...original, ...input.updates };
        if (kind === "target") req.target.id = "other";
        if (kind === "scope") req.target.scope.id = "other";
        if (kind === "action") req.actionType = "task.update-description";
        if (kind === "after") after.title = "Unexpected";
        return {
          success: true,
          request: req,
          runId: "run-1",
          before: original,
          after,
        };
      });
      await render();
      await edit();
      expect(wrapper.find("[data-update-preview]").exists()).toBe(false);
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    },
  );
  it.each([
    "logout",
    "device",
    "vault",
    "did",
    "notification",
    "task",
    "unmount",
  ])("fences pending previews across %s", async (change) => {
    const call = pending();
    api.previewBoardUpdate.mockReturnValue(call.promise);
    await render();
    await edit();
    const input = api.previewBoardUpdate.mock.calls[0][0];
    if (change === "logout") {
      useAppStore().isAuthenticated = false;
      useAppStore().isAuthenticated = true;
    }
    if (change === "device") {
      useAppStore().deviceId = "other";
      useAppStore().deviceId = "device-1";
    }
    if (change === "vault") useIdentityStore().currentContext = "org_other";
    if (change === "did") useIdentityStore().primaryDID = "did:other";
    if (change === "notification") invalidate();
    if (change === "task") {
      api.getBoardEditSource.mockResolvedValue(
        source({ task: task({ id: "task-2" }) }),
      );
      await wrapper.setProps({ taskId: "task-2" });
    }
    if (change === "unmount") wrapper.unmount();
    call.resolve({
      success: true,
      request: request(input),
      runId: "run-1",
      before: original,
      after: { ...original, ...input.updates },
    });
    await flushPromises();
    if (change !== "unmount")
      expect(wrapper.find("[data-update-preview]").exists()).toBe(false);
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
  });
  it("suppresses execution success after session invalidation", async () => {
    const call = pending();
    api.executeBoardUpdate.mockReturnValue(call.promise);
    await render();
    await edit();
    await action("execute-update");
    invalidate();
    call.resolve(runResult());
    await flushPromises();
    expect(wrapper.emitted("updated")).toBeUndefined();
    expect(wrapper.find("form").exists()).toBe(false);
  });
  it("handles native read-only and unauthenticated sources without writes", async () => {
    api.getBoardEditSource.mockResolvedValue(source({ editable: false }));
    await render();
    await action("preview-update");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    useAppStore().isAuthenticated = false;
    await action("refresh-editor");
    expect(wrapper.find("form").exists()).toBe(false);
  });
  it("keeps field editing available when movement is absent", async () => {
    await render();
    expect(wrapper.find('[data-action="preview-move"]').exists()).toBe(false);
    await edit();
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
  });
  it.each(["0", "1000000"])(
    "previews movement at position %s independently of unsaved fields",
    async (position) => {
      enableMovement();
      await render();
      await wrapper.find('[data-field="title"]').setValue("Unsaved title");
      await move(position);
      expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
        columnId: "column-2",
        position: Number(position),
      });
      const preview = wrapper.find("[data-move-preview]");
      expect(preview.text()).toContain("column-1");
      expect(preview.text()).toContain("column-2");
      expect(preview.text()).toContain(position);
      expect(preview.text()).not.toContain("Unsaved title");
      expect(
        wrapper.find('[data-field="title"]').attributes("disabled"),
      ).toBeDefined();
      expect(
        wrapper.find('[data-move-field="columnId"]').attributes("disabled"),
      ).toBeDefined();
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    },
  );
  it("locks movement during a field preview and keeps its patch separate", async () => {
    api.getBoardEditSource.mockResolvedValue(
      source({
        movement: {
          editable: true,
          columnId: "column-1",
          position: 0,
          columns: [{ id: "column-1", name: "Only column" }],
        },
      }),
    );
    await render();
    await wrapper.find('[data-move-field="position"]').setValue("8");
    await edit();
    expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual({
      title: "New title",
    });
    expect(wrapper.find("[data-move-preview]").exists()).toBe(false);
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("does not preview a no-op move", async () => {
    enableMovement();
    await render();
    await action("preview-move");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it.each(["", "-1", "0.5", "1000001", "1e3", "Infinity"])(
    "rejects invalid movement position %s",
    async (position) => {
      enableMovement();
      await render();
      await move(position);
      expect(api.previewBoardUpdate).not.toHaveBeenCalled();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    },
  );
  it("renders native column names as text and refuses columns outside the returned board list", async () => {
    enableMovement({
      columns: [
        { id: "column-1", name: "<img src=x onerror=bad>" },
        { id: "column-2", name: "<script>bad</script>" },
      ],
    });
    await render();
    await move();
    expect(wrapper.find("[data-move-preview]").text()).toContain("<img");
    expect(wrapper.findAll("img,script,iframe")).toHaveLength(0);
    await action("cancel-update");
    wrapper.vm.moveDraft.columnId = "other-board-column";
    await action("preview-move");
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
  });
  it("disables movement without its permission while preserving field edit permission", async () => {
    enableMovement({ editable: false });
    await render();
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[data-field="title"]').attributes("disabled"),
    ).toBeUndefined();
    await action("preview-move");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it("requires base edit permission as well as movement permission", async () => {
    const movement = enableMovement();
    api.getBoardEditSource.mockResolvedValue(
      source({ editable: false, editableFields: [], movement }),
    );
    await render();
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeDefined();
    await action("preview-move");
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
  });
  it.each(["after", "input", "mixed", "action"])(
    "rejects mismatched %s movement preview",
    async (kind) => {
      enableMovement();
      api.previewBoardUpdate.mockImplementation(async (input) => {
        const req = { ...request(input), actionType: "board-task.move" };
        const after = { ...input.updates };
        if (kind === "after") after.position++;
        if (kind === "input")
          req.input.updates = { ...input.updates, columnId: "other" };
        if (kind === "mixed")
          req.input.updates = { ...input.updates, title: "Unexpected" };
        if (kind === "action") req.actionType = "board-task.update-fields";
        return {
          success: true,
          runId: "move-run",
          request: req,
          before: { columnId: "column-1", position: 4 },
          after,
        };
      });
      await render();
      await move();
      expect(wrapper.find("[data-move-preview]").exists()).toBe(false);
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    },
  );
  it("executes a move through shared confirmation and reloads authoritative movement", async () => {
    enableMovement();
    await render();
    await move();
    const result = runResult();
    result.run.id = "move-run";
    result.run.actionType = "board-task.move";
    api.executeBoardUpdate.mockResolvedValue(result);
    api.getBoardEditSource.mockResolvedValue(
      source({
        movement: {
          editable: true,
          columnId: "column-2",
          position: 17,
          columns: [{ id: "column-2", name: "Server column" }],
        },
      }),
    );
    await action("execute-update");
    expect(wrapper.emitted("updated")).toHaveLength(1);
    expect(wrapper.find('[data-move-field="position"]').element.value).toBe(
      "17",
    );
    expect(api.updateTask).not.toHaveBeenCalled();
  });
  it("fences a late move preview across authentication ABA", async () => {
    enableMovement();
    const delayed = pending();
    api.previewBoardUpdate.mockReturnValue(delayed.promise);
    await render();
    await move();
    const input = api.previewBoardUpdate.mock.calls[0][0];
    useAppStore().isAuthenticated = false;
    useAppStore().isAuthenticated = true;
    delayed.resolve({
      success: true,
      runId: "move-run",
      request: { ...request(input), actionType: "board-task.move" },
      before: { columnId: "column-1", position: 4 },
      after: input.updates,
    });
    await flushPromises();
    expect(wrapper.find("[data-move-preview]").exists()).toBe(false);
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
  });
  it("keeps both editors locked after a lost move reply until explicit recovery", async () => {
    enableMovement();
    await render();
    await move();
    api.executeBoardUpdate.mockRejectedValue(new Error("Lost"));
    await action("execute-update");
    expect(
      wrapper.find('[data-field="title"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeDefined();
    const cancelled = runResult("cancelled");
    cancelled.run.id = "move-run";
    cancelled.run.actionType = "board-task.move";
    api.cancelBoardUpdate.mockResolvedValue(cancelled);
    await action("cancel-recorded-update");
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeUndefined();
    expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
  });
  it("restores older unknown movement metadata in the shared task fence", async () => {
    enableMovement();
    const old = runResult("unknown");
    old.run.actionType = "board-task.move";
    api.getBoardUpdateRuns.mockResolvedValue({
      success: true,
      runs: [],
      unresolvedRun: old,
    });
    await render();
    expect(
      wrapper.find('[data-action="preview-update"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[data-action="preview-move"]').attributes("disabled"),
    ).toBeDefined();
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
  });
  it("bounds raw UTF8 column bytes without counting JSON escape expansion", async () => {
    enableMovement({
      columns: Array.from({ length: 16 }, (_, index) => ({
        id: `column-${index + 1}`,
        name: "\\".repeat(4000),
      })),
    });
    await render();
    expect(wrapper.find('[data-action="preview-move"]').exists()).toBe(true);
    await move();
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
  });
  it.each(["duplicates", "count", "bytes", "name", "blank", "current"])(
    "rejects malformed movement columns: %s",
    async (kind) => {
      const movement = enableMovement();
      if (kind === "duplicates") movement.columns.push(movement.columns[0]);
      if (kind === "count")
        movement.columns = Array.from({ length: 201 }, (_, i) => ({
          id: `c-${i}`,
          name: "column",
        }));
      if (kind === "bytes")
        movement.columns = Array.from({ length: 20 }, (_, index) => ({
          id: `column-${index + 1}`,
          name: "文".repeat(1300),
        }));
      if (kind === "name") movement.columns[0].name = "文".repeat(1366);
      if (kind === "blank") movement.columns[0].name = " ";
      if (kind === "current") movement.columnId = "missing-column";
      await render();
      expect(wrapper.find('[data-action="preview-move"]').exists()).toBe(false);
      expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    },
  );
});
