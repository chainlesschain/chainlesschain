/**
 * SkillLoader supplementary unit tests
 *
 * Covers: constructor defaults, loadLayer edge cases, loadAll, reload,
 * loadSingleSkill, gating behavior, event emission, and filtering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getName: vi.fn(() => "chainlesschain-test"),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { SkillLoader } = require("../skill-loader.js");

/** Helper: create a valid SKILL.md in a directory */
function writeSkillMd(dir, overrides = {}) {
  const meta = {
    name: "test-skill",
    version: "1.0.0",
    description: "Test skill",
    "user-invocable": true,
    enabled: true,
    ...overrides,
  };

  const yamlLines = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const content = `---\n${yamlLines}\n---\n# ${meta.name}\nThis is a test.\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}

describe("SkillLoader — supplementary tests", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      "skill-loader-unit-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8),
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ─── 1. Constructor defaults ────────────────────────────────────────

  describe("constructor defaults", () => {
    it("should default workspacePath to process.cwd()", () => {
      const loader = new SkillLoader();
      expect(loader.options.workspacePath).toBe(process.cwd());
    });

    it("should default autoGating to true", () => {
      const loader = new SkillLoader();
      expect(loader.options.autoGating).toBe(true);
    });

    it("should default strictGating to false", () => {
      const loader = new SkillLoader();
      expect(loader.options.strictGating).toBe(false);
    });
  });

  // ─── 2. Constructor custom options ──────────────────────────────────

  describe("constructor custom options", () => {
    it("should accept custom workspacePath", () => {
      const loader = new SkillLoader({ workspacePath: "/custom/path" });
      expect(loader.options.workspacePath).toBe("/custom/path");
    });

    it("should accept autoGating: false", () => {
      const loader = new SkillLoader({ autoGating: false });
      expect(loader.options.autoGating).toBe(false);
    });

    it("should accept strictGating: true", () => {
      const loader = new SkillLoader({ strictGating: true });
      expect(loader.options.strictGating).toBe(true);
    });
  });

  // ─── 3-4. loadLayer with non-existent / empty dir ──────────────────

  describe("loadLayer edge cases", () => {
    it("should return zeros for non-existent directory", async () => {
      const loader = new SkillLoader({
        workspacePath: path.join(tempDir, "does-not-exist"),
        autoGating: false,
      });
      const result = await loader.loadLayer("workspace");
      expect(result).toEqual({ loaded: 0, skipped: 0, errors: [] });
    });

    it("should return zeros for an empty directory", async () => {
      const skillsDir = path.join(tempDir, ".chainlesschain", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const result = await loader.loadLayer("workspace");
      expect(result).toEqual({ loaded: 0, skipped: 0, errors: [] });
    });

    // ─── 5. loadLayer skips non-directories ──────────────────────────

    it("should skip files (non-directories) in the layer path", async () => {
      const skillsDir = path.join(tempDir, ".chainlesschain", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      // Create a plain file instead of a directory
      fs.writeFileSync(path.join(skillsDir, "not-a-dir.txt"), "hello");

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const result = await loader.loadLayer("workspace");
      expect(result.loaded).toBe(0);
    });

    // ─── 6. loadLayer skips dirs without SKILL.md ────────────────────

    it("should skip directories without SKILL.md", async () => {
      const emptySkillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "empty-dir",
      );
      fs.mkdirSync(emptySkillDir, { recursive: true });
      fs.writeFileSync(path.join(emptySkillDir, "README.md"), "# Hi");

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const result = await loader.loadLayer("workspace");
      expect(result.loaded).toBe(0);
    });
  });

  // ─── 7. loadLayer loads valid SKILL.md ─────────────────────────────

  describe("loadLayer loads valid skill", () => {
    it("should load a skill from dir with SKILL.md", async () => {
      const skillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "my-skill",
      );
      writeSkillMd(skillDir, { name: "my-skill" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(loader.layerDefinitions.workspace.has("my-skill")).toBe(true);
    });

    it("should emit skill-loaded event", async () => {
      const skillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "evt-skill",
      );
      writeSkillMd(skillDir, { name: "evt-skill" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const handler = vi.fn();
      loader.on("skill-loaded", handler);

      await loader.loadLayer("workspace");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: "workspace",
          definition: expect.objectContaining({ name: "evt-skill" }),
        }),
      );
    });
  });

  // ─── 8-9. loadAll ──────────────────────────────────────────────────

  describe("loadAll", () => {
    it("should load skills from all 4 layers and call resolveConflicts", async () => {
      // Set up workspace layer skill
      const wsSkillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "ws-skill",
      );
      writeSkillMd(wsSkillDir, { name: "ws-skill" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const result = await loader.loadAll();

      // Should have loaded at least the workspace skill
      expect(result.loaded).toBeGreaterThanOrEqual(1);
      // resolveConflicts populates resolvedSkills
      expect(loader.resolvedSkills.size).toBeGreaterThanOrEqual(1);
      expect(loader.resolvedSkills.has("ws-skill")).toBe(true);
    });
  });

  // ─── 10-11. resolveConflicts ───────────────────────────────────────

  describe("resolveConflicts — supplementary", () => {
    it("should let marketplace override bundled", () => {
      const loader = new SkillLoader({ autoGating: false });

      loader.layerDefinitions.bundled.set("dup", {
        name: "dup",
        description: "bundled",
        source: "bundled",
      });
      loader.layerDefinitions.marketplace.set("dup", {
        name: "dup",
        description: "marketplace",
        source: "marketplace",
      });

      loader.resolveConflicts();

      const resolved = loader.resolvedSkills.get("dup");
      expect(resolved.source).toBe("marketplace");
      expect(resolved.description).toBe("marketplace");
    });

    it("should emit skill-overridden for each override in priority chain", () => {
      const loader = new SkillLoader({ autoGating: false });
      const handler = vi.fn();
      loader.on("skill-overridden", handler);

      loader.layerDefinitions.bundled.set("chain", {
        name: "chain",
        source: "bundled",
      });
      loader.layerDefinitions.marketplace.set("chain", {
        name: "chain",
        source: "marketplace",
      });
      loader.layerDefinitions.workspace.set("chain", {
        name: "chain",
        source: "workspace",
      });

      loader.resolveConflicts();

      // Two overrides: bundled -> marketplace, marketplace -> workspace
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith({
        skillName: "chain",
        oldSource: "bundled",
        newSource: "marketplace",
      });
      expect(handler).toHaveBeenCalledWith({
        skillName: "chain",
        oldSource: "marketplace",
        newSource: "workspace",
      });
    });
  });

  // ─── 12. getDefinitionsBySource ────────────────────────────────────

  describe("getDefinitionsBySource", () => {
    it("should return definitions only for the requested layer", () => {
      const loader = new SkillLoader({ autoGating: false });

      loader.layerDefinitions.bundled.set("b1", { name: "b1" });
      loader.layerDefinitions.workspace.set("w1", { name: "w1" });
      loader.layerDefinitions.workspace.set("w2", { name: "w2" });
      loader.layerDefinitions.marketplace.set("m1", { name: "m1" });

      expect(loader.getDefinitionsBySource("bundled")).toHaveLength(1);
      expect(loader.getDefinitionsBySource("workspace")).toHaveLength(2);
      expect(loader.getDefinitionsBySource("marketplace")).toHaveLength(1);
      expect(loader.getDefinitionsBySource("managed")).toHaveLength(0);
    });
  });

  // ─── 13. getUserInvocableDefinitions ───────────────────────────────

  describe("getUserInvocableDefinitions — supplementary", () => {
    it("should return empty array when no skills are resolved", () => {
      const loader = new SkillLoader({ autoGating: false });
      expect(loader.getUserInvocableDefinitions()).toEqual([]);
    });

    it("should include only skills that are invocable, visible, and enabled", () => {
      const loader = new SkillLoader({ autoGating: false });

      loader.resolvedSkills.set("ok", {
        name: "ok",
        userInvocable: true,
        hidden: false,
        enabled: true,
      });
      loader.resolvedSkills.set("no-invocable", {
        name: "no-invocable",
        userInvocable: false,
        hidden: false,
        enabled: true,
      });
      loader.resolvedSkills.set("is-hidden", {
        name: "is-hidden",
        userInvocable: true,
        hidden: true,
        enabled: true,
      });
      loader.resolvedSkills.set("is-disabled", {
        name: "is-disabled",
        userInvocable: true,
        hidden: false,
        enabled: false,
      });

      const result = loader.getUserInvocableDefinitions();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ok");
    });
  });

  // ─── 14-15. reload ─────────────────────────────────────────────────

  describe("reload", () => {
    it("should clear all layers and resolved skills then reload", async () => {
      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });

      // Pre-populate
      loader.layerDefinitions.bundled.set("old", { name: "old" });
      loader.resolvedSkills.set("old", { name: "old" });

      // Create workspace skill for reload to find
      const wsDir = path.join(tempDir, ".chainlesschain", "skills", "reloaded");
      writeSkillMd(wsDir, { name: "reloaded" });

      await loader.reload();

      // Old skill should be gone
      expect(loader.layerDefinitions.bundled.has("old")).toBe(false);
      // New skill should be loaded
      expect(loader.resolvedSkills.has("reloaded")).toBe(true);
    });

    it("should clear gating cache on reload", async () => {
      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });

      // Spy on gating.clearCache
      const clearCacheSpy = vi.spyOn(loader.gating, "clearCache");

      await loader.reload();

      expect(clearCacheSpy).toHaveBeenCalledTimes(1);
      clearCacheSpy.mockRestore();
    });
  });

  // ─── 16-17. loadSingleSkill ────────────────────────────────────────

  describe("loadSingleSkill", () => {
    it("should load a single skill from a given directory", async () => {
      const skillDir = path.join(tempDir, "single-skill");
      writeSkillMd(skillDir, { name: "single-skill" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const def = await loader.loadSingleSkill(skillDir, "managed");

      expect(def).not.toBeNull();
      expect(def.name).toBe("single-skill");
      expect(def.source).toBe("managed");
      // Should also be stored in layerDefinitions and resolvedSkills
      expect(loader.layerDefinitions.managed.has("single-skill")).toBe(true);
      expect(loader.resolvedSkills.has("single-skill")).toBe(true);
    });

    it("should return null when SKILL.md is missing", async () => {
      const emptyDir = path.join(tempDir, "no-skill-md");
      fs.mkdirSync(emptyDir, { recursive: true });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const def = await loader.loadSingleSkill(emptyDir);

      expect(def).toBeNull();
    });

    it("should default layer to 'managed'", async () => {
      const skillDir = path.join(tempDir, "default-layer");
      writeSkillMd(skillDir, { name: "default-layer" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: false,
      });
      const def = await loader.loadSingleSkill(skillDir);

      expect(def.source).toBe("managed");
    });
  });

  // ─── 18-20. Gating behavior ────────────────────────────────────────

  describe("gating", () => {
    it("should call gating.checkRequirements when autoGating is true", async () => {
      const skillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "gated-skill",
      );
      writeSkillMd(skillDir, { name: "gated-skill" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: true,
        strictGating: false,
      });

      const checkSpy = vi
        .spyOn(loader.gating, "checkRequirements")
        .mockResolvedValue({ passed: true, results: {} });

      await loader.loadLayer("workspace");

      expect(checkSpy).toHaveBeenCalled();
      checkSpy.mockRestore();
    });

    it("should skip skill when strictGating is true and gating fails", async () => {
      const skillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "strict-fail",
      );
      writeSkillMd(skillDir, { name: "strict-fail" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: true,
        strictGating: true,
      });

      vi.spyOn(loader.gating, "checkRequirements").mockResolvedValue({
        passed: false,
        results: {
          platform: { passed: true },
          bins: { passed: false, missing: ["someBin"] },
          env: { passed: true },
          enabled: { passed: true },
        },
      });
      vi.spyOn(loader.gating, "getSummary").mockReturnValue(
        "Missing binaries: someBin",
      );

      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(0);
      expect(result.skipped).toBe(1);
      expect(loader.layerDefinitions.workspace.has("strict-fail")).toBe(false);
    });

    it("should mark _gatingFailed when non-strict gating fails", async () => {
      const skillDir = path.join(
        tempDir,
        ".chainlesschain",
        "skills",
        "soft-fail",
      );
      writeSkillMd(skillDir, { name: "soft-fail" });

      const loader = new SkillLoader({
        workspacePath: tempDir,
        autoGating: true,
        strictGating: false,
      });

      vi.spyOn(loader.gating, "checkRequirements").mockResolvedValue({
        passed: false,
        results: {
          platform: { passed: true },
          bins: { passed: false, missing: ["missingBin"] },
          env: { passed: true },
          enabled: { passed: true },
        },
      });
      vi.spyOn(loader.gating, "getSummary").mockReturnValue(
        "Missing binaries: missingBin",
      );

      const result = await loader.loadLayer("workspace");

      expect(result.loaded).toBe(1);
      expect(result.skipped).toBe(0);

      const def = loader.layerDefinitions.workspace.get("soft-fail");
      expect(def._gatingFailed).toBe(true);
      expect(def._gatingReason).toBe("Missing binaries: missingBin");
    });
  });
});
