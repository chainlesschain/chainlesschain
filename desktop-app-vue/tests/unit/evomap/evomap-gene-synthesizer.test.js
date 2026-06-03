/**
 * Unit tests for EvoMapGeneSynthesizer
 * @module evomap/evomap-gene-synthesizer.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let EvoMapGeneSynthesizer, getEvoMapGeneSynthesizer;

describe("EvoMapGeneSynthesizer", () => {
  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));

    const mod =
      await import("../../../src/main/evomap/evomap-gene-synthesizer.js");
    EvoMapGeneSynthesizer = mod.EvoMapGeneSynthesizer;
    getEvoMapGeneSynthesizer = mod.getEvoMapGeneSynthesizer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Constructor & Initialize
  // ============================================================

  describe("constructor", () => {
    it("should initialize with null fields", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.db).toBeNull();
      expect(synth.initialized).toBe(false);
    });
  });

  describe("initialize()", () => {
    it("should set dependencies and mark initialized", async () => {
      const synth = new EvoMapGeneSynthesizer();
      await synth.initialize({}, {}, {});
      expect(synth.initialized).toBe(true);
    });

    it("should skip if already initialized", async () => {
      const synth = new EvoMapGeneSynthesizer();
      await synth.initialize({}, {});
      await synth.initialize({}, {}); // no-op
      expect(synth.initialized).toBe(true);
    });
  });

  describe("setConfig()", () => {
    it("should cache the config", () => {
      const synth = new EvoMapGeneSynthesizer();
      synth.setConfig({ test: true });
      expect(synth._configCache).toEqual({ test: true });
    });
  });

  // ============================================================
  // synthesizeFromInstinct
  // ============================================================

  describe("synthesizeFromInstinct()", () => {
    it("should create Gene+Capsule+EvolutionEvent", () => {
      const synth = new EvoMapGeneSynthesizer();
      const instinct = {
        pattern: "Use async/await instead of callbacks",
        category: "coding-pattern",
        confidence: 0.85,
        use_count: 12,
      };

      const { gene, capsule, evolutionEvent } =
        synth.synthesizeFromInstinct(instinct);

      expect(gene.type).toBe("Gene");
      expect(gene.category).toBe("optimize");
      expect(gene.summary).toContain("async");
      expect(gene.asset_id).toMatch(/^sha256:/);

      expect(capsule.type).toBe("Capsule");
      expect(capsule.parent_gene_id).toBe(gene.asset_id);
      expect(capsule.confidence).toBe(0.85);
      expect(capsule.success_streak).toBe(12);

      expect(evolutionEvent.type).toBe("EvolutionEvent");
      expect(evolutionEvent.event_type).toBe("instinct_matured");
      expect(evolutionEvent.related_assets).toContain(gene.asset_id);
    });

    it("should throw on null instinct", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(() => synth.synthesizeFromInstinct(null)).toThrow(
        "Invalid instinct",
      );
    });

    it("should throw on missing pattern", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(() => synth.synthesizeFromInstinct({ category: "test" })).toThrow(
        "missing pattern",
      );
    });

    it("should handle JSON string examples", () => {
      const synth = new EvoMapGeneSynthesizer();
      const instinct = {
        pattern: "Test pattern",
        examples: JSON.stringify(["example1", "example2"]),
      };
      const { gene } = synth.synthesizeFromInstinct(instinct);
      expect(gene.strategy.examples).toHaveLength(2);
    });

    it("should default category to optimize", () => {
      const synth = new EvoMapGeneSynthesizer();
      const instinct = { pattern: "test", category: "unknown-category" };
      const { gene } = synth.synthesizeFromInstinct(instinct);
      expect(gene.category).toBe("optimize");
    });
  });

  // ============================================================
  // synthesizeFromDecision
  // ============================================================

  describe("synthesizeFromDecision()", () => {
    it("should create Gene+Capsule+EvolutionEvent", () => {
      const synth = new EvoMapGeneSynthesizer();
      const decision = {
        context: "Database choice for caching layer",
        outcome: "Use Redis",
        rationale: "Better data structures",
        source: "voting",
        success_rate: 0.92,
        apply_count: 8,
      };

      const { gene, capsule, evolutionEvent } =
        synth.synthesizeFromDecision(decision);

      expect(gene.type).toBe("Gene");
      expect(gene.summary).toContain("Decision");
      expect(capsule.confidence).toBe(0.92);
      expect(capsule.success_streak).toBe(8);
      expect(evolutionEvent.event_type).toBe("decision_validated");
    });

    it("should throw on null decision", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(() => synth.synthesizeFromDecision(null)).toThrow();
    });

    it("should handle decision with chosen_option field", () => {
      const synth = new EvoMapGeneSynthesizer();
      const decision = {
        description: "Cache strategy",
        chosen_option: "Redis with TTL",
      };
      const { gene } = synth.synthesizeFromDecision(decision);
      expect(gene.summary).toBeDefined();
    });
  });

  // ============================================================
  // synthesizeRecipeFromWorkflow
  // ============================================================

  describe("synthesizeRecipeFromWorkflow()", () => {
    it("should create recipe from workflow template", () => {
      const synth = new EvoMapGeneSynthesizer();
      const template = {
        id: "bugfix",
        name: "Bug Fix Workflow",
        steps: [
          { role: "investigator", description: "Investigate" },
          { role: "fixer", description: "Fix it" },
        ],
      };
      const history = [{ success: true }, { success: false }];

      const recipe = synth.synthesizeRecipeFromWorkflow(template, history);

      expect(recipe.type).toBe("Gene");
      expect(recipe.category).toBe("innovate");
      expect(recipe.strategy.steps).toHaveLength(2);
      expect(recipe.strategy.success_rate).toBe(0.5);
    });

    it("should throw on null template", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(() => synth.synthesizeRecipeFromWorkflow(null)).toThrow();
    });

    it("should handle status field for success detection", () => {
      const synth = new EvoMapGeneSynthesizer();
      const template = { id: "t", name: "T", steps: [] };
      const history = [
        { status: "success" },
        { status: "failed" },
        { status: "success" },
      ];
      const recipe = synth.synthesizeRecipeFromWorkflow(template, history);
      expect(recipe.strategy.success_rate).toBeCloseTo(2 / 3);
    });
  });

  // ============================================================
  // synthesizeFromSkill
  // ============================================================

  describe("synthesizeFromSkill()", () => {
    it("should create Gene+Capsule from skill", () => {
      const synth = new EvoMapGeneSynthesizer();
      const skill = {
        name: "review-code",
        description: "Code review skill",
        instructions: "Review the code thoroughly",
        tools: ["read", "grep"],
        version: "1.0.0",
      };

      const { gene, capsule } = synth.synthesizeFromSkill(skill);

      expect(gene.type).toBe("Gene");
      expect(gene.category).toBe("innovate");
      expect(gene.summary).toContain("Skill");
      expect(gene.strategy.tools).toEqual(["read", "grep"]);

      expect(capsule.type).toBe("Capsule");
      expect(capsule.parent_gene_id).toBe(gene.asset_id);
    });

    it("should throw on null skill", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(() => synth.synthesizeFromSkill(null)).toThrow();
    });
  });

  // ============================================================
  // Privacy Filter
  // ============================================================

  describe("_applyPrivacyFilter()", () => {
    it("should return empty string for null input", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._applyPrivacyFilter(null)).toBe("");
      expect(synth._applyPrivacyFilter(undefined)).toBe("");
    });

    it("should return empty string for non-string input", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._applyPrivacyFilter(123)).toBe("");
    });

    it("should redact API keys", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._applyPrivacyFilter(
        "Use api_key: sk-abc123456789 for auth",
      );
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("sk-abc123456789");
    });

    it("should redact Bearer tokens", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._applyPrivacyFilter(
        "Authorization: Bearer eyJhbGciOiJIUz",
      );
      expect(result).toContain("[REDACTED]");
    });

    it("should anonymize file paths", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._applyPrivacyFilter(
        "File at /home/user/project/src/main.js",
      );
      expect(result).not.toContain("/home/user");
    });

    it("should anonymize email addresses", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._applyPrivacyFilter(
        "Contact john@example.com for help",
      );
      expect(result).not.toContain("john@example.com");
      expect(result).toContain("<email>");
    });

    it("should apply custom exclude patterns", () => {
      const synth = new EvoMapGeneSynthesizer();
      synth.setConfig({
        privacyFilter: {
          excludePatterns: ["secret-project-\\w+"],
        },
      });
      const result = synth._applyPrivacyFilter(
        "Working on secret-project-alpha",
      );
      expect(result).toContain("[EXCLUDED]");
    });

    it("should handle invalid custom regex gracefully", () => {
      const synth = new EvoMapGeneSynthesizer();
      synth.setConfig({
        privacyFilter: {
          excludePatterns: ["[invalid-regex"],
        },
      });
      // Should not throw
      const result = synth._applyPrivacyFilter("test content");
      expect(result).toBe("test content");
    });

    it("should skip anonymization when disabled", () => {
      const synth = new EvoMapGeneSynthesizer();
      synth.setConfig({ privacyFilter: { anonymize: false } });
      const result = synth._applyPrivacyFilter("Contact john@example.com");
      // Email NOT stripped since anonymize is false
      expect(result).toContain("john@example.com");
    });
  });

  // ============================================================
  // containsSecrets
  // ============================================================

  describe("containsSecrets()", () => {
    it("should detect API keys", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.containsSecrets("api_key: abc123")).toBe(true);
    });

    it("should detect Bearer tokens", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.containsSecrets("Bearer eyJhbGciOiJIUz")).toBe(true);
    });

    it("should detect GitHub tokens", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(
        synth.containsSecrets("ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
      ).toBe(true);
    });

    it("should detect private keys", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.containsSecrets("-----BEGIN PRIVATE KEY-----")).toBe(true);
    });

    it("should detect sk- tokens", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.containsSecrets("sk-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    });

    it("should return false for clean content", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(
        synth.containsSecrets("Use async/await for better readability"),
      ).toBe(false);
    });

    it("should return false for null", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth.containsSecrets(null)).toBe(false);
    });
  });

  // ============================================================
  // _extractSignals
  // ============================================================

  describe("_extractSignals()", () => {
    it("should extract keywords of 3+ chars", () => {
      const synth = new EvoMapGeneSynthesizer();
      const signals = synth._extractSignals(
        "Use async await for database queries",
      );
      expect(signals).toContain("async");
      expect(signals).toContain("await");
      expect(signals).toContain("database");
      expect(signals).toContain("queries");
    });

    it("should filter stop words", () => {
      const synth = new EvoMapGeneSynthesizer();
      const signals = synth._extractSignals("the and for that this");
      expect(signals).toHaveLength(0);
    });

    it("should deduplicate", () => {
      const synth = new EvoMapGeneSynthesizer();
      const signals = synth._extractSignals("async async async");
      expect(signals).toEqual(["async"]);
    });

    it("should return max 10", () => {
      const synth = new EvoMapGeneSynthesizer();
      const text = Array.from({ length: 20 }, (_, i) => `keyword${i}`).join(
        " ",
      );
      const signals = synth._extractSignals(text);
      expect(signals.length).toBeLessThanOrEqual(10);
    });

    it("should return empty for null", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._extractSignals(null)).toEqual([]);
    });
  });

  // ============================================================
  // _mapInstinctCategoryToGene
  // ============================================================

  describe("_mapInstinctCategoryToGene()", () => {
    it("should map error-fix to repair", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._mapInstinctCategoryToGene("error-fix")).toBe("repair");
    });

    it("should map coding-pattern to optimize", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._mapInstinctCategoryToGene("coding-pattern")).toBe(
        "optimize",
      );
    });

    it("should map workflow to innovate", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._mapInstinctCategoryToGene("workflow")).toBe("innovate");
    });

    it("should map testing to innovate", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._mapInstinctCategoryToGene("testing")).toBe("innovate");
    });

    it("should default to optimize for unknown", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._mapInstinctCategoryToGene("unknown")).toBe("optimize");
    });
  });

  // ============================================================
  // _sanitizeExamples
  // ============================================================

  describe("_sanitizeExamples()", () => {
    it("should parse JSON string", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._sanitizeExamples(JSON.stringify(["a", "b"]));
      expect(result).toHaveLength(2);
    });

    it("should handle array input", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._sanitizeExamples(["a", "b"]);
      expect(result).toHaveLength(2);
    });

    it("should return empty for invalid JSON", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._sanitizeExamples("not-json")).toEqual([]);
    });

    it("should return empty for non-array", () => {
      const synth = new EvoMapGeneSynthesizer();
      expect(synth._sanitizeExamples(JSON.stringify({ a: 1 }))).toEqual([]);
    });

    it("should limit to 5 examples", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._sanitizeExamples(
        Array.from({ length: 10 }, (_, i) => `ex${i}`),
      );
      expect(result).toHaveLength(5);
    });

    it("should apply privacy filter to examples", () => {
      const synth = new EvoMapGeneSynthesizer();
      const result = synth._sanitizeExamples([
        "Use api_key: sk-secret12345678901234 here",
      ]);
      expect(result[0]).toContain("[REDACTED]");
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("getEvoMapGeneSynthesizer()", () => {
    it("should return a singleton", () => {
      const instance = getEvoMapGeneSynthesizer();
      expect(instance).toBeInstanceOf(EvoMapGeneSynthesizer);
    });
  });
});
