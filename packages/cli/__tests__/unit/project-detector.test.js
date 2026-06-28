import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findProjectRoot,
  loadProjectConfig,
  isInsideProject,
  _clearProjectConfigCache,
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

  // ─── loadProjectConfig caching (mtime-invalidated) ────

  describe("loadProjectConfig caching", () => {
    let cfgPath;

    beforeEach(() => {
      _clearProjectConfigCache();
      const ccDir = join(tempDir, ".chainlesschain");
      mkdirSync(ccDir, { recursive: true });
      cfgPath = join(ccDir, "config.json");
    });

    it("serves an unchanged file from cache (same object reference)", () => {
      writeFileSync(cfgPath, JSON.stringify({ name: "a", n: 1 }), "utf-8");

      const first = loadProjectConfig(tempDir);
      const second = loadProjectConfig(tempDir);

      // A cache hit returns the stored object; a fresh JSON.parse would yield a
      // new object (!==). Reference identity proves the parse was skipped.
      expect(second).toBe(first);
      expect(second).toEqual({ name: "a", n: 1 });
    });

    it("re-reads after the file's mtime changes (edit / persona set)", () => {
      writeFileSync(cfgPath, JSON.stringify({ name: "a" }), "utf-8");
      const first = loadProjectConfig(tempDir);
      expect(first).toEqual({ name: "a" });

      // Rewrite with new content and force a distinctly newer mtime (a same-tick
      // overwrite could keep the same mtimeMs on coarse-resolution filesystems).
      writeFileSync(
        cfgPath,
        JSON.stringify({ name: "b", extra: true }),
        "utf-8",
      );
      const bumped = new Date(statSync(cfgPath).mtimeMs + 5000);
      utimesSync(cfgPath, bumped, bumped);

      const second = loadProjectConfig(tempDir);
      expect(second).not.toBe(first); // invalidated → re-parsed
      expect(second).toEqual({ name: "b", extra: true });
    });

    it("re-reads after the file is removed and recreated", () => {
      writeFileSync(cfgPath, JSON.stringify({ name: "a" }), "utf-8");
      expect(loadProjectConfig(tempDir)).toEqual({ name: "a" });

      rmSync(cfgPath);
      expect(loadProjectConfig(tempDir)).toBeNull(); // stale entry dropped

      writeFileSync(cfgPath, JSON.stringify({ name: "c" }), "utf-8");
      expect(loadProjectConfig(tempDir)).toEqual({ name: "c" });
    });

    it("caches a null for malformed JSON, then recovers when fixed", () => {
      writeFileSync(cfgPath, "broken{{{", "utf-8");
      expect(loadProjectConfig(tempDir)).toBeNull();

      writeFileSync(cfgPath, JSON.stringify({ name: "fixed" }), "utf-8");
      const bumped = new Date(statSync(cfgPath).mtimeMs + 5000);
      utimesSync(cfgPath, bumped, bumped);

      expect(loadProjectConfig(tempDir)).toEqual({ name: "fixed" });
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
