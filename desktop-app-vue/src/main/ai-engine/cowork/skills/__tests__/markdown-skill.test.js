/**
 * MarkdownSkill 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownSkill } from "../markdown-skill.js";

describe("MarkdownSkill", () => {
  describe("constructor", () => {
    it("should create skill from definition", () => {
      const definition = {
        name: "test-skill",
        displayName: "Test Skill",
        description: "A test skill",
        version: "1.0.0",
        category: "testing",
        capabilities: ["test"],
        supportedFileTypes: [".txt"],
        source: "managed",
        sourcePath: "/path/to/skill/SKILL.md",
        userInvocable: true,
        hidden: false,
        tags: ["test", "demo"],
        enabled: true,
        handler: null,
        body: "# Test\n\nBody content",
      };

      const skill = new MarkdownSkill(definition);

      expect(skill.skillId).toBe("test-skill");
      expect(skill.name).toBe("Test Skill");
      expect(skill.description).toBe("A test skill");
      expect(skill.version).toBe("1.0.0");
      expect(skill.category).toBe("testing");
      expect(skill.source).toBe("managed");
      expect(skill.userInvocable).toBe(true);
      expect(skill.hidden).toBe(false);
      expect(skill.tags).toEqual(["test", "demo"]);
    });

    it("should use name as displayName if not provided", () => {
      const definition = {
        name: "my-skill",
        description: "A skill",
      };

      const skill = new MarkdownSkill(definition);

      expect(skill.name).toBe("my-skill");
    });
  });

  describe("canHandle", () => {
    it("should return higher score for skills with handler", () => {
      const withHandler = new MarkdownSkill({
        name: "with-handler",
        description: "Has handler",
        handler: "./handler.js",
        capabilities: ["task"],
      });

      const withoutHandler = new MarkdownSkill({
        name: "without-handler",
        description: "No handler",
        capabilities: ["task"],
      });

      const task = { type: "task" };

      const scoreWith = withHandler.canHandle(task);
      const scoreWithout = withoutHandler.canHandle(task);

      // Both should have base score from capability match
      expect(scoreWith).toBeGreaterThanOrEqual(50);
      expect(scoreWithout).toBeGreaterThanOrEqual(50);
      // Handler adds 10 extra points
      expect(scoreWith).toBe(scoreWithout + 10);
    });

    it("should return 0 when disabled", () => {
      const skill = new MarkdownSkill({
        name: "disabled-skill",
        description: "Disabled",
        enabled: false,
        capabilities: ["task"],
      });

      const score = skill.canHandle({ type: "task" });

      expect(score).toBe(0);
    });

    it("should increase score based on tag matches", () => {
      const skill = new MarkdownSkill({
        name: "tagged-skill",
        description: "Has tags",
        tags: ["pdf", "document"],
        capabilities: ["process"],
      });

      const taskWithTags = { type: "process", tags: ["pdf", "document"] };
      const taskWithoutTags = { type: "process", tags: [] };

      const scoreWithTags = skill.canHandle(taskWithTags);
      const scoreWithoutTags = skill.canHandle(taskWithoutTags);

      // Tag matches should add extra points
      expect(scoreWithTags).toBeGreaterThan(scoreWithoutTags);
    });
  });

  describe("execute", () => {
    it("should return documentation for skill without handler", async () => {
      const skill = new MarkdownSkill({
        name: "doc-skill",
        description: "Documentation only",
        body: "# Usage\n\nUse this skill...",
      });

      const result = await skill.execute({});

      expect(result.success).toBe(true);
      expect(result.type).toBe("documentation");
      expect(result.body).toContain("Usage");
    });
  });

  describe("getInfo", () => {
    it("should include additional fields", () => {
      const definition = {
        name: "info-skill",
        description: "Test",
        source: "workspace",
        sourcePath: "/path/to/skill",
        userInvocable: true,
        hidden: false,
        tags: ["a", "b"],
        handler: "./handler.js",
        body: "content",
        requires: { bins: ["node"] },
        os: ["win32"],
      };

      const skill = new MarkdownSkill(definition);
      const info = skill.getInfo();

      expect(info.source).toBe("workspace");
      expect(info.sourcePath).toBe("/path/to/skill");
      expect(info.userInvocable).toBe(true);
      expect(info.hidden).toBe(false);
      expect(info.tags).toEqual(["a", "b"]);
      expect(info.hasHandler).toBe(true);
      expect(info.hasBody).toBe(true);
      expect(info.requires).toEqual({ bins: ["node"] });
      expect(info.os).toEqual(["win32"]);
    });
  });

  describe("getBody", () => {
    it("should return body content", () => {
      const skill = new MarkdownSkill({
        name: "body-skill",
        description: "Test",
        body: "# Instructions\n\nFollow these steps...",
      });

      expect(skill.getBody()).toContain("Instructions");
    });

    it("should return empty string if no body", () => {
      const skill = new MarkdownSkill({
        name: "no-body",
        description: "Test",
      });

      expect(skill.getBody()).toBe("");
    });
  });

  describe("getDefinition", () => {
    it("should return original definition", () => {
      const definition = {
        name: "def-skill",
        description: "Test",
        version: "2.0.0",
      };

      const skill = new MarkdownSkill(definition);
      const retrieved = skill.getDefinition();

      expect(retrieved).toBe(skill.definition);
      expect(retrieved.name).toBe("def-skill");
      expect(retrieved.version).toBe("2.0.0");
    });
  });
});
