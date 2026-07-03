import { describe, it, expect } from "vitest";
import {
  getStatusText,
  getStatusTagColor,
  getStatusColor,
  formatAddress,
  formatTime,
} from "@renderer/components/blockchain/bridgeHistoryUtils";

describe("bridgeHistoryUtils", () => {
  it("maps status text/tag-color/color with fallback", () => {
    expect(getStatusText("locked")).toBe("已锁定");
    expect(getStatusText("x")).toBe("x");
    expect(getStatusTagColor("completed")).toBe("success");
    expect(getStatusTagColor("x")).toBe("default");
    expect(getStatusColor("failed")).toBe("#ff4d4f");
    expect(getStatusColor("x")).toBe("#8c8c8c");
  });

  describe("formatAddress", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(formatAddress("")).toBe("");
      expect(formatAddress("0xabc")).toBe("0xabc");
      const a = "0x" + "c".repeat(40);
      expect(formatAddress(a)).toBe(`${a.slice(0, 10)}...${a.slice(-8)}`);
    });
  });

  describe("formatTime", () => {
    it("empties falsy, buckets relative, dates old", () => {
      expect(formatTime(0)).toBe("");
      expect(formatTime(Date.now())).toBe("刚刚");
      expect(formatTime(Date.now() - 5 * 60000)).toBe("5 分钟前");
      expect(formatTime(Date.now() - 3 * 3600000)).toBe("3 小时前");
      const out = formatTime(Date.now() - 2 * 86400000);
      expect(out).not.toMatch(/前|刚刚/);
    });
  });
});
