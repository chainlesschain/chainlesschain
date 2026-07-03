import { describe, it, expect } from "vitest";
import {
  getTimelineColor,
  getItemTypeColor,
  getItemTypeName,
  getDefaultTitle,
  formatAmount,
  formatDid,
  formatTime,
  formatFullTime,
  visibleMetadata,
} from "@renderer/components/trade/common/transactionTimelineUtils";

describe("transactionTimelineUtils", () => {
  describe("getTimelineColor", () => {
    it("prefers explicit item.color", () => {
      expect(getTimelineColor({ color: "#abcdef" })).toBe("#abcdef");
    });
    it("falls back to status color, then type color", () => {
      expect(getTimelineColor({ status: "completed" })).toBe("#52c41a");
      expect(getTimelineColor({ status: "unknown" })).toBe("#1890ff");
      expect(getTimelineColor({ type: "payment" })).toBe("#faad14");
      expect(getTimelineColor({})).toBe("#1890ff");
    });
  });

  it("maps item type color+name+default title", () => {
    expect(getItemTypeColor("escrow")).toBe("gold");
    expect(getItemTypeColor("x")).toBe("default");
    expect(getItemTypeName("release")).toBe("释放");
    expect(getItemTypeName("x")).toBe("x");
    expect(getDefaultTitle({ type: "dispute" })).toBe("争议记录");
    expect(getDefaultTitle({ type: "x" })).toBe("交易记录");
  });

  describe("formatAmount", () => {
    it("zeros falsy/NaN, formats numbers with grouping", () => {
      expect(formatAmount(undefined)).toBe("0");
      expect(formatAmount("nope")).toBe("0");
      expect(formatAmount(0)).toBe("0");
      expect(formatAmount(1234567)).toBe("1,234,567");
    });
  });

  it("formats DID with truncation", () => {
    expect(formatDid("")).toBe("-");
    expect(formatDid("did:key:short")).toBe("did:key:short");
    const d = "did:key:" + "z".repeat(30);
    expect(formatDid(d)).toBe(`${d.slice(0, 10)}...${d.slice(-8)}`);
  });

  describe("formatTime / formatFullTime", () => {
    it("dashes falsy, buckets relative", () => {
      expect(formatTime(0)).toBe("-");
      expect(formatTime(Date.now())).toBe("刚刚");
      expect(formatTime(Date.now() - 30 * 60 * 1000)).toBe("30分钟前");
      expect(formatTime(Date.now() - 3 * 60 * 60 * 1000)).toBe("3小时前");
    });
    it("formatFullTime dashes falsy, returns string otherwise", () => {
      expect(formatFullTime(0)).toBe("-");
      expect(typeof formatFullTime(1700000000000)).toBe("string");
    });
  });

  describe("visibleMetadata", () => {
    it("returns {} for non-objects", () => {
      expect(visibleMetadata(null)).toEqual({});
      expect(visibleMetadata("x")).toEqual({});
    });
    it("filters null/undefined/empty and _-prefixed keys", () => {
      expect(
        visibleMetadata({
          a: 1,
          b: null,
          c: undefined,
          d: "",
          _internal: "hide",
          e: "keep",
        }),
      ).toEqual({ a: 1, e: "keep" });
    });
  });
});
