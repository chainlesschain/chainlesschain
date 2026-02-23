/**
 * RiskAnalyzer unit tests
 * Tests analyze(), isBlacklisted(), addToWhitelist(), isWhitelisted()
 */

import { describe, it, expect, beforeEach } from "vitest";

const { RiskAnalyzer, RISK_LEVEL } = require("../risk-analyzer");

// Note: `whitelists` is module-level state — use unique addresses per test to avoid conflicts

describe("RiskAnalyzer.analyze — risk levels", () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new RiskAnalyzer();
  });

  it('small ETH transfer → level = "low", score < 20', () => {
    const txInfo = {
      to: "0xknownrecipient0000000000000000000000001",
      chain: "ethereum",
      value: "0.05", // < 0.1 ETH
      methodId: null,
      methodName: null,
      params: [],
    };
    // First whitelist the address so it doesn't get +10 penalty
    analyzer.addToWhitelist(txInfo.to, "ethereum");
    const result = analyzer.analyze(txInfo);
    expect(result.level).toBe(RISK_LEVEL.LOW);
    expect(result.score).toBeLessThan(20);
  });

  it("non-whitelisted + value 0.05 ETH → score = 10 → LOW", () => {
    const txInfo = {
      to: "0xnotwhitelisted00000001",
      chain: "ethereum",
      value: "0.05",
      methodId: null,
      methodName: null,
    };
    const result = analyzer.analyze(txInfo);
    expect(result.score).toBe(10);
    expect(result.level).toBe(RISK_LEVEL.LOW);
  });

  it('large ETH value + simulation failure + high gas → level = "high"', () => {
    const txInfo = {
      to: "0xunknowncontract00000002",
      chain: "ethereum",
      value: "2.0", // > 1 ETH → +20
      methodId: null,
      methodName: null,
      gasPrice: "200000000000", // > 100e9 → +10
    };
    const simResult = { success: false, revertReason: "insufficient funds" }; // +30
    // score = 10 (not whitelisted) + 20 (large value) + 30 (sim fail) + 10 (gas) = 70
    const result = analyzer.analyze(txInfo, simResult);
    expect(result.level).toBe(RISK_LEVEL.HIGH);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('blacklisted address + large value + simulation failure → level = "critical"', () => {
    const txInfo = {
      to: "0x0000000000000000000000000000000000000000", // in built-in BLACKLIST
      chain: "ethereum",
      value: "2.0", // > 1 ETH
      methodId: null,
      methodName: null,
    };
    const simResult = { success: false, revertReason: "revert" };
    // 50 (blacklist) + 10 (not whitelisted) + 20 (large value) + 30 (sim fail) = 110 → clamped 100
    const result = analyzer.analyze(txInfo, simResult);
    expect(result.level).toBe(RISK_LEVEL.CRITICAL);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("blacklisted address alone → score ≥ 60, requireBiometric = true", () => {
    const txInfo = {
      to: "0x0000000000000000000000000000000000000000",
      chain: "ethereum",
      value: "0",
      methodId: null,
      methodName: null,
    };
    const result = analyzer.analyze(txInfo);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.requireBiometric).toBe(true);
  });

  it("requireBiometric = true when score ≥ 60", () => {
    // Use blacklisted address which alone gives score 50 + 10 (not whitelisted) = 60
    const txInfo = {
      to: "0x0000000000000000000000000000000000000000",
      chain: "ethereum",
      value: "0",
    };
    const result = analyzer.analyze(txInfo);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.requireBiometric).toBe(true);
  });

  it("low-risk transaction → requireBiometric = false", () => {
    const txInfo = {
      to: "0xknownrecipient00000000002",
      chain: "ethereum",
      value: "0.01",
    };
    analyzer.addToWhitelist(txInfo.to, "ethereum");
    const result = analyzer.analyze(txInfo);
    expect(result.requireBiometric).toBe(false);
  });

  it("simulation failure adds +30 to score", () => {
    const txInfo = {
      to: "0xsimfailtest00000003",
      chain: "ethereum",
      value: "0",
    };
    const withoutSim = analyzer.analyze(txInfo);
    const withFailedSim = analyzer.analyze(txInfo, {
      success: false,
      revertReason: "revert",
    });
    expect(withFailedSim.score - withoutSim.score).toBe(30);
  });

  it("successful simulation does not add to score", () => {
    const txInfo = {
      to: "0xsimpasstest00000004",
      chain: "ethereum",
      value: "0",
    };
    const withoutSim = analyzer.analyze(txInfo);
    const withPassSim = analyzer.analyze(txInfo, {
      success: true,
      gasUsed: 21000,
      assetChanges: [],
    });
    expect(withPassSim.score).toBe(withoutSim.score);
  });

  it("score is clamped to max 100", () => {
    const txInfo = {
      to: "0x0000000000000000000000000000000000000000",
      chain: "ethereum",
      value: "5.0", // > 1 ETH
      methodId: "0xdeadbeef",
      methodName: "unknown_selector", // starts with 'unknown_'
      gasPrice: "200000000000",
    };
    const result = analyzer.analyze(txInfo, {
      success: false,
      revertReason: "revert",
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns warnings array and reasons array", () => {
    const txInfo = {
      to: "0x0000000000000000000000000000000000000000",
      chain: "ethereum",
      value: "0",
    };
    const result = analyzer.analyze(txInfo);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0); // blacklist warning
  });
});

describe("RiskAnalyzer — whitelist / blacklist", () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new RiskAnalyzer();
  });

  it("isBlacklisted → true for zero address", () => {
    expect(
      analyzer.isBlacklisted("0x0000000000000000000000000000000000000000"),
    ).toBe(true);
  });

  it("isBlacklisted → false for random address", () => {
    expect(
      analyzer.isBlacklisted("0xabc123def456abc123def456abc123def456abc1"),
    ).toBe(false);
  });

  it("isBlacklisted handles null/undefined", () => {
    expect(analyzer.isBlacklisted(null)).toBe(false);
    expect(analyzer.isBlacklisted(undefined)).toBe(false);
  });

  it("addToWhitelist + isWhitelisted → true", () => {
    const addr = "0xwhitelistedaddr00000000000000000000000aa";
    expect(analyzer.isWhitelisted(addr, "ethereum")).toBe(false);
    analyzer.addToWhitelist(addr, "ethereum", "My Contract");
    expect(analyzer.isWhitelisted(addr, "ethereum")).toBe(true);
  });

  it("whitelist is chain-scoped: ethereum whitelist does not affect polygon", () => {
    const addr = "0xchainscoped0000000000000000000000000bb";
    analyzer.addToWhitelist(addr, "ethereum");
    expect(analyzer.isWhitelisted(addr, "ethereum")).toBe(true);
    expect(analyzer.isWhitelisted(addr, "polygon")).toBe(false);
  });

  it("whitelisted address skips the +10 not-in-whitelist penalty", () => {
    const addr = "0xpenatyskip000000000000000000000000000cc";
    const txInfo = { to: addr, chain: "ethereum", value: "0" };

    const beforeWhitelist = analyzer.analyze(txInfo);
    analyzer.addToWhitelist(addr, "ethereum");
    const afterWhitelist = analyzer.analyze(txInfo);

    expect(beforeWhitelist.score - afterWhitelist.score).toBe(10);
  });

  it("getWhitelist returns added entries", () => {
    const addr = "0xgetwhitelisttest0000000000000000000000dd";
    analyzer.addToWhitelist(addr, "ethereum", "Test Contract");
    const wl = analyzer.getWhitelist("ethereum");
    expect(wl[addr.toLowerCase()]).toBeDefined();
    expect(wl[addr.toLowerCase()].name).toBe("Test Contract");
  });
});
