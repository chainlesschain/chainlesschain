/**
 * DocGenerator 单元测试
 *
 * 测试文档生成器的核心功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";

// ===================== MOCK SETUP =====================

// Mock Electron (让它抛出错误，使用非Electron环境)
vi.mock("electron", () => {
  throw new Error("Not in Electron environment");
});

// Import after mocks
const DocGenerator = require("../../../src/main/skill-tool-system/doc-generator");

// Mock fs via _deps injection (Vitest CJS inline workaround)
const mockFs = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("# Mock Document"),
};
DocGenerator._deps.fs = mockFs;

// ===================== MOCK DATA =====================

const createMockSkill = (overrides = {}) => ({
  id: "skill-1",
  name: "skill_web_development",
  display_name: "Web Development",
  category: "web",
  description: "Create HTML, CSS, and JavaScript websites",
  enabled: true,
  config: { responsive: true, template: "modern" },
  tags: ["html", "css", "javascript"],
  usage_count: 50,
  success_count: 45,
  last_used_at: new Date("2025-12-30").toISOString(),
  is_builtin: true,
  ...overrides,
});

const createMockTool = (overrides = {}) => ({
  id: "tool-1",
  name: "file_reader",
  display_name: "File Reader",
  category: "file",
  tool_type: "io",
  description: "Read files from disk",
  enabled: true,
  risk_level: 1,
  parameters_schema: {
    filePath: {
      type: "string",
      required: true,
      description: "Path to the file",
    },
  },
  return_schema: { success: "boolean", content: "string" },
  required_permissions: ["fs:read"],
  usage_count: 100,
  success_count: 98,
  avg_execution_time: 15.5,
  last_used_at: new Date("2025-12-30").toISOString(),
  is_builtin: true,
  ...overrides,
});

const createMockTools = () => [
  {
    name: "html_generator",
    display_name: "HTML Generator",
    description: "Generate HTML content",
    role: "primary",
    priority: 10,
  },
  {
    name: "css_generator",
    display_name: "CSS Generator",
    description: "Generate CSS styles",
    role: "secondary",
    priority: 5,
  },
];

// ===================== TESTS =====================

describe("DocGenerator", () => {
  let generator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new DocGenerator();
  });

  describe("构造函数", () => {
    it("should create instance", () => {
      expect(generator).toBeInstanceOf(DocGenerator);
    });

    it("should set docsPath", () => {
      expect(generator.docsPath).toBeDefined();
      expect(typeof generator.docsPath).toBe("string");
    });

    it("should set skillsDocsPath", () => {
      expect(generator.skillsDocsPath).toBeDefined();
      expect(generator.skillsDocsPath).toContain("skills");
    });

    it("should set toolsDocsPath", () => {
      expect(generator.toolsDocsPath).toBeDefined();
      expect(generator.toolsDocsPath).toContain("tools");
    });

    it("should use project directory in non-Electron environment", () => {
      // 由于mock了Electron抛出错误，应该使用process.cwd()
      expect(generator.docsPath).toContain("docs");
    });
  });

  describe("initialize()", () => {
    it("should be defined", () => {
      expect(typeof generator.initialize).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.initialize();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("generateSkillDoc()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateSkillDoc).toBe("function");
    });

    it("should return promise", () => {
      const skill = createMockSkill();
      const result = generator.generateSkillDoc(skill);
      expect(result).toBeInstanceOf(Promise);
    });

    it("should accept skill and tools parameters", async () => {
      const skill = createMockSkill();
      const tools = createMockTools();

      // Should not throw
      await expect(
        generator.generateSkillDoc(skill, tools),
      ).resolves.toBeDefined();
    });
  });

  describe("generateToolDoc()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateToolDoc).toBe("function");
    });

    it("should return promise", () => {
      const tool = createMockTool();
      const result = generator.generateToolDoc(tool);
      expect(result).toBeInstanceOf(Promise);
    });

    it("should accept tool parameter", async () => {
      const tool = createMockTool();

      // Should not throw
      await expect(generator.generateToolDoc(tool)).resolves.toBeDefined();
    });
  });

  describe("_buildSkillMarkdown()", () => {
    it("should build markdown with frontmatter", () => {
      const skill = createMockSkill();
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("---");
      expect(markdown).toContain("id: skill-1");
      expect(markdown).toContain("name: skill_web_development");
      expect(markdown).toContain("category: web");
    });

    it("should include skill display name as header", () => {
      const skill = createMockSkill({ display_name: "Web Development" });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("# Web Development");
    });

    it("should include description", () => {
      const skill = createMockSkill({ description: "Test description" });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("Test description");
    });

    it("should include category display name", () => {
      const skill = createMockSkill({ category: "web" });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("Web开发");
    });

    it("should show enabled status", () => {
      const skill = createMockSkill({ enabled: true });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("✅ 已启用");
    });

    it("should show disabled status", () => {
      const skill = createMockSkill({ enabled: false });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("❌ 已禁用");
    });

    it("should include tags", () => {
      const skill = createMockSkill({ tags: ["html", "css"] });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("html");
      expect(markdown).toContain("css");
    });

    it("should handle string tags", () => {
      const skill = createMockSkill({ tags: '["html","css"]' });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("html");
    });

    it("should include tools section when tools provided", () => {
      const skill = createMockSkill();
      const tools = createMockTools();
      const markdown = generator._buildSkillMarkdown(skill, tools);

      expect(markdown).toContain("包含的工具");
      expect(markdown).toContain("HTML Generator");
      expect(markdown).toContain("CSS Generator");
    });

    it("should show primary tool with star icon", () => {
      const skill = createMockSkill();
      const tools = [{ name: "tool1", role: "primary", priority: 10 }];
      const markdown = generator._buildSkillMarkdown(skill, tools);

      expect(markdown).toContain("⭐");
    });

    it("should show secondary tool with icon", () => {
      const skill = createMockSkill();
      const tools = [{ name: "tool1", role: "secondary", priority: 5 }];
      const markdown = generator._buildSkillMarkdown(skill, tools);

      expect(markdown).toContain("🔹");
    });

    it("should include config section", () => {
      const skill = createMockSkill({ config: { template: "modern" } });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("配置选项");
      expect(markdown).toContain("template");
    });

    it("should handle string config", () => {
      const skill = createMockSkill({ config: '{"template":"modern"}' });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("template");
    });

    it("should include usage statistics", () => {
      const skill = createMockSkill({ usage_count: 50, success_count: 45 });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("统计信息");
      expect(markdown).toContain("50");
      expect(markdown).toContain("45");
      expect(markdown).toContain("90.00%");
    });

    it("should include last used date", () => {
      const skill = createMockSkill({ last_used_at: "2025-12-30T00:00:00Z" });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("最后使用");
    });

    it("should include use cases", () => {
      const skill = createMockSkill({ category: "web" });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("使用场景");
    });

    it("should include examples", () => {
      const skill = createMockSkill();
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("使用示例");
      expect(markdown).toContain("```javascript");
    });

    it("should include generation timestamp", () => {
      const skill = createMockSkill();
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("文档生成时间");
    });

    it("should indicate builtin status", () => {
      const skill = createMockSkill({ is_builtin: true });
      const markdown = generator._buildSkillMarkdown(skill, []);

      expect(markdown).toContain("内置");
    });
  });

  describe("_buildToolMarkdown()", () => {
    it("should build markdown with frontmatter", () => {
      const tool = createMockTool();
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("---");
      expect(markdown).toContain("id: tool-1");
      expect(markdown).toContain("name: file_reader");
    });

    it("should include tool display name as header", () => {
      const tool = createMockTool({ display_name: "File Reader" });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("# File Reader");
    });

    it("should include description", () => {
      const tool = createMockTool({ description: "Test tool" });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("Test tool");
    });

    it("should show risk level", () => {
      const tool = createMockTool({ risk_level: 1 });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("🟢 低风险");
    });

    it("should include parameters table", () => {
      const tool = createMockTool();
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("参数说明");
      expect(markdown).toContain("| 参数名 | 类型 | 必填 | 说明 |");
      expect(markdown).toContain("filePath");
    });

    it("should handle no parameters", () => {
      const tool = createMockTool({ parameters_schema: {} });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("该工具无参数");
    });

    it("should handle string parameters schema", () => {
      const tool = createMockTool({
        parameters_schema: '{"path":{"type":"string"}}',
      });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("path");
    });

    it("should include return schema", () => {
      const tool = createMockTool();
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("返回值说明");
      expect(markdown).toContain("success");
      expect(markdown).toContain("content");
    });

    it("should handle empty return schema", () => {
      const tool = createMockTool({ return_schema: {} });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("返回值根据具体执行情况而定");
    });

    it("should include permissions", () => {
      const tool = createMockTool({
        required_permissions: ["fs:read", "fs:write"],
      });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("权限要求");
      expect(markdown).toContain("fs:read");
      expect(markdown).toContain("fs:write");
    });

    it("should handle string permissions", () => {
      const tool = createMockTool({ required_permissions: '["fs:read"]' });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("fs:read");
    });

    it("should include usage statistics", () => {
      const tool = createMockTool({ usage_count: 100, success_count: 98 });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("统计信息");
      expect(markdown).toContain("100");
      expect(markdown).toContain("98.00%");
    });

    it("should include average execution time", () => {
      const tool = createMockTool({ avg_execution_time: 15.5 });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("15.50ms");
    });

    it("should include notes section", () => {
      const tool = createMockTool();
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("注意事项");
    });

    it("should warn about high risk tools", () => {
      const tool = createMockTool({ risk_level: 4 });
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("高风险工具");
    });

    it("should include examples", () => {
      const tool = createMockTool();
      const markdown = generator._buildToolMarkdown(tool);

      expect(markdown).toContain("使用示例");
      expect(markdown).toContain("```javascript");
    });
  });

  describe("_getCategoryDisplayName()", () => {
    it("should return display name for known category", () => {
      expect(generator._getCategoryDisplayName("web")).toBe("Web开发");
      expect(generator._getCategoryDisplayName("code")).toBe("代码开发");
      expect(generator._getCategoryDisplayName("data")).toBe("数据处理");
    });

    it("should return original category for unknown", () => {
      expect(generator._getCategoryDisplayName("unknown")).toBe("unknown");
    });
  });

  describe("_getRiskLevelDisplay()", () => {
    it("should return display for risk levels", () => {
      expect(generator._getRiskLevelDisplay(1)).toBe("🟢 低风险");
      expect(generator._getRiskLevelDisplay(2)).toBe("🟡 中风险");
      expect(generator._getRiskLevelDisplay(3)).toBe("🟠 较高风险");
      expect(generator._getRiskLevelDisplay(4)).toBe("🔴 高风险");
      expect(generator._getRiskLevelDisplay(5)).toBe("⛔ 极高风险");
    });

    it("should return unknown for invalid level", () => {
      expect(generator._getRiskLevelDisplay(99)).toBe("未知");
    });
  });

  describe("_getSkillUseCases()", () => {
    it("should return use cases for known categories", () => {
      const useCases = generator._getSkillUseCases("web");

      expect(useCases).toContain("网页");
    });

    it("should return default use cases for unknown category", () => {
      const useCases = generator._getSkillUseCases("unknown");

      expect(useCases).toContain("根据需求使用");
    });
  });

  describe("readSkillDoc()", () => {
    it("should be defined", () => {
      expect(typeof generator.readSkillDoc).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.readSkillDoc("skill-1");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("readToolDoc()", () => {
    it("should be defined", () => {
      expect(typeof generator.readToolDoc).toBe("function");
    });

    it("should return promise", () => {
      const result = generator.readToolDoc("file_reader");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("generateAllSkillDocs()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateAllSkillDocs).toBe("function");
    });

    it("should return count for multiple skills", async () => {
      const skills = [
        { skill: createMockSkill({ id: "skill-1" }), tools: [] },
        { skill: createMockSkill({ id: "skill-2" }), tools: [] },
      ];

      const count = await generator.generateAllSkillDocs(skills);

      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 for empty array", async () => {
      const count = await generator.generateAllSkillDocs([]);

      expect(count).toBe(0);
    });
  });

  describe("generateAllToolDocs()", () => {
    it("should be defined", () => {
      expect(typeof generator.generateAllToolDocs).toBe("function");
    });

    it("should return count for multiple tools", async () => {
      const tools = [
        createMockTool({ name: "tool1" }),
        createMockTool({ name: "tool2" }),
        createMockTool({ name: "tool3" }),
      ];

      const count = await generator.generateAllToolDocs(tools);

      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 for empty array", async () => {
      const count = await generator.generateAllToolDocs([]);

      expect(count).toBe(0);
    });
  });

  describe("_getToolNotes()", () => {
    it("should warn about writer tools", () => {
      const notes = generator._getToolNotes("file_writer", 2);

      expect(notes).toContain("文件写入");
    });

    it("should warn about executor tools", () => {
      const notes = generator._getToolNotes("code_executor", 3);

      expect(notes).toContain("代码执行");
      expect(notes).toContain("安全风险");
    });

    it("should warn about git tools", () => {
      const notes = generator._getToolNotes("git_commit", 2);

      expect(notes).toContain("Git配置");
    });

    it("should provide default notes for generic tools", () => {
      const notes = generator._getToolNotes("generic_tool", 1);

      expect(notes).toContain("按照参数说明");
    });
  });

  describe("_getToolExample()", () => {
    it("should generate example with string params", () => {
      const schema = {
        filePath: { type: "string" },
        content: { type: "string" },
      };

      const example = generator._getToolExample("file_writer", schema);

      expect(example).toContain("file_writer");
      expect(example).toContain("filePath");
      expect(example).toContain("```javascript");
    });

    it("should generate example with number params", () => {
      const schema = {
        count: { type: "number" },
      };

      const example = generator._getToolExample("counter", schema);

      expect(example).toContain("100");
    });

    it("should generate example with boolean params", () => {
      const schema = {
        enabled: { type: "boolean" },
      };

      const example = generator._getToolExample("toggler", schema);

      expect(example).toContain("true");
    });

    it("should handle empty schema", () => {
      const example = generator._getToolExample("no_params", {});

      expect(example).toContain("{}");
    });
  });
});
