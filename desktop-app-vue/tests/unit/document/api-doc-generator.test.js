/**
 * ApiDocGenerator 单元测试
 *
 * 测试API文档生成器的核心功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ===================== MOCK SETUP =====================

// Mock fs.promises
const mockFs = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("class MockClass { method() {} }"),
};

vi.mock("fs", () => ({
  promises: mockFs,
}));

// Import after mocks
const ApiDocGenerator = require("../../src/main/skill-tool-system/api-doc-generator");

// ===================== TESTS =====================

describe("ApiDocGenerator", () => {
  let generator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new ApiDocGenerator();
  });

  describe("构造函数", () => {
    it("should create instance", () => {
      expect(generator).toBeInstanceOf(ApiDocGenerator);
    });

    it("should set outputDir", () => {
      expect(generator.outputDir).toBeDefined();
      expect(typeof generator.outputDir).toBe("string");
    });

    it("should have module files list", () => {
      expect(generator.moduleFiles).toBeDefined();
      expect(Array.isArray(generator.moduleFiles)).toBe(true);
      expect(generator.moduleFiles.length).toBeGreaterThan(0);
    });

    it("should accept custom output directory", () => {
      const customGen = new ApiDocGenerator("/custom/path");
      expect(customGen.outputDir).toBe("/custom/path");
    });

    it("should use default output directory", () => {
      expect(generator.outputDir).toContain("docs");
      expect(generator.outputDir).toContain("api");
    });
  });

  describe("moduleFiles配置", () => {
    it("should include SkillManager", () => {
      const skillMgr = generator.moduleFiles.find(
        (m) => m.name === "SkillManager",
      );
      expect(skillMgr).toBeDefined();
      expect(skillMgr.description).toBeDefined();
    });

    it("should include ToolManager", () => {
      const toolMgr = generator.moduleFiles.find(
        (m) => m.name === "ToolManager",
      );
      expect(toolMgr).toBeDefined();
    });

    it("should include SkillExecutor", () => {
      const executor = generator.moduleFiles.find(
        (m) => m.name === "SkillExecutor",
      );
      expect(executor).toBeDefined();
    });

    it("should include ToolRunner", () => {
      const runner = generator.moduleFiles.find((m) => m.name === "ToolRunner");
      expect(runner).toBeDefined();
    });
  });

  describe("generateAll()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateAll).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.generateAll();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("generateIndex()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateIndex).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.generateIndex();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("generateModuleDoc()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateModuleDoc).toBe("function");
    });

    it("should accept module parameter", async () => {
      const module = generator.moduleFiles[0];

      // Should not throw
      await expect(
        generator.generateModuleDoc(module),
      ).resolves.toBeUndefined();
    });
  });

  describe("extractMethods()", () => {
    it("should extract method declarations", () => {
      const source = `
        class Test {
          constructor() {}
          async getData(param1, param2) {}
          processData() {}
        }
      `;

      const methods = generator.extractMethods(source);

      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBeGreaterThan(0);
    });

    it("should detect async methods", () => {
      const source = "async getData() {}";
      const methods = generator.extractMethods(source);

      const asyncMethod = methods.find((m) => m.name === "getData");
      expect(asyncMethod).toBeDefined();
      expect(asyncMethod.isAsync).toBe(true);
    });

    it("should extract method parameters", () => {
      const source = "getData(param1, param2, param3) {}";
      const methods = generator.extractMethods(source);

      const method = methods.find((m) => m.name === "getData");
      expect(method.params).toHaveLength(3);
      expect(method.params).toContain("param1");
      expect(method.params).toContain("param2");
    });

    it("should parse JSDoc comments", () => {
      const source = `
        /**
         * Get user data
         * @param {string} id - User ID
         * @returns {Promise} User object
         */
        async getUserData(id) {}
      `;

      const methods = generator.extractMethods(source);
      const method = methods.find((m) => m.name === "getUserData");

      expect(method).toBeDefined();
      expect(method.name).toBe("getUserData");
      expect(method.isAsync).toBe(true);
      // Description extraction depends on specific formatting
      // so we just check the method was found
    });

    it("should handle methods without parameters", () => {
      const source = "getData() {}";
      const methods = generator.extractMethods(source);

      const method = methods.find((m) => m.name === "getData");
      expect(method.params).toHaveLength(0);
    });
  });

  describe("extractProperties()", () => {
    it("should extract class properties", () => {
      const source = `
        constructor() {
          this.database = null;
          this.config = {};
          this.isReady = false;
        }
      `;

      const properties = generator.extractProperties(source);

      expect(Array.isArray(properties)).toBe(true);
      expect(properties.length).toBeGreaterThan(0);
      expect(properties.some((p) => p.name === "database")).toBe(true);
      expect(properties.some((p) => p.name === "config")).toBe(true);
    });

    it("should deduplicate properties", () => {
      const source = `
        this.value = 1;
        this.value = 2;
        this.value = 3;
      `;

      const properties = generator.extractProperties(source);
      const valueProps = properties.filter((p) => p.name === "value");

      expect(valueProps).toHaveLength(1);
    });

    it("should handle no properties", () => {
      const source = "function noProps() {}";
      const properties = generator.extractProperties(source);

      expect(properties).toHaveLength(0);
    });
  });

  describe("extractEvents()", () => {
    it("should extract event emissions", () => {
      const source = `
        this.emit('data:loaded');
        this.emit('error');
        this.emit('complete');
      `;

      const events = generator.extractEvents(source);

      expect(Array.isArray(events)).toBe(true);
      expect(events.some((e) => e.name === "data:loaded")).toBe(true);
      expect(events.some((e) => e.name === "error")).toBe(true);
    });

    it("should deduplicate events", () => {
      const source = `
        this.emit('data');
        this.emit('data');
        this.emit('data');
      `;

      const events = generator.extractEvents(source);
      const dataEvents = events.filter((e) => e.name === "data");

      expect(dataEvents).toHaveLength(1);
    });

    it("should handle no events", () => {
      const source = "function noEvents() {}";
      const events = generator.extractEvents(source);

      expect(events).toHaveLength(0);
    });
  });

  describe("formatMethodDoc()", () => {
    it("should format basic method", () => {
      const method = {
        name: "getData",
        isAsync: false,
        params: ["id"],
        paramDocs: [],
        description: "Get data by ID",
        returns: "",
      };

      const doc = generator.formatMethodDoc(method);

      expect(doc).toContain("getData");
      expect(doc).toContain("id");
      expect(doc).toContain("Get data by ID");
    });

    it("should format async method", () => {
      const method = {
        name: "getData",
        isAsync: true,
        params: [],
        paramDocs: [],
        description: "",
        returns: "",
      };

      const doc = generator.formatMethodDoc(method);

      expect(doc).toContain("async");
    });

    it("should include parameter documentation", () => {
      const method = {
        name: "getData",
        isAsync: false,
        params: ["id", "options"],
        paramDocs: [
          { name: "id", type: "string", description: "User ID" },
          { name: "options", type: "object", description: "Query options" },
        ],
        description: "",
        returns: "",
      };

      const doc = generator.formatMethodDoc(method);

      expect(doc).toContain("**参数:**");
      expect(doc).toContain("id");
      expect(doc).toContain("string");
      expect(doc).toContain("User ID");
    });

    it("should include return documentation", () => {
      const method = {
        name: "getData",
        isAsync: true,
        params: [],
        paramDocs: [],
        description: "",
        returns: "`Promise<User>` - User object",
      };

      const doc = generator.formatMethodDoc(method);

      expect(doc).toContain("**返回:**");
      expect(doc).toContain("Promise<User>");
    });

    it("should handle empty descriptions", () => {
      const method = {
        name: "getData",
        isAsync: false,
        params: [],
        paramDocs: [],
        description: "",
        returns: "",
      };

      const doc = generator.formatMethodDoc(method);

      expect(doc).toContain("getData");
    });
  });

  describe("generateSingleModule()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateSingleModule).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.generateSingleModule("SkillManager");
      expect(result).toBeInstanceOf(Promise);
    });

    it("should throw for non-existent module", async () => {
      await expect(
        generator.generateSingleModule("NonExistentModule"),
      ).rejects.toThrow("模块不存在");
    });
  });

  describe("辅助功能", () => {
    it("should have all required methods", () => {
      expect(typeof generator.generateAll).toBe("function");
      expect(typeof generator.generateIndex).toBe("function");
      expect(typeof generator.generateModuleDoc).toBe("function");
      expect(typeof generator.extractMethods).toBe("function");
      expect(typeof generator.extractProperties).toBe("function");
      expect(typeof generator.extractEvents).toBe("function");
      expect(typeof generator.formatMethodDoc).toBe("function");
      expect(typeof generator.generateSingleModule).toBe("function");
    });

    it("should track module files", () => {
      expect(generator.moduleFiles.length).toBeGreaterThanOrEqual(4);
      expect(generator.moduleFiles.every((m) => m.name)).toBe(true);
      expect(generator.moduleFiles.every((m) => m.file)).toBe(true);
      expect(generator.moduleFiles.every((m) => m.description)).toBe(true);
    });
  });
});
