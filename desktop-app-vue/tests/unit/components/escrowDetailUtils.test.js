import { describe, it, expect } from "vitest";
import {
  getStatusTitle,
  getStatusDescription,
  formatId,
  formatDid,
  formatAmount,
  formatFullTime,
} from "@renderer/components/trade/escrowDetailUtils";

describe("trade/escrowDetailUtils", () => {
  describe("getStatusTitle / getStatusDescription", () => {
    it("maps escrow statuses with fallback", () => {
      expect(getStatusTitle("locked")).toBe("资金已托管");
      expect(getStatusTitle("released")).toBe("资金已释放");
      expect(getStatusTitle("weird")).toBe("weird");
      expect(getStatusDescription("disputed")).toBe("交易存在争议，等待仲裁");
      expect(getStatusDescription("weird")).toBe("");
    });
  });

  describe("formatId", () => {
    it("returns dash for empty, shortens long", () => {
      expect(formatId(null)).toBe("-");
      expect(formatId("abc")).toBe("abc");
      expect(formatId("0123456789abcdefghij")).toBe("01234567...cdefghij");
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

  describe("formatFullTime", () => {
    it("returns dash for empty, string otherwise", () => {
      expect(formatFullTime(null)).toBe("-");
      const out = formatFullTime(Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
