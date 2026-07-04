import { describe, it, expect } from "vitest";
import {
  formatId,
  formatDid,
  formatAmount,
  formatTime,
  formatFullTime,
  getStatusText,
} from "@renderer/components/trade/transactionListUtils";

describe("trade/transactionListUtils", () => {
  describe("formatId", () => {
    it("returns dash for empty", () => {
      expect(formatId("")).toBe("-");
      expect(formatId(null)).toBe("-");
    });
    it("passes through short ids", () => {
      expect(formatId("abc123")).toBe("abc123");
    });
    it("shortens long ids", () => {
      expect(formatId("0123456789abcdefghij")).toBe("01234567...cdefghij");
    });
  });

  describe("formatDid", () => {
    it("returns dash for empty", () => {
      expect(formatDid(null)).toBe("-");
    });
    it("passes through short dids", () => {
      expect(formatDid("did:short")).toBe("did:short");
    });
    it("shortens long dids", () => {
      expect(formatDid("did:example:0123456789abcdefghij")).toBe(
        "did:exampl...cdefghij",
      );
    });
  });

  describe("formatAmount", () => {
    it("returns 0 for empty/NaN", () => {
      expect(formatAmount(null)).toBe("0");
      expect(formatAmount("abc")).toBe("0");
    });
    it("keeps zero", () => {
      expect(formatAmount(0)).toBe("0");
    });
    it("formats with thousands separator", () => {
      expect(formatAmount(1234567)).toBe("1,234,567");
    });
  });

  describe("formatTime", () => {
    it("returns dash for empty", () => {
      expect(formatTime(null)).toBe("-");
    });
    it("shows 刚刚 for very recent", () => {
      expect(formatTime(Date.now())).toBe("刚刚");
    });
    it("shows minutes ago", () => {
      expect(formatTime(Date.now() - 5 * 60 * 1000)).toBe("5分钟前");
    });
    it("shows hours ago within 24h", () => {
      expect(formatTime(Date.now() - 2 * 60 * 60 * 1000)).toBe("2小时前");
    });
  });

  describe("formatFullTime", () => {
    it("returns dash for empty", () => {
      expect(formatFullTime(null)).toBe("-");
    });
    it("returns a non-empty string for a timestamp", () => {
      const out = formatFullTime(Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });

  describe("getStatusText", () => {
    it("maps known statuses", () => {
      expect(getStatusText("pending")).toBe("待处理");
      expect(getStatusText("escrowed")).toBe("托管中");
      expect(getStatusText("completed")).toBe("已完成");
      expect(getStatusText("refunded")).toBe("已退款");
      expect(getStatusText("cancelled")).toBe("已取消");
      expect(getStatusText("disputed")).toBe("争议中");
    });
    it("falls back to the raw value", () => {
      expect(getStatusText("weird")).toBe("weird");
    });
  });
});
