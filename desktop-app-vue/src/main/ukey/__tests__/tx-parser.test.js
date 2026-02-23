/**
 * tx-parser unit tests
 * Tests parseTx, decodeABI, KNOWN_METHODS, SUPPORTED_CHAINS
 */

import { describe, it, expect } from "vitest";

const {
  parseTx,
  decodeABI,
  KNOWN_METHODS,
  SUPPORTED_CHAINS,
} = require("../tx-parser");

// Standard ERC-20 calldata helpers
const RECIPIENT = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const AMOUNT_HEX =
  "0000000000000000000000000000000000000000000000000002386f26fc10000";

function makeTransferCalldata() {
  // transfer(address to, uint256 amount)
  return "0xa9059cbb" + "000000000000000000000000" + RECIPIENT + AMOUNT_HEX;
}

function makeApproveCalldata() {
  // approve(address spender, uint256 amount)
  return "0x095ea7b3" + "000000000000000000000000" + RECIPIENT + AMOUNT_HEX;
}

describe("KNOWN_METHODS", () => {
  it("has ≥10 entries", () => {
    expect(Object.keys(KNOWN_METHODS).length).toBeGreaterThanOrEqual(10);
  });

  it("contains transfer selector", () => {
    expect(KNOWN_METHODS["0xa9059cbb"]).toBe("transfer");
  });

  it("contains approve selector", () => {
    expect(KNOWN_METHODS["0x095ea7b3"]).toBe("approve");
  });

  it("contains swap selectors", () => {
    const values = Object.values(KNOWN_METHODS);
    expect(values.some((v) => v.toLowerCase().includes("swap"))).toBe(true);
  });
});

describe("SUPPORTED_CHAINS", () => {
  it("contains required chains", () => {
    expect(SUPPORTED_CHAINS).toHaveProperty("ethereum");
    expect(SUPPORTED_CHAINS).toHaveProperty("polygon");
    expect(SUPPORTED_CHAINS).toHaveProperty("bsc");
    expect(SUPPORTED_CHAINS).toHaveProperty("solana");
    expect(SUPPORTED_CHAINS).toHaveProperty("bitcoin");
  });

  it("ethereum has chainId=1 and ETH symbol", () => {
    expect(SUPPORTED_CHAINS.ethereum.chainId).toBe(1);
    expect(SUPPORTED_CHAINS.ethereum.symbol).toBe("ETH");
  });

  it("each chain has chainId, symbol, decimals, rpcUrl", () => {
    for (const [, chain] of Object.entries(SUPPORTED_CHAINS)) {
      expect(chain).toHaveProperty("symbol");
      expect(chain).toHaveProperty("decimals");
      expect(chain).toHaveProperty("rpcUrl");
    }
  });
});

describe("parseTx", () => {
  it('ERC-20 transfer calldata → methodName = "transfer"', () => {
    const txInfo = parseTx(
      { to: "0xTokenAddr", data: makeTransferCalldata() },
      "ethereum",
    );
    expect(txInfo.methodName).toBe("transfer");
    expect(txInfo.methodId).toBe("0xa9059cbb");
  });

  it('ERC-20 approve calldata → methodName = "approve"', () => {
    const txInfo = parseTx(
      { to: "0xTokenAddr", data: makeApproveCalldata() },
      "ethereum",
    );
    expect(txInfo.methodName).toBe("approve");
    expect(txInfo.methodId).toBe("0x095ea7b3");
  });

  it("no calldata (plain ETH transfer) → methodId = null, methodName = null", () => {
    const txInfo = parseTx(
      { to: "0xRecipient", value: "0x38d7ea4c68000" },
      "ethereum",
    );
    expect(txInfo.methodId).toBeNull();
    expect(txInfo.methodName).toBeNull();
    expect(txInfo.params).toEqual([]);
  });

  it('empty data "0x" → methodId = null', () => {
    const txInfo = parseTx({ to: "0xRecipient", data: "0x" }, "ethereum");
    expect(txInfo.methodId).toBeNull();
  });

  it('unknown 4-byte selector → methodName = "unknown"', () => {
    const unknownData = "0xdeadbeef" + "0".repeat(64);
    const txInfo = parseTx({ to: "0xAddr", data: unknownData }, "ethereum");
    expect(txInfo.methodId).toBe("0xdeadbeef");
    expect(txInfo.methodName).toBe("unknown");
  });

  it("missing gasLimit → defaults to 21000", () => {
    const txInfo = parseTx({ to: "0xAddr" }, "ethereum");
    expect(txInfo.gasLimit).toBe(21000);
  });

  it("uses txParams.gas as gasLimit fallback", () => {
    const txInfo = parseTx({ to: "0xAddr", gas: 46000 }, "ethereum");
    expect(txInfo.gasLimit).toBe(46000);
  });

  it("missing nonce → defaults to 0", () => {
    const txInfo = parseTx({ to: "0xAddr" }, "ethereum");
    expect(txInfo.nonce).toBe(0);
  });

  it("normalizes hex wei value to decimal ETH", () => {
    // 0xde0b6b3a7640000 = 1 ETH in wei
    const txInfo = parseTx(
      { to: "0xAddr", value: "0xde0b6b3a7640000" },
      "ethereum",
    );
    expect(parseFloat(txInfo.value)).toBeCloseTo(1.0, 5);
  });

  it("decimal ETH string passthrough", () => {
    const txInfo = parseTx({ to: "0xAddr", value: "0.5" }, "ethereum");
    expect(txInfo.value).toBe("0.5");
  });

  it('undefined value → "0"', () => {
    const txInfo = parseTx({ to: "0xAddr" }, "ethereum");
    expect(txInfo.value).toBe("0");
  });

  it("includes chain and chainId", () => {
    const txInfo = parseTx({ to: "0xAddr" }, "ethereum");
    expect(txInfo.chain).toBe("ethereum");
    expect(txInfo.chainId).toBe(1);
  });

  it("unknown chain falls back to ethereum", () => {
    const txInfo = parseTx({ to: "0xAddr" }, "unknown-chain");
    expect(txInfo.chainId).toBe(1); // ethereum fallback
  });

  it("uses input field as fallback for data", () => {
    const input = makeTransferCalldata();
    const txInfo = parseTx({ to: "0xAddr", input }, "ethereum");
    expect(txInfo.methodName).toBe("transfer");
  });
});

describe("decodeABI", () => {
  it("decodes transfer address param", () => {
    const data = makeTransferCalldata();
    const params = decodeABI(data, "0xa9059cbb");
    expect(params[0]).toBe("0x" + RECIPIENT);
  });

  it("returns empty array for no params", () => {
    expect(decodeABI("0xa9059cbb", "0xa9059cbb")).toEqual([]);
  });

  it("returns empty array for empty/null data", () => {
    expect(decodeABI("", "0x")).toEqual([]);
    expect(decodeABI(null, null)).toEqual([]);
  });

  it("decodes two params (address + uint256)", () => {
    const data = makeTransferCalldata();
    const params = decodeABI(data, "0xa9059cbb");
    expect(params).toHaveLength(2);
    expect(params[0]).toMatch(/^0x[0-9a-f]{40}$/);
    expect(params[1]).toMatch(/^0x[0-9a-f]+$/);
  });
});
