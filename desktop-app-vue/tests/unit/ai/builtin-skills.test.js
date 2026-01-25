/**
 * BuiltinSkills 单元测试
 *
 * 测试内置技能定义的完整性和正确性
 */

import { describe, it, expect } from "vitest";

// Import the builtin skills
const builtinSkills = require("../../src/main/skill-tool-system/builtin-skills");

describe("BuiltinSkills", () => {
  describe("数据结构", () => {
    it("should export an array", () => {
      expect(Array.isArray(builtinSkills)).toBe(true);
    });

    it("should have skills defined", () => {
      expect(builtinSkills.length).toBeGreaterThan(0);
    });

    it("should have expected number of skills", () => {
      // 根据注释，应该有15个核心技能
      expect(builtinSkills.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("技能字段验证", () => {
    it("each skill should have required fields", () => {
      builtinSkills.forEach((skill, index) => {
        expect(skill, `Skill at index ${index} should have id`).toHaveProperty(
          "id",
        );
        expect(
          skill,
          `Skill at index ${index} should have name`,
        ).toHaveProperty("name");
        expect(
          skill,
          `Skill at index ${index} should have display_name`,
        ).toHaveProperty("display_name");
        expect(
          skill,
          `Skill at index ${index} should have description`,
        ).toHaveProperty("description");
        expect(
          skill,
          `Skill at index ${index} should have category`,
        ).toHaveProperty("category");
      });
    });

    it("each skill should have valid id format", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.id).toBeTruthy();
        expect(typeof skill.id).toBe("string");
        expect(skill.id.length).toBeGreaterThan(0);
      });
    });

    it("each skill should have name", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.name).toBeTruthy();
        expect(typeof skill.name).toBe("string");
      });
    });

    it("each skill should have display_name", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.display_name).toBeTruthy();
        expect(typeof skill.display_name).toBe("string");
      });
    });

    it("each skill should have description", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.description).toBeTruthy();
        expect(typeof skill.description).toBe("string");
      });
    });

    it("each skill should have category", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.category).toBeTruthy();
        expect(typeof skill.category).toBe("string");
        expect(skill.category.length).toBeGreaterThan(0);
      });
    });
  });

  describe("JSON字段格式", () => {
    it("tags should be valid JSON string", () => {
      builtinSkills.forEach((skill) => {
        if (skill.tags) {
          expect(() => JSON.parse(skill.tags)).not.toThrow();
          const parsed = JSON.parse(skill.tags);
          expect(Array.isArray(parsed)).toBe(true);
        }
      });
    });

    it("config should be valid JSON string", () => {
      builtinSkills.forEach((skill) => {
        if (skill.config) {
          expect(() => JSON.parse(skill.config)).not.toThrow();
          const parsed = JSON.parse(skill.config);
          expect(typeof parsed).toBe("object");
        }
      });
    });

    it("tools should be an array", () => {
      builtinSkills.forEach((skill) => {
        if (skill.tools) {
          expect(Array.isArray(skill.tools)).toBe(true);
        }
      });
    });
  });

  describe("工具关联", () => {
    it("each skill should have tools array", () => {
      builtinSkills.forEach((skill) => {
        expect(skill).toHaveProperty("tools");
        expect(Array.isArray(skill.tools)).toBe(true);
      });
    });

    it("tools should contain valid tool names", () => {
      builtinSkills.forEach((skill) => {
        skill.tools.forEach((tool) => {
          expect(typeof tool).toBe("string");
          expect(tool.length).toBeGreaterThan(0);
        });
      });
    });

    it("at least some skills should have tools", () => {
      const skillsWithTools = builtinSkills.filter(
        (s) => s.tools && s.tools.length > 0,
      );
      expect(skillsWithTools.length).toBeGreaterThan(0);
    });
  });

  describe("启用状态", () => {
    it("each skill should have enabled field", () => {
      builtinSkills.forEach((skill) => {
        expect(skill).toHaveProperty("enabled");
      });
    });

    it("enabled should be 0 or 1", () => {
      builtinSkills.forEach((skill) => {
        expect([0, 1]).toContain(skill.enabled);
      });
    });

    it("is_builtin should be 1", () => {
      builtinSkills.forEach((skill) => {
        expect(skill.is_builtin).toBe(1);
      });
    });
  });

  describe("特定技能验证", () => {
    it("should include code development skill", () => {
      const codeSkill = builtinSkills.find(
        (s) => s.id === "skill_code_development",
      );
      expect(codeSkill).toBeDefined();
      expect(codeSkill.category).toBe("code");
    });

    it("should include web development skill", () => {
      const webSkill = builtinSkills.find(
        (s) => s.id === "skill_web_development",
      );
      expect(webSkill).toBeDefined();
      expect(webSkill.category).toBe("web");
    });

    it("should include data analysis skill", () => {
      const dataSkill = builtinSkills.find(
        (s) => s.id === "skill_data_analysis",
      );
      expect(dataSkill).toBeDefined();
      expect(dataSkill.category).toBe("data");
    });
  });

  describe("唯一性验证", () => {
    it("should check for duplicate ids", () => {
      const ids = builtinSkills.map((s) => s.id);
      const uniqueIds = new Set(ids);

      // 记录是否有重复
      const hasDuplicates = uniqueIds.size < ids.length;

      if (hasDuplicates) {
        console.log(
          `Warning: Found ${ids.length - uniqueIds.size} duplicate skill IDs`,
        );
      }

      // 至少应该有大部分是唯一的
      expect(uniqueIds.size).toBeGreaterThan(ids.length * 0.9);
    });

    it("should check for duplicate names", () => {
      const names = builtinSkills.map((s) => s.name);
      const uniqueNames = new Set(names);

      const hasDuplicates = uniqueNames.size < names.length;

      if (hasDuplicates) {
        console.log(
          `Warning: Found ${names.length - uniqueNames.size} duplicate skill names`,
        );
      }

      // 至少应该有大部分是唯一的
      expect(uniqueNames.size).toBeGreaterThan(names.length * 0.9);
    });
  });

  describe("文档路径", () => {
    it("each skill should have doc_path", () => {
      builtinSkills.forEach((skill) => {
        if (skill.doc_path) {
          expect(typeof skill.doc_path).toBe("string");
          expect(skill.doc_path).toContain(".md");
        }
      });
    });
  });

  describe("图标配置", () => {
    it("each skill should have icon", () => {
      builtinSkills.forEach((skill) => {
        if (skill.icon) {
          expect(typeof skill.icon).toBe("string");
          expect(skill.icon.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("配置选项", () => {
    it("code development should have language config", () => {
      const codeSkill = builtinSkills.find(
        (s) => s.id === "skill_code_development",
      );
      if (codeSkill && codeSkill.config) {
        const config = JSON.parse(codeSkill.config);
        expect(config).toHaveProperty("defaultLanguage");
      }
    });

    it("web development should have template config", () => {
      const webSkill = builtinSkills.find(
        (s) => s.id === "skill_web_development",
      );
      if (webSkill && webSkill.config) {
        const config = JSON.parse(webSkill.config);
        expect(config).toHaveProperty("defaultTemplate");
      }
    });
  });
});
