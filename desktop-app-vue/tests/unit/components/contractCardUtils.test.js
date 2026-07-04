import { describe, it, expect } from "vitest";
import {
  getContractTypeColor,
  getContractTypeName,
  formatDid,
  formatAmount,
  formatTime,
} from "@renderer/components/trade/common/contractCardUtils";

describe("trade/common/contractCardUtils", () => {
  describe("getContractTypeColor / getContractTypeName", () => {
    it("maps contract types with fallback", () => {
      expect(getContractTypeColor("trade")).toBe("green");
      expect(getContractTypeColor("escrow")).toBe("orange");
      expect(getContractTypeColor("x")).toBe("default");
      expect(getContractTypeName("service")).toBe("服务合约");
      expect(getContractTypeName("x")).toBe("x");
    });
  });

  describe("formatDid", () => {
    it("returns dash for empty, shortens long", () => {
      expect(formatDid(null)).toBe("-");
      expect(formatDid("did:short")).toBe("did:short");
      expect(formatDid("did:example:0123456789abcdefghij")).toBe(
        "did:exampl...cdefghij",
      );
    });
  });

  describe("formatAmount", () => {
    it("returns 0 for empty/NaN, keeps zero, formats", () => {
      expect(formatAmount(null)).toBe("0");
      expect(formatAmount("abc")).toBe("0");
      expect(formatAmount(0)).toBe("0");
      expect(formatAmount(1234567)).toBe("1,234,567");
    });
  });

  describe("formatTime", () => {
    it("returns dash for empty", () => {
      expect(formatTime(null)).toBe("-");
    });
    it("shows relative time within 24h", () => {
      expect(formatTime(Date.now())).toBe("刚刚");
      expect(formatTime(Date.now() - 5 * 60 * 1000)).toBe("5分钟前");
      expect(formatTime(Date.now() - 2 * 60 * 60 * 1000)).toBe("2小时前");
    });
    it("shows a date beyond 24h", () => {
      const out = formatTime(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(out).not.toMatch(/前|刚刚/);
    });
  });
});
