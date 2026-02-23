/**
 * MPCManager Unit Tests
 *
 * Covers: initialize, shamirSplit, shamirReconstruct, socialRecoverySetup,
 *         socialRecoveryRecover, distributedKeyGeneration, garbledCircuit,
 *         obliviousTransfer, spdzCompute, thresholdSign, jointAuthentication,
 *         createMPCChannel, sealedAuction, federatedLearning,
 *         complianceDataSharing, getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Note: shamir-split.js uses pure GF(256) math and has no external I/O side-effects,
// so we let the real implementation run rather than mocking it. Tests verify output
// shapes; the real split/reconstruct correctness is covered in ukey tests.

const { MPCManager } = require("../mpc-manager.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  const raw = {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
  return { db: raw, saveToFile: vi.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MPCManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new MPCManager();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await manager.initialize(mockDb);

      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent — calling twice only execs once", async () => {
      await manager.initialize(mockDb);
      const execCalls = mockDb.db.exec.mock.calls.length;

      await manager.initialize(mockDb);

      expect(mockDb.db.exec.mock.calls.length).toBe(execCalls);
      expect(manager.initialized).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // shamirSplit
  // ─────────────────────────────────────────────────────────────────────────
  describe("shamirSplit()", () => {
    it("should return sessionId, shares, threshold, totalShares (delegates to splitSecret)", async () => {
      await manager.initialize(null);

      const result = await manager.shamirSplit("my-secret-data", 3, 2);

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("shares");
      expect(result).toHaveProperty("threshold");
      expect(result).toHaveProperty("totalShares");
    });

    it("shares should be an array of strings with the expected count", async () => {
      await manager.initialize(null);

      const result = await manager.shamirSplit("secret", 3, 2);

      expect(Array.isArray(result.shares)).toBe(true);
      expect(result.shares).toHaveLength(3);
      for (const share of result.shares) {
        expect(typeof share).toBe("string");
      }
    });

    it("threshold and totalShares should match inputs", async () => {
      await manager.initialize(null);

      const result = await manager.shamirSplit("secret", 5, 3);

      expect(result.threshold).toBe(3);
      expect(result.totalShares).toBe(5);
    });

    it("should store session in DB when db is available", async () => {
      await manager.initialize(mockDb);

      await manager.shamirSplit("secret", 3, 2);

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO mpc_sessions"),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // shamirReconstruct
  // ─────────────────────────────────────────────────────────────────────────
  describe("shamirReconstruct()", () => {
    it("should return secret and sharesUsed (delegates to reconstructSecret)", async () => {
      await manager.initialize(null);

      const result = await manager.shamirReconstruct(["1:aabb", "2:ccdd"]);

      expect(result).toHaveProperty("secret");
      expect(result).toHaveProperty("sharesUsed");
    });

    it("sharesUsed should equal input shares length", async () => {
      await manager.initialize(null);
      const shares = ["1:aabb", "2:ccdd", "3:eeff"];

      const result = await manager.shamirReconstruct(shares);

      expect(result.sharesUsed).toBe(shares.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // socialRecoverySetup
  // ─────────────────────────────────────────────────────────────────────────
  describe("socialRecoverySetup()", () => {
    it("should return sessionId, guardianShares, threshold, totalGuardians", async () => {
      await manager.initialize(null);

      const result = await manager.socialRecoverySetup(
        "user-001",
        ["guardian-a", "guardian-b", "guardian-c"],
        2,
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("guardianShares");
      expect(result).toHaveProperty("threshold");
      expect(result).toHaveProperty("totalGuardians");
    });

    it("guardianShares should have guardianId and share for each guardian", async () => {
      await manager.initialize(null);
      const guardians = ["g1", "g2", "g3"];

      const result = await manager.socialRecoverySetup("user-1", guardians, 2);

      expect(result.guardianShares).toHaveLength(guardians.length);
      for (const gs of result.guardianShares) {
        expect(gs).toHaveProperty("guardianId");
        expect(gs).toHaveProperty("share");
      }
    });

    it("totalGuardians should equal guardians.length", async () => {
      await manager.initialize(null);
      const guardians = ["g1", "g2", "g3"];

      const result = await manager.socialRecoverySetup("user-1", guardians, 2);

      expect(result.totalGuardians).toBe(guardians.length);
    });

    it("should throw if threshold exceeds totalGuardians", async () => {
      await manager.initialize(null);

      await expect(
        manager.socialRecoverySetup("user-1", ["g1", "g2"], 3),
      ).rejects.toThrow("Threshold cannot exceed total guardians");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // socialRecoveryRecover
  // ─────────────────────────────────────────────────────────────────────────
  describe("socialRecoveryRecover()", () => {
    it("should return {recovered:true, recoveryKey} (delegates to reconstructSecret)", async () => {
      await manager.initialize(null);
      const guardianShares = [
        { guardianId: "g1", share: "1:aabb" },
        { guardianId: "g2", share: "2:ccdd" },
      ];

      const result = await manager.socialRecoveryRecover(guardianShares);

      expect(result.recovered).toBe(true);
      expect(result).toHaveProperty("recoveryKey");
      expect(typeof result.recoveryKey).toBe("string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // distributedKeyGeneration
  // ─────────────────────────────────────────────────────────────────────────
  describe("distributedKeyGeneration()", () => {
    it("should return sessionId, publicKey, participantShares, threshold", async () => {
      await manager.initialize(null);

      const result = await manager.distributedKeyGeneration(
        ["p1", "p2", "p3"],
        2,
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("publicKey");
      expect(result).toHaveProperty("participantShares");
      expect(result).toHaveProperty("threshold");
    });

    it("participantShares length should equal participants length", async () => {
      await manager.initialize(null);
      const participants = ["p1", "p2", "p3"];

      const result = await manager.distributedKeyGeneration(participants, 2);

      expect(result.participantShares).toHaveLength(participants.length);
    });

    it("should throw if threshold exceeds participant count", async () => {
      await manager.initialize(null);

      await expect(
        manager.distributedKeyGeneration(["p1", "p2"], 5),
      ).rejects.toThrow("Threshold cannot exceed participant count");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // garbledCircuit
  // ─────────────────────────────────────────────────────────────────────────
  describe("garbledCircuit()", () => {
    it("should return sessionId, result, gateCount, evaluationTimeMs", async () => {
      await manager.initialize(null);

      const result = await manager.garbledCircuit(
        { gates: 16, description: "test circuit" },
        [
          { participantId: "p1", value: 0 },
          { participantId: "p2", value: 1 },
        ],
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("gateCount");
      expect(result).toHaveProperty("evaluationTimeMs");
    });

    it("gateCount should be a positive number", async () => {
      await manager.initialize(null);

      const result = await manager.garbledCircuit({ gates: 8 }, [
        { participantId: "p1", value: 1 },
      ]);

      expect(result.gateCount).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // obliviousTransfer
  // ─────────────────────────────────────────────────────────────────────────
  describe("obliviousTransfer()", () => {
    it("should return sessionId, selectedValue, transferTimeMs", async () => {
      await manager.initialize(null);

      const result = await manager.obliviousTransfer(
        ["value-0", "value-1", "value-2"],
        1,
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("selectedValue");
      expect(result).toHaveProperty("transferTimeMs");
    });

    it("receiverChoice 0 should select the first item", async () => {
      await manager.initialize(null);
      const inputs = ["first", "second", "third"];

      const result = await manager.obliviousTransfer(inputs, 0);

      expect(result.selectedValue).toBe("first");
    });

    it("should throw if receiverChoice is out of bounds", async () => {
      await manager.initialize(null);

      await expect(manager.obliviousTransfer(["a", "b"], 5)).rejects.toThrow(
        "Invalid receiver choice",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // spdzCompute
  // ─────────────────────────────────────────────────────────────────────────
  describe("spdzCompute()", () => {
    const participantValues = [
      { participantId: "p1", value: 10 },
      { participantId: "p2", value: 20 },
      { participantId: "p3", value: 30 },
    ];

    it.each(["sum", "average", "max", "min", "product"])(
      "should support '%s' and return sessionId, result, participants, roundsCompleted",
      async (expression) => {
        await manager.initialize(null);

        const result = await manager.spdzCompute(expression, participantValues);

        expect(result).toHaveProperty("sessionId");
        expect(result).toHaveProperty("result");
        expect(result).toHaveProperty("participants");
        expect(result).toHaveProperty("roundsCompleted");
      },
    );

    it("participants should equal participantValues.length", async () => {
      await manager.initialize(null);

      const result = await manager.spdzCompute("sum", participantValues);

      expect(result.participants).toBe(participantValues.length);
    });

    it("should compute correct sum", async () => {
      await manager.initialize(null);

      const result = await manager.spdzCompute("sum", participantValues);

      expect(result.result).toBe(60);
    });

    it("should compute correct max", async () => {
      await manager.initialize(null);

      const result = await manager.spdzCompute("max", participantValues);

      expect(result.result).toBe(30);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // thresholdSign
  // ─────────────────────────────────────────────────────────────────────────
  describe("thresholdSign()", () => {
    it("should return signature, signerCount, threshold", async () => {
      await manager.initialize(null);

      const result = await manager.thresholdSign(
        "message to sign",
        ["share1", "share2", "share3"],
        2,
      );

      expect(result).toHaveProperty("signature");
      expect(result).toHaveProperty("signerCount");
      expect(result).toHaveProperty("threshold");
    });

    it("signerCount should equal shares.length", async () => {
      await manager.initialize(null);
      const shares = ["s1", "s2", "s3"];

      const result = await manager.thresholdSign("msg", shares, 2);

      expect(result.signerCount).toBe(shares.length);
    });

    it("should throw if shares count is below threshold", async () => {
      await manager.initialize(null);

      await expect(
        manager.thresholdSign("msg", ["only-one"], 3),
      ).rejects.toThrow("Not enough shares");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // jointAuthentication
  // ─────────────────────────────────────────────────────────────────────────
  describe("jointAuthentication()", () => {
    it("should return sessionId, authenticated:true, participantCount", async () => {
      await manager.initialize(null);

      const result = await manager.jointAuthentication(
        ["alice", "bob", "carol"],
        "challenge-nonce-abc123",
      );

      expect(result).toHaveProperty("sessionId");
      expect(result.authenticated).toBe(true);
      expect(result).toHaveProperty("participantCount");
    });

    it("participantCount should equal participants.length", async () => {
      await manager.initialize(null);
      const participants = ["p1", "p2"];

      const result = await manager.jointAuthentication(
        participants,
        "challenge",
      );

      expect(result.participantCount).toBe(participants.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createMPCChannel
  // ─────────────────────────────────────────────────────────────────────────
  describe("createMPCChannel()", () => {
    it("should return channelId, participants, protocol, status:'ready'", async () => {
      await manager.initialize(null);

      const result = await manager.createMPCChannel(
        ["alice", "bob"],
        "garbled-circuit",
      );

      expect(result).toHaveProperty("channelId");
      expect(result).toHaveProperty("participants");
      expect(result).toHaveProperty("protocol");
      expect(result.status).toBe("ready");
    });

    it("should return the original participants array", async () => {
      await manager.initialize(null);
      const participants = ["p1", "p2", "p3"];

      const result = await manager.createMPCChannel(participants, "spdz");

      expect(result.participants).toEqual(participants);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sealedAuction
  // ─────────────────────────────────────────────────────────────────────────
  describe("sealedAuction()", () => {
    const bids = [
      { bidderId: "bidder-1", amount: 500 },
      { bidderId: "bidder-2", amount: 800 },
      { bidderId: "bidder-3", amount: 350 },
    ];

    it("should return sessionId, winnerId, winningBid, totalBids, protocol", async () => {
      await manager.initialize(null);

      const result = await manager.sealedAuction(bids);

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("winnerId");
      expect(result).toHaveProperty("winningBid");
      expect(result).toHaveProperty("totalBids");
      expect(result).toHaveProperty("protocol");
    });

    it("winnerId should be the bidderId with the highest bid", async () => {
      await manager.initialize(null);

      const result = await manager.sealedAuction(bids);

      expect(result.winnerId).toBe("bidder-2");
      expect(result.winningBid).toBe(800);
    });

    it("totalBids should equal bids.length", async () => {
      await manager.initialize(null);

      const result = await manager.sealedAuction(bids);

      expect(result.totalBids).toBe(bids.length);
    });

    it("should throw if bids array is empty", async () => {
      await manager.initialize(null);

      await expect(manager.sealedAuction([])).rejects.toThrow(
        "At least one bid is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // federatedLearning
  // ─────────────────────────────────────────────────────────────────────────
  describe("federatedLearning()", () => {
    const participantUpdates = [
      { participantId: "p1", weights: [0.1, 0.2, 0.3], sampleCount: 100 },
      { participantId: "p2", weights: [0.4, 0.5, 0.6], sampleCount: 200 },
    ];

    it("should return sessionId, aggregatedUpdate, participantCount, roundId", async () => {
      await manager.initialize(null);

      const result = await manager.federatedLearning(
        "model-v1",
        participantUpdates,
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("aggregatedUpdate");
      expect(result).toHaveProperty("participantCount");
      expect(result).toHaveProperty("roundId");
    });

    it("participantCount should equal participantUpdates.length", async () => {
      await manager.initialize(null);

      const result = await manager.federatedLearning(
        "model-v1",
        participantUpdates,
      );

      expect(result.participantCount).toBe(participantUpdates.length);
    });

    it("aggregatedUpdate should be an array of the same length as weights", async () => {
      await manager.initialize(null);

      const result = await manager.federatedLearning(
        "model-v1",
        participantUpdates,
      );

      expect(Array.isArray(result.aggregatedUpdate)).toBe(true);
      expect(result.aggregatedUpdate).toHaveLength(
        participantUpdates[0].weights.length,
      );
    });

    it("should throw if participantUpdates is empty", async () => {
      await manager.initialize(null);

      await expect(manager.federatedLearning("model-v1", [])).rejects.toThrow(
        "At least one participant update is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // complianceDataSharing
  // ─────────────────────────────────────────────────────────────────────────
  describe("complianceDataSharing()", () => {
    const dataOwners = ["org-alpha", "org-beta", "org-gamma"];

    it("should return sessionId, resultHash, dataOwnersCount, policyCompliant:true", async () => {
      await manager.initialize(null);

      const result = await manager.complianceDataSharing(
        dataOwners,
        "SELECT AVG(salary) FROM employees",
        { auditRequired: true },
      );

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("resultHash");
      expect(result).toHaveProperty("dataOwnersCount");
      expect(result.policyCompliant).toBe(true);
    });

    it("dataOwnersCount should equal dataOwners.length", async () => {
      await manager.initialize(null);

      const result = await manager.complianceDataSharing(
        dataOwners,
        "SELECT COUNT(*)",
        {},
      );

      expect(result.dataOwnersCount).toBe(dataOwners.length);
    });

    it("should throw if dataOwners is empty", async () => {
      await manager.initialize(null);

      await expect(
        manager.complianceDataSharing([], "SELECT 1", {}),
      ).rejects.toThrow("At least one data owner is required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return zeroed stats shape when db has no rows", async () => {
      await manager.initialize(mockDb);

      const stats = await manager.getStats();

      expect(stats).toHaveProperty("totalSessions");
      expect(stats).toHaveProperty("byType");
      expect(stats).toHaveProperty("byStatus");
      expect(stats).toHaveProperty("avgParticipants");
      expect(stats.totalSessions).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byStatus).toEqual({});
      expect(stats.avgParticipants).toBe(0);
    });

    it("should return zeroed stats when no db is set", async () => {
      await manager.initialize(null);

      const stats = await manager.getStats();

      expect(stats.totalSessions).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byStatus).toEqual({});
      expect(stats.avgParticipants).toBe(0);
    });
  });
});
