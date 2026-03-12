import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureEvoMapFederationTables,
  listFederatedHubs,
  addFederatedHub,
  syncGenes,
  getPressureReport,
  recombineGenes,
  getLineage,
  addLineageEntry,
  _resetState,
} from "../../src/lib/evomap-federation.js";

describe("evomap-federation", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureEvoMapFederationTables(db);
  });

  // ─── ensureEvoMapFederationTables ───────────────────────────

  describe("ensureEvoMapFederationTables", () => {
    it("creates evomap_hub_federation and gene_lineage tables", () => {
      expect(db.tables.has("evomap_hub_federation")).toBe(true);
      expect(db.tables.has("gene_lineage")).toBe(true);
    });

    it("is idempotent", () => {
      ensureEvoMapFederationTables(db);
      ensureEvoMapFederationTables(db);
      expect(db.tables.has("evomap_hub_federation")).toBe(true);
    });
  });

  // ─── addFederatedHub ────────────────────────────────────────

  describe("addFederatedHub", () => {
    it("adds a hub with default values", () => {
      const hub = addFederatedHub(db, "https://hub1.example.com");
      expect(hub.id).toBeDefined();
      expect(hub.hubUrl).toBe("https://hub1.example.com");
      expect(hub.status).toBe("offline");
      expect(hub.region).toBe("global");
      expect(hub.trustScore).toBe(0.5);
      expect(hub.geneCount).toBe(0);
    });

    it("adds a hub with custom name and region", () => {
      const hub = addFederatedHub(
        db,
        "https://hub2.example.com",
        "Hub Two",
        "us-east",
      );
      expect(hub.hubName).toBe("Hub Two");
      expect(hub.region).toBe("us-east");
    });

    it("throws on missing URL", () => {
      expect(() => addFederatedHub(db, "")).toThrow("Hub URL is required");
    });

    it("persists hub to database", () => {
      addFederatedHub(db, "https://hub3.example.com");
      const rows = db.data.get("evomap_hub_federation") || [];
      expect(rows.length).toBe(1);
    });
  });

  // ─── listFederatedHubs ──────────────────────────────────────

  describe("listFederatedHubs", () => {
    it("returns empty array initially", () => {
      expect(listFederatedHubs(db)).toEqual([]);
    });

    it("returns all added hubs", () => {
      addFederatedHub(db, "https://a.com");
      addFederatedHub(db, "https://b.com");
      expect(listFederatedHubs(db).length).toBe(2);
    });

    it("filters by status", () => {
      const hub = addFederatedHub(db, "https://a.com");
      syncGenes(db, hub.id, ["g1"]);
      addFederatedHub(db, "https://b.com");
      const online = listFederatedHubs(db, { status: "online" });
      expect(online.length).toBe(1);
    });

    it("filters by region", () => {
      addFederatedHub(db, "https://a.com", "A", "us");
      addFederatedHub(db, "https://b.com", "B", "eu");
      const eu = listFederatedHubs(db, { region: "eu" });
      expect(eu.length).toBe(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        addFederatedHub(db, `https://hub${i}.com`);
      }
      expect(listFederatedHubs(db, { limit: 3 }).length).toBe(3);
    });
  });

  // ─── syncGenes ──────────────────────────────────────────────

  describe("syncGenes", () => {
    it("syncs genes and updates hub status", () => {
      const hub = addFederatedHub(db, "https://hub.com");
      const result = syncGenes(db, hub.id, ["g1", "g2"]);
      expect(result.synced).toBe(2);
      expect(result.hubId).toBe(hub.id);
      expect(result.timestamp).toBeDefined();
    });

    it("sets hub to online after sync", () => {
      const hub = addFederatedHub(db, "https://hub.com");
      syncGenes(db, hub.id, ["g1"]);
      const hubs = listFederatedHubs(db, { status: "online" });
      expect(hubs.length).toBe(1);
    });

    it("throws on unknown hub", () => {
      expect(() => syncGenes(db, "nonexistent")).toThrow("Hub not found");
    });

    it("increments gene count", () => {
      const hub = addFederatedHub(db, "https://hub.com");
      syncGenes(db, hub.id, ["g1", "g2"]);
      syncGenes(db, hub.id, ["g3"]);
      const hubs = listFederatedHubs(db);
      expect(hubs[0].geneCount).toBe(3);
    });
  });

  // ─── getPressureReport ──────────────────────────────────────

  describe("getPressureReport", () => {
    it("returns zeros when no lineage", () => {
      const report = getPressureReport();
      expect(report.totalGenes).toBe(0);
      expect(report.avgFitness).toBe(0);
      expect(report.maxGeneration).toBe(0);
    });

    it("computes stats from lineage entries", () => {
      addLineageEntry(db, "gene-1", null, {
        generation: 1,
        fitnessScore: 0.8,
        mutationType: "mutation",
      });
      addLineageEntry(db, "gene-2", "gene-1", {
        generation: 2,
        fitnessScore: 0.6,
        mutationType: "mutation",
      });
      const report = getPressureReport();
      expect(report.totalGenes).toBe(2);
      expect(report.maxGeneration).toBe(2);
      expect(report.mutations).toBe(2);
      expect(report.recombinations).toBe(0);
    });

    it("counts recombinations separately", () => {
      recombineGenes(db, "g1", "g2");
      const report = getPressureReport();
      expect(report.recombinations).toBe(1);
      expect(report.mutations).toBe(0);
    });
  });

  // ─── recombineGenes ─────────────────────────────────────────

  describe("recombineGenes", () => {
    it("creates a child gene from two parents", () => {
      const entry = recombineGenes(db, "gene-a", "gene-b");
      expect(entry.geneId).toBeDefined();
      expect(entry.parentGeneId).toBe("gene-a");
      expect(entry.recombinationSource).toBe("gene-b");
      expect(entry.mutationType).toBe("recombination");
      expect(entry.generation).toBe(1);
    });

    it("throws when gene IDs are missing", () => {
      expect(() => recombineGenes(db, "", "gene-b")).toThrow(
        "Two gene IDs are required",
      );
      expect(() => recombineGenes(db, "gene-a", "")).toThrow(
        "Two gene IDs are required",
      );
    });

    it("persists lineage to database", () => {
      recombineGenes(db, "g1", "g2");
      const rows = db.data.get("gene_lineage") || [];
      expect(rows.length).toBe(1);
    });

    it("fitness score is between 0.5 and 1.0", () => {
      const entry = recombineGenes(db, "g1", "g2");
      expect(entry.fitnessScore).toBeGreaterThanOrEqual(0.5);
      expect(entry.fitnessScore).toBeLessThanOrEqual(1.0);
    });
  });

  // ─── getLineage ─────────────────────────────────────────────

  describe("getLineage", () => {
    it("returns empty array for unknown gene", () => {
      expect(getLineage("unknown")).toEqual([]);
    });

    it("throws on missing gene ID", () => {
      expect(() => getLineage("")).toThrow("Gene ID is required");
    });

    it("returns lineage entries for a gene", () => {
      addLineageEntry(db, "gene-1", null);
      const entries = getLineage("gene-1");
      expect(entries.length).toBe(1);
    });

    it("includes parent and child references", () => {
      addLineageEntry(db, "child", "parent");
      const parentLineage = getLineage("parent");
      expect(parentLineage.length).toBe(1);
      expect(parentLineage[0].geneId).toBe("child");
    });
  });
});
