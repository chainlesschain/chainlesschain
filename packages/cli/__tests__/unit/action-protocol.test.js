import { describe, it, expect, vi } from "vitest";
import {
  handleSlashCommand,
  handleOrchestrate,
} from "../../src/gateways/ws/action-protocol.js";

describe("ws action protocol", () => {
  it("returns SESSION_NOT_FOUND when slash-command target is missing", () => {
    const server = {
      sessionHandlers: new Map(),
      _send: vi.fn(),
    };

    handleSlashCommand(server, "1", {}, {
      sessionId: "missing",
      command: "/help",
    });

    expect(server._send).toHaveBeenCalledWith({}, {
      id: "1",
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: "No active session handler for: missing",
    });
  });

  it("delegates slash-command to active session handler", () => {
    const handler = { handleSlashCommand: vi.fn() };
    const server = {
      sessionHandlers: new Map([["sess-1", handler]]),
      _send: vi.fn(),
    };

    handleSlashCommand(server, "2", {}, {
      sessionId: "sess-1",
      command: "/model qwen",
    });

    expect(handler.handleSlashCommand).toHaveBeenCalledWith("/model qwen", "2");
  });

  it("returns INVALID_TASK for orchestrate without task", async () => {
    const server = { _send: vi.fn() };

    await handleOrchestrate(server, "3", {}, {});

    expect(server._send).toHaveBeenCalledWith({}, {
      id: "3",
      type: "error",
      code: "INVALID_TASK",
      message: "task field required",
    });
  });
});
