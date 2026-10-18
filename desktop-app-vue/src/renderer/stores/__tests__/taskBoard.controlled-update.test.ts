import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useTaskBoardStore } from "../taskBoard";
import { useAppStore } from "../app";
import { useIdentityStore } from "../identity";
describe("board controlled update compatibility", () => {
  let api: any, invoke: any;
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().isAuthenticated = true;
    invoke = vi.fn();
    api = {
      previewBoardUpdate: vi.fn().mockResolvedValue({
        success: true,
        request: {
          actionType: "board-task.update-fields",
          actionVersion: 1,
          opaque: "preview",
        },
      }),
      executeBoardUpdate: vi
        .fn()
        .mockResolvedValue({ success: true, run: { status: "succeeded" } }),
    };
    (window as any).electronAPI = { task: api, invoke };
  });
  it("routes controlled fields through native preview and execute without an optimistic body cache", async () => {
    const store = useTaskBoardStore();
    store.tasks = [{ id: "task-1", title: "Original" } as any];
    store.currentTask = store.tasks[0];
    expect(await store.updateTask("task-1", { title: "Changed" })).toEqual({
      success: true,
      taskId: "task-1",
    });
    expect(api.previewBoardUpdate).toHaveBeenCalledWith({
      taskId: "task-1",
      updates: { title: "Changed" },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(api.executeBoardUpdate).toHaveBeenCalledWith({
      request: {
        actionType: "board-task.update-fields",
        actionVersion: 1,
        opaque: "preview",
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(store.tasks[0].title).toBe("Original");
    expect(store.currentTask?.title).toBe("Original");
  });
  it.each(["cancelled", "denied", "running", "unknown"])(
    "never claims a %s run applied or resends",
    async (status) => {
      api.executeBoardUpdate.mockResolvedValue({
        success: true,
        run: { status },
      });
      expect(
        (await useTaskBoardStore().updateTask("task-1", { description: "new" }))
          .success,
      ).toBe(false);
      expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
      expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects unknown fields and fixed failures do not log private bodies", async () => {
    const store = useTaskBoardStore();
    expect(
      (await store.updateTask("task-1", { title: "Changed", boardId: "other" }))
        .success,
    ).toBe(false);
    expect(api.previewBoardUpdate).not.toHaveBeenCalled();
    api.previewBoardUpdate.mockRejectedValue(
      new Error("PRIVATE proposed body"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await store.updateTask("task-1", { title: "Changed" })).toEqual({
      success: false,
      error: "BOARD_ACTION_OPERATION_FAILED",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it.each([
    { priority: "critical" },
    { assigneeDid: "did:member:one" },
    { dueDate: 1792281600123 },
    { estimatedHours: 3.125 },
    { actualHours: 0 },
    {
      assigneeDid: null,
      dueDate: null,
      estimatedHours: null,
      actualHours: null,
    },
    {
      title: "Mixed",
      description: "Body",
      status: "review",
      priority: "high",
      assigneeDid: null,
      dueDate: 0,
      estimatedHours: 0,
      actualHours: 1.25,
    },
  ])(
    "routes supported patch %j through one controlled action without cache changes",
    async (updates) => {
      const store = useTaskBoardStore();
      store.tasks = [
        {
          id: "task-1",
          title: "Original",
          priority: "low",
          dueDate: null,
          actualHours: 4,
        } as any,
      ];
      store.currentTask = store.tasks[0];
      const original = JSON.stringify(store.tasks);
      expect((await store.updateTask("task-1", updates as any)).success).toBe(
        true,
      );
      expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
      expect(api.previewBoardUpdate.mock.calls[0][0].updates).toEqual(updates);
      expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(JSON.stringify(store.tasks)).toBe(original);
      expect(store.currentTask).toEqual(store.tasks[0]);
    },
  );
  it.each([{}, { unknown: true }, { priority: "high", position: 2 }, null, []])(
    "rejects invalid patch %j without any fallback",
    async (updates) => {
      expect(
        await useTaskBoardStore().updateTask("task-1", updates as any),
      ).toEqual({ success: false, error: "BOARD_ACTION_INVALID_UPDATE" });
      expect(api.previewBoardUpdate).not.toHaveBeenCalled();
      expect(api.executeBoardUpdate).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("rejects a legacy preview instead of executing it", async () => {
    api.previewBoardUpdate.mockResolvedValue({
      success: true,
      request: { actionType: "board-task.update", actionVersion: 1 },
    });
    expect(
      await useTaskBoardStore().updateTask("task-1", { priority: "high" }),
    ).toEqual({ success: false, error: "BOARD_ACTION_PREVIEW_FAILED" });
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not retry a lost execute reply or update cached fields", async () => {
    api.executeBoardUpdate.mockRejectedValue(new Error("PRIVATE path"));
    expect(
      await useTaskBoardStore().updateTask("task-1", { actualHours: 0 }),
    ).toEqual({ success: false, error: "BOARD_ACTION_OPERATION_FAILED" });
    expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
    expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
  function prepareMove() {
    const store = useTaskBoardStore();
    store.currentBoard = { id: "board-1", orgId: "org-1" } as any;
    store.tasks = [
      {
        id: "task-1",
        boardId: "board-1",
        columnId: "column-1",
        position: 8,
        title: "Original",
      } as any,
    ];
    store.currentTask = store.tasks[0];
    api.previewBoardUpdate.mockResolvedValue({
      success: true,
      request: {
        actionType: "board-task.move",
        actionVersion: 1,
        opaque: "move-preview",
      },
    });
    api.getTask = vi.fn().mockResolvedValue({
      success: true,
      task: {
        ...store.tasks[0],
        columnId: "column-2",
        position: 21,
        title: "Authoritative",
      },
    });
    api.getTasks = vi.fn().mockResolvedValue({
      success: true,
      tasks: [
        {
          ...store.tasks[0],
          columnId: "column-2",
          position: 21,
          title: "Authoritative",
        },
      ],
    });
    return store;
  }
  function deferred() {
    let resolve!: (value: any) => void;
    const promise = new Promise((value) => {
      resolve = value;
    });
    return { promise, resolve };
  }
  it("moves with columnId and a native preview, then refreshes rather than applying proposed values", async () => {
    const store = prepareMove();
    expect(await store.moveTask("task-1", "column-2", 0)).toEqual({
      success: true,
      taskId: "task-1",
    });
    expect(api.previewBoardUpdate).toHaveBeenCalledWith({
      taskId: "task-1",
      updates: { columnId: "column-2", position: 0 },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(api.executeBoardUpdate).toHaveBeenCalledWith({
      request: {
        actionType: "board-task.move",
        actionVersion: 1,
        opaque: "move-preview",
      },
    });
    expect(api.getTask).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(api.getTasks).toHaveBeenCalledWith({ boardId: "board-1" });
    expect(store.tasks[0].position).toBe(21);
    expect(store.currentTask?.title).toBe("Authoritative");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps cached movement unchanged while confirmation is pending", async () => {
    const store = prepareMove(),
      delayed = deferred();
    api.executeBoardUpdate.mockReturnValue(delayed.promise);
    const operation = store.moveTask("task-1", "column-2", 1000000);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.tasks[0].columnId).toBe("column-1");
    expect(store.tasks[0].position).toBe(8);
    expect(api.getTask).not.toHaveBeenCalled();
    delayed.resolve({ success: true, run: { status: "cancelled" } });
    expect((await operation).success).toBe(false);
    expect(store.tasks[0].position).toBe(8);
  });
  it.each(["queued", "running", "unknown", "cancelled", "denied", "failed"])(
    "does not refresh or replay an unapplied %s move",
    async (status) => {
      const store = prepareMove();
      api.executeBoardUpdate.mockResolvedValue({
        success: true,
        run: { status },
      });
      expect((await store.moveTask("task-1", "column-2", 0)).success).toBe(
        false,
      );
      expect(api.getTask).not.toHaveBeenCalled();
      expect(api.getTasks).not.toHaveBeenCalled();
      expect(api.previewBoardUpdate).toHaveBeenCalledTimes(1);
      expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
      expect(store.tasks[0].columnId).toBe("column-1");
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it.each([-1, 0.5, 1000001, NaN, Infinity])(
    "rejects invalid movement position %s before IPC",
    async (position) => {
      const store = prepareMove();
      expect(
        (await store.moveTask("task-1", "column-2", position)).success,
      ).toBe(false);
      expect(api.previewBoardUpdate).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("rejects a field-update preview returned for movement", async () => {
    const store = prepareMove();
    api.previewBoardUpdate.mockResolvedValue({
      success: true,
      request: { actionType: "board-task.update-fields", actionVersion: 1 },
    });
    expect((await store.moveTask("task-1", "column-2", 0)).success).toBe(false);
    expect(api.executeBoardUpdate).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["auth", "identity", "board", "task", "notification"])(
    "discards fresh movement results across %s invalidation",
    async (kind) => {
      const store = prepareMove(),
        delayed = deferred();
      let invalidate!: () => void;
      (window as any).electronAPI.notification = {
        onInvalidated: vi.fn((fn) => {
          invalidate = fn;
          return vi.fn();
        }),
      };
      api.getTasks.mockReturnValue(delayed.promise);
      const operation = store.moveTask("task-1", "column-2", 0);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(api.getTasks).toHaveBeenCalledTimes(1);
      if (kind === "auth") {
        useAppStore().isAuthenticated = false;
        useAppStore().isAuthenticated = true;
      }
      if (kind === "identity") {
        useIdentityStore().currentContext = "other";
        useIdentityStore().currentContext = "personal";
      }
      if (kind === "board") store.currentBoard = { id: "other-board" } as any;
      if (kind === "task") store.currentTask = { id: "other-task" } as any;
      if (kind === "notification") invalidate();
      delayed.resolve({
        success: true,
        tasks: [
          {
            id: "task-1",
            boardId: "board-1",
            columnId: "column-2",
            position: 0,
          },
        ],
      });
      expect((await operation).success).toBe(false);
      expect(store.tasks[0].columnId).toBe("column-1");
      expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["task", "list", "missing", "scope"])(
    "leaves cache unchanged after invalid fresh %s response",
    async (kind) => {
      const store = prepareMove();
      if (kind === "task") api.getTask.mockResolvedValue({ success: false });
      if (kind === "list") api.getTasks.mockRejectedValue(new Error("PRIVATE"));
      if (kind === "missing")
        api.getTasks.mockResolvedValue({ success: true, tasks: [] });
      if (kind === "scope")
        api.getTasks.mockResolvedValue({
          success: true,
          tasks: [{ id: "task-1", boardId: "other-board" }],
        });
      expect((await store.moveTask("task-1", "column-2", 0)).success).toBe(
        false,
      );
      expect(store.tasks[0].columnId).toBe("column-1");
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("does not retry or fresh-read after a lost movement execute reply", async () => {
    const store = prepareMove();
    api.executeBoardUpdate.mockRejectedValue(new Error("PRIVATE"));
    expect((await store.moveTask("task-1", "column-2", 0)).success).toBe(false);
    expect(api.getTask).not.toHaveBeenCalled();
    expect(api.executeBoardUpdate).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
  function prepareCreate() {
    const store = prepareMove();
    api.previewBoardCreate = vi.fn().mockResolvedValue({
      success: true,
      taskId: "new-task",
      request: {
        actionType: "board-task.create",
        actionVersion: 1,
        target: { id: "new-task" },
        opaque: "create-preview",
      },
    });
    api.executeBoardCreate = vi.fn().mockResolvedValue({
      success: true,
      run: { status: "succeeded", target: { id: "new-task" } },
    });
    api.getTask.mockResolvedValue({
      success: true,
      task: { id: "new-task", boardId: "board-1", title: "Actual title" },
    });
    api.getTasks.mockResolvedValue({
      success: true,
      tasks: [
        store.tasks[0],
        { id: "new-task", boardId: "board-1", title: "Actual title" },
      ],
    });
    return store;
  }
  it("extracts the outer board and creates through scoped preview/execute followed by fresh reads", async () => {
    const store = prepareCreate();
    expect(
      await store.createTask({
        boardId: "board-1",
        title: "Proposed",
        columnId: "column-1",
        parentTaskId: "task-1",
        dueDate: 0,
        estimatedHours: null,
      }),
    ).toEqual({ success: true, taskId: "new-task" });
    expect(api.previewBoardCreate).toHaveBeenCalledWith({
      boardId: "board-1",
      taskData: {
        title: "Proposed",
        columnId: "column-1",
        parentTaskId: "task-1",
        dueDate: 0,
        estimatedHours: null,
      },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(api.getTask).toHaveBeenCalledWith({ taskId: "new-task" });
    expect(api.getTasks).toHaveBeenCalledWith({ boardId: "board-1" });
    expect(store.tasks[1].title).toBe("Actual title");
    expect(store.currentTask?.id).toBe("task-1");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    "createdBy",
    "id",
    "status",
    "taskType",
    "labels",
    "sprintId",
    "orgId",
  ])(
    "rejects caller-supplied creation field %s without a legacy fallback",
    async (field) => {
      const store = prepareCreate();
      expect(
        (
          await store.createTask({
            boardId: "board-1",
            title: "Proposed",
            columnId: "column-1",
            [field]: "forged",
          } as any)
        ).success,
      ).toBe(false);
      expect(api.previewBoardCreate).not.toHaveBeenCalled();
      expect(api.executeBoardCreate).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it.each(["queued", "running", "unknown", "cancelled", "denied", "failed"])(
    "does not append or refresh an unapplied %s creation",
    async (status) => {
      const store = prepareCreate();
      api.executeBoardCreate.mockResolvedValue({
        success: true,
        run: { status, target: { id: "new-task" } },
      });
      expect(
        (
          await store.createTask({
            boardId: "board-1",
            title: "Proposed",
            columnId: "column-1",
          })
        ).success,
      ).toBe(false);
      expect(store.tasks).toHaveLength(1);
      expect(api.getTask).not.toHaveBeenCalled();
      expect(api.executeBoardCreate).toHaveBeenCalledTimes(1);
    },
  );
  it("never creates twice after a lost execute reply", async () => {
    const store = prepareCreate();
    api.executeBoardCreate.mockRejectedValue(new Error("PRIVATE"));
    expect(
      (
        await store.createTask({
          boardId: "board-1",
          title: "Proposed",
          columnId: "column-1",
        })
      ).success,
    ).toBe(false);
    expect(store.tasks).toHaveLength(1);
    expect(api.executeBoardCreate).toHaveBeenCalledTimes(1);
    expect(api.previewBoardCreate).toHaveBeenCalledTimes(1);
    expect(api.getTask).not.toHaveBeenCalled();
  });
  it.each(["auth", "board", "identity"])(
    "does not publish a fresh creation list across %s changes",
    async (kind) => {
      const store = prepareCreate(),
        delayed = deferred();
      api.getTasks.mockReturnValue(delayed.promise);
      const operation = store.createTask({
        boardId: "board-1",
        title: "Proposed",
        columnId: "column-1",
      });
      for (let index = 0; index < 8; index++) await Promise.resolve();
      if (kind === "auth") {
        useAppStore().isAuthenticated = false;
        useAppStore().isAuthenticated = true;
      }
      if (kind === "board") store.currentBoard = { id: "other" } as any;
      if (kind === "identity") useIdentityStore().currentContext = "other";
      delayed.resolve({
        success: true,
        tasks: [{ id: "new-task", boardId: "board-1" }],
      });
      expect((await operation).success).toBe(false);
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("task-1");
    },
  );
  it("rejects a mismatched allocated task and does not execute its preview", async () => {
    const store = prepareCreate();
    api.previewBoardCreate.mockResolvedValue({
      success: true,
      taskId: "new-task",
      request: {
        actionType: "board-task.create",
        actionVersion: 1,
        target: { id: "other" },
      },
    });
    expect(
      (
        await store.createTask({
          boardId: "board-1",
          title: "Proposed",
          columnId: "column-1",
        })
      ).success,
    ).toBe(false);
    expect(api.executeBoardCreate).not.toHaveBeenCalled();
  });
});
