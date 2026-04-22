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

describe("tech-learning-ipc", () => {
  let registerTechLearningIPC;
  let unregisterTechLearningIPC;
  let CHANNELS;
  let mockIpcMain;
  let mockIpcGuard;
  let mockTechLearningEngine;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod =
      await import("../../../../src/main/ai-engine/autonomous/tech-learning-ipc.js");
    registerTechLearningIPC = mod.registerTechLearningIPC;
    unregisterTechLearningIPC = mod.unregisterTechLearningIPC;
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

    mockTechLearningEngine = {
      detectStack: vi.fn().mockResolvedValue({
        id: "profile-1",
        language: "typescript",
        frameworks: ["vue", "electron"],
      }),
      getProfiles: vi
        .fn()
        .mockResolvedValue([{ id: "profile-1" }, { id: "profile-2" }]),
      extractPractices: vi.fn().mockResolvedValue([
        { id: "p1", title: "Use strict mode" },
        { id: "p2", title: "Pin dependencies" },
      ]),
      getPractices: vi.fn().mockResolvedValue([{ id: "p1" }]),
      synthesizeSkill: vi
        .fn()
        .mockResolvedValue({ id: "skill-1", name: "vue-best-practices" }),
    };

    registerTechLearningIPC({
      techLearningEngine: mockTechLearningEngine,
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
      const result = registerTechLearningIPC({
        techLearningEngine: mockTechLearningEngine,
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      expect(result.handlerCount).toBe(5);
    });

    it("skips re-registration when module is already registered", () => {
      mockIpcMain.handle.mockClear();
      mockIpcGuard.isModuleRegistered.mockReturnValue(true);
      const result = registerTechLearningIPC({
        techLearningEngine: mockTechLearningEngine,
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      expect(mockIpcMain.handle).not.toHaveBeenCalled();
      expect(result.handlerCount).toBe(5);
    });

    it("calls ipcGuard.registerModule with channels", () => {
      expect(mockIpcGuard.registerModule).toHaveBeenCalledWith(
        "tech-learning-ipc",
        CHANNELS,
      );
    });

    it("registers all handlers as async functions", () => {
      for (const handler of Object.values(handlers)) {
        expect(handler.constructor.name).toBe("AsyncFunction");
      }
    });
  });

  describe("tech-learning:detect-stack", () => {
    it("returns a profile on success", async () => {
      const res = await handlers["tech-learning:detect-stack"](
        {},
        { repoPath: "./foo" },
      );
      expect(res).toEqual({
        success: true,
        profile: {
          id: "profile-1",
          language: "typescript",
          frameworks: ["vue", "electron"],
        },
      });
      expect(mockTechLearningEngine.detectStack).toHaveBeenCalledWith({
        repoPath: "./foo",
      });
    });

    it("returns error when engine missing", async () => {
      mockIpcMain.handle.mockClear();
      registerTechLearningIPC({
        techLearningEngine: null,
        ipcMain: mockIpcMain,
        ipcGuard: { ...mockIpcGuard, isModuleRegistered: () => false },
      });
      const h = mockIpcMain.handle.mock.calls.find(
        (c) => c[0] === "tech-learning:detect-stack",
      )[1];
      const res = await h({}, {});
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not initialized/i);
    });

    it("surfaces thrown errors", async () => {
      mockTechLearningEngine.detectStack.mockRejectedValueOnce(
        new Error("no package.json"),
      );
      const res = await handlers["tech-learning:detect-stack"](
        {},
        { repoPath: "/missing" },
      );
      expect(res).toEqual({ success: false, error: "no package.json" });
    });
  });

  describe("tech-learning:get-profiles", () => {
    it("returns profiles with supplied filter", async () => {
      const res = await handlers["tech-learning:get-profiles"](
        {},
        { language: "typescript" },
      );
      expect(res.success).toBe(true);
      expect(res.profiles).toHaveLength(2);
      expect(mockTechLearningEngine.getProfiles).toHaveBeenCalledWith({
        language: "typescript",
      });
    });

    it("defaults filter to {} when undefined", async () => {
      await handlers["tech-learning:get-profiles"]({}, undefined);
      expect(mockTechLearningEngine.getProfiles).toHaveBeenCalledWith({});
    });

    it("surfaces thrown errors", async () => {
      mockTechLearningEngine.getProfiles.mockRejectedValueOnce(
        new Error("store offline"),
      );
      const res = await handlers["tech-learning:get-profiles"]({}, {});
      expect(res).toEqual({ success: false, error: "store offline" });
    });
  });

  describe("tech-learning:extract-practices", () => {
    it("returns extracted practices", async () => {
      const res = await handlers["tech-learning:extract-practices"](
        {},
        { profileId: "profile-1" },
      );
      expect(res.success).toBe(true);
      expect(res.practices).toHaveLength(2);
    });

    it("surfaces thrown errors", async () => {
      mockTechLearningEngine.extractPractices.mockRejectedValueOnce(
        new Error("extract failed"),
      );
      const res = await handlers["tech-learning:extract-practices"]({}, {});
      expect(res).toEqual({ success: false, error: "extract failed" });
    });
  });

  describe("tech-learning:get-practices", () => {
    it("returns practices with filter", async () => {
      const res = await handlers["tech-learning:get-practices"](
        {},
        { category: "testing" },
      );
      expect(res.success).toBe(true);
      expect(mockTechLearningEngine.getPractices).toHaveBeenCalledWith({
        category: "testing",
      });
    });

    it("defaults filter to {} when undefined", async () => {
      await handlers["tech-learning:get-practices"]({}, undefined);
      expect(mockTechLearningEngine.getPractices).toHaveBeenCalledWith({});
    });
  });

  describe("tech-learning:synthesize-skill", () => {
    it("synthesizes a skill", async () => {
      const res = await handlers["tech-learning:synthesize-skill"](
        {},
        { profileId: "profile-1", practiceIds: ["p1"] },
      );
      expect(res).toEqual({
        success: true,
        skill: { id: "skill-1", name: "vue-best-practices" },
      });
    });

    it("surfaces thrown errors", async () => {
      mockTechLearningEngine.synthesizeSkill.mockRejectedValueOnce(
        new Error("no practices selected"),
      );
      const res = await handlers["tech-learning:synthesize-skill"]({}, {});
      expect(res).toEqual({ success: false, error: "no practices selected" });
    });
  });

  describe("unregisterTechLearningIPC", () => {
    it("removes all channel handlers", () => {
      unregisterTechLearningIPC({
        ipcMain: mockIpcMain,
        ipcGuard: mockIpcGuard,
      });
      for (const channel of CHANNELS) {
        expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(channel);
      }
      expect(mockIpcGuard.unregisterModule).toHaveBeenCalledWith(
        "tech-learning-ipc",
      );
    });

    it("tolerates removeHandler throwing", () => {
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error("not registered");
      });
      expect(() =>
        unregisterTechLearningIPC({
          ipcMain: mockIpcMain,
          ipcGuard: mockIpcGuard,
        }),
      ).not.toThrow();
    });
  });
});
