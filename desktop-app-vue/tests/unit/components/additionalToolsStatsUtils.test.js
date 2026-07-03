import { describe, it, expect } from "vitest";
import {
  getCategoryColor,
  getCategoryName,
  getSuccessRateColor,
  getToolSuccessRate,
} from "@renderer/components/tool/additionalToolsStatsUtils";

describe("additionalToolsStatsUtils", () => {
  describe("getCategoryColor", () => {
    it("maps known categories", () => {
      expect(getCategoryColor("blockchain")).toBe("blue");
      expect(getCategoryColor("finance")).toBe("green");
      expect(getCategoryColor("general")).toBe("default");
    });
    it("falls back to default for unknown", () => {
      expect(getCategoryColor("mystery")).toBe("default");
    });
  });

  describe("getCategoryName", () => {
    it("maps known categories to localized names", () => {
      expect(getCategoryName("blockchain")).toBe("区块链");
      expect(getCategoryName("code")).toBe("代码生成");
    });
    it("echoes unknown category unchanged", () => {
      expect(getCategoryName("weird")).toBe("weird");
    });
  });

  describe("getSuccessRateColor", () => {
    it("returns the color tier for each threshold", () => {
      expect(getSuccessRateColor("95")).toBe("#52c41a"); // >= 90
      expect(getSuccessRateColor("90")).toBe("#52c41a");
      expect(getSuccessRateColor("80")).toBe("#1890ff"); // >= 70
      expect(getSuccessRateColor("60")).toBe("#faad14"); // >= 50
      expect(getSuccessRateColor("30")).toBe("#f5222d"); // < 50
    });
    it("parses percent strings and NaN falls to the lowest tier", () => {
      expect(getSuccessRateColor("88.5%")).toBe("#1890ff");
      expect(getSuccessRateColor("n/a")).toBe("#f5222d");
    });
  });

  describe("getToolSuccessRate", () => {
    it("returns 0 when there are no usages", () => {
      expect(getToolSuccessRate({ usage_count: 0, success_count: 0 })).toBe(0);
      expect(getToolSuccessRate({})).toBe(0);
    });
    it("computes a one-decimal percentage", () => {
      expect(getToolSuccessRate({ usage_count: 4, success_count: 3 })).toBe(
        "75.0",
      );
      expect(getToolSuccessRate({ usage_count: 3, success_count: 1 })).toBe(
        "33.3",
      );
    });
  });
});
