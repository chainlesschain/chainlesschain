import { describe, it, expect } from "vitest";
import {
  calculateMatchScore,
  escapeRegExp,
  highlightText,
  getMessageCategory,
  getRoleName,
  getTypeName,
  getTypeColor,
  formatTime,
} from "@renderer/components/projects/conversationSearchPanelUtils";

describe("projects/conversationSearchPanelUtils", () => {
  describe("calculateMatchScore", () => {
    it("scores by match quality", () => {
      expect(calculateMatchScore("hello", "hello")).toBe(100);
      expect(calculateMatchScore("hello world", "hello")).toBe(80);
      expect(calculateMatchScore("foo bar baz", "bar")).toBe(60);
      expect(calculateMatchScore("xxhelloxx", "hello")).toBe(30);
      expect(calculateMatchScore("nothing here", "zzz")).toBe(10);
    });
  });

  describe("escapeRegExp", () => {
    it("escapes regex metacharacters", () => {
      expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
      expect(escapeRegExp("(x)")).toBe("\\(x\\)");
    });
  });

  describe("highlightText", () => {
    it("returns empty for empty text", () => {
      expect(highlightText("", "x")).toBe("");
    });
    it("escapes html and wraps matches in mark", () => {
      const out = highlightText("hello world", "world");
      expect(out).toContain('<mark class="search-highlight">world</mark>');
    });
    it("escapes html even without a query", () => {
      const out = highlightText("<script>", "");
      expect(out).not.toContain("<script>");
    });
    it("treats query as literal (no regex injection)", () => {
      const out = highlightText("a.b", ".");
      expect(out).toContain('<mark class="search-highlight">.</mark>');
    });
  });

  describe("getMessageCategory", () => {
    it("maps message types with fallback", () => {
      expect(getMessageCategory("task-plan")).toBe("task");
      expect(getMessageCategory("interview")).toBe("interview");
      expect(getMessageCategory("intent-confirmation")).toBe("intent");
      expect(getMessageCategory("intent-recognition")).toBe("intent");
      expect(getMessageCategory("chat")).toBe("normal");
    });
  });

  describe("getRoleName", () => {
    it("maps roles with fallback", () => {
      expect(getRoleName("user")).toBe("用户");
      expect(getRoleName("assistant")).toBe("AI助手");
      expect(getRoleName("system")).toBe("系统");
      expect(getRoleName("other")).toBe("other");
    });
  });

  describe("getTypeName / getTypeColor", () => {
    it("maps types with fallback", () => {
      expect(getTypeName("task")).toBe("任务计划");
      expect(getTypeName("x")).toBe("x");
      expect(getTypeColor("intent")).toBe("purple");
      expect(getTypeColor("x")).toBe("default");
    });
  });

  describe("formatTime", () => {
    it("returns a time string for today", () => {
      const out = formatTime(Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
    it("prefixes weekday within the week", () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      expect(formatTime(twoDaysAgo)).toMatch(/周[日一二三四五六]/);
    });
  });
});
