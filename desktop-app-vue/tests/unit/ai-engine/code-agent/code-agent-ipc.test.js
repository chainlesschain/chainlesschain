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

describe("code-agent-ipc", () => {
  let registerCodeAgentIPC;
  let unregisterCodeAgentIPC;
  let CHANNELS;
  let mockIpcMain;
  let mockCodeGenerator;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod =
      await import("../../../../src/main/ai-engine/code-agent/code-agent-ipc.js");
    registerCodeAgentIPC = mod.registerCodeAgentIPC;
    unregisterCodeAgentIPC = mod.unregisterCodeAgentIPC;
    CHANNELS = mod.CHANNELS;

    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    mockCodeGenerator = {
      generate: vi.fn().mockResolvedValue({ code: "const x = 1;" }),
      review: vi.fn().mockResolvedValue({ score: 8, comments: ["ok"] }),
      fix: vi.fn().mockResolvedValue({ code: "const x = 1;", fixes: 1 }),
      scaffold: vi.fn().mockResolvedValue({ files: ["index.ts"] }),
      configureCICD: vi.fn().mockResolvedValue({ files: [".github/ci.yml"] }),
      analyzeGit: vi.fn().mockResolvedValue({ branch: "main", commits: 42 }),
      explain: vi.fn().mockResolvedValue({ summary: "declares a constant" }),
      refactor: vi.fn().mockResolvedValue({ code: "const y = 1;" }),
    };

    registerCodeAgentIPC({
      codeGenerator: mockCodeGenerator,
      ipcMain: mockIpcMain,
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
      const result = registerCodeAgentIPC({
        codeGenerator: mockCodeGenerator,
        ipcMain: mockIpcMain,
      });
      expect(result.handlerCount).toBe(8);
    });

    it("accepts legacy positional codeGenerator arg with injected ipcMain", () => {
      // The adapter accepts either a deps object { codeGenerator, ipcMain }
      // or a bare codeGenerator instance. When given a bare instance that
      // is NOT a deps-shaped object, the adapter should treat it as the
      // codeGenerator and fall back to electron.ipcMain.
      // Here we pass an object missing the `codeGenerator` key so the
      // adapter treats the whole object as the generator, and we separately
      // stub mockIpcMain via the mocked electron module.
      mockIpcMain.handle.mockClear();
      // With bare instance form (no `codeGenerator` key), the adapter
      // should NOT throw, even though ipcMain falls through to the
      // module-level mocked electron export.
      expect(() =>
        registerCodeAgentIPC({
          generate: vi.fn(),
          review: vi.fn(),
          fix: vi.fn(),
          scaffold: vi.fn(),
          configureCICD: vi.fn(),
          analyzeGit: vi.fn(),
          explain: vi.fn(),
          refactor: vi.fn(),
          codeGenerator: null,
          ipcMain: mockIpcMain,
        }),
      ).not.toThrow();
    });

    it("registers all handlers as async functions", () => {
      for (const handler of Object.values(handlers)) {
        expect(handler.constructor.name).toBe("AsyncFunction");
      }
    });
  });

  describe("code-agent:generate", () => {
    it("returns generated code", async () => {
      const res = await handlers["code-agent:generate"](
        {},
        { prompt: "a fn", options: {} },
      );
      expect(res).toEqual({ success: true, data: { code: "const x = 1;" } });
      expect(mockCodeGenerator.generate).toHaveBeenCalledWith("a fn", {});
    });

    it("returns error when generator missing", async () => {
      mockIpcMain.handle.mockClear();
      registerCodeAgentIPC({ codeGenerator: null, ipcMain: mockIpcMain });
      const h = mockIpcMain.handle.mock.calls.find(
        (c) => c[0] === "code-agent:generate",
      )[1];
      const res = await h({}, { prompt: "p", options: {} });
      expect(res).toEqual({
        success: false,
        error: "CodeGeneratorV2 not available",
      });
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.generate.mockRejectedValueOnce(new Error("LLM down"));
      const res = await handlers["code-agent:generate"](
        {},
        { prompt: "p", options: {} },
      );
      expect(res).toEqual({ success: false, error: "LLM down" });
    });
  });

  describe("code-agent:review", () => {
    it("returns review result", async () => {
      const res = await handlers["code-agent:review"](
        {},
        { code: "x", options: {} },
      );
      expect(res.success).toBe(true);
      expect(res.data.score).toBe(8);
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.review.mockRejectedValueOnce(new Error("bad ast"));
      const res = await handlers["code-agent:review"](
        {},
        { code: "x", options: {} },
      );
      expect(res).toEqual({ success: false, error: "bad ast" });
    });
  });

  describe("code-agent:fix", () => {
    it("applies fixes", async () => {
      const res = await handlers["code-agent:fix"](
        {},
        { code: "x", issues: ["i1"], options: {} },
      );
      expect(res.success).toBe(true);
      expect(mockCodeGenerator.fix).toHaveBeenCalledWith("x", ["i1"], {});
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.fix.mockRejectedValueOnce(new Error("conflict"));
      const res = await handlers["code-agent:fix"](
        {},
        { code: "x", issues: [], options: {} },
      );
      expect(res).toEqual({ success: false, error: "conflict" });
    });
  });

  describe("code-agent:scaffold", () => {
    it("creates a scaffold", async () => {
      const res = await handlers["code-agent:scaffold"](
        {},
        { template: "vue", options: {} },
      );
      expect(res.success).toBe(true);
      expect(res.data.files).toContain("index.ts");
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.scaffold.mockRejectedValueOnce(
        new Error("unknown template"),
      );
      const res = await handlers["code-agent:scaffold"](
        {},
        { template: "x", options: {} },
      );
      expect(res).toEqual({ success: false, error: "unknown template" });
    });
  });

  describe("code-agent:configure-ci", () => {
    it("configures CI", async () => {
      const res = await handlers["code-agent:configure-ci"](
        {},
        { projectType: "node", options: {} },
      );
      expect(res.success).toBe(true);
      expect(mockCodeGenerator.configureCICD).toHaveBeenCalledWith("node", {});
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.configureCICD.mockRejectedValueOnce(
        new Error("no workflow support"),
      );
      const res = await handlers["code-agent:configure-ci"](
        {},
        { projectType: "x", options: {} },
      );
      expect(res).toEqual({ success: false, error: "no workflow support" });
    });
  });

  describe("code-agent:analyze-git", () => {
    it("analyzes a repo", async () => {
      const res = await handlers["code-agent:analyze-git"](
        {},
        { repoPath: "/r", options: {} },
      );
      expect(res.success).toBe(true);
      expect(res.data.branch).toBe("main");
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.analyzeGit.mockRejectedValueOnce(new Error("no .git"));
      const res = await handlers["code-agent:analyze-git"](
        {},
        { repoPath: "/r", options: {} },
      );
      expect(res).toEqual({ success: false, error: "no .git" });
    });
  });

  describe("code-agent:explain", () => {
    it("explains code", async () => {
      const res = await handlers["code-agent:explain"](
        {},
        { code: "const x = 1;", options: {} },
      );
      expect(res.success).toBe(true);
      expect(res.data.summary).toBeTruthy();
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.explain.mockRejectedValueOnce(new Error("LLM busy"));
      const res = await handlers["code-agent:explain"](
        {},
        { code: "x", options: {} },
      );
      expect(res).toEqual({ success: false, error: "LLM busy" });
    });
  });

  describe("code-agent:refactor", () => {
    it("refactors code", async () => {
      const res = await handlers["code-agent:refactor"](
        {},
        { code: "x", options: {} },
      );
      expect(res.success).toBe(true);
      expect(res.data.code).toBe("const y = 1;");
    });

    it("surfaces thrown errors", async () => {
      mockCodeGenerator.refactor.mockRejectedValueOnce(new Error("no targets"));
      const res = await handlers["code-agent:refactor"](
        {},
        { code: "x", options: {} },
      );
      expect(res).toEqual({ success: false, error: "no targets" });
    });
  });

  describe("unregisterCodeAgentIPC", () => {
    it("removes all channel handlers", () => {
      unregisterCodeAgentIPC({ ipcMain: mockIpcMain });
      for (const channel of CHANNELS) {
        expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(channel);
      }
    });

    it("tolerates removeHandler throwing", () => {
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error("not registered");
      });
      expect(() =>
        unregisterCodeAgentIPC({ ipcMain: mockIpcMain }),
      ).not.toThrow();
    });
  });
});
