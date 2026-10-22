// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createControlledBoardTask,
  updateControlledBoardTask,
} from "../../../../tests/e2e/helpers";

function fixture({ create = false, updates = { priority: "high" } } = {}) {
  const taskId = "fixture-task";
  const idempotencyKey = "22222222-2222-4222-8222-222222222222";
  const request = {
    actionType: create
      ? "board-task.create"
      : Object.hasOwn(updates, "columnId")
        ? "board-task.move"
        : "board-task.update-fields",
    actionDigest: "fixture-digest",
    target: { id: taskId },
    idempotencyKey,
    input: create ? { boardId: "fixture-board" } : { updates },
  };
  const preview = { success: true, runId: "fixture-run", taskId, request };
  const original = vi.fn(async () => ({ response: 0 }));
  const dialog = { showMessageBox: original };
  const app = {
    evaluate: async (callback, argument) => callback({ dialog }, argument),
  };
  const confirmation = {
    title: create ? "确认创建看板任务" : "确认修改看板任务",
    buttons: ["取消", create ? "确认创建" : "确认保存"],
    detail: `操作摘要：${request.actionDigest}\n${create ? "任务ID：" : "任务："}${JSON.stringify(taskId)}`,
  };
  const result = {
    success: true,
    run: { id: preview.runId, status: "succeeded", target: { id: taskId } },
  };
  const stored = {
    success: true,
    task: { id: taskId, boardId: "fixture-board", title: "Fixture task" },
    movement: { columnId: "todo", position: 0 },
  };
  for (const [key, value] of Object.entries(updates)) {
    if (["columnId", "position"].includes(key)) stored.movement[key] = value;
    else stored.task[key] = value;
  }
  const execute = vi.fn(async () => {
    expect(await dialog.showMessageBox({}, confirmation)).toEqual({
      response: 1,
      checkboxChecked: false,
    });
    return result;
  });
  const window = {
    evaluate: vi.fn(async (_callback, argument) => {
      if (!argument) return idempotencyKey;
      if (argument.channel.includes("previewBoard")) return preview;
      if (argument.channel.includes("executeBoard")) return execute(argument);
      if (
        ["task:get-task", "task.getBoardEditSource"].includes(argument.channel)
      )
        return stored;
      throw new Error(`Unexpected channel: ${argument.channel}`);
    }),
  };
  return {
    app,
    window,
    taskId,
    request,
    preview,
    original,
    dialog,
    confirmation,
    result,
    stored,
    execute,
    updates,
  };
}

describe("PM board fixture governed writes", () => {
  it.each([false, true])(
    "confirms and reads back an exact action (create=%s)",
    async (create) => {
      const f = fixture({ create });
      const result = create
        ? await createControlledBoardTask(f.app, f.window, "fixture-board", {
            columnId: "todo",
            title: "Fixture task",
          })
        : await updateControlledBoardTask(f.app, f.window, f.taskId, f.updates);
      expect(result).toEqual({ success: true, taskId: f.taskId });
      expect(f.execute).toHaveBeenCalledWith({
        channel: create ? "task.executeBoardCreate" : "task.executeBoardUpdate",
        args: [{ request: f.request }],
      });
      expect(f.dialog.showMessageBox).toBe(f.original);
    },
  );

  it("does not confirm another action, task or dialog, or reuse a confirmation", async () => {
    const f = fixture();
    f.execute.mockImplementationOnce(async () => {
      for (const changes of [
        { title: "Unrelated dialog" },
        { buttons: ["取消", "Other action"] },
        { detail: `操作摘要：other-digest\n任务：${JSON.stringify(f.taskId)}` },
        { detail: `操作摘要：${f.request.actionDigest}\n任务："other-task"` },
      ]) {
        expect(
          await f.dialog.showMessageBox({}, { ...f.confirmation, ...changes }),
        ).toEqual({ response: 0 });
      }
      expect(await f.dialog.showMessageBox({}, f.confirmation)).toEqual({
        response: 1,
        checkboxChecked: false,
      });
      expect(await f.dialog.showMessageBox({}, f.confirmation)).toEqual({
        response: 0,
      });
      return f.result;
    });
    await updateControlledBoardTask(f.app, f.window, f.taskId, f.updates);
    expect(f.original).toHaveBeenCalledTimes(5);
    expect(f.dialog.showMessageBox).toBe(f.original);
  });

  it("restores native confirmation after an execution transport failure", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error("reply lost"));
    await expect(
      updateControlledBoardTask(f.app, f.window, f.taskId, f.updates),
    ).rejects.toThrow("reply lost");
    expect(f.dialog.showMessageBox).toBe(f.original);
    expect(Object.getOwnPropertySymbols(f.dialog)).toHaveLength(0);
  });

  it("serializes native reviews for concurrent submissions to the same app", async () => {
    const f = fixture();
    let release;
    let started;
    const firstStarted = new Promise((resolve) => {
      started = resolve;
    });
    const pendingConfirmation = new Promise((resolve) => {
      release = resolve;
    });
    f.execute.mockImplementationOnce(async () => {
      expect((await f.dialog.showMessageBox({}, f.confirmation)).response).toBe(
        1,
      );
      started();
      await pendingConfirmation;
      return f.result;
    });
    const first = updateControlledBoardTask(
      f.app,
      f.window,
      f.taskId,
      f.updates,
    );
    await firstStarted;
    const second = updateControlledBoardTask(
      f.app,
      f.window,
      f.taskId,
      f.updates,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(f.execute).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.dialog.showMessageBox).toBe(f.original);
  });

  it("rejects a preview bound to a different task before execution", async () => {
    const f = fixture();
    f.request.target.id = "other-task";
    await expect(
      updateControlledBoardTask(f.app, f.window, f.taskId, f.updates),
    ).rejects.toThrow("update preview failed");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.dialog.showMessageBox).toBe(f.original);
  });

  it("requires authoritative field readback after reported success", async () => {
    const f = fixture();
    f.stored.task.priority = "low";
    await expect(
      updateControlledBoardTask(f.app, f.window, f.taskId, f.updates),
    ).rejects.toThrow("update readback failed");
    expect(f.dialog.showMessageBox).toBe(f.original);
  });

  it.each([
    { columnId: "done", position: 3 },
    { assigneeDid: "did:key:member", dueDate: 1800000000000, actualHours: 7 },
  ])("reads back authoritative fields and movement for %j", async (updates) => {
    const f = fixture({ updates });
    await expect(
      updateControlledBoardTask(f.app, f.window, f.taskId, updates),
    ).resolves.toEqual({ success: true, taskId: f.taskId });
  });
});
