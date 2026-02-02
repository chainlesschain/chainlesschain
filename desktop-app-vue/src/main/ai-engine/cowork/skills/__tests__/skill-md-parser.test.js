/**
 * SkillMdParser 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SkillMdParser } from "../skill-md-parser.js";

describe("SkillMdParser", () => {
  let parser;

  beforeEach(() => {
    parser = new SkillMdParser({ strictValidation: false });
  });

  describe("parseContent", () => {
    it("should parse valid SKILL.md content", () => {
      const content = `---
name: test-skill
description: A test skill
version: 1.0.0
category: testing
tags: [test, demo]
user-invocable: true
enabled: true
---

# Test Skill

This is the body of the skill.
`;

      const result = parser.parseContent(
        content,
        "/path/to/test-skill/SKILL.md",
      );

      expect(result.name).toBe("test-skill");
      expect(result.description).toBe("A test skill");
      expect(result.version).toBe("1.0.0");
      expect(result.category).toBe("testing");
      expect(result.tags).toEqual(["test", "demo"]);
      expect(result.userInvocable).toBe(true);
      expect(result.enabled).toBe(true);
      expect(result.body).toContain("This is the body of the skill.");
    });

    it("should handle kebab-case field names", () => {
      const content = `---
name: my-skill
description: Test
display-name: My Skill
user-invocable: false
supported-file-types: [.txt, .md]
---
`;

      const result = parser.parseContent(content);

      expect(result.displayName).toBe("My Skill");
      expect(result.userInvocable).toBe(false);
      expect(result.supportedFileTypes).toEqual([".txt", ".md"]);
    });

    it("should parse requires section", () => {
      const content = `---
name: complex-skill
description: A skill with requirements
requires:
  bins: [node, npm]
  env: [API_KEY, SECRET]
os: [win32, darwin]
---
`;

      const result = parser.parseContent(content);

      expect(result.requires.bins).toEqual(["node", "npm"]);
      expect(result.requires.env).toEqual(["API_KEY", "SECRET"]);
      expect(result.os).toEqual(["win32", "darwin"]);
    });

    it("should use directory name as skill name if not specified", () => {
      const content = `---
description: A skill without name
---
`;

      const result = parser.parseContent(content, "/path/to/my-skill/SKILL.md");

      expect(result.name).toBe("my-skill");
    });

    it("should set default values for optional fields", () => {
      const content = `---
name: minimal
description: Minimal skill
---
`;

      const result = parser.parseContent(content);

      expect(result.version).toBe("1.0.0");
      expect(result.category).toBe("custom");
      expect(result.tags).toEqual([]);
      expect(result.userInvocable).toBe(true);
      expect(result.hidden).toBe(false);
      expect(result.enabled).toBe(true);
      expect(result.os).toEqual(["win32", "darwin", "linux"]);
    });

    it("should handle content without frontmatter", () => {
      const content = `# Just Markdown

No YAML frontmatter here.
`;

      const result = parser.parseContent(content, "/path/to/no-yaml/SKILL.md");

      expect(result.name).toBe("no-yaml");
      expect(result.body).toContain("Just Markdown");
    });
  });

  describe("validate", () => {
    it("should validate name format", () => {
      const definition = {
        name: "Invalid Name!",
        description: "Test",
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "name must be alphanumeric with hyphens (e.g., my-skill)",
      );
    });

    it("should validate required fields", () => {
      const definition = {
        name: "",
        description: "",
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("name is required");
      expect(result.errors).toContain("description is required");
    });

    it("should validate description length", () => {
      const longParser = new SkillMdParser({ maxDescriptionLength: 10 });
      const definition = {
        name: "test",
        description: "This is a very long description that exceeds the limit",
      };

      const result = longParser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("exceeds"))).toBe(true);
    });

    it("should validate version format", () => {
      const definition = {
        name: "test",
        description: "Test",
        version: "invalid",
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("semver"))).toBe(true);
    });

    it("should validate handler path", () => {
      const definition = {
        name: "test",
        description: "Test",
        handler: "absolute/path.js",
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("relative"))).toBe(true);
    });

    it("should validate platform values", () => {
      const definition = {
        name: "test",
        description: "Test",
        os: ["win32", "invalid-os"],
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid platform"))).toBe(
        true,
      );
    });

    it("should pass validation for valid definition", () => {
      const definition = {
        name: "valid-skill",
        description: "A valid skill",
        version: "1.2.3",
        handler: "./handler.js",
        os: ["win32", "darwin"],
      };

      const result = parser.validate(definition);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
