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
  // V2
  HUB_STATUS_V2,
  TRUST_TIER,
  MUTATION_TYPE,
  trustTier,
  setHubStatus,
  listHubsV2,
  buildFederationContext,
  getFederationStatsV2,
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

  // ═══════════════════════════════════════════════════════════════
  // V2 Canonical Surface (Phase 42)
  // ═══════════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("HUB_STATUS_V2 is frozen with 4 values", () => {
      expect(Object.isFrozen(HUB_STATUS_V2)).toBe(true);
      expect(Object.values(HUB_STATUS_V2).length).toBe(4);
      expect(HUB_STATUS_V2.ONLINE).toBe("online");
      expect(HUB_STATUS_V2.DEGRADED).toBe("degraded");
    });

    it("TRUST_TIER is frozen with 3 values", () => {
      expect(Object.isFrozen(TRUST_TIER)).toBe(true);
      expect(Object.values(TRUST_TIER)).toEqual(["low", "medium", "high"]);
    });

    it("MUTATION_TYPE is frozen", () => {
      expect(Object.isFrozen(MUTATION_TYPE)).toBe(true);
      expect(MUTATION_TYPE.RECOMBINATION).toBe("recombination");
    });
  });

  describe("trustTier", () => {
    it("returns LOW for score < 0.3", () => {
      expect(trustTier(0)).toBe(TRUST_TIER.LOW);
      expect(trustTier(0.29)).toBe(TRUST_TIER.LOW);
    });

    it("returns MEDIUM for 0.3 <= score < 0.7", () => {
      expect(trustTier(0.3)).toBe(TRUST_TIER.MEDIUM);
      expect(trustTier(0.5)).toBe(TRUST_TIER.MEDIUM);
      expect(trustTier(0.69)).toBe(TRUST_TIER.MEDIUM);
    });

    it("returns HIGH for score >= 0.7", () => {
      expect(trustTier(0.7)).toBe(TRUST_TIER.HIGH);
      expect(trustTier(1.0)).toBe(TRUST_TIER.HIGH);
    });

    it("throws on non-number", () => {
      expect(() => trustTier("foo")).toThrow("Trust score must be a number");
      expect(() => trustTier(NaN)).toThrow();
    });
  });

  describe("setHubStatus", () => {
    it("transitions offline → syncing", () => {
      const hub = addFederatedHub(db, "hub://a", "A", "us");
      const result = setHubStatus(db, hub.id, HUB_STATUS_V2.SYNCING);
      expect(result.status).toBe("syncing");
    });

    it("transitions syncing → online", () => {
      const hub = addFederatedHub(db, "hub://a", "A", "us");
      setHubStatus(db, hub.id, HUB_STATUS_V2.SYNCING);
      setHubStatus(db, hub.id, HUB_STATUS_V2.ONLINE);
    });

    it("rejects invalid transition offline → degraded", () => {
      const hub = addFederatedHub(db, "hub://a", "A", "us");
      expect(() => setHubStatus(db, hub.id, HUB_STATUS_V2.DEGRADED)).toThrow(
        /Invalid hub status transition/,
      );
    });

    it("rejects unknown status", () => {
      const hub = addFederatedHub(db, "hub://a", "A", "us");
      expect(() => setHubStatus(db, hub.id, "zombie")).toThrow(
        /Unknown hub status/,
      );
    });

    it("rejects unknown hub", () => {
      expect(() => setHubStatus(db, "missing", HUB_STATUS_V2.ONLINE)).toThrow(
        /Hub not found/,
      );
    });
  });

  describe("listHubsV2", () => {
    beforeEach(() => {
      const a = addFederatedHub(db, "hub://a", "A", "us");
      const b = addFederatedHub(db, "hub://b", "B", "eu");
      // bump trust scores via sync
      syncGenes(db, a.id, []);
      syncGenes(db, a.id, []);
      syncGenes(db, a.id, []);
      syncGenes(db, a.id, []);
      syncGenes(db, a.id, []);
    });

    it("annotates with trustTier", () => {
      const hubs = listHubsV2(db, {});
      for (const h of hubs) {
        expect(["low", "medium", "high"]).toContain(h.trustTier);
      }
    });

    it("filters by region", () => {
      const hubs = listHubsV2(db, { region: "eu" });
      expect(hubs.length).toBe(1);
      expect(hubs[0].region).toBe("eu");
    });

    it("filters by minTrust", () => {
      const hubs = listHubsV2(db, { minTrust: 0.7 });
      expect(hubs.every((h) => h.trustScore >= 0.7)).toBe(true);
    });

    it("filters by trustTier", () => {
      const hubs = listHubsV2(db, { trustTier: TRUST_TIER.LOW });
      expect(hubs.every((h) => h.trustTier === "low")).toBe(true);
    });
  });

  describe("buildFederationContext", () => {
    it("returns zero-stats for empty state", () => {
      const ctx = buildFederationContext();
      expect(ctx.hubCount).toBe(0);
      expect(ctx.totalGenes).toBe(0);
      expect(ctx.avgTrust).toBe(0);
      expect(ctx.avgTrustTier).toBeNull();
    });

    it("aggregates hubs and genes", () => {
      const a = addFederatedHub(db, "hub://a", "A", "us");
      syncGenes(db, a.id, []);
      addLineageEntry(db, "g1", null, {
        fitnessScore: 0.8,
        mutationType: "mutation",
      });
      const ctx = buildFederationContext();
      expect(ctx.hubCount).toBe(1);
      expect(ctx.onlineHubs).toBeGreaterThanOrEqual(1);
      expect(ctx.totalGenes).toBe(1);
      expect(ctx.avgFitness).toBeCloseTo(0.8);
      expect(ctx.regions).toContain("us");
    });
  });

  describe("getFederationStatsV2", () => {
    it("returns per-status/region/trust breakdown", () => {
      const a = addFederatedHub(db, "hub://a", "A", "us");
      const b = addFederatedHub(db, "hub://b", "B", "eu");
      syncGenes(db, a.id, []); // moves A to online
      const stats = getFederationStatsV2();
      expect(stats.totalHubs).toBe(2);
      expect(stats.byStatus.online).toBe(1);
      expect(stats.byStatus.offline).toBe(1);
      expect(stats.byRegion.us).toBe(1);
      expect(stats.byRegion.eu).toBe(1);
      expect(stats.byTrustTier.medium).toBeGreaterThanOrEqual(1);
      void b;
    });

    it("counts lineage mutations by type", () => {
      addLineageEntry(db, "g1", null, { mutationType: "mutation" });
      recombineGenes(db, "g1", "g2");
      const stats = getFederationStatsV2();
      expect(stats.byMutationType.mutation).toBe(1);
      expect(stats.byMutationType.recombination).toBe(1);
    });
  });
});
