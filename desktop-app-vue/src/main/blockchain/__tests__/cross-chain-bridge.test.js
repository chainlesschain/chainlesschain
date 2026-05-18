/**
 * CrossChainBridge unit tests — Phase 89
 *
 * Covers: initialize, _registerDefaultChains, bridgeAsset, atomicSwap,
 *         sendMessage, getBalances, listChains, estimateFee, getTransferStatus, configureChain
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { CrossChainBridge } = require("../cross-chain-bridge");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("CrossChainBridge", () => {
  let bridge;
  let db;

  beforeEach(() => {
    bridge = new CrossChainBridge();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(bridge.initialized).toBe(false);
    expect(bridge._chains.size).toBe(0);
    expect(bridge._pendingTransfers.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize and register default chains", async () => {
    await bridge.initialize(db);
    expect(bridge.initialized).toBe(true);
    expect(bridge._chains.size).toBe(5);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await bridge.initialize(db);
    await bridge.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── _registerDefaultChains ───────────────────────────────────────────────
  it("should register ethereum, polygon, bsc, arbitrum, solana", async () => {
    await bridge.initialize(db);
    expect(bridge._chains.has("ethereum")).toBe(true);
    expect(bridge._chains.has("polygon")).toBe(true);
    expect(bridge._chains.has("solana")).toBe(true);
    expect(bridge._chains.get("solana").type).toBe("svm");
  });

  // ── bridgeAsset ──────────────────────────────────────────────────────────
  it("should bridge asset between valid chains", async () => {
    await bridge.initialize(db);
    const transfer = await bridge.bridgeAsset(
      "ethereum",
      "polygon",
      "USDC",
      1000,
    );
    expect(transfer.id).toMatch(/^bridge-/);
    expect(transfer.fromChain).toBe("ethereum");
    expect(transfer.toChain).toBe("polygon");
    expect(transfer.amount).toBe(1000);
    expect(transfer.fee).toBeCloseTo(1);
    expect(transfer.status).toBe("pending");
  });

  it("should throw for unknown source chain", async () => {
    await bridge.initialize(db);
    await expect(
      bridge.bridgeAsset("unknown", "polygon", "ETH", 1),
    ).rejects.toThrow("Unknown chain");
  });

  it("should throw for unknown destination chain", async () => {
    await bridge.initialize(db);
    await expect(
      bridge.bridgeAsset("ethereum", "unknown", "ETH", 1),
    ).rejects.toThrow("Unknown chain");
  });

  it("should emit bridge:transfer-initiated event", async () => {
    await bridge.initialize(db);
    const listener = vi.fn();
    bridge.on("bridge:transfer-initiated", listener);
    await bridge.bridgeAsset("ethereum", "polygon", "USDC", 100);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ fromChain: "ethereum", toChain: "polygon" }),
    );
  });

  // ── atomicSwap ───────────────────────────────────────────────────────────
  it("should create an atomic swap", async () => {
    await bridge.initialize(db);
    const swap = await bridge.atomicSwap("alice", "bob", "ETH", "SOL", 1, 50);
    expect(swap.id).toMatch(/^swap-/);
    expect(swap.partyA).toBe("alice");
    expect(swap.amountA).toBe(1);
    expect(swap.amountB).toBe(50);
    expect(swap.status).toBe("initiated");
    expect(swap.hashLock).toBeTruthy();
  });

  it("should emit bridge:swap-initiated event", async () => {
    await bridge.initialize(db);
    const listener = vi.fn();
    bridge.on("bridge:swap-initiated", listener);
    await bridge.atomicSwap("a", "b", "ETH", "BTC", 1, 0.05);
    expect(listener).toHaveBeenCalled();
  });

  // ── sendMessage ──────────────────────────────────────────────────────────
  it("should send a cross-chain message", async () => {
    await bridge.initialize(db);
    const msg = await bridge.sendMessage("ethereum", "solana", {
      data: "hello",
    });
    expect(msg.id).toMatch(/^msg-/);
    expect(msg.payload).toEqual({ data: "hello" });
    expect(msg.status).toBe("pending");
  });

  it("should emit bridge:message-sent event", async () => {
    await bridge.initialize(db);
    const listener = vi.fn();
    bridge.on("bridge:message-sent", listener);
    await bridge.sendMessage("ethereum", "polygon", {});
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ fromChain: "ethereum" }),
    );
  });

  // ── getBalances ──────────────────────────────────────────────────────────
  it("should return empty balances for unknown address", async () => {
    await bridge.initialize(db);
    const balances = bridge.getBalances("0xabc");
    expect(balances.ethereum).toEqual({ native: 0, tokens: {} });
    expect(Object.keys(balances).length).toBe(5);
  });

  // ── listChains ───────────────────────────────────────────────────────────
  it("should list all registered chains", async () => {
    await bridge.initialize(db);
    const chains = bridge.listChains();
    expect(chains.length).toBe(5);
    expect(chains.find((c) => c.id === "ethereum")).toBeDefined();
  });

  // ── estimateFee ──────────────────────────────────────────────────────────
  it("should estimate fee for same-type chains", async () => {
    await bridge.initialize(db);
    const fee = bridge.estimateFee("ethereum", "polygon", 1000);
    expect(fee.fee).toBeCloseTo(1);
    expect(fee.estimatedTime).toBe(300);
  });

  it("should estimate higher fee for cross-type chains", async () => {
    await bridge.initialize(db);
    const fee = bridge.estimateFee("ethereum", "solana", 1000);
    expect(fee.fee).toBeCloseTo(2);
    expect(fee.estimatedTime).toBe(600);
  });

  // ── getTransferStatus ────────────────────────────────────────────────────
  it("should return transfer status", async () => {
    await bridge.initialize(db);
    const transfer = await bridge.bridgeAsset("ethereum", "polygon", "ETH", 10);
    const status = bridge.getTransferStatus(transfer.id);
    expect(status.status).toBe("pending");
  });

  it("should return null for unknown transfer", async () => {
    await bridge.initialize(db);
    expect(bridge.getTransferStatus("nonexistent")).toBeNull();
  });

  // ── configureChain ───────────────────────────────────────────────────────
  it("should configure an existing chain", async () => {
    await bridge.initialize(db);
    const result = bridge.configureChain("ethereum", {
      rpc: "https://new-rpc.com",
    });
    expect(result.rpc).toBe("https://new-rpc.com");
  });

  it("should return null for unknown chain", async () => {
    await bridge.initialize(db);
    expect(bridge.configureChain("unknown", {})).toBeNull();
  });
});
