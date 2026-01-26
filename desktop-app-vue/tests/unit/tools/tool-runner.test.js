/**
 * ToolRunner 单元测试 (简化版)
 *
 * 专注于核心功能测试，避免过度依赖内部实现细节
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ===================== MOCK SETUP =====================

// Mock fs.promises
const mockFs = {
  readFile: vi.fn().mockResolvedValue("file content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
};

vi.mock("fs", () => ({
  promises: mockFs,
}));

// Mock path - keep actual implementation
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return actual;
});

// Import after mocks
const ToolRunner = require("../../../src/main/skill-tool-system/tool-runner");

// ===================== MOCK FACTORIES =====================

const createMockToolManager = () => ({
  getToolByName: vi.fn().mockResolvedValue({
    id: "tool-1",
    name: "generic_handler",
    enabled: true,
    parameters_schema: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
  }),
  recordExecution: vi.fn().mockResolvedValue(true),
});

// ===================== TESTS =====================

describe("ToolRunner", () => {
  let runner;
  let mockToolMgr;

  beforeEach(() => {
    vi.clearAllMocks();

    mockToolMgr = createMockToolManager();
    runner = new ToolRunner(mockToolMgr);
  });

  describe("构造函数", () => {
    it("should create instance with toolManager", () => {
      expect(runner).toBeInstanceOf(ToolRunner);
      expect(runner.toolManager).toBe(mockToolMgr);
    });

    it("should initialize tool implementations", () => {
      expect(runner.toolImplementations).toBeDefined();
      expect(typeof runner.toolImplementations).toBe("object");
    });

    it("should have file operation tools", () => {
      expect(runner.toolImplementations.file_reader).toBeDefined();
      expect(runner.toolImplementations.file_writer).toBeDefined();
      expect(runner.toolImplementations.file_editor).toBeDefined();
    });

    it("should have code generation tools", () => {
      expect(runner.toolImplementations.html_generator).toBeDefined();
      expect(runner.toolImplementations.css_generator).toBeDefined();
      expect(runner.toolImplementations.js_generator).toBeDefined();
    });

    it("should have project management tools", () => {
      expect(runner.toolImplementations.create_project_structure).toBeDefined();
      expect(runner.toolImplementations.git_init).toBeDefined();
      expect(runner.toolImplementations.git_commit).toBeDefined();
    });

    it("should have utility tools", () => {
      expect(runner.toolImplementations.info_searcher).toBeDefined();
      expect(runner.toolImplementations.format_output).toBeDefined();
      expect(runner.toolImplementations.generic_handler).toBeDefined();
    });
  });

  describe("executeTool()", () => {
    it("should execute tool successfully", async () => {
      const params = { input: "test" };
      const result = await runner.executeTool("generic_handler", params);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe("generic_handler");
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith(
        "generic_handler",
        true,
        expect.any(Number),
      );
    });

    it("should handle non-existent tool", async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce(null);

      const result = await runner.executeTool("nonexistent", {});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should handle disabled tool", async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: "tool-1",
        name: "test_tool",
        enabled: false,
        parameters_schema: {},
      });

      const result = await runner.executeTool("test_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should validate params before execution", async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: "tool-1",
        name: "generic_handler",
        enabled: true,
        parameters_schema: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      });

      const result = await runner.executeTool("generic_handler", {}); // Missing required param

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should handle missing implementation", async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: "tool-1",
        name: "unknown_tool",
        enabled: true,
        parameters_schema: { type: "object", properties: {} },
      });

      const result = await runner.executeTool("unknown_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should record execution on success", async () => {
      await runner.executeTool("generic_handler", { input: "test" });

      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith(
        "generic_handler",
        true,
        expect.any(Number),
      );
    });

    it("should record execution on failure", async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce(null);

      await runner.executeTool("nonexistent", {});

      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith(
        "nonexistent",
        false,
        expect.any(Number),
      );
    });
  });

  describe("validateParams()", () => {
    it("should validate required params", () => {
      const tool = {
        parameters_schema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
          },
          required: ["filePath"],
        },
      };

      const validResult = runner.validateParams(tool, {
        filePath: "/test.txt",
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {});
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    it("should validate param types", () => {
      const tool = {
        parameters_schema: {
          type: "object",
          properties: {
            count: { type: "number" },
            name: { type: "string" },
          },
        },
      };

      const validResult = runner.validateParams(tool, {
        count: 10,
        name: "test",
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {
        count: "not a number",
        name: "test",
      });
      expect(invalidResult.valid).toBe(false);
    });

    it("should handle array types", () => {
      const tool = {
        parameters_schema: {
          type: "object",
          properties: {
            items: { type: "array" },
          },
        },
      };

      const validResult = runner.validateParams(tool, {
        items: [1, 2, 3],
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {
        items: "not an array",
      });
      expect(invalidResult.valid).toBe(false);
    });

    it("should handle string schema", () => {
      const tool = {
        parameters_schema: JSON.stringify({
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        }),
      };

      const result = runner.validateParams(tool, { input: "test" });
      expect(result.valid).toBe(true);
    });
  });

  describe("file_reader implementation", () => {
    it("should be a function", () => {
      const fileReader = runner.toolImplementations.file_reader;
      expect(typeof fileReader).toBe("function");
    });

    // Skip: Vitest cannot properly mock Node.js built-in fs module for CommonJS require
    // See: tests/reports/DEPENDENCY_INJECTION_COMPLETE_REPORT.md
    it.skip("should read file successfully", async () => {
      vi.clearAllMocks();
      mockFs.readFile.mockResolvedValueOnce("test content");

      const fileReader = runner.toolImplementations.file_reader;
      const result = await fileReader({ filePath: "test.txt" });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });
  });

  describe("file_writer implementation", () => {
    it("should be a function", () => {
      const fileWriter = runner.toolImplementations.file_writer;
      expect(typeof fileWriter).toBe("function");
    });

    it("should write file successfully", async () => {
      const fileWriter = runner.toolImplementations.file_writer;
      const result = await fileWriter({
        filePath: "test.txt",
        content: "new content",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("file_editor implementation", () => {
    it("should be a function", () => {
      const fileEditor = runner.toolImplementations.file_editor;
      expect(typeof fileEditor).toBe("function");
    });
  });

  describe("html_generator implementation", () => {
    it("should be a function", () => {
      const htmlGenerator = runner.toolImplementations.html_generator;
      expect(typeof htmlGenerator).toBe("function");
    });

    it("should generate HTML", async () => {
      const htmlGenerator = runner.toolImplementations.html_generator;
      const result = await htmlGenerator({
        title: "Test Page",
        content: "<h1>Hello</h1>",
      });

      expect(result.html).toBeDefined();
      expect(result.html).toContain("<!DOCTYPE html>");
      expect(result.html).toContain("<title>Test Page</title>");
    });
  });

  describe("css_generator implementation", () => {
    it("should be a function", () => {
      const cssGenerator = runner.toolImplementations.css_generator;
      expect(typeof cssGenerator).toBe("function");
    });

    it("should generate CSS", async () => {
      const cssGenerator = runner.toolImplementations.css_generator;
      const result = await cssGenerator({
        selectors: {
          body: { color: "black" },
        },
      });

      expect(result.css).toBeDefined();
      expect(typeof result.css).toBe("string");
    });
  });

  describe("js_generator implementation", () => {
    it("should be a function", () => {
      const jsGenerator = runner.toolImplementations.js_generator;
      expect(typeof jsGenerator).toBe("function");
    });
  });

  describe("generic_handler implementation", () => {
    it("should be a function", () => {
      const genericHandler = runner.toolImplementations.generic_handler;
      expect(typeof genericHandler).toBe("function");
    });

    it("should handle generic params", async () => {
      const genericHandler = runner.toolImplementations.generic_handler;
      const result = await genericHandler({
        input: "test data",
      });

      expect(result).toBeDefined();
    });
  });

  describe("format_output implementation", () => {
    it("should be a function", () => {
      const formatOutput = runner.toolImplementations.format_output;
      expect(typeof formatOutput).toBe("function");
    });

    it("should format as JSON", async () => {
      const formatOutput = runner.toolImplementations.format_output;
      const result = await formatOutput({
        data: { key: "value" },
        format: "json",
      });

      expect(result.formatted).toBeDefined();
      expect(typeof result.formatted).toBe("string");
    });
  });

  describe("create_project_structure implementation", () => {
    it("should be a function", () => {
      const creator = runner.toolImplementations.create_project_structure;
      expect(typeof creator).toBe("function");
    });
  });

  describe("info_searcher implementation", () => {
    it("should be a function", () => {
      const infoSearcher = runner.toolImplementations.info_searcher;
      expect(typeof infoSearcher).toBe("function");
    });
  });

  describe("formatAsTable()", () => {
    it("should format array as table", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];

      const table = runner.formatAsTable(data);

      expect(typeof table).toBe("string");
      expect(table.length).toBeGreaterThan(0);
    });

    it("should handle empty array", () => {
      const table = runner.formatAsTable([]);

      expect(typeof table).toBe("string");
    });

    it("should handle non-array", () => {
      const table = runner.formatAsTable("not an array");

      expect(typeof table).toBe("string");
    });
  });
});
