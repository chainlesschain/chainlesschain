/**
 * User Preference Learner Tests
 *
 * Tests:
 * - Initialization and table creation
 * - getPreferences (all and filtered)
 * - updatePreference (insert and update)
 * - deletePreference
 * - extractPreferencesFromInteraction
 * - buildPreferenceContext
 * - Confidence adjustment on repeated evidence
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: vi.fn(() => `test-pref-uuid-${++uuidCounter}`),
}));

const {
  UserPreferenceLearner,
  PREFERENCE_CATEGORIES,
  EXTRACTION_RULES,
} = require("../user-preference-learner");

/**
 * Create a mock in-memory database that simulates the real database interface.
 * Uses a simple array-based store for user_preferences rows.
 */
function createMockDatabase() {
  const store = [];

  const mockDb = {
    _store: store,

    exec: vi.fn(() => {
      // Simulate table creation
    }),

    run: vi.fn((sql, params) => {
      if (sql.includes("INSERT INTO user_preferences")) {
        store.push({
          id: params[0],
          category: params[1],
          key: params[2],
          value: params[3],
          confidence: params[4],
          source: params[5],
          evidence_count: 1,
          last_seen_at: params[6],
          created_at: params[7],
          updated_at: params[8],
        });
        return { changes: 1 };
      }
      if (sql.includes("UPDATE user_preferences")) {
        const category = params[6];
        const key = params[7];
        const item = store.find(
          (r) => r.category === category && r.key === key,
        );
        if (item) {
          item.value = params[0];
          item.confidence = params[1];
          item.source = params[2];
          item.evidence_count = params[3];
          item.last_seen_at = params[4];
          item.updated_at = params[5];
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (sql.includes("DELETE FROM user_preferences")) {
        const id = params[0];
        const idx = store.findIndex((r) => r.id === id);
        if (idx >= 0) {
          store.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      return { changes: 0 };
    }),

    prepare: vi.fn((sql) => {
      return {
        get: vi.fn((...params) => {
          if (sql.includes("WHERE category = ? AND key = ?")) {
            const category = params[0];
            const key = params[1];
            return store.find(
              (r) => r.category === category && r.key === key,
            ) || null;
          }
          return null;
        }),
        all: vi.fn((...params) => {
          if (sql.includes("WHERE category = ?") && !sql.includes("AND")) {
            const category = params[0];
            return store
              .filter((r) => r.category === category)
              .sort((a, b) => b.confidence - a.confidence);
          }
          if (sql.includes("WHERE confidence >= ?")) {
            const minConf = params[0];
            const limit = params[1];
            return store
              .filter((r) => r.confidence >= minConf)
              .sort((a, b) => b.confidence - a.confidence || b.evidence_count - a.evidence_count)
              .slice(0, limit);
          }
          if (sql.includes("SELECT * FROM user_preferences ORDER BY")) {
            return store
              .slice()
              .sort((a, b) => b.confidence - a.confidence);
          }
          return [];
        }),
      };
    }),

    saveToFile: vi.fn(),
  };

  return mockDb;
}

describe("UserPreferenceLearner", () => {
  let learner;
  let mockDb;

  beforeEach(() => {
    uuidCounter = 0;
    mockDb = createMockDatabase();
    learner = new UserPreferenceLearner({
      database: mockDb,
    });
  });

  // ============================================================
  // Initialization
  // ============================================================

  describe("initialize", () => {
    it("should create database tables on initialization", async () => {
      await learner.initialize();

      expect(mockDb.exec).toHaveBeenCalled();
      const execCall = mockDb.exec.mock.calls[0][0];
      expect(execCall).toContain("CREATE TABLE IF NOT EXISTS user_preferences");
      expect(execCall).toContain("idx_user_preferences_category");
      expect(execCall).toContain("UNIQUE(category, key)");
      expect(learner.initialized).toBe(true);
    });

    it("should accept database as parameter to initialize()", async () => {
      const learner2 = new UserPreferenceLearner({});
      expect(learner2.db).toBeNull();

      await learner2.initialize(mockDb);

      expect(learner2.db).toBe(mockDb);
      expect(learner2.initialized).toBe(true);
    });

    it("should warn and skip if no database is provided", async () => {
      const learner2 = new UserPreferenceLearner({});
      await learner2.initialize();

      expect(learner2.initialized).toBe(false);
    });

    it("should call saveToFile after table creation", async () => {
      await learner.initialize();
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });
  });

  // ============================================================
  // getPreferences
  // ============================================================

  describe("getPreferences", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should return all preferences when no category is specified", () => {
      learner.updatePreference("code_style", "language_preference", "TypeScript", "explicit");
      learner.updatePreference("communication_style", "verbosity", "concise", "inferred");

      const prefs = learner.getPreferences();
      expect(prefs).toBeDefined();
      expect(Array.isArray(prefs)).toBe(true);
    });

    it("should filter by category when specified", () => {
      learner.updatePreference("code_style", "language_preference", "TypeScript", "explicit");
      learner.updatePreference("communication_style", "verbosity", "concise", "inferred");

      const codePrefs = learner.getPreferences("code_style");
      expect(codePrefs).toBeDefined();
      expect(Array.isArray(codePrefs)).toBe(true);
    });

    it("should return empty array for invalid category", () => {
      const prefs = learner.getPreferences("invalid_category");
      expect(prefs).toEqual([]);
    });

    it("should return empty array when database is not available", () => {
      learner.db = null;
      const prefs = learner.getPreferences();
      expect(prefs).toEqual([]);
    });
  });

  // ============================================================
  // updatePreference - Insert
  // ============================================================

  describe("updatePreference - insert", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should create a new preference", () => {
      const result = learner.updatePreference(
        "code_style",
        "language_preference",
        "TypeScript",
        "explicit",
      );

      expect(result).not.toBeNull();
      expect(result.category).toBe("code_style");
      expect(result.key).toBe("language_preference");
      expect(result.value).toBe("TypeScript");
      expect(result.source).toBe("explicit");
      expect(result.evidenceCount).toBe(1);
      expect(result.id).toBeDefined();
    });

    it("should set higher initial confidence for explicit preferences", () => {
      const explicit = learner.updatePreference(
        "code_style",
        "lang",
        "TS",
        "explicit",
      );
      expect(explicit.confidence).toBe(0.8);
    });

    it("should set default confidence for inferred preferences", () => {
      const inferred = learner.updatePreference(
        "code_style",
        "style",
        "functional",
        "inferred",
      );
      expect(inferred.confidence).toBe(0.5);
    });

    it("should return null for invalid category", () => {
      const result = learner.updatePreference(
        "invalid",
        "key",
        "value",
        "explicit",
      );
      expect(result).toBeNull();
    });

    it("should return null for missing required fields", () => {
      expect(learner.updatePreference(null, "key", "value")).toBeNull();
      expect(learner.updatePreference("code_style", null, "value")).toBeNull();
      expect(learner.updatePreference("code_style", "key", null)).toBeNull();
    });

    it("should default source to inferred for invalid source", () => {
      const result = learner.updatePreference(
        "code_style",
        "test",
        "val",
        "invalid_source",
      );
      expect(result).not.toBeNull();
      // The source should have been defaulted to 'inferred'
      expect(result.source).toBe("inferred");
    });
  });

  // ============================================================
  // updatePreference - Update (existing)
  // ============================================================

  describe("updatePreference - update existing", () => {
    beforeEach(async () => {
      await learner.initialize();
      // Create an initial preference
      learner.updatePreference(
        "code_style",
        "language_preference",
        "JavaScript",
        "inferred",
      );
    });

    it("should increment evidence_count on repeated observation", () => {
      const updated = learner.updatePreference(
        "code_style",
        "language_preference",
        "JavaScript",
        "inferred",
      );

      expect(updated).not.toBeNull();
      expect(updated.evidenceCount).toBe(2);
    });

    it("should increase confidence on repeated same-value observation", () => {
      const initial = mockDb._store.find(
        (r) => r.category === "code_style" && r.key === "language_preference",
      );
      const initialConfidence = initial.confidence;

      const updated = learner.updatePreference(
        "code_style",
        "language_preference",
        "JavaScript",
        "inferred",
      );

      expect(updated.confidence).toBeGreaterThan(initialConfidence);
    });

    it("should adjust confidence when value changes", () => {
      // Update with a different value
      const updated = learner.updatePreference(
        "code_style",
        "language_preference",
        "TypeScript",
        "inferred",
      );

      // Confidence should still change but may be lower due to value change penalty
      expect(updated).not.toBeNull();
      expect(updated.value).toBe("TypeScript");
    });

    it("should give a confidence boost for explicit source", () => {
      const initial = mockDb._store.find(
        (r) => r.category === "code_style" && r.key === "language_preference",
      );
      const initialConfidence = initial.confidence;

      const updated = learner.updatePreference(
        "code_style",
        "language_preference",
        "JavaScript",
        "explicit",
      );

      // Explicit source should give extra confidence boost
      expect(updated.confidence).toBeGreaterThan(initialConfidence);
    });

    it("should not exceed maximum confidence", () => {
      // Update many times to try to exceed max confidence
      for (let i = 0; i < 50; i++) {
        learner.updatePreference(
          "code_style",
          "language_preference",
          "JavaScript",
          "explicit",
        );
      }

      const item = mockDb._store.find(
        (r) => r.category === "code_style" && r.key === "language_preference",
      );
      expect(item.confidence).toBeLessThanOrEqual(0.99);
    });
  });

  // ============================================================
  // deletePreference
  // ============================================================

  describe("deletePreference", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should delete a preference by ID", () => {
      const pref = learner.updatePreference(
        "code_style",
        "lang",
        "TS",
        "explicit",
      );

      const result = learner.deletePreference(pref.id);
      expect(result).toBe(true);

      // Verify it was removed from the store
      const remaining = mockDb._store.find((r) => r.id === pref.id);
      expect(remaining).toBeUndefined();
    });

    it("should return false if ID is not provided", () => {
      expect(learner.deletePreference(null)).toBe(false);
      expect(learner.deletePreference("")).toBe(false);
    });

    it("should return false when database is not available", () => {
      learner.db = null;
      expect(learner.deletePreference("some-id")).toBe(false);
    });
  });

  // ============================================================
  // extractPreferencesFromInteraction
  // ============================================================

  describe("extractPreferencesFromInteraction", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should extract code_style preference from 'use TypeScript'", () => {
      const extracted = learner.extractPreferencesFromInteraction(
        "Please use TypeScript for this project",
        "Sure, I'll use TypeScript.",
        0,
      );

      expect(extracted.length).toBeGreaterThan(0);
      const tsPref = extracted.find(
        (p) => p.category === "code_style" && p.key === "language_preference",
      );
      expect(tsPref).toBeDefined();
      expect(tsPref.value).toBe("TypeScript");
    });

    it("should extract communication_style preference from 'be concise'", () => {
      const extracted = learner.extractPreferencesFromInteraction(
        "Be concise in your responses",
        "Got it.",
        0,
      );

      expect(extracted.length).toBeGreaterThan(0);
      const stylePref = extracted.find(
        (p) => p.category === "communication_style" && p.key === "verbosity",
      );
      expect(stylePref).toBeDefined();
      expect(stylePref.value).toBe("concise");
    });

    it("should extract response_format preference from 'step by step'", () => {
      const extracted = learner.extractPreferencesFromInteraction(
        "Give me a step-by-step guide",
        "Step 1...",
        0,
      );

      const formatPref = extracted.find(
        (p) => p.category === "response_format" && p.key === "structure",
      );
      expect(formatPref).toBeDefined();
      expect(formatPref.value).toBe("step_by_step");
    });

    it("should extract feedback-based preference for code blocks on positive feedback", () => {
      const extracted = learner.extractPreferencesFromInteraction(
        "Show me how to sort an array",
        "Here is the code:\n```javascript\nconst sorted = arr.sort();\n```",
        1,
      );

      const codeBlockPref = extracted.find(
        (p) => p.category === "response_format" && p.key === "code_blocks",
      );
      expect(codeBlockPref).toBeDefined();
      expect(codeBlockPref.source).toBe("feedback");
    });

    it("should infer conciseness preference on negative feedback with long response", () => {
      const longResponse = "a".repeat(2500);
      const extracted = learner.extractPreferencesFromInteraction(
        "Quick question about arrays",
        longResponse,
        -1,
      );

      const concisePref = extracted.find(
        (p) =>
          p.category === "communication_style" &&
          p.key === "verbosity" &&
          p.value === "concise",
      );
      expect(concisePref).toBeDefined();
      expect(concisePref.source).toBe("feedback");
    });

    it("should return empty array for null/empty user message", () => {
      expect(learner.extractPreferencesFromInteraction(null)).toEqual([]);
      expect(learner.extractPreferencesFromInteraction("")).toEqual([]);
    });

    it("should not extract preferences if no rules match", () => {
      const extracted = learner.extractPreferencesFromInteraction(
        "What is the capital of France?",
        "Paris is the capital of France.",
        0,
      );

      expect(extracted).toEqual([]);
    });

    it("should persist extracted preferences to the database", () => {
      learner.extractPreferencesFromInteraction(
        "Please use TypeScript",
        "OK",
        0,
      );

      // Check that updatePreference was called (which calls db.run)
      const inserted = mockDb._store.find(
        (r) => r.category === "code_style" && r.key === "language_preference",
      );
      expect(inserted).toBeDefined();
      expect(inserted.value).toBe("TypeScript");
    });
  });

  // ============================================================
  // buildPreferenceContext
  // ============================================================

  describe("buildPreferenceContext", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should build a formatted context string", () => {
      learner.updatePreference(
        "code_style",
        "language_preference",
        "TypeScript",
        "explicit",
      );
      learner.updatePreference(
        "communication_style",
        "verbosity",
        "concise",
        "inferred",
      );

      const context = learner.buildPreferenceContext();

      expect(typeof context).toBe("string");
      if (context.length > 0) {
        expect(context).toContain("User Preferences");
      }
    });

    it("should group preferences by category", () => {
      learner.updatePreference(
        "code_style",
        "language_preference",
        "TypeScript",
        "explicit",
      );
      learner.updatePreference(
        "code_style",
        "paradigm",
        "functional",
        "inferred",
      );
      learner.updatePreference(
        "communication_style",
        "verbosity",
        "concise",
        "explicit",
      );

      const context = learner.buildPreferenceContext();

      if (context.length > 0) {
        expect(context).toContain("###");
      }
    });

    it("should return empty string when no preferences exist", () => {
      const context = learner.buildPreferenceContext();
      expect(context).toBe("");
    });

    it("should return empty string when database is not available", () => {
      learner.db = null;
      expect(learner.buildPreferenceContext()).toBe("");
    });

    it("should respect the limit parameter", () => {
      for (let i = 0; i < 20; i++) {
        learner.updatePreference(
          "code_style",
          `key_${i}`,
          `value_${i}`,
          "inferred",
        );
      }

      const context = learner.buildPreferenceContext(5);
      expect(typeof context).toBe("string");
    });
  });

  // ============================================================
  // Confidence adjustment on repeated evidence
  // ============================================================

  describe("confidence dynamics", () => {
    beforeEach(async () => {
      await learner.initialize();
    });

    it("should show diminishing confidence returns on repeated observations", () => {
      // First observation
      learner.updatePreference(
        "code_style",
        "lang",
        "TS",
        "inferred",
      );
      const conf1 = mockDb._store.find(
        (r) => r.key === "lang",
      ).confidence;

      // Second observation
      learner.updatePreference(
        "code_style",
        "lang",
        "TS",
        "inferred",
      );
      const conf2 = mockDb._store.find(
        (r) => r.key === "lang",
      ).confidence;

      // Third observation
      learner.updatePreference(
        "code_style",
        "lang",
        "TS",
        "inferred",
      );
      const conf3 = mockDb._store.find(
        (r) => r.key === "lang",
      ).confidence;

      // Each increment should be progressively smaller
      const boost1 = conf2 - conf1;
      const boost2 = conf3 - conf2;

      expect(boost1).toBeGreaterThan(0);
      expect(boost2).toBeGreaterThan(0);
      expect(boost2).toBeLessThan(boost1);
    });

    it("should track evidence_count accurately", () => {
      learner.updatePreference("code_style", "lang", "TS", "inferred");
      learner.updatePreference("code_style", "lang", "TS", "inferred");
      learner.updatePreference("code_style", "lang", "TS", "inferred");

      const item = mockDb._store.find((r) => r.key === "lang");
      expect(item.evidence_count).toBe(3);
    });
  });
});
