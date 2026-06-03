import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findProjectRoot,
  loadProjectConfig,
  isInsideProject,
} from "../../src/lib/project-detector.js";

describe("project-detector", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-projdet-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── findProjectRoot ──────────────────────────────────

  describe("findProjectRoot", () => {
    it("finds project root in the same directory", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), '{"name":"test"}', "utf-8");

      expect(findProjectRoot(tempDir)).toBe(tempDir);
    });

    it("finds project root in parent directory", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), '{"name":"test"}', "utf-8");

      const nested = join(tempDir, "src", "lib");
      mkdirSync(nested, { recursive: true });

      expect(findProjectRoot(nested)).toBe(tempDir);
    });

    it("finds project root in deeply nested directory", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), '{"name":"test"}', "utf-8");

      const deep = join(tempDir, "a", "b", "c", "d");
      mkdirSync(deep, { recursive: true });

      expect(findProjectRoot(deep)).toBe(tempDir);
    });

    it("uses cwd when no startDir is provided", () => {
      // This should not throw, just return null or a valid path
      const result = findProjectRoot();
      expect(result === null || typeof result === "string").toBe(true);
    });
  });

  // ─── loadProjectConfig ────────────────────────────────

  describe("loadProjectConfig", () => {
    it("loads and parses config.json", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      const config = {
        name: "test-project",
        template: "code-project",
        version: "1.0.0",
      };
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify(config),
        "utf-8",
      );

      const loaded = loadProjectConfig(tempDir);
      expect(loaded).toEqual(config);
    });

    it("returns null when config.json does not exist", () => {
      expect(loadProjectConfig(tempDir)).toBeNull();
    });

    it("returns null when config.json is invalid JSON", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), "not json{{{", "utf-8");

      expect(loadProjectConfig(tempDir)).toBeNull();
    });
  });

  // ─── isInsideProject ──────────────────────────────────

  describe("isInsideProject", () => {
    it("returns true when inside a project", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), '{"name":"test"}', "utf-8");

      expect(isInsideProject(tempDir)).toBe(true);
    });

    it("returns true from a nested subdirectory", () => {
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      writeFileSync(join(ccDir, "config.json"), '{"name":"test"}', "utf-8");

      const nested = join(tempDir, "src");
      mkdirSync(nested, { recursive: true });

      expect(isInsideProject(nested)).toBe(true);
    });
  });
});
