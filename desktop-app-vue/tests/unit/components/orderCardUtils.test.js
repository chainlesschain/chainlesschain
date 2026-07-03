import { describe, it, expect } from "vitest";
import {
  getOrderTypeColor,
  getOrderTypeLabel,
  getAssetColor,
  formatAmount,
  formatDid,
  formatTime,
} from "@renderer/components/trade/common/orderCardUtils";

describe("orderCardUtils", () => {
  it("maps order type color+label + asset color", () => {
    expect(getOrderTypeColor("auction")).toBe("purple");
    expect(getOrderTypeColor("x")).toBe("default");
    expect(getOrderTypeLabel("buy")).toBe("求购");
    expect(getOrderTypeLabel("x")).toBe("x");
    expect(getAssetColor("nft")).toBe("#52c41a");
    expect(getAssetColor("x")).toBe("#999");
  });

  describe("formatAmount", () => {
    it("zeros falsy/NaN", () => {
      expect(formatAmount(undefined)).toBe("0");
      expect(formatAmount("nope")).toBe("0");
    });
    it("abbreviates large numbers K/M/B", () => {
      expect(formatAmount(1500)).toBe("1.50K");
      expect(formatAmount(2_500_000)).toBe("2.50M");
      expect(formatAmount(3_000_000_000)).toBe("3.00B");
      expect(formatAmount(500)).toBe("500");
    });
  });

  it("formats DID with truncation", () => {
    expect(formatDid("")).toBe("-");
    const d = "did:key:" + "z".repeat(30);
    expect(formatDid(d)).toBe(`${d.slice(0, 10)}...${d.slice(-8)}`);
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
