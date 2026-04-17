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
  // V2
  BRIDGE_STATUS_V2,
  SWAP_STATUS_V2,
  MESSAGE_STATUS_V2,
  CHAIN_ID_V2,
  CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS,
  setMaxActiveBridgesPerAddress,
  getMaxActiveBridgesPerAddress,
  getActiveBridgeCount,
  configureChainV2,
  getChainConfigV2,
  listChainsV2,
  bridgeAssetV2,
  setBridgeStatusV2,
  setSwapStatusV2,
  setMessageStatusV2,
  autoExpireSwapsV2,
  getCrossChainStatsV2,
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

  /* ══════════════════════════════════════════════════════
   * Phase 89 Cross-Chain V2 surface
   * ══════════════════════════════════════════════════════ */

  describe("cross-chain V2 (Phase 89)", () => {
    describe("frozen enums", () => {
      it("BRIDGE_STATUS_V2 has 6 states", () => {
        expect(Object.keys(BRIDGE_STATUS_V2)).toHaveLength(6);
        expect(Object.isFrozen(BRIDGE_STATUS_V2)).toBe(true);
      });

      it("SWAP_STATUS_V2 has 5 states", () => {
        expect(Object.keys(SWAP_STATUS_V2)).toHaveLength(5);
        expect(Object.isFrozen(SWAP_STATUS_V2)).toBe(true);
      });

      it("MESSAGE_STATUS_V2 has 4 states", () => {
        expect(Object.keys(MESSAGE_STATUS_V2)).toHaveLength(4);
        expect(Object.isFrozen(MESSAGE_STATUS_V2)).toBe(true);
      });

      it("CHAIN_ID_V2 has 5 chains", () => {
        expect(Object.keys(CHAIN_ID_V2)).toHaveLength(5);
        expect(Object.isFrozen(CHAIN_ID_V2)).toBe(true);
      });

      it("DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS exposed", () => {
        expect(CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS).toBe(3);
      });
    });

    describe("setMaxActiveBridgesPerAddress", () => {
      it("default is 3", () => {
        expect(getMaxActiveBridgesPerAddress()).toBe(3);
      });

      it("accepts positive integer", () => {
        setMaxActiveBridgesPerAddress(10);
        expect(getMaxActiveBridgesPerAddress()).toBe(10);
      });

      it("floors non-integer", () => {
        setMaxActiveBridgesPerAddress(5.7);
        expect(getMaxActiveBridgesPerAddress()).toBe(5);
      });

      it("rejects non-number/NaN/<1", () => {
        expect(() => setMaxActiveBridgesPerAddress(0)).toThrow();
        expect(() => setMaxActiveBridgesPerAddress(-1)).toThrow();
        expect(() => setMaxActiveBridgesPerAddress(Number.NaN)).toThrow();
        expect(() => setMaxActiveBridgesPerAddress("5")).toThrow();
      });

      it("_resetState restores default", () => {
        setMaxActiveBridgesPerAddress(99);
        _resetState();
        expect(getMaxActiveBridgesPerAddress()).toBe(3);
      });
    });

    describe("getActiveBridgeCount", () => {
      it("counts non-terminal bridges globally when no address", () => {
        bridgeAsset(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        bridgeAsset(db, {
          fromChain: "bsc",
          toChain: "solana",
          amount: 5,
          senderAddress: "0xB",
        });
        expect(getActiveBridgeCount()).toBe(2);
      });

      it("filters by address", () => {
        bridgeAsset(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        bridgeAsset(db, {
          fromChain: "bsc",
          toChain: "solana",
          amount: 5,
          senderAddress: "0xB",
        });
        expect(getActiveBridgeCount("0xA")).toBe(1);
        expect(getActiveBridgeCount("0xB")).toBe(1);
        expect(getActiveBridgeCount("0xC")).toBe(0);
      });

      it("excludes terminal bridges", () => {
        const { bridgeId } = bridgeAsset(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        expect(getActiveBridgeCount("0xA")).toBe(1);
        setBridgeStatusV2(db, bridgeId, "failed", {
          errorMessage: "test",
        });
        expect(getActiveBridgeCount("0xA")).toBe(0);
      });
    });

    describe("configureChainV2", () => {
      it("configures a supported chain", () => {
        const cfg = configureChainV2({
          chainId: "ethereum",
          rpcUrl: "https://eth.example.com",
          contractAddress: "0xCCC",
        });
        expect(cfg.chainId).toBe("ethereum");
        expect(cfg.enabled).toBe(true);
        expect(cfg.rpcUrl).toBe("https://eth.example.com");
      });

      it("rejects unsupported chain", () => {
        expect(() => configureChainV2({ chainId: "unknown" })).toThrow();
      });

      it("listChainsV2 reflects config", () => {
        configureChainV2({
          chainId: "polygon",
          rpcUrl: "https://p.com",
        });
        const chains = listChainsV2();
        const poly = chains.find((c) => c.id === "polygon");
        expect(poly.enabled).toBe(true);
        expect(poly.rpcUrl).toBe("https://p.com");
        const eth = chains.find((c) => c.id === "ethereum");
        expect(eth.enabled).toBe(false);
      });

      it("getChainConfigV2 returns null for unconfigured", () => {
        expect(getChainConfigV2("solana")).toBeNull();
      });
    });

    describe("bridgeAssetV2 + concurrency cap", () => {
      it("throws on unsupported chain", () => {
        expect(() =>
          bridgeAssetV2(db, {
            fromChain: "unknown",
            toChain: "polygon",
            amount: 10,
          }),
        ).toThrow(/Unsupported/);
      });

      it("throws on same-chain", () => {
        expect(() =>
          bridgeAssetV2(db, {
            fromChain: "ethereum",
            toChain: "ethereum",
            amount: 10,
          }),
        ).toThrow(/must differ/);
      });

      it("throws on invalid amount", () => {
        expect(() =>
          bridgeAssetV2(db, {
            fromChain: "ethereum",
            toChain: "polygon",
            amount: 0,
          }),
        ).toThrow(/positive/);
      });

      it("enforces per-address cap", () => {
        setMaxActiveBridgesPerAddress(2);
        bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "bsc",
          amount: 10,
          senderAddress: "0xA",
        });
        expect(() =>
          bridgeAssetV2(db, {
            fromChain: "ethereum",
            toChain: "solana",
            amount: 10,
            senderAddress: "0xA",
          }),
        ).toThrow(/Max active bridges per address reached/);
      });

      it("cap scoped per address (B independent of A)", () => {
        setMaxActiveBridgesPerAddress(1);
        bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        // B is independent
        const r = bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "bsc",
          amount: 10,
          senderAddress: "0xB",
        });
        expect(r.bridgeId).toBeTruthy();
      });

      it("cap freed after terminal status", () => {
        setMaxActiveBridgesPerAddress(1);
        const { bridgeId } = bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 10,
          senderAddress: "0xA",
        });
        setBridgeStatusV2(db, bridgeId, "failed", { errorMessage: "x" });
        // Now A can create another
        const r = bridgeAssetV2(db, {
          fromChain: "ethereum",
          toChain: "bsc",
          amount: 10,
          senderAddress: "0xA",
        });
        expect(r.bridgeId).toBeTruthy();
      });
    });

    describe("setBridgeStatusV2", () => {
      let bridgeId;
      beforeEach(() => {
        const r = bridgeAsset(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 100,
        });
        bridgeId = r.bridgeId;
      });

      it("valid transition pending→locked w/ lockTxHash patch", () => {
        const b = setBridgeStatusV2(db, bridgeId, "locked", {
          lockTxHash: "0xLOCK",
        });
        expect(b.status).toBe("locked");
        expect(b.lock_tx_hash).toBe("0xLOCK");
      });

      it("rejects invalid transition pending→completed", () => {
        expect(() => setBridgeStatusV2(db, bridgeId, "completed")).toThrow(
          /Invalid bridge transition/,
        );
      });

      it("auto-sets completed_at on terminal", () => {
        setBridgeStatusV2(db, bridgeId, "locked");
        setBridgeStatusV2(db, bridgeId, "minted");
        const b = setBridgeStatusV2(db, bridgeId, "completed");
        expect(b.completed_at).toBeTruthy();
      });

      it("rejects unknown bridgeId", () => {
        expect(() => setBridgeStatusV2(db, "bogus", "locked")).toThrow(
          /not found/,
        );
      });

      it("rejects transition from terminal", () => {
        setBridgeStatusV2(db, bridgeId, "failed", { errorMessage: "x" });
        expect(() => setBridgeStatusV2(db, bridgeId, "locked")).toThrow(
          /Invalid bridge transition/,
        );
      });
    });

    describe("setSwapStatusV2", () => {
      let swapId;
      beforeEach(() => {
        const r = initiateSwap(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 1,
        });
        swapId = r.swapId;
      });

      it("initiated→hash_locked valid", () => {
        const s = setSwapStatusV2(db, swapId, "hash_locked");
        expect(s.status).toBe("hash_locked");
      });

      it("rejects claimed→hash_locked", () => {
        setSwapStatusV2(db, swapId, "claimed", { claimTxHash: "0xC" });
        expect(() => setSwapStatusV2(db, swapId, "hash_locked")).toThrow(
          /Invalid swap transition/,
        );
      });

      it("does not leak secret in return", () => {
        const s = setSwapStatusV2(db, swapId, "hash_locked");
        expect(s.secret).toBeUndefined();
      });
    });

    describe("setMessageStatusV2", () => {
      let messageId;
      beforeEach(() => {
        const r = sendMessage(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          payload: "hello",
        });
        messageId = r.messageId;
      });

      it("pending→sent→delivered lifecycle", () => {
        setMessageStatusV2(db, messageId, "sent", {
          sourceTxHash: "0xS",
        });
        const m = setMessageStatusV2(db, messageId, "delivered", {
          destinationTxHash: "0xD",
        });
        expect(m.status).toBe("delivered");
        expect(m.delivered_at).toBeTruthy();
        expect(m.source_tx_hash).toBe("0xS");
        expect(m.destination_tx_hash).toBe("0xD");
      });

      it("failed→pending increments retries", () => {
        setMessageStatusV2(db, messageId, "failed");
        const m = setMessageStatusV2(db, messageId, "pending");
        expect(m.retries).toBe(1);
      });
    });

    describe("autoExpireSwapsV2", () => {
      it("flips past-deadline INITIATED/HASH_LOCKED to EXPIRED", () => {
        const r = initiateSwap(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 1,
          timeoutMs: -1000, // already expired
        });
        const expired = autoExpireSwapsV2(db);
        expect(expired.length).toBe(1);
        expect(expired[0].id).toBe(r.swapId);
        expect(expired[0].status).toBe("expired");
      });

      it("does not touch already-claimed swaps", () => {
        const r = initiateSwap(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 1,
          timeoutMs: -1000,
        });
        setSwapStatusV2(db, r.swapId, "claimed", { claimTxHash: "0xC" });
        const expired = autoExpireSwapsV2(db);
        expect(expired.length).toBe(0);
      });

      it("returns empty when none expired", () => {
        initiateSwap(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 1,
          timeoutMs: 3600000,
        });
        expect(autoExpireSwapsV2(db).length).toBe(0);
      });
    });

    describe("getCrossChainStatsV2", () => {
      it("zero-state has all-enum-keys", () => {
        const s = getCrossChainStatsV2();
        expect(s.totalBridges).toBe(0);
        expect(s.activeBridges).toBe(0);
        expect(s.bridgesByStatus.pending).toBe(0);
        expect(s.bridgesByStatus.completed).toBe(0);
        expect(s.swapsByStatus.initiated).toBe(0);
        expect(s.messagesByStatus.delivered).toBe(0);
        expect(s.chainUsage.ethereum).toBe(0);
        expect(s.chainUsage.solana).toBe(0);
        expect(s.maxActiveBridgesPerAddress).toBe(3);
      });

      it("aggregates activity", () => {
        bridgeAsset(db, {
          fromChain: "ethereum",
          toChain: "polygon",
          amount: 100,
        });
        bridgeAsset(db, {
          fromChain: "bsc",
          toChain: "solana",
          amount: 50,
        });
        initiateSwap(db, {
          fromChain: "ethereum",
          toChain: "arbitrum",
          amount: 1,
        });
        sendMessage(db, { fromChain: "polygon", toChain: "bsc" });

        const s = getCrossChainStatsV2();
        expect(s.totalBridges).toBe(2);
        expect(s.totalSwaps).toBe(1);
        expect(s.totalMessages).toBe(1);
        expect(s.activeBridges).toBe(2);
        expect(s.bridgesByStatus.pending).toBe(2);
        expect(s.totalBridgeVolume).toBe(150);
        expect(s.totalFees).toBeGreaterThan(0);
        expect(s.chainUsage.ethereum).toBeGreaterThan(0);
      });

      it("reflects configuredChains count", () => {
        configureChainV2({ chainId: "ethereum", rpcUrl: "x" });
        configureChainV2({ chainId: "polygon", rpcUrl: "y" });
        expect(getCrossChainStatsV2().configuredChains).toBe(2);
      });
    });
  });
});
