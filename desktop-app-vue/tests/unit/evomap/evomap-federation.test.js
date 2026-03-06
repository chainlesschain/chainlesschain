import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let EvoMapFederation, getEvoMapFederation, HUB_STATUS;

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
  const mod = await import("../../../src/main/evomap/evomap-federation.js");
  EvoMapFederation = mod.EvoMapFederation;
  getEvoMapFederation = mod.getEvoMapFederation;
  HUB_STATUS = mod.HUB_STATUS;
});

describe("EvoMapFederation", () => {
  let federation;
  beforeEach(() => {
    federation = new EvoMapFederation({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(federation.initialized).toBe(false);
      expect(federation._hubs).toBeInstanceOf(Map);
      expect(federation._lineage).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await federation.initialize();
      expect(federation.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      federation._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS evomap_hub_federation");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS gene_lineage");
    });
  });

  describe("listHubs()", () => {
    it("should return empty list", async () => {
      const hubs = await federation.listHubs();
      expect(hubs).toHaveLength(0);
    });

    it("should filter by status", async () => {
      federation._hubs.set("h1", { status: "online", region: "us" });
      federation._hubs.set("h2", { status: "offline", region: "eu" });
      const hubs = await federation.listHubs({ status: "online" });
      expect(hubs).toHaveLength(1);
    });
  });

  describe("syncGenes()", () => {
    it("should throw if hubId is missing", async () => {
      await expect(federation.syncGenes({})).rejects.toThrow(
        "Hub ID is required",
      );
    });

    it("should throw if hub not found", async () => {
      await expect(federation.syncGenes({ hubId: "unknown" })).rejects.toThrow(
        "Hub not found: unknown",
      );
    });

    it("should sync genes with hub", async () => {
      federation._hubs.set("h1", { id: "h1", status: "online", gene_count: 0 });
      const result = await federation.syncGenes({
        hubId: "h1",
        geneIds: ["g1", "g2"],
      });
      expect(result.synced).toBe(2);
      expect(result.hubId).toBe("h1");
    });

    it("should update hub gene count", async () => {
      federation._hubs.set("h1", { id: "h1", status: "online", gene_count: 5 });
      await federation.syncGenes({ hubId: "h1", geneIds: ["g1", "g2", "g3"] });
      const hub = federation._hubs.get("h1");
      expect(hub.gene_count).toBe(8);
    });
  });

  describe("getPressureReport()", () => {
    it("should return empty pressure report", async () => {
      const report = await federation.getPressureReport();
      expect(report.totalGenes).toBe(0);
      expect(report.avgFitness).toBe(0);
      expect(report.maxGeneration).toBe(0);
    });
  });

  describe("recombineGenes()", () => {
    it("should throw if two gene IDs are not provided", async () => {
      await expect(federation.recombineGenes({})).rejects.toThrow(
        "Two gene IDs are required for recombination",
      );
      await expect(
        federation.recombineGenes({ geneId1: "g1" }),
      ).rejects.toThrow("Two gene IDs are required for recombination");
    });

    it("should recombine two genes", async () => {
      const result = await federation.recombineGenes({
        geneId1: "gene-a",
        geneId2: "gene-b",
      });
      expect(result.parent_gene_id).toBe("gene-a");
      expect(result.recombination_source).toBe("gene-b");
      expect(result.mutation_type).toBe("recombination");
      expect(result.fitness_score).toBeGreaterThanOrEqual(0.5);
    });

    it("should persist to DB", async () => {
      await federation.recombineGenes({ geneId1: "g1", geneId2: "g2" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getLineage()", () => {
    it("should throw if geneId missing", async () => {
      await expect(federation.getLineage()).rejects.toThrow(
        "Gene ID is required",
      );
    });

    it("should return lineage from memory", async () => {
      const f = new EvoMapFederation(null);
      f._lineage.set("l1", { gene_id: "g1", parent_gene_id: null });
      f._lineage.set("l2", { gene_id: "g2", parent_gene_id: "g1" });
      const lineage = await f.getLineage("g1");
      expect(lineage).toHaveLength(2);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      federation._hubs.set("h1", {});
      federation._lineage.set("l1", {});
      await federation.close();
      expect(federation._hubs.size).toBe(0);
      expect(federation._lineage.size).toBe(0);
      expect(federation.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getEvoMapFederation();
      expect(instance).toBeInstanceOf(EvoMapFederation);
    });
  });
});
