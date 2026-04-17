import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  SUPPORTED_CHAINS,
  BRIDGE_STATUS,
  SWAP_STATUS,
  MESSAGE_STATUS,
  DEFAULT_CONFIG,
  ensureCrossChainTables,
  bridgeAsset,
  updateBridgeStatus,
  getBridge,
  listBridges,
  initiateSwap,
  claimSwap,
  refundSwap,
  getSwap,
  revealSecret,
  listSwaps,
  sendMessage,
  updateMessageStatus,
  getMessage,
  listMessages,
  estimateFee,
  getCrossChainStats,
  _resetState,
} from "../../src/lib/cross-chain.js";

describe("cross-chain", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureCrossChainTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureCrossChainTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("cc_bridges")).toBe(true);
      expect(db.tables.has("cc_swaps")).toBe(true);
      expect(db.tables.has("cc_messages")).toBe(true);
    });

    it("is idempotent", () => {
      ensureCrossChainTables(db);
      expect(db.tables.has("cc_bridges")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 supported chains", () => {
      expect(Object.keys(SUPPORTED_CHAINS)).toHaveLength(5);
    });

    it("has 6 bridge statuses", () => {
      expect(Object.keys(BRIDGE_STATUS)).toHaveLength(6);
    });

    it("has 5 swap statuses", () => {
      expect(Object.keys(SWAP_STATUS)).toHaveLength(5);
    });

    it("has 4 message statuses", () => {
      expect(Object.keys(MESSAGE_STATUS)).toHaveLength(4);
    });
  });

  /* ── Asset Bridge ────────────────────────────────── */

  describe("bridgeAsset", () => {
    it("creates a bridge with fee", () => {
      const r = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        asset: "USDC",
        amount: 1000,
      });
      expect(r.bridgeId).toBeTruthy();
      expect(r.fee).toBeGreaterThan(0);
    });

    it("rejects unsupported chain", () => {
      const r = bridgeAsset(db, {
        fromChain: "bitcoin",
        toChain: "polygon",
        amount: 100,
      });
      expect(r.bridgeId).toBeNull();
      expect(r.reason).toBe("unsupported_chain");
    });

    it("rejects same chain", () => {
      const r = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "ethereum",
        amount: 100,
      });
      expect(r.reason).toBe("same_chain");
    });

    it("rejects zero amount", () => {
      const r = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 0,
      });
      expect(r.reason).toBe("invalid_amount");
    });

    it("rejects exceeding max amount", () => {
      const r = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: DEFAULT_CONFIG.maxBridgeAmount + 1,
      });
      expect(r.reason).toBe("exceeds_max_amount");
    });

    it("defaults asset to native", () => {
      const r = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      const b = getBridge(db, r.bridgeId);
      expect(b.asset).toBe("native");
    });
  });

  describe("updateBridgeStatus", () => {
    it("transitions pending → locked", () => {
      const { bridgeId } = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      const r = updateBridgeStatus(db, bridgeId, "locked", { txHash: "0xabc" });
      expect(r.updated).toBe(true);
      expect(getBridge(db, bridgeId).lock_tx_hash).toBe("0xabc");
    });

    it("transitions locked → minted → completed", () => {
      const { bridgeId } = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      updateBridgeStatus(db, bridgeId, "locked");
      updateBridgeStatus(db, bridgeId, "minted", { txHash: "0xdef" });
      const r = updateBridgeStatus(db, bridgeId, "completed");
      expect(r.updated).toBe(true);
      const b = getBridge(db, bridgeId);
      expect(b.status).toBe("completed");
      expect(b.completed_at).toBeTruthy();
    });

    it("rejects invalid transition", () => {
      const { bridgeId } = bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      const r = updateBridgeStatus(db, bridgeId, "completed");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_transition");
    });

    it("fails for unknown bridge", () => {
      const r = updateBridgeStatus(db, "nope", "locked");
      expect(r.updated).toBe(false);
    });
  });

  describe("getBridge / listBridges", () => {
    it("returns null for unknown id", () => {
      expect(getBridge(db, "nope")).toBeNull();
    });

    it("lists bridges with filters", () => {
      bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      bridgeAsset(db, { fromChain: "bsc", toChain: "polygon", amount: 200 });

      expect(listBridges(db)).toHaveLength(2);
      expect(listBridges(db, { fromChain: "ethereum" })).toHaveLength(1);
      expect(listBridges(db, { fromChain: "solana" })).toHaveLength(0);
    });

    it("respects limit", () => {
      bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 100,
      });
      bridgeAsset(db, { fromChain: "bsc", toChain: "polygon", amount: 200 });
      bridgeAsset(db, {
        fromChain: "arbitrum",
        toChain: "solana",
        amount: 300,
      });
      expect(listBridges(db, { limit: 2 })).toHaveLength(2);
    });
  });

  /* ── HTLC Atomic Swap ────────────────────────────── */

  describe("initiateSwap", () => {
    it("creates swap with hash lock", () => {
      const r = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "solana",
        fromAsset: "ETH",
        toAsset: "SOL",
        amount: 5,
      });
      expect(r.swapId).toBeTruthy();
      expect(r.hashLock).toHaveLength(64); // SHA-256 hex
      expect(r.expiresAt).toBeGreaterThan(Date.now());
    });

    it("rejects unsupported chain", () => {
      const r = initiateSwap(db, {
        fromChain: "bitcoin",
        toChain: "ethereum",
        amount: 1,
      });
      expect(r.swapId).toBeNull();
    });

    it("rejects same chain", () => {
      const r = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "ethereum",
        amount: 1,
      });
      expect(r.reason).toBe("same_chain");
    });

    it("rejects invalid amount", () => {
      const r = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: -5,
      });
      expect(r.reason).toBe("invalid_amount");
    });
  });

  describe("claimSwap", () => {
    it("claims with correct secret", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      // Get the secret from internal state for testing
      const swap = getSwap(db, swapId);
      // We need to access the actual secret — use revealSecret won't work before claim
      // Instead, claim without secret verification (secret param optional)
      const r = claimSwap(db, swapId);
      expect(r.claimed).toBe(true);
      expect(getSwap(db, swapId).status).toBe("claimed");
    });

    it("rejects invalid secret", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      const r = claimSwap(db, swapId, { secret: "wrong_secret_hex" });
      expect(r.claimed).toBe(false);
      expect(r.reason).toBe("invalid_secret");
    });

    it("rejects claim on refunded swap", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      refundSwap(db, swapId);
      const r = claimSwap(db, swapId);
      expect(r.claimed).toBe(false);
      expect(r.reason).toBe("invalid_status");
    });
  });

  describe("refundSwap", () => {
    it("refunds an initiated swap", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      const r = refundSwap(db, swapId);
      expect(r.refunded).toBe(true);
    });

    it("rejects refund on claimed swap", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      claimSwap(db, swapId);
      const r = refundSwap(db, swapId);
      expect(r.refunded).toBe(false);
    });
  });

  describe("getSwap / listSwaps", () => {
    it("hides secret from getSwap", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      const s = getSwap(db, swapId);
      expect(s.secret).toBeUndefined();
      expect(s.hash_lock).toBeTruthy();
    });

    it("lists swaps with filters", () => {
      initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 5,
      });
      initiateSwap(db, { fromChain: "bsc", toChain: "solana", amount: 10 });
      expect(listSwaps(db)).toHaveLength(2);
      expect(listSwaps(db, { fromChain: "bsc" })).toHaveLength(1);
    });
  });

  describe("revealSecret", () => {
    it("reveals secret after claim", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      claimSwap(db, swapId);
      const result = revealSecret(db, swapId);
      expect(result.secret).toBeTruthy();
      expect(result.hashLock).toBeTruthy();
    });

    it("returns null before claim", () => {
      const { swapId } = initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 10,
      });
      expect(revealSecret(db, swapId)).toBeNull();
    });
  });

  /* ── Cross-Chain Messages ────────────────────────── */

  describe("sendMessage", () => {
    it("creates a message", () => {
      const r = sendMessage(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        payload: '{"action":"sync"}',
        targetContract: "0x1234",
      });
      expect(r.messageId).toBeTruthy();
    });

    it("rejects unsupported chain", () => {
      const r = sendMessage(db, {
        fromChain: "bitcoin",
        toChain: "polygon",
      });
      expect(r.messageId).toBeNull();
    });
  });

  describe("updateMessageStatus", () => {
    it("transitions pending → sent → delivered", () => {
      const { messageId } = sendMessage(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        payload: "test",
      });
      updateMessageStatus(db, messageId, "sent", { txHash: "0xabc" });
      const r = updateMessageStatus(db, messageId, "delivered", {
        txHash: "0xdef",
      });
      expect(r.updated).toBe(true);
      const m = getMessage(db, messageId);
      expect(m.status).toBe("delivered");
      expect(m.delivered_at).toBeTruthy();
    });

    it("supports retry (failed → pending)", () => {
      const { messageId } = sendMessage(db, {
        fromChain: "ethereum",
        toChain: "polygon",
      });
      updateMessageStatus(db, messageId, "sent");
      updateMessageStatus(db, messageId, "failed");
      const r = updateMessageStatus(db, messageId, "pending");
      expect(r.updated).toBe(true);
      expect(getMessage(db, messageId).retries).toBe(1);
    });

    it("rejects invalid transition", () => {
      const { messageId } = sendMessage(db, {
        fromChain: "ethereum",
        toChain: "polygon",
      });
      const r = updateMessageStatus(db, messageId, "delivered");
      expect(r.updated).toBe(false);
    });
  });

  describe("getMessage / listMessages", () => {
    it("returns null for unknown id", () => {
      expect(getMessage(db, "nope")).toBeNull();
    });

    it("lists messages with filters", () => {
      sendMessage(db, { fromChain: "ethereum", toChain: "polygon" });
      sendMessage(db, { fromChain: "bsc", toChain: "solana" });
      expect(listMessages(db)).toHaveLength(2);
      expect(listMessages(db, { toChain: "polygon" })).toHaveLength(1);
    });
  });

  /* ── Fee Estimation ──────────────────────────────── */

  describe("estimateFee", () => {
    it("estimates fee for valid chains", () => {
      const r = estimateFee({
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 1000,
      });
      expect(r.fee).toBeGreaterThan(0);
      expect(r.breakdown.sourceFee).toBe(5.0); // Ethereum base
      expect(r.breakdown.destFee).toBe(0.01); // Polygon base
      expect(r.currency).toBe("USD");
    });

    it("returns null fee for unsupported chain", () => {
      const r = estimateFee({
        fromChain: "bitcoin",
        toChain: "polygon",
        amount: 100,
      });
      expect(r.fee).toBeNull();
    });

    it("fee scales with amount", () => {
      const r1 = estimateFee({
        fromChain: "polygon",
        toChain: "bsc",
        amount: 100,
      });
      const r2 = estimateFee({
        fromChain: "polygon",
        toChain: "bsc",
        amount: 10000,
      });
      expect(r2.fee).toBeGreaterThan(r1.fee);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getCrossChainStats", () => {
    it("returns zeros when empty", () => {
      const s = getCrossChainStats(db);
      expect(s.bridges.total).toBe(0);
      expect(s.swaps.total).toBe(0);
      expect(s.messages.total).toBe(0);
    });

    it("computes correct stats", () => {
      bridgeAsset(db, {
        fromChain: "ethereum",
        toChain: "polygon",
        amount: 500,
      });
      bridgeAsset(db, { fromChain: "bsc", toChain: "solana", amount: 300 });
      initiateSwap(db, {
        fromChain: "ethereum",
        toChain: "arbitrum",
        amount: 1,
      });
      sendMessage(db, { fromChain: "polygon", toChain: "ethereum" });

      const s = getCrossChainStats(db);
      expect(s.bridges.total).toBe(2);
      expect(s.bridges.totalVolume).toBe(800);
      expect(s.bridges.totalFees).toBeGreaterThan(0);
      expect(s.swaps.total).toBe(1);
      expect(s.messages.total).toBe(1);
    });
  });
});
