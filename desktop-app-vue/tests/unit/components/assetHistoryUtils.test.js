import { describe, it, expect } from "vitest";
import {
  getAssetColor,
  getTypeLabel,
  getTypeColor,
  getTransactionTypeColor,
  getTransactionTypeName,
  getTimelineColor,
  getIconColor,
  formatAmount,
  formatDid,
  formatHash,
  formatTime,
} from "@renderer/components/trade/assetHistoryUtils";

describe("assetHistoryUtils", () => {
  it("maps asset color/label/color with fallback", () => {
    expect(getAssetColor("nft")).toBe("#52c41a");
    expect(getAssetColor("x")).toBe("#999");
    expect(getTypeLabel("knowledge")).toBe("知识产品");
    expect(getTypeLabel("x")).toBe("x");
    expect(getTypeColor("service")).toBe("orange");
    expect(getTypeColor("x")).toBe("default");
  });

  it("maps transaction color/name/timeline/icon color", () => {
    expect(getTransactionTypeColor("burn")).toBe("red");
    expect(getTransactionTypeName("mint")).toBe("铸造");
    expect(getTimelineColor("trade")).toBe("orange");
    expect(getTimelineColor("x")).toBe("gray");
    expect(getIconColor("transfer")).toBe("#1890ff");
    expect(getIconColor("x")).toBe("#999");
  });

  describe("formatAmount", () => {
    it("returns 0 for missing/NaN", () => {
      expect(formatAmount(undefined)).toBe("0");
      expect(formatAmount("abc")).toBe("0");
    });
    it("formats whole numbers and applies decimals divisor", () => {
      expect(formatAmount(0)).toBe("0");
      expect(formatAmount(1000)).toBe("1,000");
      expect(formatAmount(1000000, 6)).toBe("1");
    });
  });

  describe("formatDid", () => {
    it("handles sentinels and truncation", () => {
      expect(formatDid("")).toBe("-");
      expect(formatDid("SYSTEM")).toBe("SYSTEM（系统）");
      expect(formatDid("BURNED")).toBe("BURNED（已销毁）");
      expect(formatDid("did:key:short")).toBe("did:key:short");
      const did = "did:key:" + "z".repeat(30);
      expect(formatDid(did)).toBe(`${did.slice(0, 10)}...${did.slice(-8)}`);
    });
  });

  describe("formatHash", () => {
    it("dashes empty, truncates long", () => {
      expect(formatHash("")).toBe("-");
      expect(formatHash("abc")).toBe("abc");
      const h = "0x" + "a".repeat(40);
      expect(formatHash(h)).toBe(`${h.slice(0, 10)}...${h.slice(-8)}`);
    });
  });

  describe("formatTime", () => {
    it("dashes falsy, buckets relative, dates old", () => {
      expect(formatTime(0)).toBe("-");
      expect(formatTime(Date.now())).toBe("刚刚");
      expect(formatTime(Date.now() - 5 * 60 * 1000)).toBe("5分钟前");
      expect(formatTime(Date.now() - 3 * 60 * 60 * 1000)).toBe("3小时前");
      expect(formatTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe("2天前");
    });
  });
});
