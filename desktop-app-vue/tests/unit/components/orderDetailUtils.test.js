import { describe, it, expect } from "vitest";
import {
  getOrderTypeColor,
  getOrderTypeName,
  getOrderStatusColor,
  getOrderStatusName,
  getTransactionStatusColor,
  getTransactionStatusName,
  shortenDid,
  shortenId,
  formatTime,
} from "@renderer/components/trade/orderDetailUtils";

describe("orderDetailUtils", () => {
  it("maps order type color+name", () => {
    expect(getOrderTypeColor("auction")).toBe("purple");
    expect(getOrderTypeName("buy")).toBe("求购");
    expect(getOrderTypeColor("x")).toBe("default");
    expect(getOrderTypeName("x")).toBe("x");
  });

  it("maps order status color+name", () => {
    expect(getOrderStatusColor("disputed")).toBe("volcano");
    expect(getOrderStatusName("escrow")).toBe("托管中");
    expect(getOrderStatusColor("x")).toBe("default");
    expect(getOrderStatusName("x")).toBe("x");
  });

  it("maps transaction status color+name", () => {
    expect(getTransactionStatusColor("delivered")).toBe("cyan");
    expect(getTransactionStatusName("refunded")).toBe("已退款");
    expect(getTransactionStatusColor("x")).toBe("default");
    expect(getTransactionStatusName("x")).toBe("x");
  });

  describe("shortenDid / shortenId", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(shortenDid("")).toBe("");
      expect(shortenId("")).toBe("");
      expect(shortenDid("did:key:short")).toBe("did:key:short");
      const did = "did:key:" + "z".repeat(30);
      expect(shortenDid(did)).toBe(`${did.slice(0, 10)}...${did.slice(-8)}`);
      const id = "o".repeat(20);
      expect(shortenId(id)).toBe(`${id.slice(0, 8)}...${id.slice(-8)}`);
    });
  });

  it("formats time as a non-empty string", () => {
    expect(typeof formatTime(1700000000000)).toBe("string");
    expect(formatTime(1700000000000).length).toBeGreaterThan(0);
  });
});
