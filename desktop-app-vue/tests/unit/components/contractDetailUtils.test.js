import { describe, it, expect } from "vitest";
import {
  getStatusColor,
  getStatusName,
  getTypeColor,
  getTypeName,
  getEscrowTypeColor,
  getEscrowTypeName,
  getConditionTypeName,
  getEventTypeName,
  getEventColor,
  formatTermKey,
  shortenDid,
  formatTime,
  isExpired,
} from "@renderer/components/trade/contractDetailUtils";

describe("contractDetailUtils", () => {
  it("maps contract status color+name with fallback", () => {
    expect(getStatusColor("active")).toBe("green");
    expect(getStatusColor("nope")).toBe("default");
    expect(getStatusName("disputed")).toBe("有争议");
    expect(getStatusName("nope")).toBe("nope");
  });

  it("maps contract type color+name", () => {
    expect(getTypeColor("bounty")).toBe("orange");
    expect(getTypeName("skill_exchange")).toBe("技能交换");
    expect(getTypeColor("x")).toBe("default");
    expect(getTypeName("x")).toBe("x");
  });

  it("maps escrow + condition types", () => {
    expect(getEscrowTypeColor("multisig")).toBe("geekblue");
    expect(getEscrowTypeName("timelock")).toBe("时间锁");
    expect(getConditionTypeName("payment_received")).toBe("收到付款");
    expect(getConditionTypeName("x")).toBe("x");
  });

  it("maps event type name + color with fallback", () => {
    expect(getEventTypeName("arbitration_initiated")).toBe("发起仲裁");
    expect(getEventColor("cancelled")).toBe("red");
    expect(getEventColor("unknown")).toBe("blue");
  });

  it("maps term keys with fallback to raw key", () => {
    expect(formatTermKey("buyerDid")).toBe("买家");
    expect(formatTermKey("unlockTime")).toBe("解锁时间");
    expect(formatTermKey("mysteryKey")).toBe("mysteryKey");
  });

  it("shortens long DIDs only", () => {
    expect(shortenDid("")).toBe("");
    expect(shortenDid("did:key:short")).toBe("did:key:short");
    const did = "did:key:" + "z".repeat(30);
    expect(shortenDid(did)).toBe(`${did.slice(0, 10)}...${did.slice(-8)}`);
  });

  it("formats time and checks expiry", () => {
    expect(typeof formatTime(1700000000000)).toBe("string");
    expect(isExpired(Date.now() - 1000)).toBe(true);
    expect(isExpired(Date.now() + 100000)).toBe(false);
  });
});
