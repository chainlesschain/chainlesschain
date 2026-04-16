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
