import { describe, it, expect } from "vitest";
import {
  getCategoryColor,
  getCategoryName,
  getRiskColor,
  getRiskLabel,
  getSuccessRate,
  getSuccessRateColor,
} from "@renderer/pages/toolManagementUtils";

describe("toolManagementUtils", () => {
  describe("getCategoryColor / getCategoryName", () => {
    it("maps known categories", () => {
      expect(getCategoryColor("file")).toBe("blue");
      expect(getCategoryColor("code")).toBe("cyan");
      expect(getCategoryName("system")).toBe("系统操作");
      expect(getCategoryName("general")).toBe("通用");
    });
    it("falls back for unknown", () => {
      expect(getCategoryColor("nope")).toBe("default");
      expect(getCategoryName("nope")).toBe("nope");
    });
  });

  describe("getRiskColor / getRiskLabel", () => {
    it("maps risk levels 1-5", () => {
      expect(getRiskColor(1)).toBe("success");
      expect(getRiskColor(5)).toBe("red");
      expect(getRiskLabel(1)).toBe("低");
      expect(getRiskLabel(5)).toBe("极高");
    });
    it("falls back for unknown level", () => {
      expect(getRiskColor(9)).toBe("default");
      expect(getRiskLabel(9)).toBe("未知");
    });
  });

  describe("getSuccessRate", () => {
    it("returns 0 when never used (no divide-by-zero)", () => {
      expect(getSuccessRate({ usage_count: 0, success_count: 0 })).toBe(0);
      expect(getSuccessRate({ success_count: 5 })).toBe(0);
    });
    it("computes one-decimal percentage", () => {
      expect(getSuccessRate({ usage_count: 4, success_count: 3 })).toBe("75.0");
      expect(getSuccessRate({ usage_count: 3, success_count: 1 })).toBe("33.3");
    });
  });

  describe("getSuccessRateColor", () => {
    it("greens >=90, ambers >=70, reds below", () => {
      expect(getSuccessRateColor({ usage_count: 10, success_count: 10 })).toBe(
        "#52c41a",
      );
      expect(getSuccessRateColor({ usage_count: 10, success_count: 8 })).toBe(
        "#faad14",
      );
      expect(getSuccessRateColor({ usage_count: 10, success_count: 5 })).toBe(
        "#ff4d4f",
      );
    });
  });
});
