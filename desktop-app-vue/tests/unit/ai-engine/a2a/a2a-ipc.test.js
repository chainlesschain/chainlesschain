import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

describe("a2a-ipc", () => {
  let registerA2AIPC;
  let unregisterA2AIPC;
  let CHANNELS;
  let mockIpcMain;
  let mockA2AEngine;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import("../../../../src/main/ai-engine/a2a/a2a-ipc.js");
    registerA2AIPC = mod.registerA2AIPC;
    unregisterA2AIPC = mod.unregisterA2AIPC;
    CHANNELS = mod.CHANNELS;

    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    mockA2AEngine = {
      discoverAgents: vi.fn(() => [
        { id: "agent-1", name: "Builder" },
        { id: "agent-2", name: "Reviewer" },
      ]),
      sendTask: vi
        .fn()
        .mockResolvedValue({ taskId: "task-1", status: "queued" }),
      getTaskStatus: vi.fn(() => ({ id: "task-1", status: "running" })),
      subscribeToTask: vi.fn(() => "sub-1"),
      registerCard: vi.fn(() => ({ id: "card-1", version: 1 })),
      updateCard: vi.fn(() => ({ id: "card-1", version: 2 })),
      listPeers: vi.fn(() => ["peer-a", "peer-b"]),
      negotiateCapability: vi.fn(() => ({
        agreed: ["chat", "search"],
        rejected: [],
      })),
    };

    registerA2AIPC({ a2aEngine: mockA2AEngine, ipcMain: mockIpcMain });

    handlers = {};
    for (const call of mockIpcMain.handle.mock.calls) {
      handlers[call[0]] = call[1];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Registration", () => {
    it("exports CHANNELS array with 8 entries", () => {
      expect(CHANNELS).toHaveLength(8);
    });

    it("registers exactly 8 IPC handlers", () => {
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(8);
    });

    it("registers a handler for every declared channel", () => {
      const registered = mockIpcMain.handle.mock.calls.map((c) => c[0]);
      for (const channel of CHANNELS) {
        expect(registered).toContain(channel);
      }
    });

    it("returns handlerCount", () => {
      mockIpcMain.handle.mockClear();
      const result = registerA2AIPC({
        a2aEngine: mockA2AEngine,
        ipcMain: mockIpcMain,
      });
      expect(result.handlerCount).toBe(8);
    });

    it("registers all handlers as async functions", () => {
      for (const handler of Object.values(handlers)) {
        expect(handler.constructor.name).toBe("AsyncFunction");
      }
    });
  });

  describe("a2a:discover-agents", () => {
    it("returns discovered agents", async () => {
      const res = await handlers["a2a:discover-agents"](
        {},
        { capability: "chat" },
      );
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(2);
      expect(mockA2AEngine.discoverAgents).toHaveBeenCalledWith({
        capability: "chat",
      });
    });

    it("defaults filter to {} when undefined", async () => {
      await handlers["a2a:discover-agents"]({}, undefined);
      expect(mockA2AEngine.discoverAgents).toHaveBeenCalledWith({});
    });

    it("returns error when engine is missing", async () => {
      mockIpcMain.handle.mockClear();
      registerA2AIPC({ a2aEngine: null, ipcMain: mockIpcMain });
      const h = mockIpcMain.handle.mock.calls.find(
        (c) => c[0] === "a2a:discover-agents",
      )[1];
      const res = await h({}, {});
      expect(res).toEqual({
        success: false,
        error: "A2A engine not available",
      });
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.discoverAgents.mockImplementationOnce(() => {
        throw new Error("index offline");
      });
      const res = await handlers["a2a:discover-agents"]({}, {});
      expect(res).toEqual({ success: false, error: "index offline" });
    });
  });

  describe("a2a:send-task", () => {
    it("sends a task and returns result", async () => {
      const res = await handlers["a2a:send-task"](
        {},
        {
          agentId: "agent-1",
          input: { prompt: "hello" },
          options: { timeout: 5000 },
        },
      );
      expect(res).toEqual({
        success: true,
        data: { taskId: "task-1", status: "queued" },
      });
      expect(mockA2AEngine.sendTask).toHaveBeenCalledWith(
        "agent-1",
        { prompt: "hello" },
        { timeout: 5000 },
      );
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.sendTask.mockRejectedValueOnce(new Error("agent offline"));
      const res = await handlers["a2a:send-task"](
        {},
        { agentId: "x", input: {}, options: {} },
      );
      expect(res).toEqual({ success: false, error: "agent offline" });
    });
  });

  describe("a2a:get-task-status", () => {
    it("returns a task", async () => {
      const res = await handlers["a2a:get-task-status"]({}, "task-1");
      expect(res).toEqual({
        success: true,
        data: { id: "task-1", status: "running" },
      });
    });

    it("returns not-found when task is null", async () => {
      mockA2AEngine.getTaskStatus.mockReturnValueOnce(null);
      const res = await handlers["a2a:get-task-status"]({}, "missing");
      expect(res).toEqual({ success: false, error: "Task not found" });
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.getTaskStatus.mockImplementationOnce(() => {
        throw new Error("corrupt task store");
      });
      const res = await handlers["a2a:get-task-status"]({}, "t");
      expect(res).toEqual({ success: false, error: "corrupt task store" });
    });
  });

  describe("a2a:subscribe-updates", () => {
    it("returns subscriptionId", async () => {
      const res = await handlers["a2a:subscribe-updates"]({}, "task-1");
      expect(res).toEqual({ success: true, data: { subscriptionId: "sub-1" } });
      expect(mockA2AEngine.subscribeToTask).toHaveBeenCalledWith(
        "task-1",
        expect.any(Function),
      );
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.subscribeToTask.mockImplementationOnce(() => {
        throw new Error("cannot subscribe");
      });
      const res = await handlers["a2a:subscribe-updates"]({}, "t");
      expect(res).toEqual({ success: false, error: "cannot subscribe" });
    });
  });

  describe("a2a:register-card", () => {
    it("registers a card", async () => {
      const card = { name: "Builder", capabilities: ["chat"] };
      const res = await handlers["a2a:register-card"]({}, card);
      expect(res).toEqual({
        success: true,
        data: { id: "card-1", version: 1 },
      });
      expect(mockA2AEngine.registerCard).toHaveBeenCalledWith(card);
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.registerCard.mockImplementationOnce(() => {
        throw new Error("duplicate name");
      });
      const res = await handlers["a2a:register-card"]({}, {});
      expect(res).toEqual({ success: false, error: "duplicate name" });
    });
  });

  describe("a2a:update-card", () => {
    it("updates a card", async () => {
      const res = await handlers["a2a:update-card"](
        {},
        { id: "card-1", updates: { description: "new" } },
      );
      expect(res).toEqual({
        success: true,
        data: { id: "card-1", version: 2 },
      });
      expect(mockA2AEngine.updateCard).toHaveBeenCalledWith("card-1", {
        description: "new",
      });
    });

    it("returns not-found when updateCard returns falsy", async () => {
      mockA2AEngine.updateCard.mockReturnValueOnce(null);
      const res = await handlers["a2a:update-card"](
        {},
        { id: "missing", updates: {} },
      );
      expect(res).toEqual({ success: false, error: "Card not found" });
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.updateCard.mockImplementationOnce(() => {
        throw new Error("schema violation");
      });
      const res = await handlers["a2a:update-card"](
        {},
        { id: "c", updates: {} },
      );
      expect(res).toEqual({ success: false, error: "schema violation" });
    });
  });

  describe("a2a:list-peers", () => {
    it("returns peer list", async () => {
      const res = await handlers["a2a:list-peers"]();
      expect(res).toEqual({ success: true, data: ["peer-a", "peer-b"] });
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.listPeers.mockImplementationOnce(() => {
        throw new Error("peer table unavailable");
      });
      const res = await handlers["a2a:list-peers"]();
      expect(res).toEqual({
        success: false,
        error: "peer table unavailable",
      });
    });
  });

  describe("a2a:negotiate-capability", () => {
    it("negotiates capabilities", async () => {
      const res = await handlers["a2a:negotiate-capability"](
        {},
        { agentId: "agent-1", capabilities: ["chat", "search"] },
      );
      expect(res.success).toBe(true);
      expect(res.data.agreed).toEqual(["chat", "search"]);
    });

    it("surfaces thrown errors", async () => {
      mockA2AEngine.negotiateCapability.mockImplementationOnce(() => {
        throw new Error("no overlap");
      });
      const res = await handlers["a2a:negotiate-capability"](
        {},
        { agentId: "x", capabilities: [] },
      );
      expect(res).toEqual({ success: false, error: "no overlap" });
    });
  });

  describe("unregisterA2AIPC", () => {
    it("removes all channel handlers", () => {
      unregisterA2AIPC({ ipcMain: mockIpcMain });
      for (const channel of CHANNELS) {
        expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(channel);
      }
    });

    it("tolerates removeHandler throwing", () => {
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error("not registered");
      });
      expect(() => unregisterA2AIPC({ ipcMain: mockIpcMain })).not.toThrow();
    });
  });
});
