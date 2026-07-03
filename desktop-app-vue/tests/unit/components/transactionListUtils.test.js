import { describe, it, expect } from "vitest";
import {
  getTxTypeText,
  getTxTypeColor,
  getStatusText,
  getStatusColor,
  formatHash,
  formatAddress,
  formatTime,
} from "@renderer/components/blockchain/transactionListUtils";

describe("transactionListUtils", () => {
  it("maps tx type text+color with fallback", () => {
    expect(getTxTypeText("transfer")).toBe("转账");
    expect(getTxTypeText("contract_call")).toBe("合约调用");
    expect(getTxTypeText("x")).toBe("未知");
    expect(getTxTypeColor("mint")).toBe("#52c41a");
    expect(getTxTypeColor("x")).toBe("#8c8c8c");
  });

  it("maps status text+color with fallback", () => {
    expect(getStatusText("confirmed")).toBe("已确认");
    expect(getStatusText("x")).toBe("未知");
    expect(getStatusColor("failed")).toBe("error");
    expect(getStatusColor("x")).toBe("default");
  });

  describe("formatHash / formatAddress", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(formatHash("")).toBe("");
      expect(formatHash("0xabc")).toBe("0xabc");
      const h = "0x" + "a".repeat(40);
      expect(formatHash(h)).toBe(`${h.slice(0, 10)}...${h.slice(-8)}`);
      expect(formatAddress("")).toBe("");
      const a = "0x" + "b".repeat(40);
      expect(formatAddress(a)).toBe(`${a.slice(0, 6)}...${a.slice(-4)}`);
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
