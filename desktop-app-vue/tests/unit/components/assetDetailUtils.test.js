import { describe, it, expect } from "vitest";
import {
  getTypeLabel,
  getTypeColor,
  getCoverGradient,
  formatAmount,
  formatId,
  formatDid,
  formatTime,
} from "@renderer/components/trade/assetDetailUtils";

describe("assetDetailUtils", () => {
  it("maps asset type label+color", () => {
    expect(getTypeLabel("knowledge")).toBe("知识产品");
    expect(getTypeLabel("x")).toBe("x");
    expect(getTypeColor("service")).toBe("orange");
    expect(getTypeColor("x")).toBe("default");
  });

  describe("getCoverGradient", () => {
    it("maps known types, defaults to token gradient", () => {
      expect(getCoverGradient("nft")).toContain("#f093fb");
      expect(getCoverGradient("token")).toContain("#667eea");
      expect(getCoverGradient("x")).toBe(getCoverGradient("token"));
    });
  });

  describe("formatAmount", () => {
    it("zeros falsy/NaN, abbreviates K/M/B", () => {
      expect(formatAmount(undefined)).toBe("0");
      expect(formatAmount("nope")).toBe("0");
      expect(formatAmount(1500)).toBe("1.50K");
      expect(formatAmount(2_500_000)).toBe("2.50M");
      expect(formatAmount(3_000_000_000)).toBe("3.00B");
    });
  });

  describe("formatId / formatDid", () => {
    it("dashes falsy, truncates long", () => {
      expect(formatId("")).toBe("-");
      expect(formatDid("")).toBe("-");
      const s = "x".repeat(30);
      expect(formatId(s)).toBe(`${s.slice(0, 10)}...${s.slice(-8)}`);
      expect(formatDid(s)).toBe(`${s.slice(0, 10)}...${s.slice(-8)}`);
    });
  });

  describe("formatTime", () => {
    it("dashes falsy, buckets relative", () => {
      expect(formatTime(0)).toBe("-");
      expect(formatTime(Date.now())).toBe("刚刚");
      expect(formatTime(Date.now() - 30 * 60 * 1000)).toBe("30分钟前");
      expect(formatTime(Date.now() - 3 * 60 * 60 * 1000)).toBe("3小时前");
    });
  });
});
