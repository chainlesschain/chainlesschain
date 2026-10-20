// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
} = require("../../../../packages/session-core/lib/business-object-contract.js");
const preload = readFileSync(
  fileURLToPath(new URL("../index.js", import.meta.url)),
  "utf8",
);

function loadPreload() {
  const exposed = {};
  const invoke = vi.fn(async (channel, params) => {
    // Electron IPC clones values into the main-process realm before validation.
    const delivered = deserialize(serialize(params));
    if (channel === "task:board-update-preview") {
      return {
        success: true,
        request: requestFor(
          "board-task.update-fields",
          { updates: delivered.updates },
          delivered.idempotencyKey,
        ),
      };
    }
    return validateBusinessActionRequest(delivered.request);
  });
  runInNewContext(preload, {
    require: (name) => {
      if (name !== "electron") throw new Error(`Unexpected module: ${name}`);
      return {
        contextBridge: {
          exposeInMainWorld: (key, value) => {
            exposed[key] = value;
          },
        },
        ipcRenderer: { invoke },
        desktopCapturer: {},
      };
    },
    console,
  });
  return { task: exposed.electronAPI.task, invoke };
}

function requestFor(
  actionType,
  input,
  idempotencyKey = "22222222-2222-4222-8222-222222222222",
) {
  const version = `sha256:${"a".repeat(64)}`;
  return createBusinessActionRequest({
    actionType,
    actionVersion: 1,
    target: createBusinessObjectRef({
      type: "Task",
      id: "task-1",
      sourceKind: "desktop.board-task",
      scope: { kind: "organization", id: "org-1" },
      version,
    }),
    expectedVersion: version,
    input: {
      ...input,
      previewId: "11111111-1111-4111-8111-111111111111",
    },
    idempotencyKey,
  });
}

const cases = [
  {
    method: "executeBoardCreate",
    channel: "task:board-create-execute",
    actionType: "board-task.create",
    input: {
      boardId: "board-1",
      taskData: {
        columnId: "column-1",
        title: "Task",
        description: "",
        priority: "medium",
        assigneeDid: null,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
        position: 0,
        parentTaskId: null,
      },
    },
  },
  {
    method: "executeBoardUpdate",
    channel: "task:board-update-execute",
    actionType: "board-task.update-fields",
    input: {
      updates: {
        assigneeDid: null,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
      },
    },
  },
];

describe("board action preload transport", () => {
  it.each(["assigneeDid", "dueDate", "estimatedHours", "actualHours"])(
    "preserves clearing %s through preview, signing, and execution",
    async (field) => {
      const { task, invoke } = loadPreload();
      const updates = { title: "Updated task", [field]: null };
      const params = {
        taskId: "task-1",
        updates,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      };

      const preview = await task.previewBoardUpdate(params);
      expect(preview.request.input.updates).toEqual(updates);
      expect(preview.request.idempotencyKey).toBe(params.idempotencyKey);
      expect(invoke).toHaveBeenNthCalledWith(
        1,
        "task:board-update-preview",
        params,
      );

      const executed = await task.executeBoardUpdate({
        request: preview.request,
      });
      expect(executed).toEqual(preview.request);
      expect(executed.input.updates).toEqual(updates);
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it.each(cases)(
    "$method preserves the complete preview request through host validation",
    async ({ method, channel, actionType, input }) => {
      const { task, invoke } = loadPreload();
      const request = requestFor(actionType, input);

      await expect(task[method]({ request })).resolves.toEqual(request);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(channel, { request });
    },
  );

  it.each(cases)(
    "$method leaves digest enforcement to the host for modified requests",
    async ({ method, actionType, input }) => {
      const { task, invoke } = loadPreload();
      const request = deserialize(serialize(requestFor(actionType, input)));
      const fields = request.input.taskData ?? request.input.updates;
      fields.dueDate = 1;

      await expect(task[method]({ request })).rejects.toThrow(
        "Action digest binding mismatch",
      );
      expect(invoke).toHaveBeenCalledOnce();
    },
  );
});
