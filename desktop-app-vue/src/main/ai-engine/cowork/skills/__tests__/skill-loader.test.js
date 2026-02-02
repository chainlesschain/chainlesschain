/**
 * SkillLoader 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { SkillLoader, LAYER_PRIORITY } from "../skill-loader.js";

// Mock electron app
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "chainlesschain-test")),
  },
}));

describe("SkillLoader", () => {
  let loader;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), "skill-loader-test-" + Date.now());
    loader = new SkillLoader({
      workspacePath: tempDir,
      autoGating: false,
    });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("LAYER_PRIORITY", () => {
    it("should have correct priority values", () => {
      expect(LAYER_PRIORITY.bundled).toBe(0);
      expect(LAYER_PRIORITY.managed).toBe(1);
      expect(LAYER_PRIORITY.workspace).toBe(2);
    });
  });

  describe("getLayerPaths", () => {
    it("should return paths for all three layers", () => {
      const paths = loader.getLayerPaths();

      expect(paths).toHaveProperty("bundled");
      expect(paths).toHaveProperty("managed");
      expect(paths).toHaveProperty("workspace");

      expect(paths.bundled).toContain("builtin");
      expect(paths.workspace).toContain(".chainlesschain");
    });
  });

  describe("loadLayer", () => {
    it("should return empty result for non-existent directory", async () => {
      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should load skills from directory", async () => {
      // Create test skill directory
      const skillsDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "test-skill",
      );
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillsDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill
---

# Test Skill
`,
      );

      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("should skip directories without SKILL.md", async () => {
      const skillsDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "not-a-skill",
      );
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "README.md"), "# Not a skill");

      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(0);
    });
  });

  describe("resolveConflicts", () => {
    it("should override lower priority skills with higher priority", async () => {
      // Create bundled skill mock data
      loader.layerDefinitions.bundled.set("shared-skill", {
        name: "shared-skill",
        description: "Bundled version",
        source: "bundled",
      });

      // Create workspace skill with same name
      loader.layerDefinitions.workspace.set("shared-skill", {
        name: "shared-skill",
        description: "Workspace version",
        source: "workspace",
      });

      loader.resolveConflicts();

      const resolved = loader.resolvedSkills.get("shared-skill");
      expect(resolved.source).toBe("workspace");
      expect(resolved.description).toBe("Workspace version");
    });

    it("should emit skill-overridden event", async () => {
      const overriddenHandler = vi.fn();
      loader.on("skill-overridden", overriddenHandler);

      loader.layerDefinitions.bundled.set("override-test", {
        name: "override-test",
        source: "bundled",
      });

      loader.layerDefinitions.managed.set("override-test", {
        name: "override-test",
        source: "managed",
      });

      loader.resolveConflicts();

      expect(overriddenHandler).toHaveBeenCalledWith({
        skillName: "override-test",
        oldSource: "bundled",
        newSource: "managed",
      });
    });
  });

  describe("createSkillInstances", () => {
    it("should create MarkdownSkill instances", async () => {
      loader.resolvedSkills.set("instance-test", {
        name: "instance-test",
        description: "Test instance creation",
        source: "workspace",
        sourcePath: "/path/to/skill",
        version: "1.0.0",
        category: "test",
      });

      const instances = loader.createSkillInstances();

      expect(instances).toHaveLength(1);
      expect(instances[0].skillId).toBe("instance-test");
      expect(instances[0].source).toBe("workspace");
    });
  });

  describe("getDefinitionsBySource", () => {
    it("should return definitions for specific source", () => {
      loader.layerDefinitions.bundled.set("bundled-1", { name: "bundled-1" });
      loader.layerDefinitions.bundled.set("bundled-2", { name: "bundled-2" });
      loader.layerDefinitions.managed.set("managed-1", { name: "managed-1" });

      const bundled = loader.getDefinitionsBySource("bundled");
      const managed = loader.getDefinitionsBySource("managed");

      expect(bundled).toHaveLength(2);
      expect(managed).toHaveLength(1);
    });
  });

  describe("getUserInvocableDefinitions", () => {
    it("should filter invocable and visible skills", () => {
      loader.resolvedSkills.set("invocable", {
        name: "invocable",
        userInvocable: true,
        hidden: false,
        enabled: true,
      });

      loader.resolvedSkills.set("hidden", {
        name: "hidden",
        userInvocable: true,
        hidden: true,
        enabled: true,
      });

      loader.resolvedSkills.set("disabled", {
        name: "disabled",
        userInvocable: true,
        hidden: false,
        enabled: false,
      });

      loader.resolvedSkills.set("not-invocable", {
        name: "not-invocable",
        userInvocable: false,
        hidden: false,
        enabled: true,
      });

      const invocable = loader.getUserInvocableDefinitions();

      expect(invocable).toHaveLength(1);
      expect(invocable[0].name).toBe("invocable");
    });
  });

  describe("setWorkspacePath", () => {
    it("should update workspace path", () => {
      const newPath = "/new/workspace/path";
      loader.setWorkspacePath(newPath);

      expect(loader.options.workspacePath).toBe(newPath);
    });
  });
});
