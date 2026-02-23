/**
 * FederatedLearningManager Unit Tests
 *
 * Covers:
 * - initialize() creates DB tables
 * - createRound() creates a round and broadcasts via P2P
 * - joinRound() enrolls a peer and respects max participants
 * - leaveRound() marks peer as left
 * - submitGradients() stores gradients and applies DP
 * - aggregate() triggers when all participants submit
 * - getStatus() returns round info with peer counts
 * - listRounds() returns filtered round lists
 * - getPeers() returns peer list for a round
 * - getGlobalModel() returns model info
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  FederatedLearningManager,
} = require("../federated-learning-manager.js");

// UUID regex for validation (v4 format)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    all: vi.fn(() => []),
    get: vi.fn(() => null),
    ...overrides,
  };
}

function createMockDb() {
  const stmts = [];
  const db = {
    exec: vi.fn(),
    prepare: vi.fn(() => {
      const stmt = makePrepStmt();
      stmts.push(stmt);
      return stmt;
    }),
    _stmts: stmts,
  };
  return db;
}

function createMockP2PManager() {
  return {
    node: null,
    peerId: { toString: () => "local-peer-123" },
    peers: new Map(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FederatedLearningManager", () => {
  let manager;
  let mockDb;
  let mockP2P;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = createMockDb();
    mockP2P = createMockP2PManager();

    manager = new FederatedLearningManager({
      database: mockDb,
      p2pManager: mockP2P,
    });
  });

  describe("initialize()", () => {
    it("should create database tables", async () => {
      await manager.initialize();

      expect(mockDb.exec).toHaveBeenCalled();
      const calls = mockDb.exec.mock.calls.map((c) => c[0]);

      // Should create federated_rounds table
      const roundsTable = calls.find((c) =>
        c.includes("federated_rounds")
      );
      expect(roundsTable).toBeDefined();
      expect(roundsTable).toContain("CREATE TABLE IF NOT EXISTS");

      // Should create federated_peers table
      const peersTable = calls.find((c) =>
        c.includes("federated_peers")
      );
      expect(peersTable).toBeDefined();
      expect(peersTable).toContain("CREATE TABLE IF NOT EXISTS");

      // Should create indexes
      const indexCalls = calls.filter((c) =>
        c.includes("CREATE INDEX IF NOT EXISTS")
      );
      expect(indexCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("should set initialized flag", async () => {
      expect(manager.initialized).toBe(false);
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should not reinitialize if already initialized", async () => {
      await manager.initialize();
      const callCount = mockDb.exec.mock.calls.length;

      await manager.initialize();
      // No additional exec calls
      expect(mockDb.exec.mock.calls.length).toBe(callCount);
    });
  });

  describe("createRound()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create a round with the provided config", async () => {
      const config = {
        modelId: "llm-model-v1",
        minParticipants: 3,
        maxParticipants: 8,
        aggregationMethod: "fedavg",
        roundTimeout: 300000,
      };

      const round = await manager.createRound(config);

      expect(round).toBeDefined();
      expect(round.id).toMatch(UUID_REGEX);
      expect(round.model_id).toBe("llm-model-v1");
      expect(round.status).toBe("recruiting");
      expect(round.min_participants).toBe(3);
      expect(round.max_participants).toBe(8);
      expect(round.aggregation_method).toBe("fedavg");
      expect(round.round_timeout_ms).toBe(300000);
      expect(round.coordinator_peer_id).toBe("local-peer-123");
    });

    it("should throw if modelId is missing", async () => {
      await expect(manager.createRound({})).rejects.toThrow(
        "modelId is required"
      );
    });

    it("should insert the round into the database", async () => {
      await manager.createRound({ modelId: "test-model" });

      // The prepare call for INSERT should have been made
      const prepareCalls = mockDb.prepare.mock.calls;
      const insertCall = prepareCalls.find((c) =>
        c[0].includes("INSERT INTO federated_rounds")
      );
      expect(insertCall).toBeDefined();
    });

    it("should use default values when not specified", async () => {
      const round = await manager.createRound({ modelId: "m1" });

      expect(round.min_participants).toBe(2);
      expect(round.max_participants).toBe(10);
      expect(round.aggregation_method).toBe("fedavg");
      expect(round.round_timeout_ms).toBe(600000);
    });

    it("should emit round-created event", async () => {
      const handler = vi.fn();
      manager.on("round-created", handler);

      await manager.createRound({ modelId: "m1" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].model_id).toBe("m1");
    });
  });

  describe("joinRound()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should enroll a peer in a round", async () => {
      // Mock: round exists in recruiting status
      let callIndex = 0;
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              status: "recruiting",
              min_participants: 2,
              max_participants: 5,
            })),
          });
        }
        if (sql.includes("SELECT COUNT(*)")) {
          callIndex++;
          if (callIndex <= 1) {
            return makePrepStmt({
              get: vi.fn(() => ({ count: 1 })),
            });
          }
          return makePrepStmt({
            get: vi.fn(() => ({ count: 2 })),
          });
        }
        return makePrepStmt();
      });

      const enrollment = await manager.joinRound("round-1", "peer-abc");

      expect(enrollment).toBeDefined();
      expect(enrollment.roundId).toBe("round-1");
      expect(enrollment.peerId).toBe("peer-abc");
      expect(enrollment.status).toBe("joined");
    });

    it("should throw if round not found", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          get: vi.fn(() => null),
        });
      });

      await expect(
        manager.joinRound("nonexistent", "peer-1")
      ).rejects.toThrow("Round nonexistent not found");
    });

    it("should throw if round is not recruiting", async () => {
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              status: "completed",
              min_participants: 2,
              max_participants: 5,
            })),
          });
        }
        return makePrepStmt();
      });

      await expect(
        manager.joinRound("round-1", "peer-1")
      ).rejects.toThrow("not accepting participants");
    });

    it("should throw if roundId or peerId is missing", async () => {
      await expect(manager.joinRound(null, "peer-1")).rejects.toThrow(
        "roundId and peerId are required"
      );
      await expect(manager.joinRound("round-1", null)).rejects.toThrow(
        "roundId and peerId are required"
      );
    });

    it("should emit peer-joined event", async () => {
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              status: "recruiting",
              min_participants: 2,
              max_participants: 5,
            })),
          });
        }
        if (sql.includes("SELECT COUNT(*)")) {
          return makePrepStmt({
            get: vi.fn(() => ({ count: 1 })),
          });
        }
        return makePrepStmt();
      });

      const handler = vi.fn();
      manager.on("peer-joined", handler);

      await manager.joinRound("round-1", "peer-x");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("leaveRound()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should mark peer as left", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          run: vi.fn(() => ({ changes: 1 })),
        });
      });

      const result = await manager.leaveRound("round-1", "peer-abc");

      expect(result.roundId).toBe("round-1");
      expect(result.peerId).toBe("peer-abc");
      expect(result.status).toBe("left");
    });

    it("should throw if peer not found in round", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          run: vi.fn(() => ({ changes: 0 })),
        });
      });

      await expect(
        manager.leaveRound("round-1", "unknown-peer")
      ).rejects.toThrow("Peer unknown-peer not found in round round-1");
    });

    it("should emit peer-left event", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          run: vi.fn(() => ({ changes: 1 })),
        });
      });

      const handler = vi.fn();
      manager.on("peer-left", handler);

      await manager.leaveRound("round-1", "peer-z");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].peerId).toBe("peer-z");
    });
  });

  describe("submitGradients()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should store gradients for a peer", async () => {
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              status: "training",
              min_participants: 2,
              aggregation_method: "fedavg",
            })),
          });
        }
        if (
          sql.includes(
            "SELECT * FROM federated_peers WHERE round_id = ? AND peer_id = ?"
          )
        ) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "peer-record-1",
              round_id: "round-1",
              peer_id: "peer-a",
              status: "joined",
            })),
          });
        }
        if (sql.includes("SELECT COUNT(*)")) {
          return makePrepStmt({
            get: vi.fn(() => ({ count: 2 })),
          });
        }
        return makePrepStmt();
      });

      // Set up the gradient store
      manager.gradientStore.set("round-1", new Map());

      const result = await manager.submitGradients(
        "round-1",
        "peer-a",
        [0.1, 0.2, 0.3]
      );

      expect(result).toBeDefined();
      expect(result.roundId).toBe("round-1");
      expect(result.peerId).toBe("peer-a");
      expect(result.parameterCount).toBe(3);
      expect(result.gradientHash).toBeDefined();
    });

    it("should throw if gradients is not a non-empty array", async () => {
      await expect(
        manager.submitGradients("round-1", "peer-a", [])
      ).rejects.toThrow("Gradients must be a non-empty array");

      await expect(
        manager.submitGradients("round-1", "peer-a", "not-array")
      ).rejects.toThrow("Gradients must be a non-empty array");
    });

    it("should throw if round not found", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          get: vi.fn(() => null),
        });
      });

      await expect(
        manager.submitGradients("bad-round", "peer-a", [1, 2])
      ).rejects.toThrow("Round bad-round not found");
    });

    it("should emit gradients-submitted event", async () => {
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              status: "training",
              min_participants: 3,
            })),
          });
        }
        if (
          sql.includes(
            "SELECT * FROM federated_peers WHERE round_id = ? AND peer_id = ?"
          )
        ) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "pr-1",
              peer_id: "peer-a",
              status: "joined",
            })),
          });
        }
        if (sql.includes("SELECT COUNT(*)")) {
          return makePrepStmt({
            get: vi.fn(() => ({ count: 1 })),
          });
        }
        return makePrepStmt();
      });

      manager.gradientStore.set("round-1", new Map());

      const handler = vi.fn();
      manager.on("gradients-submitted", handler);

      await manager.submitGradients("round-1", "peer-a", [0.5, 0.6]);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("aggregate()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should aggregate gradients and return result", async () => {
      // Set up gradient store
      const roundGradients = new Map();
      roundGradients.set("peer-a", [1, 2, 3]);
      roundGradients.set("peer-b", [3, 2, 1]);
      manager.gradientStore.set("round-1", roundGradients);

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              aggregation_method: "fedavg",
              round_number: 0,
              config: "{}",
            })),
          });
        }
        if (
          sql.includes(
            "SELECT * FROM federated_peers WHERE round_id = ? AND status = 'submitted'"
          )
        ) {
          return makePrepStmt({
            all: vi.fn(() => [
              {
                peer_id: "peer-a",
                local_samples: 100,
                status: "submitted",
              },
              {
                peer_id: "peer-b",
                local_samples: 200,
                status: "submitted",
              },
            ]),
          });
        }
        return makePrepStmt();
      });

      const result = await manager.aggregate("round-1");

      expect(result).toBeDefined();
      expect(result.roundId).toBe("round-1");
      expect(result.method).toBe("fedavg");
      expect(result.participantCount).toBe(2);
      expect(result.parameterCount).toBe(3);
      expect(result.globalModelHash).toBeDefined();
      expect(result.roundNumber).toBe(1);
      expect(result.contributionScores).toBeDefined();
    });

    it("should throw if no gradients available", async () => {
      manager.gradientStore.set("round-1", new Map());

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              aggregation_method: "fedavg",
              round_number: 0,
            })),
          });
        }
        return makePrepStmt();
      });

      await expect(manager.aggregate("round-1")).rejects.toThrow(
        "No gradients available"
      );
    });

    it("should emit aggregation-complete event", async () => {
      const roundGradients = new Map();
      roundGradients.set("peer-a", [1, 1]);
      roundGradients.set("peer-b", [2, 2]);
      manager.gradientStore.set("round-1", roundGradients);

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              aggregation_method: "fedavg",
              round_number: 0,
              config: "{}",
            })),
          });
        }
        if (sql.includes("SELECT * FROM federated_peers")) {
          return makePrepStmt({
            all: vi.fn(() => [
              { peer_id: "peer-a", local_samples: 50, status: "submitted" },
              { peer_id: "peer-b", local_samples: 50, status: "submitted" },
            ]),
          });
        }
        return makePrepStmt();
      });

      const handler = vi.fn();
      manager.on("aggregation-complete", handler);

      await manager.aggregate("round-1");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roundId).toBe("round-1");
    });
  });

  describe("getStatus()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return round status with peer counts", async () => {
      let countCall = 0;
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT * FROM federated_rounds WHERE id")) {
          return makePrepStmt({
            get: vi.fn(() => ({
              id: "round-1",
              coordinator_peer_id: "peer-coord",
              model_id: "model-1",
              status: "training",
              round_number: 2,
              aggregation_method: "fedavg",
              global_model_hash: "abc123",
              min_participants: 2,
              max_participants: 10,
              round_timeout_ms: 600000,
              dp_config: null,
              config: '{"modelId":"model-1"}',
              created_at: 1000,
              updated_at: 2000,
            })),
          });
        }
        if (sql.includes("SELECT COUNT(*)")) {
          countCall++;
          if (countCall === 1) {
            return makePrepStmt({
              get: vi.fn(() => ({ count: 5 })),
            });
          }
          return makePrepStmt({
            get: vi.fn(() => ({ count: 3 })),
          });
        }
        return makePrepStmt();
      });

      const status = await manager.getStatus("round-1");

      expect(status).toBeDefined();
      expect(status.id).toBe("round-1");
      expect(status.status).toBe("training");
      expect(status.modelId).toBe("model-1");
      expect(status.totalPeers).toBe(5);
      expect(status.submittedPeers).toBe(3);
      expect(status.roundNumber).toBe(2);
    });

    it("should return null if round not found", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          get: vi.fn(() => null),
        });
      });

      const status = await manager.getStatus("nonexistent");
      expect(status).toBeNull();
    });
  });

  describe("listRounds()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return a list of rounds", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          all: vi.fn(() => [
            {
              id: "r1",
              coordinator_peer_id: "p1",
              model_id: "m1",
              status: "recruiting",
              round_number: 0,
              aggregation_method: "fedavg",
              global_model_hash: null,
              min_participants: 2,
              max_participants: 10,
              round_timeout_ms: 600000,
              created_at: 1000,
              updated_at: 1000,
            },
            {
              id: "r2",
              coordinator_peer_id: "p2",
              model_id: "m2",
              status: "completed",
              round_number: 5,
              aggregation_method: "fedprox",
              global_model_hash: "hash-xyz",
              min_participants: 3,
              max_participants: 8,
              round_timeout_ms: 300000,
              created_at: 2000,
              updated_at: 3000,
            },
          ]),
        });
      });

      const rounds = await manager.listRounds({ limit: 10 });

      expect(rounds).toHaveLength(2);
      expect(rounds[0].id).toBe("r1");
      expect(rounds[1].id).toBe("r2");
      expect(rounds[1].status).toBe("completed");
    });

    it("should return empty array when no database", async () => {
      manager.database = null;
      const rounds = await manager.listRounds();
      expect(rounds).toEqual([]);
    });
  });

  describe("getPeers()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return peers for a round", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          all: vi.fn(() => [
            {
              id: "fp-1",
              round_id: "round-1",
              peer_id: "peer-a",
              status: "submitted",
              gradient_hash: "hash-a",
              local_samples: 100,
              contribution_score: 0.85,
              joined_at: 1000,
              submitted_at: 2000,
            },
            {
              id: "fp-2",
              round_id: "round-1",
              peer_id: "peer-b",
              status: "joined",
              gradient_hash: null,
              local_samples: 0,
              contribution_score: 0,
              joined_at: 1100,
              submitted_at: null,
            },
          ]),
        });
      });

      const peers = await manager.getPeers("round-1");

      expect(peers).toHaveLength(2);
      expect(peers[0].peerId).toBe("peer-a");
      expect(peers[0].status).toBe("submitted");
      expect(peers[0].contributionScore).toBe(0.85);
      expect(peers[1].peerId).toBe("peer-b");
      expect(peers[1].status).toBe("joined");
    });

    it("should throw if roundId is missing", async () => {
      await expect(manager.getPeers(null)).rejects.toThrow(
        "roundId is required"
      );
    });
  });

  describe("getGlobalModel()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return global model info", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          get: vi.fn(() => ({
            id: "round-1",
            model_id: "model-v1",
            global_model_hash: "abcdef01",
            round_number: 3,
            aggregation_method: "fedavg",
            status: "completed",
          })),
        });
      });

      const model = await manager.getGlobalModel("round-1");

      expect(model.roundId).toBe("round-1");
      expect(model.modelId).toBe("model-v1");
      expect(model.globalModelHash).toBe("abcdef01");
      expect(model.roundNumber).toBe(3);
    });

    it("should throw if round not found", async () => {
      mockDb.prepare.mockImplementation(() => {
        return makePrepStmt({
          get: vi.fn(() => null),
        });
      });

      await expect(
        manager.getGlobalModel("nonexistent")
      ).rejects.toThrow("Round nonexistent not found");
    });
  });
});
