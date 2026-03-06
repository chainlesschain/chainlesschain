import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let GeneIPManager, getGeneIPManager;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/evomap/gene-ip-manager.js");
  GeneIPManager = mod.GeneIPManager;
  getGeneIPManager = mod.getGeneIPManager;
});

describe("GeneIPManager", () => {
  let manager;
  beforeEach(() => {
    manager = new GeneIPManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._ownerships).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      manager._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS gene_ownership");
    });
  });

  describe("registerOwnership()", () => {
    it("should throw if geneId is missing", async () => {
      await expect(manager.registerOwnership({})).rejects.toThrow(
        "Gene ID is required",
      );
    });

    it("should throw if ownerDid is missing", async () => {
      await expect(manager.registerOwnership({ geneId: "g1" })).rejects.toThrow(
        "Owner DID is required",
      );
    });

    it("should register ownership", async () => {
      const result = await manager.registerOwnership({
        geneId: "gene-1",
        ownerDid: "did:example:owner",
      });
      expect(result.gene_id).toBe("gene-1");
      expect(result.owner_did).toBe("did:example:owner");
      expect(result.verified).toBe(1);
      expect(result.plagiarism_score).toBe(0.0);
    });

    it("should persist to DB", async () => {
      await manager.registerOwnership({ geneId: "g1", ownerDid: "did:1" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should store in memory", async () => {
      await manager.registerOwnership({ geneId: "g1", ownerDid: "did:1" });
      expect(manager._ownerships.size).toBe(1);
    });
  });

  describe("traceContributions()", () => {
    it("should throw if geneId is missing", async () => {
      await expect(manager.traceContributions()).rejects.toThrow(
        "Gene ID is required",
      );
    });

    it("should return empty for unknown gene", async () => {
      const result = await manager.traceContributions("unknown-gene");
      expect(result.geneId).toBe("unknown-gene");
      expect(result.contributors).toHaveLength(0);
      expect(result.derivationChain).toHaveLength(0);
    });

    it("should trace contributions for owned gene", async () => {
      await manager.registerOwnership({ geneId: "g1", ownerDid: "did:owner" });
      const result = await manager.traceContributions("g1");
      expect(result.geneId).toBe("g1");
      expect(result.owner).toBe("did:owner");
      expect(result.contributors).toContain("did:owner");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._ownerships.set("o1", {});
      await manager.close();
      expect(manager._ownerships.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getGeneIPManager();
      expect(instance).toBeInstanceOf(GeneIPManager);
    });
  });
});
