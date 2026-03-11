import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureInstinctsTable,
  recordInstinct,
  getInstincts,
  getStrongInstincts,
  deleteInstinct,
  resetInstincts,
  decayInstincts,
  generateInstinctPrompt,
  INSTINCT_CATEGORIES,
} from "../../src/lib/instinct-manager.js";

describe("Instinct Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureInstinctsTable ─────────────────────────────────────

  describe("ensureInstinctsTable", () => {
    it("should create instincts table", () => {
      ensureInstinctsTable(db);
      expect(db.tables.has("instincts")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureInstinctsTable(db);
      ensureInstinctsTable(db);
      expect(db.tables.has("instincts")).toBe(true);
    });
  });

  // ─── INSTINCT_CATEGORIES ─────────────────────────────────────

  describe("INSTINCT_CATEGORIES", () => {
    it("should have expected categories", () => {
      expect(INSTINCT_CATEGORIES.TOOL_PREFERENCE).toBe("tool_preference");
      expect(INSTINCT_CATEGORIES.CODING_STYLE).toBe("coding_style");
      expect(INSTINCT_CATEGORIES.RESPONSE_FORMAT).toBe("response_format");
      expect(INSTINCT_CATEGORIES.LANGUAGE).toBe("language");
      expect(INSTINCT_CATEGORIES.WORKFLOW).toBe("workflow");
      expect(INSTINCT_CATEGORIES.BEHAVIOR).toBe("behavior");
    });

    it("should have 6 categories", () => {
      expect(Object.keys(INSTINCT_CATEGORIES)).toHaveLength(6);
    });
  });

  // ─── recordInstinct ──────────────────────────────────────────

  describe("recordInstinct", () => {
    it("should create a new instinct", () => {
      const result = recordInstinct(
        db,
        "coding_style",
        "Prefers TypeScript over JavaScript",
      );
      expect(result.isNew).toBe(true);
      expect(result.confidence).toBe(0.5);
      expect(result.occurrences).toBe(1);
      expect(result.category).toBe("coding_style");
      expect(result.pattern).toBe("Prefers TypeScript over JavaScript");
    });

    it("should increment existing instinct", () => {
      recordInstinct(db, "tool_preference", "Uses write_file often");
      const result = recordInstinct(
        db,
        "tool_preference",
        "Uses write_file often",
      );
      expect(result.isNew).toBe(false);
      expect(result.occurrences).toBe(2);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should increase confidence asymptotically", () => {
      let inst;
      for (let i = 0; i < 10; i++) {
        inst = recordInstinct(db, "behavior", "Always asks for confirmation");
      }
      expect(inst.confidence).toBeGreaterThan(0.8);
      expect(inst.confidence).toBeLessThan(1.0);
    });

    it("should track different patterns separately", () => {
      recordInstinct(db, "language", "Responds in English");
      recordInstinct(db, "language", "Responds in Chinese");

      const instincts = getInstincts(db, { category: "language" });
      expect(instincts).toHaveLength(2);
    });
  });

  // ─── getInstincts ────────────────────────────────────────────

  describe("getInstincts", () => {
    it("should return all instincts", () => {
      recordInstinct(db, "coding_style", "Pattern A");
      recordInstinct(db, "behavior", "Pattern B");

      const all = getInstincts(db);
      expect(all).toHaveLength(2);
    });

    it("should filter by category", () => {
      recordInstinct(db, "coding_style", "Pattern A");
      recordInstinct(db, "behavior", "Pattern B");

      const filtered = getInstincts(db, { category: "coding_style" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].category).toBe("coding_style");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        recordInstinct(db, "behavior", `Pattern ${i}`);
      }

      const limited = getInstincts(db, { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("should return empty for no instincts", () => {
      ensureInstinctsTable(db);
      expect(getInstincts(db)).toHaveLength(0);
    });
  });

  // ─── getStrongInstincts ──────────────────────────────────────

  describe("getStrongInstincts", () => {
    it("should return only high-confidence instincts", () => {
      // Create a strong instinct by repeated recording
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "behavior", "Strong pattern");
      }
      recordInstinct(db, "behavior", "Weak pattern"); // Only 1 occurrence, conf=0.5

      const strong = getStrongInstincts(db, 0.7);
      expect(strong).toHaveLength(1);
      expect(strong[0].pattern).toBe("Strong pattern");
    });

    it("should return empty if no strong instincts", () => {
      recordInstinct(db, "behavior", "New pattern");
      expect(getStrongInstincts(db, 0.7)).toHaveLength(0);
    });
  });

  // ─── deleteInstinct ──────────────────────────────────────────

  describe("deleteInstinct", () => {
    it("should delete by ID prefix", () => {
      const inst = recordInstinct(db, "behavior", "To delete");
      const ok = deleteInstinct(db, inst.id.slice(0, 8));
      expect(ok).toBe(true);

      const remaining = getInstincts(db);
      expect(remaining).toHaveLength(0);
    });

    it("should return false for non-existent ID", () => {
      ensureInstinctsTable(db);
      expect(deleteInstinct(db, "nonexistent")).toBe(false);
    });
  });

  // ─── resetInstincts ──────────────────────────────────────────

  describe("resetInstincts", () => {
    it("should clear all instincts", () => {
      recordInstinct(db, "a", "Pattern 1");
      recordInstinct(db, "b", "Pattern 2");
      recordInstinct(db, "c", "Pattern 3");

      const count = resetInstincts(db);
      expect(count).toBe(3);
      expect(getInstincts(db)).toHaveLength(0);
    });

    it("should return 0 when already empty", () => {
      ensureInstinctsTable(db);
      expect(resetInstincts(db)).toBe(0);
    });
  });

  // ─── decayInstincts ──────────────────────────────────────────

  describe("decayInstincts", () => {
    it("should not decay recent instincts", () => {
      recordInstinct(db, "behavior", "Recent");
      const decayed = decayInstincts(db, 30);
      // Since the instinct was just created, it shouldn't be decayed
      expect(decayed).toBe(0);
    });

    it("should decay old instincts", () => {
      const inst = recordInstinct(db, "behavior", "Old pattern");
      // Manually set last_seen to old date
      const rows = db.data.get("instincts");
      const row = rows.find((r) => r.id === inst.id);
      if (row) row.last_seen = "2020-01-01 00:00:00";

      const decayed = decayInstincts(db, 1);
      expect(decayed).toBe(1);
    });
  });

  // ─── generateInstinctPrompt ──────────────────────────────────

  describe("generateInstinctPrompt", () => {
    it("should return empty string when no strong instincts", () => {
      ensureInstinctsTable(db);
      expect(generateInstinctPrompt(db)).toBe("");
    });

    it("should generate prompt from strong instincts", () => {
      // Build up strong instincts
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "coding_style", "Uses async/await");
      }

      const prompt = generateInstinctPrompt(db);
      expect(prompt).toContain("preferences");
      expect(prompt).toContain("coding_style");
      expect(prompt).toContain("async/await");
    });

    it("should include confidence percentage", () => {
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "workflow", "Prefers TDD");
      }

      const prompt = generateInstinctPrompt(db);
      expect(prompt).toMatch(/confidence: \d+%/);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle recording with same category but different patterns", () => {
      recordInstinct(db, "coding_style", "Uses semicolons");
      recordInstinct(db, "coding_style", "Prefers const over let");

      const all = getInstincts(db, { category: "coding_style" });
      expect(all).toHaveLength(2);
    });

    it("should decay confidence to minimum 0.1", () => {
      const inst = recordInstinct(db, "behavior", "Pattern");
      // Set very old date and low confidence
      const rows = db.data.get("instincts");
      const row = rows.find((r) => r.id === inst.id);
      if (row) {
        row.last_seen = "2010-01-01 00:00:00";
        row.confidence = 0.11;
      }

      decayInstincts(db, 1);
      const updated = getInstincts(db);
      expect(updated[0].confidence).toBeGreaterThanOrEqual(0.1);
    });
  });
});
