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

vi.mock("../../../../src/main/ipc/ipc-guard.js", () => ({
  default: {
    isModuleRegistered: vi.fn(() => false),
    registerModule: vi.fn(),
    unregisterModule: vi.fn(),
  },
}));

describe("collaboration-governance-ipc", () => {
  let registerCollaborationGovernanceIPC;
  let unregisterCollaborationGovernanceIPC;
  let CHANNELS;
  let mockIpcMain;
  let mockIpcGuard;
  let mockCollaborationGovernance;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod =
      await import("../../../../src/main/ai-engine/autonomous/collaboration-governance-ipc.js");
    registerCollaborationGovernanceIPC = mod.registerCollaborationGovernanceIPC;
    unregisterCollaborationGovernanceIPC =
      mod.unregisterCollaborationGovernanceIPC;
    CHANNELS = mod.CHANNELS;

    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    mockIpcGuard = {
      isModuleRegistered: vi.fn(() => false),
      registerModule: vi.fn(),
      unregisterModule: vi.fn(),
    };

    mockCollaborationGovernance = {
      getPendingDecisions: vi
        .fn()
        .mockResolvedValue([{ id: "d1", status: "pending" }]),
      approveDecision: vi
        .fn()
        .mockResolvedValue({ id: "d1", status: "approved" }),
      rejectDecision: vi
        .fn()
        .mockResolvedValue({ id: "d1", status: "rejected" }),
      getAutonomyLevel: vi.fn().mockResolvedValue("supervised"),
      setAutonomyPolicy: vi
        .fn()
        .mockResolvedValue({ scope: "global", level: "supervised" }),
    };

    registerCollaborationGovernanceIPC({
      collaborationGovernance: mockCollaborationGovernance,
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    handlers = {};
    for (const call of mockIpcMain.handle.mock.calls) {
      handlers[call[0]] = call[1];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Registration", () => {
    it("exports CHANNELS array with 5 entries", () => {
      expect(CHANNELS).toHaveLength(5);
    });

    it("registers exactly 5 IPC handlers", () => {
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(5);
    });

    it("registers handlers for every declared channel", () => {
      const registered = mockIpcMain.handle.mock.calls.map((c) => c[0]);
      for (const channel of CHANNELS) {
        expect(registered).toContain(channel);
      }
    });

    it("returns handlerCount from register function", () => {
      mockIpcMain.handle.mockClear();
      mockIpcGuard.isModuleRegistered.mockReturnValue(false);
      const result = registerCollaborationGovernanceIPC({
        collaborationGovernance: mockCollaborationGovernance,
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      expect(result.handlerCount).toBe(5);
    });

    it("skips re-registration when module is already registered", () => {
      mockIpcMain.handle.mockClear();
      mockIpcGuard.isModuleRegistered.mockReturnValue(true);
      const result = registerCollaborationGovernanceIPC({
        collaborationGovernance: mockCollaborationGovernance,
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      expect(mockIpcMain.handle).not.toHaveBeenCalled();
      expect(result.handlerCount).toBe(5);
    });

    it("calls ipcGuard.registerModule with channels", () => {
      expect(mockIpcGuard.registerModule).toHaveBeenCalledWith(
        "collab-governance-ipc",
        CHANNELS,
      );
    });

    it("registers all handlers as async functions", () => {
      for (const handler of Object.values(handlers)) {
        expect(handler.constructor.name).toBe("AsyncFunction");
      }
    });
  });

  describe("collab-governance:get-pending", () => {
    it("returns decisions on success", async () => {
      const res = await handlers["collab-governance:get-pending"](
        {},
        { status: "pending" },
      );
      expect(res).toEqual({
        success: true,
        decisions: [{ id: "d1", status: "pending" }],
      });
      expect(
        mockCollaborationGovernance.getPendingDecisions,
      ).toHaveBeenCalledWith({ status: "pending" });
    });

    it("defaults filter to {} when undefined", async () => {
      await handlers["collab-governance:get-pending"]({}, undefined);
      expect(
        mockCollaborationGovernance.getPendingDecisions,
      ).toHaveBeenCalledWith({});
    });

    it("returns error when collaborationGovernance missing", async () => {
      mockIpcMain.handle.mockClear();
      registerCollaborationGovernanceIPC({
        collaborationGovernance: null,
        ipcMain: mockIpcMain,
        ipcGuard: { ...mockIpcGuard, isModuleRegistered: () => false },
      });
      const freshHandler = mockIpcMain.handle.mock.calls.find(
        (c) => c[0] === "collab-governance:get-pending",
      )[1];
      const res = await freshHandler({}, {});
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not initialized/i);
    });

    it("returns error when underlying call throws", async () => {
      mockCollaborationGovernance.getPendingDecisions.mockRejectedValueOnce(
        new Error("db down"),
      );
      const res = await handlers["collab-governance:get-pending"]({}, {});
      expect(res).toEqual({ success: false, error: "db down" });
    });
  });

  describe("collab-governance:approve-decision", () => {
    it("approves a decision", async () => {
      const params = { decisionId: "d1", approverId: "u1" };
      const res = await handlers["collab-governance:approve-decision"](
        {},
        params,
      );
      expect(res).toEqual({
        success: true,
        decision: { id: "d1", status: "approved" },
      });
      expect(mockCollaborationGovernance.approveDecision).toHaveBeenCalledWith(
        params,
      );
    });

    it("returns error when approval fails", async () => {
      mockCollaborationGovernance.approveDecision.mockRejectedValueOnce(
        new Error("already decided"),
      );
      const res = await handlers["collab-governance:approve-decision"](
        {},
        { decisionId: "d1" },
      );
      expect(res).toEqual({ success: false, error: "already decided" });
    });
  });

  describe("collab-governance:reject-decision", () => {
    it("rejects a decision", async () => {
      const res = await handlers["collab-governance:reject-decision"](
        {},
        { decisionId: "d1", reason: "not enough context" },
      );
      expect(res.success).toBe(true);
      expect(res.decision.status).toBe("rejected");
    });

    it("surfaces downstream errors", async () => {
      mockCollaborationGovernance.rejectDecision.mockRejectedValueOnce(
        new Error("unknown decision"),
      );
      const res = await handlers["collab-governance:reject-decision"](
        {},
        { decisionId: "x" },
      );
      expect(res).toEqual({ success: false, error: "unknown decision" });
    });
  });

  describe("collab-governance:get-autonomy-level", () => {
    it("returns autonomy level for a scope", async () => {
      const res = await handlers["collab-governance:get-autonomy-level"](
        {},
        "workflow",
      );
      expect(res).toEqual({ success: true, level: "supervised" });
      expect(mockCollaborationGovernance.getAutonomyLevel).toHaveBeenCalledWith(
        "workflow",
      );
    });

    it("propagates errors", async () => {
      mockCollaborationGovernance.getAutonomyLevel.mockRejectedValueOnce(
        new Error("no such scope"),
      );
      const res = await handlers["collab-governance:get-autonomy-level"](
        {},
        "bogus",
      );
      expect(res.success).toBe(false);
      expect(res.error).toBe("no such scope");
    });
  });

  describe("collab-governance:set-autonomy-policy", () => {
    it("sets a policy", async () => {
      const params = { scope: "global", level: "full-auto" };
      const res = await handlers["collab-governance:set-autonomy-policy"](
        {},
        params,
      );
      expect(res.success).toBe(true);
      expect(
        mockCollaborationGovernance.setAutonomyPolicy,
      ).toHaveBeenCalledWith(params);
    });

    it("propagates errors", async () => {
      mockCollaborationGovernance.setAutonomyPolicy.mockRejectedValueOnce(
        new Error("invalid policy"),
      );
      const res = await handlers["collab-governance:set-autonomy-policy"](
        {},
        {},
      );
      expect(res).toEqual({ success: false, error: "invalid policy" });
    });
  });

  describe("unregisterCollaborationGovernanceIPC", () => {
    it("removes all channel handlers", () => {
      unregisterCollaborationGovernanceIPC({
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      for (const channel of CHANNELS) {
        expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(channel);
      }
      expect(mockIpcGuard.unregisterModule).toHaveBeenCalledWith(
        "collab-governance-ipc",
      );
    });

    it("tolerates removeHandler throwing", () => {
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error("not registered");
      });
      expect(() =>
        unregisterCollaborationGovernanceIPC({
          ipcMain: mockIpcMain,
          ipcGuard: mockIpcGuard,
        }),
      ).not.toThrow();
    });
  });
});
