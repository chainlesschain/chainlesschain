import { describe, it, expect, vi } from "vitest";
import {
  handleSlashCommand,
  handleOrchestrate,
} from "../../src/gateways/ws/action-protocol.js";

describe("ws action protocol", () => {
  it("uses host evolution authority and rejects admission before provider or process execution", async () => {
    const { _deps } = await import("../../src/lib/claude-code-bridge.js");
    const original = { ..._deps };
    const fetch = vi.fn();
    _deps.execSync = vi.fn(() => {
      throw new Error("no installed external CLI");
    });
    _deps.spawn = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const factory = vi.fn(async () => {
      throw new Error("host authority denied");
    });
    const clientFactory = vi.fn();
    const server = {
      projectRoot: process.cwd(),
      evolutionCompositionFactory: factory,
      _send: vi.fn(),
    };
    const ws = {};
    try {
      await handleOrchestrate(server, "governed", ws, {
        task: "inspect the project",
        noCi: true,
        evolutionCompositionFactory: clientFactory,
        evolutionIngress: {},
      });
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory.mock.calls[0][0]).toMatchObject({
        mode: "orchestrate",
        cwd: process.cwd(),
        runId: expect.any(String),
      });
      expect(clientFactory).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(_deps.spawn).not.toHaveBeenCalled();
      expect(server._send).toHaveBeenCalledWith(ws, {
        id: "governed",
        type: "error",
        code: "ORCHESTRATE_FAILED",
        message: "host authority denied",
      });
      expect(
        server._send.mock.calls.some(
          ([, data]) => data.type === "orchestrate:done",
        ),
      ).toBe(false);
    } finally {
      Object.assign(_deps, original);
      vi.unstubAllGlobals();
    }
  });

  it("returns SESSION_NOT_FOUND when slash-command target is missing", () => {
    const server = {
      sessionHandlers: new Map(),
      _send: vi.fn(),
    };

    handleSlashCommand(
      server,
      "1",
      {},
      {
        sessionId: "missing",
        command: "/help",
      },
    );

    expect(server._send).toHaveBeenCalledWith(
      {},
      {
        id: "1",
        type: "error",
        code: "SESSION_NOT_FOUND",
        message: "No active session handler for: missing",
      },
    );
  });

  it("delegates slash-command to active session handler", () => {
    const handler = { handleSlashCommand: vi.fn() };
    const server = {
      sessionHandlers: new Map([["sess-1", handler]]),
      _send: vi.fn(),
    };

    handleSlashCommand(
      server,
      "2",
      {},
      {
        sessionId: "sess-1",
        command: "/model qwen",
      },
    );

    expect(handler.handleSlashCommand).toHaveBeenCalledWith("/model qwen", "2");
  });

  it("returns INVALID_TASK for orchestrate without task", async () => {
    const server = { _send: vi.fn() };

    await handleOrchestrate(server, "3", {}, {});

    expect(server._send).toHaveBeenCalledWith(
      {},
      {
        id: "3",
        type: "error",
        code: "INVALID_TASK",
        message: "task field required",
      },
    );
  });
});
