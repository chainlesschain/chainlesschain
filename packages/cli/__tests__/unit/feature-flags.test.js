import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock config-manager before importing feature-flags
let mockConfig = {};
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => mockConfig,
  getConfigValue: (key) => {
    const parts = key.split(".");
    let current = mockConfig;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  },
  saveConfig: (config) => {
    mockConfig = config;
  },
}));

const { feature, featureVariant, listFeatures, setFeature, getFlagInfo } =
  await import("../../src/lib/feature-flags.js");

describe("feature-flags", () => {
  const savedEnv = {};

  beforeEach(() => {
    mockConfig = { features: {} };
    // Clear any CC_FLAG_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CC_FLAG_")) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      process.env[key] = val;
    }
  });

  // ── feature() ──

  describe("feature()", () => {
    it("returns default false for known flags with no config", () => {
      expect(feature("CONTEXT_SNIP")).toBe(false);
      expect(feature("BACKGROUND_TASKS")).toBe(false);
      expect(feature("WORKTREE_ISOLATION")).toBe(false);
    });

    it("returns default true for PROMPT_COMPRESSOR", () => {
      expect(feature("PROMPT_COMPRESSOR")).toBe(true);
    });

    it("returns false for unknown flags", () => {
      expect(feature("NONEXISTENT_FLAG")).toBe(false);
    });

    it("reads boolean true from config", () => {
      mockConfig.features.CONTEXT_SNIP = true;
      expect(feature("CONTEXT_SNIP")).toBe(true);
    });

    it("reads boolean false from config", () => {
      mockConfig.features.PROMPT_COMPRESSOR = false;
      expect(feature("PROMPT_COMPRESSOR")).toBe(false);
    });

    it("handles object-style flag with enabled field", () => {
      mockConfig.features.CONTEXT_SNIP = {
        enabled: true,
        variant: "aggressive",
      };
      expect(feature("CONTEXT_SNIP")).toBe(true);
    });

    it("handles object-style flag with enabled=false", () => {
      mockConfig.features.CONTEXT_SNIP = {
        enabled: false,
        variant: "off",
      };
      expect(feature("CONTEXT_SNIP")).toBe(false);
    });

    it("env var overrides config (true)", () => {
      mockConfig.features.CONTEXT_SNIP = false;
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      expect(feature("CONTEXT_SNIP")).toBe(true);
    });

    it("env var overrides config (false)", () => {
      mockConfig.features.PROMPT_COMPRESSOR = true;
      process.env.CC_FLAG_PROMPT_COMPRESSOR = "false";
      expect(feature("PROMPT_COMPRESSOR")).toBe(false);
    });

    it("env var supports 1/0", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "1";
      expect(feature("CONTEXT_SNIP")).toBe(true);
      process.env.CC_FLAG_CONTEXT_SNIP = "0";
      expect(feature("CONTEXT_SNIP")).toBe(false);
    });
  });

  // ── percentage rollout ──

  describe("percentage rollout", () => {
    it("returns false for 0 percent", () => {
      mockConfig.features.CONTEXT_SNIP = 0;
      expect(feature("CONTEXT_SNIP")).toBe(false);
    });

    it("returns true for 100 percent", () => {
      mockConfig.features.CONTEXT_SNIP = 100;
      expect(feature("CONTEXT_SNIP")).toBe(true);
    });

    it("returns consistent result for same flag (deterministic hash)", () => {
      mockConfig.features.CONTEXT_SNIP = 50;
      const result1 = feature("CONTEXT_SNIP");
      const result2 = feature("CONTEXT_SNIP");
      expect(result1).toBe(result2);
    });
  });

  // ── featureVariant() ──

  describe("featureVariant()", () => {
    it("returns null for boolean flags", () => {
      mockConfig.features.CONTEXT_SNIP = true;
      expect(featureVariant("CONTEXT_SNIP")).toBeNull();
    });

    it("returns variant from object flag", () => {
      mockConfig.features.CONTEXT_SNIP = {
        enabled: true,
        variant: "aggressive",
      };
      expect(featureVariant("CONTEXT_SNIP")).toBe("aggressive");
    });

    it("returns null for missing flags", () => {
      expect(featureVariant("NONEXISTENT")).toBeNull();
    });
  });

  // ── listFeatures() ──

  describe("listFeatures()", () => {
    it("lists all known registry flags", () => {
      const flags = listFeatures();
      const names = flags.map((f) => f.name);
      expect(names).toContain("BACKGROUND_TASKS");
      expect(names).toContain("WORKTREE_ISOLATION");
      expect(names).toContain("CONTEXT_SNIP");
      expect(names).toContain("CONTEXT_COLLAPSE");
      expect(names).toContain("JSONL_SESSION");
      expect(names).toContain("PROMPT_COMPRESSOR");
    });

    it("includes source=default for unconfigured flags", () => {
      const flags = listFeatures();
      const snip = flags.find((f) => f.name === "CONTEXT_SNIP");
      expect(snip.source).toBe("default");
      expect(snip.enabled).toBe(false);
    });

    it("includes source=config for configured flags", () => {
      mockConfig.features.CONTEXT_SNIP = true;
      const flags = listFeatures();
      const snip = flags.find((f) => f.name === "CONTEXT_SNIP");
      expect(snip.source).toBe("config");
      expect(snip.enabled).toBe(true);
    });

    it("includes source=env for env-overridden flags", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      const flags = listFeatures();
      const snip = flags.find((f) => f.name === "CONTEXT_SNIP");
      expect(snip.source).toBe("env");
    });

    it("includes user-defined flags from config", () => {
      mockConfig.features.MY_CUSTOM_FLAG = true;
      const flags = listFeatures();
      const custom = flags.find((f) => f.name === "MY_CUSTOM_FLAG");
      expect(custom).toBeDefined();
      expect(custom.enabled).toBe(true);
      expect(custom.description).toBe("(user-defined)");
    });

    it("each flag has description", () => {
      const flags = listFeatures();
      for (const f of flags) {
        expect(typeof f.description).toBe("string");
        expect(f.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ── setFeature() ──

  describe("setFeature()", () => {
    it("sets a flag to true", () => {
      setFeature("CONTEXT_SNIP", true);
      expect(mockConfig.features.CONTEXT_SNIP).toBe(true);
    });

    it("sets a flag to false", () => {
      mockConfig.features.CONTEXT_SNIP = true;
      setFeature("CONTEXT_SNIP", false);
      expect(mockConfig.features.CONTEXT_SNIP).toBe(false);
    });

    it("sets a percentage value", () => {
      setFeature("CONTEXT_SNIP", 50);
      expect(mockConfig.features.CONTEXT_SNIP).toBe(50);
    });
  });

  // ── getFlagInfo() ──

  describe("getFlagInfo()", () => {
    it("returns info for known flags", () => {
      const info = getFlagInfo("CONTEXT_SNIP");
      expect(info).toBeDefined();
      expect(info.description).toContain("snipCompact");
      expect(typeof info.default).toBe("boolean");
    });

    it("returns null for unknown flags", () => {
      expect(getFlagInfo("NONEXISTENT")).toBeNull();
    });
  });
});
