import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { EnterpriseKG } = require("../enterprise-kg.js");

describe("EnterpriseKG", () => {
  let kg;
  let db;

  beforeEach(async () => {
    kg = new EnterpriseKG();
    db = createMockDB();
    await kg.initialize(db);
  });

  // --- Initialization ---

  it("should initialize with db and create tables", () => {
    expect(kg.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
    expect(db.exec.mock.calls[0][0]).toContain("kg_entities");
    expect(db.exec.mock.calls[0][0]).toContain("kg_relationships");
  });

  it("should skip double initialization", async () => {
    const callCount = db.exec.mock.calls.length;
    await kg.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  it("should load existing entities from database", async () => {
    const fresh = new EnterpriseKG();
    const db2 = createMockDB();
    db2.prepare.mockImplementation((sql) => {
      if (sql.includes("kg_entities")) {
        return {
          all: vi
            .fn()
            .mockReturnValue([
              {
                id: "e1",
                name: "Alice",
                type: "person",
                properties: '{"age":30}',
              },
            ]),
        };
      }
      return { all: vi.fn().mockReturnValue([]) };
    });
    await fresh.initialize(db2);
    expect(fresh.getStats().entities).toBe(1);
  });

  it("should handle table creation error gracefully", async () => {
    const fresh = new EnterpriseKG();
    const badDb = createMockDB();
    badDb.exec.mockImplementation(() => {
      throw new Error("table error");
    });
    await fresh.initialize(badDb);
    // Should still initialize (tables may exist from before)
    expect(fresh.initialized).toBe(true);
  });

  // --- Entity Management ---

  it("should add an entity and persist to DB", () => {
    const entity = kg.addEntity("Bob", "person", { role: "dev" });
    expect(entity.id).toMatch(/^entity-/);
    expect(entity.name).toBe("Bob");
    expect(entity.type).toBe("person");
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO kg_entities"),
    );
  });

  it("should emit kg:entity-added event", () => {
    const handler = vi.fn();
    kg.on("kg:entity-added", handler);
    kg.addEntity("Alice", "person");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alice", type: "person" }),
    );
  });

  it("should index entities by type", () => {
    kg.addEntity("Alice", "person");
    kg.addEntity("Bob", "person");
    kg.addEntity("Acme", "company");
    const stats = kg.getStats();
    expect(stats.entityTypes.person).toBe(2);
    expect(stats.entityTypes.company).toBe(1);
  });

  it("should handle entity persist error gracefully", () => {
    db.prepare.mockImplementation(() => {
      throw new Error("insert fail");
    });
    const entity = kg.addEntity("Test", "test");
    expect(entity.name).toBe("Test"); // still returns entity even if persist fails
  });

  // --- Relationship Management ---

  it("should add a relationship between entities", () => {
    const e1 = kg.addEntity("Alice", "person");
    const e2 = kg.addEntity("Acme", "company");
    const rel = kg.addRelationship(e1.id, e2.id, "works_at", {}, 0.9);
    expect(rel.id).toMatch(/^rel-/);
    expect(rel.source_id).toBe(e1.id);
    expect(rel.target_id).toBe(e2.id);
    expect(rel.type).toBe("works_at");
    expect(rel.weight).toBe(0.9);
  });

  it("should handle relationship persist error gracefully", () => {
    db.prepare.mockImplementation(() => {
      throw new Error("rel fail");
    });
    const rel = kg.addRelationship("a", "b", "knows");
    expect(rel.type).toBe("knows");
  });

  // --- Query ---

  it("should query entities by type", () => {
    kg.addEntity("Alice", "person");
    kg.addEntity("Acme", "company");
    const results = kg.query({ entityType: "person" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Alice");
  });

  it("should query entity by id with relationships", () => {
    const e1 = kg.addEntity("Alice", "person");
    const e2 = kg.addEntity("Bob", "person");
    kg.addRelationship(e1.id, e2.id, "knows");
    const results = kg.query({ entityId: e1.id });
    expect(results.length).toBe(1);
    expect(results[0].entity.name).toBe("Alice");
    expect(results[0].relationships.length).toBe(1);
  });

  it("should query entities by name substring", () => {
    kg.addEntity("Alice Smith", "person");
    kg.addEntity("Bob Jones", "person");
    const results = kg.query({ name: "alice" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Alice Smith");
  });

  it("should return all entities with limit if no filter", () => {
    kg.addEntity("A", "t");
    kg.addEntity("B", "t");
    const results = kg.query({ limit: 1 });
    expect(results.length).toBe(1);
  });

  it("should return empty for unknown entityId", () => {
    const results = kg.query({ entityId: "unknown" });
    expect(results.length).toBe(0);
  });

  it("should return empty for unknown entityType", () => {
    const results = kg.query({ entityType: "nonexistent" });
    expect(results.length).toBe(0);
  });

  // --- Visualize ---

  it("should return graph visualization data", () => {
    const e1 = kg.addEntity("Alice", "person");
    const e2 = kg.addEntity("Bob", "person");
    kg.addRelationship(e1.id, e2.id, "knows");
    const viz = kg.visualize();
    expect(viz.nodes.length).toBe(2);
    expect(viz.edges.length).toBe(1);
    expect(viz.stats.totalNodes).toBe(2);
  });

  it("should respect maxNodes and maxEdges options", () => {
    for (let i = 0; i < 5; i++) {
      kg.addEntity(`E${i}`, "t");
    }
    const viz = kg.visualize({ maxNodes: 2 });
    expect(viz.nodes.length).toBe(2);
    expect(viz.stats.totalNodes).toBe(5);
  });

  // --- Reasoning ---

  it("should traverse graph for reasoning", () => {
    const e1 = kg.addEntity("Alice", "person");
    const e2 = kg.addEntity("Bob", "person");
    const e3 = kg.addEntity("Acme", "company");
    kg.addRelationship(e1.id, e2.id, "knows");
    kg.addRelationship(e2.id, e3.id, "works_at");
    const result = kg.reason(e1.id, 3);
    expect(result.entityId).toBe(e1.id);
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.inferences.length).toBeGreaterThan(0);
  });

  it("should handle reasoning for unknown entity", () => {
    const result = kg.reason("unknown", 2);
    expect(result.paths.length).toBe(0);
    expect(result.inferences.length).toBe(0);
  });

  it("should limit reasoning depth", () => {
    const e1 = kg.addEntity("A", "t");
    const result = kg.reason(e1.id, 0);
    expect(result.paths.length).toBe(0);
  });

  // --- GraphRAG Search ---

  it("should search entities and return context", () => {
    const e1 = kg.addEntity("Machine Learning", "topic", {
      description: "AI subfield",
    });
    const e2 = kg.addEntity("Neural Networks", "topic");
    kg.addRelationship(e1.id, e2.id, "related_to");
    const result = kg.graphRAGSearch("machine");
    expect(result.query).toBe("machine");
    expect(result.totalMatches).toBe(1);
    expect(result.results[0].entity.name).toBe("Machine Learning");
    expect(result.results[0].neighbors).toContain("Neural Networks");
  });

  it("should search by description property", () => {
    kg.addEntity("DL", "topic", { description: "Deep learning techniques" });
    const result = kg.graphRAGSearch("deep learning");
    expect(result.totalMatches).toBe(1);
  });

  it("should return empty for no match", () => {
    const result = kg.graphRAGSearch("nonexistent");
    expect(result.totalMatches).toBe(0);
    expect(result.results.length).toBe(0);
  });

  // --- Import / Export ---

  it("should import entities and relationships", () => {
    const result = kg.importData({
      entities: [
        { name: "X", type: "t" },
        { name: "Y", type: "t" },
      ],
      relationships: [{ source: "a", target: "b", type: "r" }],
    });
    expect(result.entitiesAdded).toBe(2);
    expect(result.relationshipsAdded).toBe(1);
  });

  it("should export all graph data", () => {
    kg.addEntity("A", "t");
    kg.addRelationship("a", "b", "r");
    const data = kg.exportData();
    expect(data.entities.length).toBe(1);
    expect(data.relationships.length).toBe(1);
    expect(data.exportedAt).toBeDefined();
  });

  // --- Stats ---

  it("should return correct stats", () => {
    kg.addEntity("A", "person");
    kg.addEntity("B", "company");
    kg.addRelationship("x", "y", "r");
    const stats = kg.getStats();
    expect(stats.entities).toBe(2);
    expect(stats.relationships).toBe(1);
    expect(stats.entityTypes.person).toBe(1);
    expect(stats.entityTypes.company).toBe(1);
  });
});
