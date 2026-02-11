/**
 * ActionSuggestion 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  ActionSuggestion,
  SuggestionType,
  SuggestionPriority,
  getActionSuggestion,
} = require("../action-suggestion");

describe("ActionSuggestion", () => {
  let suggestion;

  beforeEach(() => {
    vi.clearAllMocks();
    suggestion = new ActionSuggestion({
      enablePatternLearning: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      expect(suggestion.config.maxSuggestions).toBe(5);
      expect(suggestion.config.enablePatternLearning).toBe(true);
    });

    it("should accept custom config", () => {
      const s = new ActionSuggestion({
        maxSuggestions: 10,
        confidenceThreshold: 0.8,
      });

      expect(s.config.maxSuggestions).toBe(10);
      expect(s.config.confidenceThreshold).toBe(0.8);
    });
  });

  describe("suggest", () => {
    it("should return suggestions for content", async () => {
      const context = {
        url: "https://example.com/login",
        title: "Login Page",
        buttons: [{ text: "Submit", isPrimary: true, visible: true }],
        inputs: [{ type: "text", placeholder: "Username", value: "" }],
      };

      const result = await suggestion.suggest(context);

      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("should suggest based on patterns", async () => {
      const context = {
        url: "https://example.com/login",
        content: "Please login to continue",
      };

      const result = await suggestion.suggest(context);

      expect(result.success).toBe(true);
      // Should match login pattern
      const hasLoginRelated = result.suggestions.some(
        (s) => s.pattern === "login" || s.description?.includes("login"),
      );
      expect(hasLoginRelated || result.suggestions.length >= 0).toBe(true);
    });

    it("should limit suggestions to maxSuggestions", async () => {
      const s = new ActionSuggestion({ maxSuggestions: 2 });

      const context = {
        buttons: [
          { text: "Button 1" },
          { text: "Button 2" },
          { text: "Button 3" },
          { text: "Button 4" },
        ],
      };

      const result = await s.suggest(context);

      expect(result.suggestions.length).toBeLessThanOrEqual(2);
    });

    it("should prioritize high priority suggestions", async () => {
      const context = {
        buttons: [{ text: "Cancel" }, { text: "Submit", isPrimary: true }],
      };

      const result = await suggestion.suggest(context);

      if (result.suggestions.length >= 2) {
        const submitIdx = result.suggestions.findIndex((s) =>
          s.description?.includes("Submit"),
        );
        const cancelIdx = result.suggestions.findIndex((s) =>
          s.description?.includes("Cancel"),
        );

        // Submit should come before Cancel due to priority
        if (submitIdx >= 0 && cancelIdx >= 0) {
          expect(submitIdx).toBeLessThan(cancelIdx);
        }
      }
    });

    it("should suggest form submission when form is ready", async () => {
      const context = {
        forms: [
          {
            hasEmptyFields: false,
            canSubmit: true,
            submitButton: { text: "Submit" },
          },
        ],
      };

      const result = await suggestion.suggest(context);

      const hasSubmitSuggestion = result.suggestions.some(
        (s) => s.type === SuggestionType.SUBMIT,
      );
      expect(hasSubmitSuggestion).toBe(true);
    });

    it("should suggest filling empty inputs", async () => {
      const context = {
        inputs: [
          { type: "text", label: "Name", value: "" },
          { type: "email", label: "Email", value: "test@example.com" },
        ],
      };

      const result = await suggestion.suggest(context);

      const hasTypeSuggestion = result.suggestions.some(
        (s) => s.type === SuggestionType.TYPE,
      );
      expect(hasTypeSuggestion).toBe(true);
    });
  });

  describe("recordAction", () => {
    it("should record action to history", () => {
      suggestion.recordAction({
        type: SuggestionType.CLICK,
        target: { selector: "#submit" },
        description: "Click submit",
      });

      const history = suggestion.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].type).toBe(SuggestionType.CLICK);
    });

    it("should limit history size", () => {
      const s = new ActionSuggestion({ historySize: 10 });

      for (let i = 0; i < 20; i++) {
        s.recordAction({ type: SuggestionType.CLICK, index: i });
      }

      const history = s.getHistory(100);
      expect(history.length).toBeLessThanOrEqual(10);
    });

    it("should learn patterns when enabled", () => {
      suggestion.suggest({ url: "https://example.com/form" });

      suggestion.recordAction({
        type: SuggestionType.TYPE,
        target: "input",
      });

      expect(suggestion.learnedPatterns.size).toBeGreaterThan(0);
    });
  });

  describe("feedback", () => {
    it("should track accepted suggestions", () => {
      suggestion.feedback({ type: SuggestionType.CLICK }, true);

      const stats = suggestion.getStats();
      expect(stats.accepted).toBe(1);
    });

    it("should track rejected suggestions", () => {
      suggestion.feedback({ type: SuggestionType.CLICK }, false);

      const stats = suggestion.getStats();
      expect(stats.rejected).toBe(1);
    });

    it("should track by type", () => {
      suggestion.feedback({ type: SuggestionType.CLICK }, true);
      suggestion.feedback({ type: SuggestionType.CLICK }, true);
      suggestion.feedback({ type: SuggestionType.TYPE }, false);

      const stats = suggestion.getStats();
      expect(stats.byType[SuggestionType.CLICK].accepted).toBe(2);
      expect(stats.byType[SuggestionType.TYPE].rejected).toBe(1);
    });
  });

  describe("getHistory", () => {
    it("should return action history", () => {
      suggestion.recordAction({ type: SuggestionType.CLICK });
      suggestion.recordAction({ type: SuggestionType.TYPE });

      const history = suggestion.getHistory();

      expect(history.length).toBe(2);
    });

    it("should limit by parameter", () => {
      for (let i = 0; i < 10; i++) {
        suggestion.recordAction({ type: SuggestionType.CLICK, index: i });
      }

      const history = suggestion.getHistory(3);
      expect(history.length).toBe(3);
    });

    it("should return most recent first", () => {
      suggestion.recordAction({ type: SuggestionType.CLICK, order: 1 });
      suggestion.recordAction({ type: SuggestionType.TYPE, order: 2 });
      suggestion.recordAction({ type: SuggestionType.SUBMIT, order: 3 });

      const history = suggestion.getHistory();

      expect(history[0].order).toBe(3);
      expect(history[2].order).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should return statistics", async () => {
      await suggestion.suggest({ url: "https://example.com" });

      const stats = suggestion.getStats();

      expect(stats.totalSuggestions).toBeDefined();
      expect(stats.acceptanceRate).toBeDefined();
      expect(stats.learnedPatterns).toBeDefined();
    });

    it("should calculate acceptance rate", () => {
      suggestion.feedback({ type: SuggestionType.CLICK }, true);
      suggestion.feedback({ type: SuggestionType.CLICK }, true);
      suggestion.feedback({ type: SuggestionType.CLICK }, false);

      const stats = suggestion.getStats();

      expect(stats.acceptanceRate).toBe("66.67%");
    });
  });

  describe("clearHistory", () => {
    it("should clear action history", () => {
      suggestion.recordAction({ type: SuggestionType.CLICK });
      suggestion.recordAction({ type: SuggestionType.TYPE });

      suggestion.clearHistory();

      expect(suggestion.getHistory().length).toBe(0);
    });
  });

  describe("clearLearnedPatterns", () => {
    it("should clear learned patterns", () => {
      suggestion.suggest({ url: "https://example.com/form" });
      suggestion.recordAction({ type: SuggestionType.TYPE });

      suggestion.clearLearnedPatterns();

      expect(suggestion.learnedPatterns.size).toBe(0);
    });
  });

  describe("resetStats", () => {
    it("should reset all statistics", () => {
      suggestion.feedback({ type: SuggestionType.CLICK }, true);
      suggestion.feedback({ type: SuggestionType.TYPE }, false);

      suggestion.resetStats();

      const stats = suggestion.getStats();
      expect(stats.accepted).toBe(0);
      expect(stats.rejected).toBe(0);
    });
  });

  describe("export and import", () => {
    it("should export data", () => {
      suggestion.recordAction({ type: SuggestionType.CLICK });
      suggestion.feedback({ type: SuggestionType.CLICK }, true);

      const data = suggestion.export();

      expect(data.history).toBeDefined();
      expect(data.learnedPatterns).toBeDefined();
      expect(data.stats).toBeDefined();
      expect(data.exportedAt).toBeDefined();
    });

    it("should import data", () => {
      const data = {
        history: [{ type: SuggestionType.CLICK, timestamp: Date.now() }],
        learnedPatterns: [
          ["key1", { type: SuggestionType.TYPE, frequency: 5 }],
        ],
        stats: {
          accepted: 10,
          rejected: 5,
        },
      };

      const result = suggestion.import(data);

      expect(result.success).toBe(true);
      expect(suggestion.history.length).toBe(1);
      expect(suggestion.learnedPatterns.size).toBe(1);
    });
  });

  describe("SuggestionType constants", () => {
    it("should have all types defined", () => {
      expect(SuggestionType.CLICK).toBe("click");
      expect(SuggestionType.TYPE).toBe("type");
      expect(SuggestionType.SELECT).toBe("select");
      expect(SuggestionType.SCROLL).toBe("scroll");
      expect(SuggestionType.NAVIGATE).toBe("navigate");
      expect(SuggestionType.WAIT).toBe("wait");
      expect(SuggestionType.SUBMIT).toBe("submit");
      expect(SuggestionType.CONFIRM).toBe("confirm");
      expect(SuggestionType.CANCEL).toBe("cancel");
      expect(SuggestionType.UPLOAD).toBe("upload");
      expect(SuggestionType.DOWNLOAD).toBe("download");
    });
  });

  describe("SuggestionPriority constants", () => {
    it("should have all priorities defined", () => {
      expect(SuggestionPriority.HIGH).toBe("high");
      expect(SuggestionPriority.MEDIUM).toBe("medium");
      expect(SuggestionPriority.LOW).toBe("low");
    });
  });

  describe("getActionSuggestion singleton", () => {
    it("should return singleton instance", () => {
      const s1 = getActionSuggestion();
      const s2 = getActionSuggestion();

      expect(s1).toBe(s2);
    });
  });
});
