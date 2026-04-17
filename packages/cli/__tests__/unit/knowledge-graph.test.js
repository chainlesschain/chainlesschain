/**
 * Unit tests for knowledge-graph (Phase 94 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureKnowledgeGraphTables,
  listEntityTypes,
  addEntity,
  getEntity,
  listEntities,
  removeEntity,
  addRelation,
  getRelation,
  listRelations,
  removeRelation,
  reason,
  query,
  getStats,
  exportGraph,
  importGraph,
  ENTITY_TYPES,
  _resetState,
  // V2 surface
  ENTITY_STATUS_V2,
  RELATION_STATUS_V2,
  KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER,
  KG_DEFAULT_MAX_RELATIONS_PER_ENTITY,
  KG_DEFAULT_ENTITY_STALE_MS,
  KG_DEFAULT_RELATION_STALE_MS,
  getDefaultMaxActiveEntitiesPerOwnerV2,
  getMaxActiveEntitiesPerOwnerV2,
  setMaxActiveEntitiesPerOwnerV2,
  getDefaultMaxRelationsPerEntityV2,
  getMaxRelationsPerEntityV2,
  setMaxRelationsPerEntityV2,
  getDefaultEntityStaleMsV2,
  getEntityStaleMsV2,
  setEntityStaleMsV2,
  getDefaultRelationStaleMsV2,
  getRelationStaleMsV2,
  setRelationStaleMsV2,
  registerEntityV2,
  getEntityV2,
  setEntityStatusV2,
  deprecateEntity,
  archiveEntityV2,
  removeEntityV2,
  reviveEntity,
  touchEntityActivity,
  registerRelationV2,
  getRelationV2,
  setRelationStatusV2,
  deprecateRelation,
  removeRelationV2,
  reviveRelation,
  getActiveEntityCount,
  getActiveRelationCount,
  autoArchiveStaleEntities,
  autoRemoveStaleRelations,
  getKnowledgeGraphStatsV2,
  _resetStateV2,
} from "../../src/lib/knowledge-graph.js";

describe("knowledge-graph", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureKnowledgeGraphTables(db);
  });

  /* ── Schema / catalogs ─────────────────────────────────────── */

  describe("ensureKnowledgeGraphTables", () => {
    it("creates kg_entities + kg_relationships tables", () => {
      expect(db.tables.has("kg_entities")).toBe(true);
      expect(db.tables.has("kg_relationships")).toBe(true);
    });

    it("is idempotent", () => {
      ensureKnowledgeGraphTables(db);
      ensureKnowledgeGraphTables(db);
      expect(db.tables.has("kg_entities")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureKnowledgeGraphTables(null)).not.toThrow();
    });
  });

  describe("Catalogs", () => {
    it("lists 7 standard entity types", () => {
      const types = listEntityTypes();
      expect(types).toHaveLength(7);
      const names = types.map((t) => t.name);
      expect(names).toContain("Person");
      expect(names).toContain("Organization");
      expect(names).toContain("Project");
      expect(names).toContain("Technology");
      expect(names).toContain("Document");
      expect(names).toContain("Concept");
      expect(names).toContain("Event");
    });

    it("ENTITY_TYPES is frozen", () => {
      expect(Object.isFrozen(ENTITY_TYPES)).toBe(true);
    });
  });

  /* ── Entities ──────────────────────────────────────────────── */

  describe("addEntity", () => {
    it("creates entity with generated id", () => {
      const e = addEntity(db, { name: "Alice", type: "Person" });
      expect(e.id).toBeDefined();
      expect(e.name).toBe("Alice");
      expect(e.type).toBe("Person");
      expect(e.properties).toBeNull();
      expect(e.tags).toBeNull();
    });

    it("honors provided properties + tags", () => {
      const e = addEntity(db, {
        name: "Bob",
        type: "Person",
        properties: { age: 30, title: "SWE" },
        tags: ["backend", "team-a"],
      });
      expect(e.properties).toEqual({ age: 30, title: "SWE" });
      expect(e.tags).toEqual(["backend", "team-a"]);
    });

    it("accepts custom (non-standard) type strings", () => {
      const e = addEntity(db, { name: "MyCustomThing", type: "CustomType" });
      expect(e.type).toBe("CustomType");
    });

    it("rejects missing name", () => {
      expect(() => addEntity(db, { type: "Person" })).toThrow(
        /entity name is required/,
      );
      expect(() => addEntity(db, { name: "  ", type: "Person" })).toThrow(
        /entity name is required/,
      );
    });

    it("rejects missing type", () => {
      expect(() => addEntity(db, { name: "Alice" })).toThrow(
        /entity type is required/,
      );
    });

    it("rejects duplicate id", () => {
      const e = addEntity(db, { name: "Alice", type: "Person" });
      expect(() =>
        addEntity(db, { id: e.id, name: "Alice2", type: "Person" }),
      ).toThrow(/already exists/);
    });

    it("persists entity with serialized properties + tags", () => {
      const e = addEntity(db, {
        name: "Alice",
        type: "Person",
        properties: { role: "admin" },
        tags: ["vip"],
      });
      const row = db
        .prepare("SELECT * FROM kg_entities WHERE id = ?")
        .get(e.id);
      expect(row.properties).toBe(JSON.stringify({ role: "admin" }));
      expect(row.tags).toBe(JSON.stringify(["vip"]));
    });

    it("strips internal _seq from returned entity", () => {
      const e = addEntity(db, { name: "Alice", type: "Person" });
      expect(e).not.toHaveProperty("_seq");
    });
  });

  describe("getEntity / listEntities", () => {
    beforeEach(() => {
      addEntity(db, { name: "Alice", type: "Person", tags: ["eng"] });
      addEntity(db, { name: "Bob", type: "Person", tags: ["ops"] });
      addEntity(db, { name: "Acme", type: "Organization" });
      addEntity(db, { name: "ProjectX", type: "Project" });
    });

    it("getEntity returns null for unknown id", () => {
      expect(getEntity("nope")).toBeNull();
    });

    it("listEntities returns most-recent first", () => {
      const rows = listEntities();
      expect(rows).toHaveLength(4);
      expect(rows[0].name).toBe("ProjectX");
    });

    it("filters by type", () => {
      const rows = listEntities({ type: "Person" });
      expect(rows).toHaveLength(2);
      expect(rows.every((e) => e.type === "Person")).toBe(true);
    });

    it("filters by name substring (case-insensitive)", () => {
      const rows = listEntities({ name: "ALI" });
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Alice");
    });

    it("filters by tag", () => {
      const rows = listEntities({ tag: "eng" });
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Alice");
    });

    it("respects limit", () => {
      expect(listEntities({ limit: 2 })).toHaveLength(2);
    });
  });

  describe("removeEntity", () => {
    it("removes entity and cascades to relations", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      const c = addEntity(db, { name: "C", type: "Person" });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: b.id,
        targetId: c.id,
        relationType: "knows",
      });

      expect(removeEntity(db, b.id)).toBe(true);
      expect(getEntity(b.id)).toBeNull();
      // Both relations that touched b should be gone
      expect(listRelations()).toHaveLength(0);
    });

    it("returns false for unknown id", () => {
      expect(removeEntity(db, "nope")).toBe(false);
    });
  });

  /* ── Relations ─────────────────────────────────────────────── */

  describe("addRelation", () => {
    let alice, bob;

    beforeEach(() => {
      alice = addEntity(db, { name: "Alice", type: "Person" });
      bob = addEntity(db, { name: "Bob", type: "Person" });
    });

    it("creates directed relation with defaults", () => {
      const r = addRelation(db, {
        sourceId: alice.id,
        targetId: bob.id,
        relationType: "knows",
      });
      expect(r.id).toBeDefined();
      expect(r.sourceId).toBe(alice.id);
      expect(r.targetId).toBe(bob.id);
      expect(r.relationType).toBe("knows");
      expect(r.weight).toBe(1.0);
    });

    it("honors weight + properties", () => {
      const r = addRelation(db, {
        sourceId: alice.id,
        targetId: bob.id,
        relationType: "works_with",
        weight: 0.75,
        properties: { since: 2020 },
      });
      expect(r.weight).toBe(0.75);
      expect(r.properties).toEqual({ since: 2020 });
    });

    it("rejects missing sourceId / targetId / relationType", () => {
      expect(() =>
        addRelation(db, { targetId: bob.id, relationType: "knows" }),
      ).toThrow(/sourceId is required/);
      expect(() =>
        addRelation(db, { sourceId: alice.id, relationType: "knows" }),
      ).toThrow(/targetId is required/);
      expect(() =>
        addRelation(db, { sourceId: alice.id, targetId: bob.id }),
      ).toThrow(/relationType is required/);
    });

    it("rejects self-referencing relation", () => {
      expect(() =>
        addRelation(db, {
          sourceId: alice.id,
          targetId: alice.id,
          relationType: "self",
        }),
      ).toThrow(/self-referencing/);
    });

    it("rejects unknown source / target entity", () => {
      expect(() =>
        addRelation(db, {
          sourceId: "nope",
          targetId: bob.id,
          relationType: "x",
        }),
      ).toThrow(/Source entity not found/);
      expect(() =>
        addRelation(db, {
          sourceId: alice.id,
          targetId: "nope",
          relationType: "x",
        }),
      ).toThrow(/Target entity not found/);
    });

    it("rejects negative weight", () => {
      expect(() =>
        addRelation(db, {
          sourceId: alice.id,
          targetId: bob.id,
          relationType: "x",
          weight: -1,
        }),
      ).toThrow(/Invalid weight/);
    });

    it("persists with serialized properties", () => {
      const r = addRelation(db, {
        sourceId: alice.id,
        targetId: bob.id,
        relationType: "x",
        properties: { k: "v" },
      });
      const row = db
        .prepare("SELECT * FROM kg_relationships WHERE id = ?")
        .get(r.id);
      expect(row.properties).toBe(JSON.stringify({ k: "v" }));
    });
  });

  describe("listRelations / getRelation", () => {
    let a, b, c;

    beforeEach(() => {
      a = addEntity(db, { name: "A", type: "Person" });
      b = addEntity(db, { name: "B", type: "Person" });
      c = addEntity(db, { name: "C", type: "Person" });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: b.id,
        targetId: c.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: a.id,
        targetId: c.id,
        relationType: "leads",
      });
    });

    it("getRelation returns null for unknown id", () => {
      expect(getRelation("nope")).toBeNull();
    });

    it("lists all by default", () => {
      expect(listRelations()).toHaveLength(3);
    });

    it("filters by sourceId", () => {
      const rows = listRelations({ sourceId: a.id });
      expect(rows).toHaveLength(2);
    });

    it("filters by targetId", () => {
      const rows = listRelations({ targetId: c.id });
      expect(rows).toHaveLength(2);
    });

    it("filters by relationType", () => {
      const rows = listRelations({ relationType: "leads" });
      expect(rows).toHaveLength(1);
    });

    it("respects limit", () => {
      expect(listRelations({ limit: 1 })).toHaveLength(1);
    });
  });

  describe("removeRelation", () => {
    it("removes relation", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      const r = addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
      });
      expect(removeRelation(db, r.id)).toBe(true);
      expect(getRelation(r.id)).toBeNull();
    });

    it("returns false for unknown id", () => {
      expect(removeRelation(db, "nope")).toBe(false);
    });
  });

  /* ── Traversal / Reasoning ─────────────────────────────────── */

  describe("reason (BFS)", () => {
    let a, b, c, d;

    beforeEach(() => {
      // Build: a → b → c → d; a → d (shortcut via "leads")
      a = addEntity(db, { name: "A", type: "Person" });
      b = addEntity(db, { name: "B", type: "Person" });
      c = addEntity(db, { name: "C", type: "Person" });
      d = addEntity(db, { name: "D", type: "Person" });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: b.id,
        targetId: c.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: c.id,
        targetId: d.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: a.id,
        targetId: d.id,
        relationType: "leads",
      });
    });

    it("reaches all nodes within max depth (out direction)", () => {
      const results = reason(a.id);
      expect(results).toHaveLength(3); // b, c, d (start excluded)
      const names = results.map((r) => r.entity.name).sort();
      expect(names).toEqual(["B", "C", "D"]);
    });

    it("respects maxDepth limit", () => {
      const results = reason(a.id, { maxDepth: 1 });
      // Direct neighbors only: b (knows) and d (leads)
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.depth === 1)).toBe(true);
    });

    it("picks shortest path to d (1 hop via leads, not 3 via knows)", () => {
      const results = reason(a.id);
      const dResult = results.find((r) => r.entity.name === "D");
      expect(dResult.depth).toBe(1);
      expect(dResult.path).toHaveLength(1);
    });

    it("filters edges by relationType", () => {
      const results = reason(a.id, { relationType: "knows" });
      // Only via knows edges: a→b→c→d (3 hops)
      expect(results).toHaveLength(3);
      const dResult = results.find((r) => r.entity.name === "D");
      expect(dResult.depth).toBe(3);
    });

    it("direction=in reverses traversal", () => {
      const results = reason(d.id, { direction: "in" });
      // Who points to d? a (leads), c (knows). Then c's inbound: b. Then b's: a.
      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.entity.name);
      expect(names).toContain("A");
      expect(names).toContain("C");
    });

    it("direction=both treats edges as undirected", () => {
      const results = reason(d.id, { direction: "both" });
      // Should reach all of a/b/c
      expect(results).toHaveLength(3);
    });

    it("includeStart returns start entity too", () => {
      const results = reason(a.id, { includeStart: true, maxDepth: 1 });
      expect(results).toHaveLength(3); // a + b + d
      const start = results.find((r) => r.entity.name === "A");
      expect(start.depth).toBe(0);
    });

    it("returns empty for isolated node", () => {
      const iso = addEntity(db, { name: "Iso", type: "Person" });
      expect(reason(iso.id)).toHaveLength(0);
    });

    it("rejects unknown start entity", () => {
      expect(() => reason("nope")).toThrow(/Start entity not found/);
    });

    it("rejects invalid direction", () => {
      expect(() => reason(a.id, { direction: "weird" })).toThrow(
        /Invalid direction/,
      );
    });

    it("rejects negative maxDepth", () => {
      expect(() => reason(a.id, { maxDepth: -1 })).toThrow(/Invalid maxDepth/);
    });
  });

  describe("query", () => {
    it("delegates to listEntities with default limit 100", () => {
      for (let i = 0; i < 20; i++) {
        addEntity(db, { name: `E${i}`, type: "Person" });
      }
      const rows = query({ type: "Person" });
      expect(rows).toHaveLength(20);
    });
  });

  /* ── Stats ─────────────────────────────────────────────────── */

  describe("getStats", () => {
    it("returns zero stats when empty", () => {
      const s = getStats();
      expect(s.entityCount).toBe(0);
      expect(s.relationCount).toBe(0);
      expect(s.avgDegree).toBe(0);
      expect(s.density).toBe(0);
      expect(s.typeDistribution).toEqual({});
    });

    it("computes type distribution", () => {
      addEntity(db, { name: "A", type: "Person" });
      addEntity(db, { name: "B", type: "Person" });
      addEntity(db, { name: "X", type: "Organization" });
      const s = getStats();
      expect(s.typeDistribution.Person).toBe(2);
      expect(s.typeDistribution.Organization).toBe(1);
    });

    it("computes avgDegree (2 * edges / nodes)", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      addRelation(db, { sourceId: a.id, targetId: b.id, relationType: "x" });
      const s = getStats();
      // 2 * 1 / 2 = 1.0
      expect(s.avgDegree).toBe(1);
    });

    it("computes density (edges / (n × (n-1)))", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      const c = addEntity(db, { name: "C", type: "Person" });
      addRelation(db, { sourceId: a.id, targetId: b.id, relationType: "x" });
      addRelation(db, { sourceId: b.id, targetId: c.id, relationType: "x" });
      addRelation(db, { sourceId: c.id, targetId: a.id, relationType: "x" });
      const s = getStats();
      // 3 / (3 × 2) = 0.5
      expect(s.density).toBe(0.5);
    });

    it("computes relation type distribution", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
      });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "works_with",
      });
      const s = getStats();
      expect(s.relationTypeDistribution.knows).toBe(1);
      expect(s.relationTypeDistribution.works_with).toBe(1);
    });
  });

  /* ── Import / Export ───────────────────────────────────────── */

  describe("exportGraph / importGraph", () => {
    it("round-trips entities + relations", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const b = addEntity(db, { name: "B", type: "Person" });
      addRelation(db, {
        sourceId: a.id,
        targetId: b.id,
        relationType: "knows",
        weight: 0.5,
      });

      const exported = exportGraph();
      expect(exported.entities).toHaveLength(2);
      expect(exported.relations).toHaveLength(1);
      expect(exported.exportedAt).toBeDefined();

      _resetState();
      db = new MockDatabase();
      ensureKnowledgeGraphTables(db);
      const result = importGraph(db, exported);

      expect(result.importedEntities).toBe(2);
      expect(result.importedRelations).toBe(1);
      expect(result.skippedRelations).toBe(0);
      expect(listEntities()).toHaveLength(2);
      expect(listRelations()).toHaveLength(1);
    });

    it("skips relations with unknown source/target", () => {
      const a = addEntity(db, { name: "A", type: "Person" });
      const result = importGraph(db, {
        entities: [],
        relations: [
          {
            sourceId: a.id,
            targetId: "missing",
            relationType: "knows",
          },
        ],
      });
      expect(result.skippedRelations).toBe(1);
      expect(result.importedRelations).toBe(0);
    });

    it("skips malformed entities silently", () => {
      const result = importGraph(db, {
        entities: [{ name: "A", type: "Person" }, { name: "" }, {}],
        relations: [],
      });
      // 1 good + 2 bad
      expect(result.importedEntities).toBe(1);
    });

    it("handles empty input", () => {
      const result = importGraph(db, {});
      expect(result.importedEntities).toBe(0);
      expect(result.importedRelations).toBe(0);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
 * Phase 94 Knowledge Graph V2 — 4-state entity + 3-state relation
 * ═════════════════════════════════════════════════════════════ */

describe("knowledge-graph V2 (Phase 94)", () => {
  let db;

  beforeEach(() => {
    _resetState();
    _resetStateV2();
    db = new MockDatabase();
    ensureKnowledgeGraphTables(db);
  });

  describe("Frozen enums + defaults", () => {
    it("ENTITY_STATUS_V2 is frozen and exposes 4 states", () => {
      expect(Object.isFrozen(ENTITY_STATUS_V2)).toBe(true);
      expect(ENTITY_STATUS_V2.ACTIVE).toBe("active");
      expect(ENTITY_STATUS_V2.DEPRECATED).toBe("deprecated");
      expect(ENTITY_STATUS_V2.ARCHIVED).toBe("archived");
      expect(ENTITY_STATUS_V2.REMOVED).toBe("removed");
    });

    it("RELATION_STATUS_V2 is frozen and exposes 3 states", () => {
      expect(Object.isFrozen(RELATION_STATUS_V2)).toBe(true);
      expect(RELATION_STATUS_V2.ACTIVE).toBe("active");
      expect(RELATION_STATUS_V2.DEPRECATED).toBe("deprecated");
      expect(RELATION_STATUS_V2.REMOVED).toBe("removed");
    });

    it("exposes all four defaults", () => {
      expect(KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER).toBe(1000);
      expect(KG_DEFAULT_MAX_RELATIONS_PER_ENTITY).toBe(100);
      expect(KG_DEFAULT_ENTITY_STALE_MS).toBe(180 * 86400000);
      expect(KG_DEFAULT_RELATION_STALE_MS).toBe(365 * 86400000);
      expect(getDefaultMaxActiveEntitiesPerOwnerV2()).toBe(1000);
      expect(getDefaultMaxRelationsPerEntityV2()).toBe(100);
      expect(getDefaultEntityStaleMsV2()).toBe(180 * 86400000);
      expect(getDefaultRelationStaleMsV2()).toBe(365 * 86400000);
    });
  });

  describe("Config mutators", () => {
    it("setMaxActiveEntitiesPerOwnerV2 floors + rejects bad", () => {
      expect(setMaxActiveEntitiesPerOwnerV2(50)).toBe(50);
      expect(getMaxActiveEntitiesPerOwnerV2()).toBe(50);
      expect(setMaxActiveEntitiesPerOwnerV2(7.9)).toBe(7);
      expect(() => setMaxActiveEntitiesPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setMaxActiveEntitiesPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveEntitiesPerOwnerV2(NaN)).toThrow();
    });

    it("setMaxRelationsPerEntityV2 floors + rejects bad", () => {
      expect(setMaxRelationsPerEntityV2(20)).toBe(20);
      expect(getMaxRelationsPerEntityV2()).toBe(20);
      expect(setMaxRelationsPerEntityV2(5.4)).toBe(5);
      expect(() => setMaxRelationsPerEntityV2(0)).toThrow();
    });

    it("setEntityStaleMsV2 + setRelationStaleMsV2 work and validate", () => {
      expect(setEntityStaleMsV2(1000)).toBe(1000);
      expect(getEntityStaleMsV2()).toBe(1000);
      expect(setRelationStaleMsV2(5000)).toBe(5000);
      expect(getRelationStaleMsV2()).toBe(5000);
      expect(() => setEntityStaleMsV2(0)).toThrow();
      expect(() => setRelationStaleMsV2(-10)).toThrow();
    });

    it("_resetStateV2 restores all four config defaults + clears maps", () => {
      setMaxActiveEntitiesPerOwnerV2(5);
      setMaxRelationsPerEntityV2(2);
      setEntityStaleMsV2(100);
      setRelationStaleMsV2(200);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      _resetStateV2();
      expect(getMaxActiveEntitiesPerOwnerV2()).toBe(1000);
      expect(getMaxRelationsPerEntityV2()).toBe(100);
      expect(getEntityStaleMsV2()).toBe(180 * 86400000);
      expect(getRelationStaleMsV2()).toBe(365 * 86400000);
      expect(getEntityV2("e1")).toBe(null);
    });
  });

  describe("registerEntityV2", () => {
    it("tags ACTIVE + createdAt + lastActivityAt", () => {
      const rec = registerEntityV2(db, {
        entityId: "e1",
        ownerId: "u1",
        name: "Alice",
        type: "Person",
        now: 1000,
      });
      expect(rec.status).toBe("active");
      expect(rec.entityId).toBe("e1");
      expect(rec.ownerId).toBe("u1");
      expect(rec.createdAt).toBe(1000);
      expect(rec.lastActivityAt).toBe(1000);
    });

    it("throws missing entityId", () => {
      expect(() => registerEntityV2(db, { ownerId: "u1" })).toThrow(/entityId/);
    });

    it("throws missing ownerId", () => {
      expect(() => registerEntityV2(db, { entityId: "e1" })).toThrow(/ownerId/);
    });

    it("throws on duplicate entityId", () => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      expect(() =>
        registerEntityV2(db, { entityId: "e1", ownerId: "u2" }),
      ).toThrow(/already/);
    });

    it("preserves metadata + isolates on read", () => {
      const meta = { importance: "high" };
      const rec = registerEntityV2(db, {
        entityId: "e1",
        ownerId: "u1",
        metadata: meta,
      });
      rec.metadata.importance = "mutated";
      const fresh = getEntityV2("e1");
      expect(fresh.metadata.importance).toBe("high");
    });

    it("enforces per-owner active cap", () => {
      setMaxActiveEntitiesPerOwnerV2(2);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
      expect(() =>
        registerEntityV2(db, { entityId: "e3", ownerId: "u1" }),
      ).toThrow(/Max active entities/);
      // Other owner unaffected
      expect(() =>
        registerEntityV2(db, { entityId: "e4", ownerId: "u2" }),
      ).not.toThrow();
    });

    it("non-active entities don't count toward per-owner cap", () => {
      setMaxActiveEntitiesPerOwnerV2(2);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
      deprecateEntity(db, "e1");
      expect(() =>
        registerEntityV2(db, { entityId: "e3", ownerId: "u1" }),
      ).not.toThrow();
    });
  });

  describe("setEntityStatusV2", () => {
    beforeEach(() => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
    });

    it("full traversal active → deprecated → archived → removed", () => {
      expect(setEntityStatusV2(db, "e1", "deprecated").status).toBe(
        "deprecated",
      );
      expect(setEntityStatusV2(db, "e1", "archived").status).toBe("archived");
      expect(setEntityStatusV2(db, "e1", "removed").status).toBe("removed");
    });

    it("deprecated → active (revive)", () => {
      setEntityStatusV2(db, "e1", "deprecated");
      expect(reviveEntity(db, "e1").status).toBe("active");
    });

    it("archived → active (revive)", () => {
      setEntityStatusV2(db, "e1", "deprecated");
      setEntityStatusV2(db, "e1", "archived");
      expect(reviveEntity(db, "e1").status).toBe("active");
    });

    it("active → removed is blocked (must go through deprecated or archived)", () => {
      expect(() => setEntityStatusV2(db, "e1", "removed")).toThrow(
        /Invalid transition/,
      );
    });

    it("terminal removed cannot transition", () => {
      setEntityStatusV2(db, "e1", "deprecated");
      setEntityStatusV2(db, "e1", "removed");
      expect(() => setEntityStatusV2(db, "e1", "active")).toThrow(/terminal/);
    });

    it("throws on unknown entity", () => {
      expect(() => setEntityStatusV2(db, "unknown", "deprecated")).toThrow(
        /not registered/,
      );
    });

    it("throws on invalid status string", () => {
      expect(() => setEntityStatusV2(db, "e1", "bogus")).toThrow(
        /Invalid entity status/,
      );
    });

    it("merges patch.metadata and keeps previous keys", () => {
      registerEntityV2(db, {
        entityId: "e2",
        ownerId: "u1",
        metadata: { score: 1, owner: "alice" },
      });
      setEntityStatusV2(db, "e2", "deprecated", {
        reason: "superseded",
        metadata: { score: 2, reviewedBy: "bob" },
      });
      const rec = getEntityV2("e2");
      expect(rec.reason).toBe("superseded");
      expect(rec.metadata.score).toBe(2);
      expect(rec.metadata.owner).toBe("alice");
      expect(rec.metadata.reviewedBy).toBe("bob");
    });

    it("getEntityV2 returns null for unknown", () => {
      expect(getEntityV2("bogus")).toBe(null);
    });
  });

  describe("touchEntityActivity", () => {
    it("bumps lastActivityAt", async () => {
      const rec = registerEntityV2(db, {
        entityId: "e1",
        ownerId: "u1",
        now: 1000,
      });
      expect(rec.lastActivityAt).toBe(1000);
      await new Promise((r) => setTimeout(r, 5));
      const touched = touchEntityActivity("e1");
      expect(touched.lastActivityAt).toBeGreaterThan(1000);
    });

    it("throws on unknown entity", () => {
      expect(() => touchEntityActivity("unknown")).toThrow(/not registered/);
    });
  });

  describe("registerRelationV2", () => {
    beforeEach(() => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
    });

    it("tags ACTIVE + all fields preserved", () => {
      const rec = registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "knows",
      });
      expect(rec.status).toBe("active");
      expect(rec.sourceEntityId).toBe("e1");
      expect(rec.targetEntityId).toBe("e2");
      expect(rec.relationType).toBe("knows");
    });

    it("throws on missing required fields", () => {
      expect(() =>
        registerRelationV2(db, {
          sourceEntityId: "e1",
          targetEntityId: "e2",
          relationType: "knows",
        }),
      ).toThrow(/relationId/);
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          targetEntityId: "e2",
          relationType: "knows",
        }),
      ).toThrow(/sourceEntityId/);
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          relationType: "knows",
        }),
      ).toThrow(/targetEntityId/);
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          targetEntityId: "e2",
        }),
      ).toThrow(/relationType/);
    });

    it("rejects self-referencing relation", () => {
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          targetEntityId: "e1",
          relationType: "self",
        }),
      ).toThrow(/self-referencing/);
    });

    it("rejects duplicate relationId", () => {
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "knows",
      });
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e2",
          targetEntityId: "e1",
          relationType: "likes",
        }),
      ).toThrow(/already/);
    });

    it("rejects when source entity unregistered in V2", () => {
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "unknown-src",
          targetEntityId: "e2",
          relationType: "knows",
        }),
      ).toThrow(/Source entity not registered/);
    });

    it("rejects when target entity unregistered in V2", () => {
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          targetEntityId: "unknown-tgt",
          relationType: "knows",
        }),
      ).toThrow(/Target entity not registered/);
    });

    it("rejects when source entity is archived/removed", () => {
      setEntityStatusV2(db, "e1", "archived");
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          targetEntityId: "e2",
          relationType: "knows",
        }),
      ).toThrow(/Source entity is archived/);
    });

    it("allows source entity in deprecated state (grace period)", () => {
      setEntityStatusV2(db, "e1", "deprecated");
      expect(() =>
        registerRelationV2(db, {
          relationId: "r1",
          sourceEntityId: "e1",
          targetEntityId: "e2",
          relationType: "knows",
        }),
      ).not.toThrow();
    });

    it("enforces per-source-entity active relation cap", () => {
      setMaxRelationsPerEntityV2(2);
      registerEntityV2(db, { entityId: "e3", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e4", ownerId: "u1" });
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
      });
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e1",
        targetEntityId: "e3",
        relationType: "b",
      });
      expect(() =>
        registerRelationV2(db, {
          relationId: "r3",
          sourceEntityId: "e1",
          targetEntityId: "e4",
          relationType: "c",
        }),
      ).toThrow(/Max active relations per entity/);
      // Other source unaffected
      expect(() =>
        registerRelationV2(db, {
          relationId: "r4",
          sourceEntityId: "e2",
          targetEntityId: "e4",
          relationType: "d",
        }),
      ).not.toThrow();
    });

    it("deprecated relations don't count toward per-entity cap", () => {
      setMaxRelationsPerEntityV2(2);
      registerEntityV2(db, { entityId: "e3", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e4", ownerId: "u1" });
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
      });
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e1",
        targetEntityId: "e3",
        relationType: "b",
      });
      deprecateRelation(db, "r1");
      expect(() =>
        registerRelationV2(db, {
          relationId: "r3",
          sourceEntityId: "e1",
          targetEntityId: "e4",
          relationType: "c",
        }),
      ).not.toThrow();
    });
  });

  describe("setRelationStatusV2", () => {
    beforeEach(() => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "knows",
      });
    });

    it("full traversal active → deprecated → removed", () => {
      expect(setRelationStatusV2(db, "r1", "deprecated").status).toBe(
        "deprecated",
      );
      expect(setRelationStatusV2(db, "r1", "removed").status).toBe("removed");
    });

    it("active → removed directly", () => {
      expect(setRelationStatusV2(db, "r1", "removed").status).toBe("removed");
    });

    it("deprecated → active (revive)", () => {
      setRelationStatusV2(db, "r1", "deprecated");
      expect(reviveRelation(db, "r1").status).toBe("active");
    });

    it("terminal removed cannot transition", () => {
      setRelationStatusV2(db, "r1", "removed");
      expect(() => setRelationStatusV2(db, "r1", "active")).toThrow(/terminal/);
    });

    it("throws on unknown relation", () => {
      expect(() => setRelationStatusV2(db, "unknown", "removed")).toThrow(
        /not registered/,
      );
    });

    it("throws on invalid status string", () => {
      expect(() => setRelationStatusV2(db, "r1", "bogus")).toThrow(
        /Invalid relation status/,
      );
    });

    it("invalid direct transition rejected", () => {
      // 'archived' is not a valid relation status
      expect(() => setRelationStatusV2(db, "r1", "archived")).toThrow(
        /Invalid relation status/,
      );
    });

    it("merges patch.metadata", () => {
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e2",
        targetEntityId: "e1",
        relationType: "likes",
        metadata: { weight: 0.5, score: 1 },
      });
      setRelationStatusV2(db, "r2", "deprecated", {
        reason: "stale",
        metadata: { weight: 0.1, reviewer: "bob" },
      });
      const rec = getRelationV2("r2");
      expect(rec.reason).toBe("stale");
      expect(rec.metadata.weight).toBe(0.1);
      expect(rec.metadata.score).toBe(1);
      expect(rec.metadata.reviewer).toBe("bob");
    });

    it("getRelationV2 returns null for unknown", () => {
      expect(getRelationV2("bogus")).toBe(null);
    });
  });

  describe("Counts", () => {
    beforeEach(() => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e3", ownerId: "u2" });
    });

    it("getActiveEntityCount — global scope (no arg)", () => {
      expect(getActiveEntityCount()).toBe(3);
      deprecateEntity(db, "e2");
      expect(getActiveEntityCount()).toBe(2);
    });

    it("getActiveEntityCount — per owner scope", () => {
      expect(getActiveEntityCount("u1")).toBe(2);
      expect(getActiveEntityCount("u2")).toBe(1);
      expect(getActiveEntityCount("u3")).toBe(0);
    });

    it("counts only ACTIVE (excludes deprecated/archived/removed)", () => {
      deprecateEntity(db, "e1");
      archiveEntityV2(db, "e2");
      expect(getActiveEntityCount("u1")).toBe(0);
      expect(getActiveEntityCount("u2")).toBe(1);
    });

    it("getActiveRelationCount — global + per-source scopes", () => {
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
      });
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e1",
        targetEntityId: "e3",
        relationType: "b",
      });
      registerRelationV2(db, {
        relationId: "r3",
        sourceEntityId: "e2",
        targetEntityId: "e3",
        relationType: "c",
      });
      expect(getActiveRelationCount()).toBe(3);
      expect(getActiveRelationCount("e1")).toBe(2);
      expect(getActiveRelationCount("e2")).toBe(1);
      deprecateRelation(db, "r1");
      expect(getActiveRelationCount("e1")).toBe(1);
    });
  });

  describe("autoArchiveStaleEntities", () => {
    it("flips stale ACTIVE entities to archived with reason='stale'", () => {
      setEntityStaleMsV2(1000);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1", now: 0 });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1", now: 5000 });
      const flipped = autoArchiveStaleEntities(db, 2000);
      expect(flipped).toEqual(["e1"]);
      expect(getEntityV2("e1").status).toBe("archived");
      expect(getEntityV2("e1").reason).toBe("stale");
      expect(getEntityV2("e2").status).toBe("active");
    });

    it("skips non-active entities", () => {
      setEntityStaleMsV2(1000);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1", now: 0 });
      deprecateEntity(db, "e1");
      const flipped = autoArchiveStaleEntities(db, 10000);
      expect(flipped).toEqual([]);
      expect(getEntityV2("e1").status).toBe("deprecated");
    });

    it("skips fresh entities within threshold", () => {
      setEntityStaleMsV2(10000);
      registerEntityV2(db, { entityId: "e1", ownerId: "u1", now: 0 });
      const flipped = autoArchiveStaleEntities(db, 500);
      expect(flipped).toEqual([]);
    });
  });

  describe("autoRemoveStaleRelations", () => {
    beforeEach(() => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
    });

    it("flips stale active relations to removed with reason='stale'", () => {
      setRelationStaleMsV2(1000);
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
        now: 0,
      });
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e2",
        targetEntityId: "e1",
        relationType: "b",
        now: 5000,
      });
      const flipped = autoRemoveStaleRelations(db, 2000);
      expect(flipped).toEqual(["r1"]);
      expect(getRelationV2("r1").status).toBe("removed");
      expect(getRelationV2("r1").reason).toBe("stale");
      expect(getRelationV2("r2").status).toBe("active");
    });

    it("flips stale deprecated relations too", () => {
      setRelationStaleMsV2(100);
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
        now: 0,
      });
      deprecateRelation(db, "r1");
      // updatedAt is now Date.now() from deprecateRelation, so we need
      // to push forward enough
      const futureNow = Date.now() + 10_000;
      const flipped = autoRemoveStaleRelations(db, futureNow);
      expect(flipped).toEqual(["r1"]);
      expect(getRelationV2("r1").status).toBe("removed");
    });

    it("skips already-removed relations", () => {
      setRelationStaleMsV2(100);
      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
        now: 0,
      });
      removeRelationV2(db, "r1");
      const flipped = autoRemoveStaleRelations(db, Date.now() + 999_999);
      expect(flipped).toEqual([]);
    });
  });

  describe("getKnowledgeGraphStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const stats = getKnowledgeGraphStatsV2();
      expect(stats.totalEntitiesV2).toBe(0);
      expect(stats.totalRelationsV2).toBe(0);
      expect(stats.maxActiveEntitiesPerOwner).toBe(1000);
      expect(stats.maxRelationsPerEntity).toBe(100);
      expect(stats.entityStaleMs).toBe(180 * 86400000);
      expect(stats.relationStaleMs).toBe(365 * 86400000);
      expect(stats.entitiesByStatus).toEqual({
        active: 0,
        deprecated: 0,
        archived: 0,
        removed: 0,
      });
      expect(stats.relationsByStatus).toEqual({
        active: 0,
        deprecated: 0,
        removed: 0,
      });
    });

    it("aggregates entity + relation counts across all statuses", () => {
      registerEntityV2(db, { entityId: "e1", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e2", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e3", ownerId: "u1" });
      registerEntityV2(db, { entityId: "e4", ownerId: "u1" });
      deprecateEntity(db, "e2");
      archiveEntityV2(db, "e3");
      deprecateEntity(db, "e4");
      removeEntityV2(db, "e4");

      registerRelationV2(db, {
        relationId: "r1",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        relationType: "a",
      });
      registerRelationV2(db, {
        relationId: "r2",
        sourceEntityId: "e2",
        targetEntityId: "e1",
        relationType: "b",
      });
      deprecateRelation(db, "r2");

      const stats = getKnowledgeGraphStatsV2();
      expect(stats.totalEntitiesV2).toBe(4);
      expect(stats.entitiesByStatus).toEqual({
        active: 1,
        deprecated: 1,
        archived: 1,
        removed: 1,
      });
      expect(stats.totalRelationsV2).toBe(2);
      expect(stats.relationsByStatus.active).toBe(1);
      expect(stats.relationsByStatus.deprecated).toBe(1);
      expect(stats.relationsByStatus.removed).toBe(0);
    });
  });
});
