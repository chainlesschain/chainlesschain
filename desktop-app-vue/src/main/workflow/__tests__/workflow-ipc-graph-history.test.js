import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { WorkflowIPC } = require("../workflow-ipc.js");

describe("WorkflowIPC Graph history capability", () => {
  it("exposes and disposes the fixed bounded history handler", async () => {
    const handlers = new Map();
    const ipcMain = {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel) => handlers.delete(channel)),
    };
    const history = {
      schema: "chainlesschain.graph-debug-history/v1",
      runId: "desktop-workflow:workflow-1",
    };
    const workflow = {
      getGraphHistory: vi.fn(async () => history),
      on: vi.fn(),
    };
    const manager = {
      getWorkflow: vi.fn(() => workflow),
      on: vi.fn(),
    };
    const bridge = new WorkflowIPC(manager, {
      ipcMain,
      BrowserWindow: { getAllWindows: () => [] },
    });

    await expect(
      handlers.get("workflow:get-graph-history")(
        {},
        {
          workflowId: "workflow-1",
          limit: 10,
          snapshotLimit: 5,
        },
      ),
    ).resolves.toEqual({ success: true, data: history });
    expect(workflow.getGraphHistory).toHaveBeenCalledWith({
      afterSeq: 0,
      limit: 10,
      snapshotLimit: 5,
    });

    bridge.dispose();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      "workflow:get-graph-history",
    );
  });
});
