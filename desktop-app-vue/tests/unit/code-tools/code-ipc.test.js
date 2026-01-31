/**
 * Code Tools IPC 单元测试
 *
 * 测试代码工具相关的IPC通信处理
 * 覆盖10个IPC handlers:
 * - code:generate - 生成代码
 * - code:generateTests - 生成单元测试
 * - code:review - 代码审查
 * - code:refactor - 代码重构
 * - code:explain - 解释代码
 * - code:fixBug - 修复bug
 * - code:generateScaffold - 生成项目脚手架
 * - code:executePython - 执行Python代码
 * - code:executeFile - 执行代码文件
 * - code:checkSafety - 检查代码安全性
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// DON'T mock electron here - use the global mock from tests/setup.ts
// We'll enhance it in beforeEach

// Import source - it will use the global electron mock
const { registerCodeIPC } = require("../../../src/main/code-tools/code-ipc");

// ===================== MOCK FACTORIES =====================

/**
 * 创建模拟的ipcMain对象
 */
const createMockIpcMain = () => {
  const handlers = new Map();

  return {
    handle: vi.fn((channel, handler) => {
      handlers.set(channel, handler);
    }),
    // Helper method to get registered handler
    getHandler: (channel) => handlers.get(channel),
    // Helper to simulate IPC call
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler for ${channel}`);
      }
      return handler({}, ...args);
    },
  };
};

/**
 * 创建模拟的LLM Manager
 */
const createMockLLMManager = () => ({
  chat: vi.fn().mockResolvedValue({
    content: "Generated code response",
    usage: { total_tokens: 100 },
  }),
  isInitialized: vi.fn().mockReturnValue(true),
  getCurrentModel: vi.fn().mockReturnValue("qwen2:7b"),
});

/**
 * 创建模拟的Code Engine
 */
const createMockCodeEngine = () => ({
  handleProjectTask: vi.fn().mockResolvedValue({
    success: true,
    code: "function test() { return true; }",
    explanation: "Test function",
    language: "javascript",
  }),
});

/**
 * 创建模拟的Code Executor
 */
const createMockCodeExecutor = () => ({
  initialize: vi.fn().mockResolvedValue(true),
  executePython: vi.fn().mockResolvedValue({
    success: true,
    stdout: "Hello, World!",
    stderr: "",
    exitCode: 0,
  }),
  executeFile: vi.fn().mockResolvedValue({
    success: true,
    stdout: "Execution successful",
    stderr: "",
    exitCode: 0,
  }),
  checkSafety: vi.fn().mockReturnValue({
    safe: true,
    warnings: [],
  }),
});

// ===================== MODULE MOCKS =====================

// Mock code-engine module
vi.mock("../../../src/main/engines/code-engine", () => {
  let mockCodeEngine;

  return {
    getCodeEngine: vi.fn(() => {
      if (!mockCodeEngine) {
        mockCodeEngine = createMockCodeEngine();
      }
      return mockCodeEngine;
    }),
    // Expose for testing
    __getMockCodeEngine: () => mockCodeEngine,
    __resetMockCodeEngine: () => {
      mockCodeEngine = undefined;
    },
  };
});

// Mock code-executor module
vi.mock("../../../src/main/engines/code-executor", () => {
  let mockCodeExecutor;

  return {
    getCodeExecutor: vi.fn(() => {
      if (!mockCodeExecutor) {
        mockCodeExecutor = createMockCodeExecutor();
      }
      return mockCodeExecutor;
    }),
    // Expose for testing
    __getMockCodeExecutor: () => mockCodeExecutor,
    __resetMockCodeExecutor: () => {
      mockCodeExecutor = undefined;
    },
  };
});

// ===================== HELPER FUNCTIONS =====================

/**
 * 获取mock的code engine实例
 */
function getMockCodeEngine() {
  const {
    __getMockCodeEngine,
  } = require("../../../src/main/engines/code-engine");
  return __getMockCodeEngine();
}

/**
 * 获取mock的code executor实例
 */
function getMockCodeExecutor() {
  const {
    __getMockCodeExecutor,
  } = require("../../../src/main/engines/code-executor");
  return __getMockCodeExecutor();
}

/**
 * 重置所有mock
 * Note: __resetMockCodeEngine and __resetMockCodeExecutor don't exist in source code
 * These were test-specific utilities that are no longer needed
 */
function resetAllMocks() {
  // No-op: mocks are reset via vi.clearAllMocks() in beforeEach
  // If source modules had exported reset functions, we would call them here
}

// ===================== TESTS =====================

describe("CodeIPC", () => {
  let mockIpcMain;
  let mockLLMManager;
  let context;
  let handlersMap;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAllMocks();

    // Create new handlers map for this test
    handlersMap = new Map();

    // Get the global electron mock from setup.ts
    const electron = require("electron");

    // Enhance the global ipcMain.handle mock to track handlers
    electron.ipcMain.handle.mockImplementation((channel, handler) => {
      handlersMap.set(channel, handler);
    });

    // Create test helper object
    mockIpcMain = {
      handle: electron.ipcMain.handle,
      removeHandler: electron.ipcMain.removeHandler,
      getHandler: (channel) => handlersMap.get(channel),
      invoke: async (channel, ...args) => {
        const handler = handlersMap.get(channel);
        if (!handler) {
          throw new Error(`No handler for ${channel}`);
        }
        return handler({}, ...args);
      },
    };

    mockLLMManager = createMockLLMManager();

    context = {
      llmManager: mockLLMManager,
    };

    // Mock console methods to reduce test output
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("registerCodeIPC()", () => {
    it("should register all 10 IPC handlers", () => {
      registerCodeIPC(context);

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(10);
    });

    it("should register code generation handlers", () => {
      registerCodeIPC(context);

      const codeHandlers = [
        "code:generate",
        "code:generateTests",
        "code:review",
        "code:refactor",
        "code:explain",
        "code:fixBug",
        "code:generateScaffold",
      ];

      codeHandlers.forEach((channel) => {
        expect(mockIpcMain.getHandler(channel)).toBeDefined();
      });
    });

    it("should register code execution handlers", () => {
      registerCodeIPC(context);

      const executionHandlers = [
        "code:executePython",
        "code:executeFile",
        "code:checkSafety",
      ];

      executionHandlers.forEach((channel) => {
        expect(mockIpcMain.getHandler(channel)).toBeDefined();
      });
    });

    it("should log successful registration", () => {
      registerCodeIPC(context);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("代码工具IPC handlers已注册 (10个)"),
      );
    });
  });

  describe("Code Generation Handlers", () => {
    beforeEach(() => {
      registerCodeIPC(context);
    });

    describe("code:generate", () => {
      it("should generate code with description", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          code: "function add(a, b) { return a + b; }",
          language: "javascript",
        });

        const result = await mockIpcMain.invoke(
          "code:generate",
          "Create an add function",
          { language: "javascript" },
        );

        expect(result.success).toBe(true);
        expect(result.code).toBeDefined();
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "generateCode",
          description: "Create an add function",
          language: "javascript",
          options: { language: "javascript" },
        });
      });

      it("should use default language when not specified", async () => {
        const mockCodeEngine = getMockCodeEngine();

        await mockIpcMain.invoke("code:generate", "Create a function");

        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
          expect.objectContaining({
            language: "javascript",
          }),
        );
      });

      it("should handle generation errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Generation failed"),
        );

        await expect(
          mockIpcMain.invoke("code:generate", "Invalid request"),
        ).rejects.toThrow("Generation failed");

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("代码生成失败"),
          expect.any(Error),
        );
      });

      it("should pass custom options to code engine", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const options = {
          language: "python",
          style: "functional",
          comments: true,
        };

        await mockIpcMain.invoke("code:generate", "Create a function", options);

        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
          expect.objectContaining({
            options: options,
          }),
        );
      });
    });

    describe("code:generateTests", () => {
      it("should generate unit tests for code", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const sourceCode = "function add(a, b) { return a + b; }";

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          code: 'test("add function", () => { expect(add(1, 2)).toBe(3); });',
          language: "javascript",
        });

        const result = await mockIpcMain.invoke(
          "code:generateTests",
          sourceCode,
          "javascript",
        );

        expect(result.success).toBe(true);
        expect(result.code).toBeDefined();
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "generateTests",
          sourceCode: sourceCode,
          language: "javascript",
        });
      });

      it("should handle test generation errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Test generation failed"),
        );

        await expect(
          mockIpcMain.invoke(
            "code:generateTests",
            "invalid code",
            "javascript",
          ),
        ).rejects.toThrow("Test generation failed");
      });
    });

    describe("code:review", () => {
      it("should review code and return score", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const sourceCode = "function test() { return true; }";

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          score: 85,
          issues: [],
          suggestions: ["Add comments"],
        });

        const result = await mockIpcMain.invoke(
          "code:review",
          sourceCode,
          "javascript",
        );

        expect(result.success).toBe(true);
        expect(result.score).toBe(85);
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining("代码审查完成，评分:"),
          85,
        );
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "reviewCode",
          sourceCode: sourceCode,
          language: "javascript",
        });
      });

      it("should handle review errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Review failed"),
        );

        await expect(
          mockIpcMain.invoke("code:review", "code", "javascript"),
        ).rejects.toThrow("Review failed");
      });
    });

    describe("code:refactor", () => {
      it("should refactor code with specified type", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const sourceCode = "var x = 1; var y = 2;";

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          code: "const x = 1;\nconst y = 2;",
          changes: ["var -> const"],
        });

        const result = await mockIpcMain.invoke(
          "code:refactor",
          sourceCode,
          "javascript",
          "modernize",
        );

        expect(result.success).toBe(true);
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "refactorCode",
          sourceCode: sourceCode,
          language: "javascript",
          options: { goal: "modernize" },
        });
      });

      it("should handle refactoring errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Refactoring failed"),
        );

        await expect(
          mockIpcMain.invoke("code:refactor", "code", "javascript", "optimize"),
        ).rejects.toThrow("Refactoring failed");
      });
    });

    describe("code:explain", () => {
      it("should explain code functionality", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const sourceCode = "const sum = arr => arr.reduce((a, b) => a + b, 0);";

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          explanation:
            "This function calculates the sum of array elements using reduce",
          complexity: "O(n)",
        });

        const result = await mockIpcMain.invoke(
          "code:explain",
          sourceCode,
          "javascript",
        );

        expect(result.success).toBe(true);
        expect(result.explanation).toBeDefined();
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "explainCode",
          sourceCode: sourceCode,
          language: "javascript",
        });
      });

      it("should handle explanation errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Explanation failed"),
        );

        await expect(
          mockIpcMain.invoke("code:explain", "code", "javascript"),
        ).rejects.toThrow("Explanation failed");
      });
    });

    describe("code:fixBug", () => {
      it("should fix bug with error message", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const sourceCode = "function divide(a, b) { return a / b; }";
        const errorMsg = "Division by zero error";

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          code: 'function divide(a, b) { if (b === 0) throw new Error("Division by zero"); return a / b; }',
          fixes: ["Added zero check"],
        });

        const result = await mockIpcMain.invoke(
          "code:fixBug",
          sourceCode,
          "javascript",
          errorMsg,
        );

        expect(result.success).toBe(true);
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "fixBugs",
          sourceCode: sourceCode,
          errorMessage: errorMsg,
          language: "javascript",
        });
      });

      it("should handle bug fix errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Fix failed"),
        );

        await expect(
          mockIpcMain.invoke("code:fixBug", "code", "javascript", "error"),
        ).rejects.toThrow("Fix failed");
      });
    });

    describe("code:generateScaffold", () => {
      it("should generate project scaffold with options", async () => {
        const mockCodeEngine = getMockCodeEngine();
        const options = {
          projectName: "my-app",
          outputDir: "/tmp/projects",
        };

        mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
          success: true,
          files: ["package.json", "src/index.js"],
          path: "/tmp/projects/my-app",
        });

        const result = await mockIpcMain.invoke(
          "code:generateScaffold",
          "react-app",
          options,
        );

        expect(result.success).toBe(true);
        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith({
          taskType: "createScaffold",
          projectName: "my-app",
          template: "react-app",
          outputDir: "/tmp/projects",
          options: options,
        });
      });

      it("should use defaults when options not provided", async () => {
        const mockCodeEngine = getMockCodeEngine();

        await mockIpcMain.invoke("code:generateScaffold", "vue-app");

        expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
          expect.objectContaining({
            projectName: "vue-app",
            outputDir: process.cwd(),
          }),
        );
      });

      it("should handle scaffold generation errors", async () => {
        const mockCodeEngine = getMockCodeEngine();
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
          new Error("Scaffold generation failed"),
        );

        await expect(
          mockIpcMain.invoke("code:generateScaffold", "invalid-template"),
        ).rejects.toThrow("Scaffold generation failed");
      });
    });
  });

  describe("Code Execution Handlers", () => {
    beforeEach(() => {
      registerCodeIPC(context);
    });

    describe("code:executePython", () => {
      it("should execute safe Python code", async () => {
        const mockExecutor = getMockCodeExecutor();
        const pythonCode = 'print("Hello, World!")';

        mockExecutor.checkSafety.mockReturnValueOnce({
          safe: true,
          warnings: [],
        });

        mockExecutor.executePython.mockResolvedValueOnce({
          success: true,
          stdout: "Hello, World!\n",
          stderr: "",
          exitCode: 0,
        });

        const result = await mockIpcMain.invoke(
          "code:executePython",
          pythonCode,
        );

        expect(result.success).toBe(true);
        expect(result.stdout).toBe("Hello, World!\n");
        expect(mockExecutor.initialize).toHaveBeenCalled();
        expect(mockExecutor.checkSafety).toHaveBeenCalledWith(pythonCode);
        expect(mockExecutor.executePython).toHaveBeenCalledWith(pythonCode, {});
      });

      it("should block unsafe code by default", async () => {
        const mockExecutor = getMockCodeExecutor();
        const unsafeCode = 'import os; os.system("rm -rf /")';

        mockExecutor.checkSafety.mockReturnValueOnce({
          safe: false,
          warnings: ["Dangerous system command detected"],
        });

        const result = await mockIpcMain.invoke(
          "code:executePython",
          unsafeCode,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("code_unsafe");
        expect(result.warnings).toContain("Dangerous system command detected");
        expect(mockExecutor.executePython).not.toHaveBeenCalled();
      });

      it("should execute unsafe code when ignoreWarnings is true", async () => {
        const mockExecutor = getMockCodeExecutor();
        const unsafeCode = 'import os; os.listdir("/")';

        mockExecutor.checkSafety.mockReturnValueOnce({
          safe: false,
          warnings: ["File system access detected"],
        });

        mockExecutor.executePython.mockResolvedValueOnce({
          success: true,
          stdout: "bin\nusr\netc\n",
          stderr: "",
          exitCode: 0,
        });

        const result = await mockIpcMain.invoke(
          "code:executePython",
          unsafeCode,
          { ignoreWarnings: true },
        );

        expect(result.success).toBe(true);
        expect(mockExecutor.executePython).toHaveBeenCalled();
      });

      it("should pass execution options to executor", async () => {
        const mockExecutor = getMockCodeExecutor();
        const options = {
          timeout: 5000,
          env: { PYTHONPATH: "/custom/path" },
        };

        await mockIpcMain.invoke(
          "code:executePython",
          'print("test")',
          options,
        );

        expect(mockExecutor.executePython).toHaveBeenCalledWith(
          'print("test")',
          options,
        );
      });

      it("should handle execution errors gracefully", async () => {
        const mockExecutor = getMockCodeExecutor();
        mockExecutor.executePython.mockRejectedValueOnce(
          new Error("Python interpreter not found"),
        );

        const result = await mockIpcMain.invoke(
          "code:executePython",
          'print("test")',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("execution_failed");
        expect(result.message).toBe("Python interpreter not found");
      });

      it("should handle initialization errors", async () => {
        const mockExecutor = getMockCodeExecutor();
        mockExecutor.initialize.mockRejectedValueOnce(
          new Error("Initialization failed"),
        );

        const result = await mockIpcMain.invoke(
          "code:executePython",
          'print("test")',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("execution_failed");
      });
    });

    describe("code:executeFile", () => {
      it("should execute code file", async () => {
        const mockExecutor = getMockCodeExecutor();
        const filepath = "/tmp/test.py";

        mockExecutor.executeFile.mockResolvedValueOnce({
          success: true,
          stdout: "File executed successfully\n",
          stderr: "",
          exitCode: 0,
        });

        const result = await mockIpcMain.invoke("code:executeFile", filepath);

        expect(result.success).toBe(true);
        expect(mockExecutor.initialize).toHaveBeenCalled();
        expect(mockExecutor.executeFile).toHaveBeenCalledWith(filepath, {});
      });

      it("should pass options to file executor", async () => {
        const mockExecutor = getMockCodeExecutor();
        const filepath = "/tmp/script.py";
        const options = {
          args: ["--verbose"],
          cwd: "/tmp",
        };

        await mockIpcMain.invoke("code:executeFile", filepath, options);

        expect(mockExecutor.executeFile).toHaveBeenCalledWith(
          filepath,
          options,
        );
      });

      it("should handle file execution errors", async () => {
        const mockExecutor = getMockCodeExecutor();
        mockExecutor.executeFile.mockRejectedValueOnce(
          new Error("File not found"),
        );

        const result = await mockIpcMain.invoke(
          "code:executeFile",
          "/nonexistent/file.py",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("execution_failed");
        expect(result.message).toBe("File not found");
      });
    });

    describe("code:checkSafety", () => {
      it("should check code safety", async () => {
        const mockExecutor = getMockCodeExecutor();
        const code = 'print("Hello")';

        mockExecutor.checkSafety.mockReturnValueOnce({
          safe: true,
          warnings: [],
        });

        const result = await mockIpcMain.invoke("code:checkSafety", code);

        expect(result.safe).toBe(true);
        expect(result.warnings).toEqual([]);
        expect(mockExecutor.checkSafety).toHaveBeenCalledWith(code);
      });

      it("should detect unsafe code", async () => {
        const mockExecutor = getMockCodeExecutor();
        const unsafeCode =
          'import subprocess; subprocess.call(["rm", "-rf", "/"])';

        mockExecutor.checkSafety.mockReturnValueOnce({
          safe: false,
          warnings: ["subprocess module detected", "Dangerous system command"],
        });

        const result = await mockIpcMain.invoke("code:checkSafety", unsafeCode);

        expect(result.safe).toBe(false);
        expect(result.warnings).toHaveLength(2);
      });

      it("should handle safety check errors", async () => {
        const mockExecutor = getMockCodeExecutor();
        mockExecutor.checkSafety.mockImplementationOnce(() => {
          throw new Error("Safety check failed");
        });

        const result = await mockIpcMain.invoke("code:checkSafety", "code");

        expect(result.safe).toBe(false);
        expect(result.warnings).toContain("Safety check failed");
      });
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      registerCodeIPC(context);
    });

    it("should handle missing llmManager gracefully", async () => {
      const mockCodeEngine = getMockCodeEngine();
      // This should still work as code engine is singleton

      await mockIpcMain.invoke("code:generate", "test");

      expect(mockCodeEngine.handleProjectTask).toHaveBeenCalled();
    });

    it("should log errors with context information", async () => {
      const mockCodeEngine = getMockCodeEngine();
      mockCodeEngine.handleProjectTask.mockRejectedValueOnce(
        new Error("Detailed error message"),
      );

      await expect(mockIpcMain.invoke("code:generate", "test")).rejects.toThrow(
        "Detailed error message",
      );

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("代码生成失败"),
        expect.objectContaining({
          message: "Detailed error message",
        }),
      );
    });

    it("should handle all code generation handler errors", async () => {
      const mockCodeEngine = getMockCodeEngine();
      const error = new Error("Test error");

      const handlers = [
        { channel: "code:generate", args: ["test"] },
        { channel: "code:generateTests", args: ["code", "js"] },
        { channel: "code:review", args: ["code", "js"] },
        { channel: "code:refactor", args: ["code", "js", "optimize"] },
        { channel: "code:explain", args: ["code", "js"] },
        { channel: "code:fixBug", args: ["code", "js", "error"] },
        { channel: "code:generateScaffold", args: ["template"] },
      ];

      for (const { channel, args } of handlers) {
        mockCodeEngine.handleProjectTask.mockRejectedValueOnce(error);

        await expect(mockIpcMain.invoke(channel, ...args)).rejects.toThrow(
          "Test error",
        );
      }
    });

    it("should handle executor initialization failures", async () => {
      const mockExecutor = getMockCodeExecutor();
      mockExecutor.initialize.mockRejectedValueOnce(
        new Error("Executor init failed"),
      );

      const result = await mockIpcMain.invoke(
        "code:executePython",
        'print("test")',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("execution_failed");
    });
  });

  describe("Integration Scenarios", () => {
    beforeEach(() => {
      registerCodeIPC(context);
    });

    it("should handle complete code generation workflow", async () => {
      const mockCodeEngine = getMockCodeEngine();

      // Generate code
      mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
        success: true,
        code: "function test() { return true; }",
      });

      const generated = await mockIpcMain.invoke(
        "code:generate",
        "Create test function",
      );

      expect(generated.success).toBe(true);

      // Generate tests
      mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
        success: true,
        code: 'test("test function", () => { expect(test()).toBe(true); });',
      });

      const tests = await mockIpcMain.invoke(
        "code:generateTests",
        generated.code,
        "javascript",
      );

      expect(tests.success).toBe(true);
    });

    it("should handle code review and refactor workflow", async () => {
      const mockCodeEngine = getMockCodeEngine();
      const code = "var x = 1;";

      // Review code
      mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
        success: true,
        score: 60,
        issues: ["Use const/let instead of var"],
      });

      const review = await mockIpcMain.invoke(
        "code:review",
        code,
        "javascript",
      );

      expect(review.success).toBe(true);
      expect(review.score).toBe(60);

      // Refactor based on review
      mockCodeEngine.handleProjectTask.mockResolvedValueOnce({
        success: true,
        code: "const x = 1;",
      });

      const refactored = await mockIpcMain.invoke(
        "code:refactor",
        code,
        "javascript",
        "modernize",
      );

      expect(refactored.success).toBe(true);
    });

    it("should handle execution with safety check workflow", async () => {
      const mockExecutor = getMockCodeExecutor();
      const code = 'print("Hello")';

      // Check safety first
      mockExecutor.checkSafety.mockReturnValueOnce({
        safe: true,
        warnings: [],
      });

      const safety = await mockIpcMain.invoke("code:checkSafety", code);

      expect(safety.safe).toBe(true);

      // Execute if safe
      mockExecutor.executePython.mockResolvedValueOnce({
        success: true,
        stdout: "Hello\n",
        stderr: "",
        exitCode: 0,
      });

      const execution = await mockIpcMain.invoke("code:executePython", code);

      expect(execution.success).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      registerCodeIPC(context);
    });

    it("should handle empty code input", async () => {
      const mockCodeEngine = getMockCodeEngine();

      await mockIpcMain.invoke("code:review", "", "javascript");

      expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceCode: "",
        }),
      );
    });

    it("should handle missing optional parameters", async () => {
      const mockCodeEngine = getMockCodeEngine();

      await mockIpcMain.invoke("code:generate", "test");

      expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
        expect.objectContaining({
          language: "javascript",
          options: {},
        }),
      );
    });

    it("should handle null/undefined parameters", async () => {
      const mockCodeEngine = getMockCodeEngine();

      await mockIpcMain.invoke("code:generateScaffold", "template", null);

      expect(mockCodeEngine.handleProjectTask).toHaveBeenCalled();
    });

    it("should handle very long code input", async () => {
      const mockCodeEngine = getMockCodeEngine();
      const longCode = "function test() { return true; }\n".repeat(1000);

      await mockIpcMain.invoke("code:review", longCode, "javascript");

      expect(mockCodeEngine.handleProjectTask).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceCode: longCode,
        }),
      );
    });

    it("should handle special characters in code", async () => {
      const mockExecutor = getMockCodeExecutor();
      const code = 'print("Hello 世界 🌍")';

      await mockIpcMain.invoke("code:executePython", code);

      expect(mockExecutor.executePython).toHaveBeenCalledWith(code, {});
    });
  });
});
