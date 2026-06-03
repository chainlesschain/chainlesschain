/**
 * SkillGating 单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SkillGating } from "../skill-gating.js";

describe("SkillGating", () => {
  let gating;

  beforeEach(() => {
    gating = new SkillGating({ cacheResults: false });
  });

  describe("checkPlatform", () => {
    it("should pass when current platform is in the list", () => {
      const result = gating.checkPlatform([process.platform]);

      expect(result.passed).toBe(true);
      expect(result.detail).toContain(process.platform);
    });

    it("should fail when current platform is not in the list", () => {
      const fakeList =
        process.platform === "win32" ? ["darwin", "linux"] : ["win32"];
      const result = gating.checkPlatform(fakeList);

      expect(result.passed).toBe(false);
      expect(result.detail).toContain("not in supported list");
    });

    it("should pass when list is empty", () => {
      const result = gating.checkPlatform([]);

      expect(result.passed).toBe(true);
    });

    it("should pass when list is undefined", () => {
      const result = gating.checkPlatform(undefined);

      expect(result.passed).toBe(true);
    });
  });

  describe("checkEnv", () => {
    it("should return true for existing env var", () => {
      process.env.TEST_GATING_VAR = "value";

      const result = gating.checkEnv("TEST_GATING_VAR");

      expect(result).toBe(true);

      delete process.env.TEST_GATING_VAR;
    });

    it("should return false for missing env var", () => {
      const result = gating.checkEnv("NONEXISTENT_VAR_12345");

      expect(result).toBe(false);
    });

    it("should return false for empty env var", () => {
      process.env.EMPTY_VAR = "";

      const result = gating.checkEnv("EMPTY_VAR");

      expect(result).toBe(false);

      delete process.env.EMPTY_VAR;
    });
  });

  describe("checkEnvVars", () => {
    it("should pass when all env vars exist", () => {
      process.env.VAR1 = "a";
      process.env.VAR2 = "b";

      const result = gating.checkEnvVars(["VAR1", "VAR2"]);

      expect(result.passed).toBe(true);
      expect(result.missing).toHaveLength(0);

      delete process.env.VAR1;
      delete process.env.VAR2;
    });

    it("should fail when some env vars are missing", () => {
      process.env.VAR1 = "a";

      const result = gating.checkEnvVars(["VAR1", "MISSING_VAR"]);

      expect(result.passed).toBe(false);
      expect(result.missing).toContain("MISSING_VAR");

      delete process.env.VAR1;
    });
  });

  describe("checkBinary", () => {
    it("should return true for common binaries", async () => {
      // 'node' should be available in test environment
      const result = await gating.checkBinary("node");

      expect(result).toBe(true);
    });

    it("should return false for non-existent binary", async () => {
      const result = await gating.checkBinary("nonexistent-binary-12345");

      expect(result).toBe(false);
    });
  });

  describe("checkRequirements", () => {
    it("should pass when all requirements are met", async () => {
      const definition = {
        enabled: true,
        os: [process.platform],
        requires: {
          bins: ["node"],
          env: [],
        },
      };

      const result = await gating.checkRequirements(definition);

      expect(result.passed).toBe(true);
    });

    it("should fail when skill is disabled", async () => {
      const definition = {
        enabled: false,
        os: [process.platform],
        requires: {},
      };

      const result = await gating.checkRequirements(definition);

      expect(result.passed).toBe(false);
      expect(result.results.enabled.passed).toBe(false);
    });

    it("should fail when platform is not supported", async () => {
      const fakeList = process.platform === "win32" ? ["darwin"] : ["win32"];
      const definition = {
        enabled: true,
        os: fakeList,
        requires: {},
      };

      const result = await gating.checkRequirements(definition);

      expect(result.passed).toBe(false);
      expect(result.results.platform.passed).toBe(false);
    });

    it("should fail when required binary is missing", async () => {
      const definition = {
        enabled: true,
        os: [process.platform],
        requires: {
          bins: ["nonexistent-binary-xyz"],
          env: [],
        },
      };

      const result = await gating.checkRequirements(definition);

      expect(result.passed).toBe(false);
      expect(result.results.bins.passed).toBe(false);
      expect(result.results.bins.missing).toContain("nonexistent-binary-xyz");
    });
  });

  describe("getSummary", () => {
    it("should return success message when passed", () => {
      const checkResult = {
        passed: true,
        results: {},
      };

      const summary = gating.getSummary(checkResult);

      expect(summary).toBe("All gating requirements passed");
    });

    it("should list all issues when failed", () => {
      const checkResult = {
        passed: false,
        results: {
          enabled: { passed: false },
          platform: { passed: false, detail: "unsupported platform" },
          bins: { passed: false, missing: ["ffmpeg"] },
          env: { passed: false, missing: ["API_KEY"] },
        },
      };

      const summary = gating.getSummary(checkResult);

      expect(summary).toContain("disabled");
      expect(summary).toContain("unsupported platform");
      expect(summary).toContain("ffmpeg");
      expect(summary).toContain("API_KEY");
    });
  });

  describe("caching", () => {
    it("should cache binary check results when enabled", async () => {
      const cachingGating = new SkillGating({ cacheResults: true });

      // First check
      await cachingGating.checkBinary("node");

      // Verify cache has entry
      expect(cachingGating.binaryCache.has("node")).toBe(true);
    });

    it("should clear cache", async () => {
      const cachingGating = new SkillGating({ cacheResults: true });

      await cachingGating.checkBinary("node");
      expect(cachingGating.binaryCache.size).toBeGreaterThan(0);

      cachingGating.clearCache();
      expect(cachingGating.binaryCache.size).toBe(0);
    });
  });
});
