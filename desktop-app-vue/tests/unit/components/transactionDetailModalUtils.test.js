import { describe, it, expect } from "vitest";
import {
  getBlockExplorerUrl,
  getNetworkName,
  getStatusIcon,
  getStatusTitle,
  getStatusColor,
  getStatusText,
  getTypeColor,
  getTypeText,
  formatDateTime,
  formatGas,
  formatJSON,
} from "@renderer/components/blockchain/transactionDetailModalUtils";

describe("transactionDetailModalUtils", () => {
  describe("getBlockExplorerUrl", () => {
    it("builds a URL for known chains + path types", () => {
      expect(getBlockExplorerUrl(1, "tx", "0xabc")).toBe(
        "https://etherscan.io/tx/0xabc",
      );
      expect(getBlockExplorerUrl(137, "address", "0xdef")).toBe(
        "https://polygonscan.com/address/0xdef",
      );
    });
    it("returns null for unknown / explorer-less chains", () => {
      expect(getBlockExplorerUrl(31337, "tx", "0x1")).toBeNull();
      expect(getBlockExplorerUrl(99999, "tx", "0x1")).toBeNull();
    });
  });

  it("maps network name with fallback", () => {
    expect(getNetworkName(1)).toBe("以太坊主网");
    expect(getNetworkName(42161)).toBe("Arbitrum One");
    expect(getNetworkName(99999)).toBe("Chain 99999");
  });

  it("maps status icon/title/color/text", () => {
    expect(getStatusIcon("confirmed")).toBe("success");
    expect(getStatusIcon("x")).toBe("info");
    expect(getStatusTitle("failed")).toBe("交易失败");
    expect(getStatusColor("pending")).toBe("processing");
    expect(getStatusText("success")).toBe("成功");
    expect(getStatusText("x")).toBe("x");
  });

  it("maps type color+text", () => {
    expect(getTypeColor("deploy")).toBe("purple");
    expect(getTypeColor("x")).toBe("default");
    expect(getTypeText("swap")).toBe("交换");
    expect(getTypeText("x")).toBe("x");
  });

  it("formatDateTime dashes falsy, formats otherwise", () => {
    expect(formatDateTime(0)).toBe("-");
    expect(typeof formatDateTime(1700000000000)).toBe("string");
  });

  describe("formatGas", () => {
    it("dashes missing inputs, computes ETH cost", () => {
      expect(formatGas(0, 100)).toBe("-");
      expect(formatGas(21000, 0)).toBe("-");
      expect(formatGas(21000, 1e9)).toBe("0.000021 ETH");
    });
  });

  describe("formatJSON", () => {
    it("pretty-prints objects + JSON strings, raw on failure", () => {
      expect(formatJSON({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatJSON('{"b":2}')).toBe('{\n  "b": 2\n}');
      expect(formatJSON("not-json")).toBe("not-json");
    });
  });
});
