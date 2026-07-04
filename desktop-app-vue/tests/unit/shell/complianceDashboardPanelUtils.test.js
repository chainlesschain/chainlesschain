import { describe, it, expect } from "vitest";
import {
  getScoreColor,
  formatRulesSummary,
  getDSRStatusColor,
  getDSRStatusLabel,
  getDSRTypeLabel,
  formatDate,
} from "@renderer/shell/complianceDashboardPanelUtils";

describe("complianceDashboardPanelUtils", () => {
  describe("getScoreColor", () => {
    it("bands by score", () => {
      expect(getScoreColor(90)).toBe("#52c41a");
      expect(getScoreColor(70)).toBe("#faad14");
      expect(getScoreColor(40)).toBe("#ff4d4f");
    });
  });

  describe("formatRulesSummary", () => {
    it("dashes empty / empty object", () => {
      expect(formatRulesSummary("")).toBe("-");
      expect(formatRulesSummary("{}")).toBe("-");
    });
    it("joins first 3 keys, ellipsizes overflow", () => {
      expect(formatRulesSummary('{"a":1,"b":2}')).toBe("a, b");
      expect(formatRulesSummary('{"a":1,"b":2,"c":3,"d":4}')).toBe(
        "a, b, c...",
      );
    });
    it("truncates raw string on parse failure", () => {
      expect(formatRulesSummary("plain")).toBe("plain");
      const long = "x".repeat(60);
      expect(formatRulesSummary(long)).toBe(long.substring(0, 50) + "...");
    });
  });

  it("maps DSR status color+label", () => {
    expect(getDSRStatusColor("in_progress")).toBe("orange");
    expect(getDSRStatusColor("x")).toBe("default");
    expect(getDSRStatusLabel("completed")).toBe("已完成");
    expect(getDSRStatusLabel("x")).toBe("x");
  });

  it("maps DSR type label, dashes missing", () => {
    expect(getDSRTypeLabel("deletion")).toBe("数据删除");
    expect(getDSRTypeLabel("x")).toBe("x");
    expect(getDSRTypeLabel(undefined)).toBe("-");
  });

  it("formatDate dashes falsy, formats otherwise", () => {
    expect(formatDate(0)).toBe("-");
    expect(typeof formatDate(1700000000000)).toBe("string");
  });
});
