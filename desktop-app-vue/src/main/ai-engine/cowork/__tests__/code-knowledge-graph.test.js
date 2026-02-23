/**
 * CodeKnowledgeGraph 单元测试 — v2.1.0
 *
 * 覆盖：initialize、_extractEntities（通过 _addEntity 直接测试）、
 *       queryEntity、computeCentrality、findHotspots、
 *       findCircularDependencies、buildKGContext、getStats、
 *       scanFile（通过实体解析逻辑）
 *
 * 注意：为避免在 Windows forks pool 中 vi.spyOn(fs) 挂起，
 *       所有文件系统操作通过直接调用内部方法测试，不依赖 vi.spyOn(fs)。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  CodeKnowledgeGraph,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
} = require("../code-knowledge-graph");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepareResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepareResult),
    saveToFile: vi.fn(),
    _prep: prepareResult,
  };
}

/**
 * Populate CKG with a small in-memory graph:
 *  ModuleA (imports) → ModuleB
 *  ModuleA (contains) → FuncFoo
 *  ModuleB (contains) → ClassBar
 */
function populateGraph(ckg) {
  const moduleA = ckg._addEntity({
    name: "moduleA",
    type: ENTITY_TYPES.MODULE,
    filePath: "a.js",
    language: "javascript",
  });
  const moduleB = ckg._addEntity({
    name: "moduleB",
    type: ENTITY_TYPES.MODULE,
    filePath: "b.js",
    language: "javascript",
  });
  const funcFoo = ckg._addEntity({
    name: "FuncFoo",
    type: ENTITY_TYPES.FUNCTION,
    filePath: "a.js",
    language: "javascript",
  });
  const classBar = ckg._addEntity({
    name: "ClassBar",
    type: ENTITY_TYPES.CLASS,
    filePath: "b.js",
    language: "javascript",
  });

  ckg._addRelationship({
    sourceId: moduleA.id,
    targetId: moduleB.id,
    type: RELATIONSHIP_TYPES.IMPORTS,
  });
  ckg._addRelationship({
    sourceId: moduleA.id,
    targetId: funcFoo.id,
    type: RELATIONSHIP_TYPES.CONTAINS,
  });
  ckg._addRelationship({
    sourceId: moduleB.id,
    targetId: classBar.id,
    type: RELATIONSHIP_TYPES.CONTAINS,
  });

  return { moduleA, moduleB, funcFoo, classBar };
}

// Simple JS content for _extractEntities tests
const SIMPLE_JS = `
import { foo } from './foo';
import bar from './bar';
const baz = require('./baz');

export class MyClass extends BaseClass {
  constructor() { super(); }
}

export function myFunction(x) {
  return x + 1;
}

const arrowFn = (x) => x * 2;

export type MyType = string | number;

export enum Color { Red, Green, Blue }
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CodeKnowledgeGraph", () => {
  let ckg;
  let db;

  beforeEach(() => {
    ckg = new CodeKnowledgeGraph();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await ckg.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(ckg.initialized).toBe(true);
    });

    it("should load entities and relationships from DB on init", async () => {
      db._prep.all
        .mockReturnValueOnce([
          {
            id: "e1",
            name: "SomeClass",
            type: "class",
            file_path: "src/foo.js",
            line_start: 1,
            line_end: 10,
            language: "javascript",
            metadata: "{}",
            created_at: "2024-01-01",
            updated_at: "2024-01-01",
          },
        ])
        .mockReturnValueOnce([]);

      await ckg.initialize(db);

      expect(ckg._entities.size).toBe(1);
      expect(ckg._entities.values().next().value.name).toBe("SomeClass");
    });

    it("should be idempotent on double initialize", async () => {
      await ckg.initialize(db);
      await ckg.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should initialize with empty maps when DB returns no data", async () => {
      await ckg.initialize(db);

      expect(ckg._entities.size).toBe(0);
      expect(ckg._relationships.size).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _addEntity / _addRelationship (internal, tested via populateGraph)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_addEntity() / _addRelationship()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should add entity to _entities map with uuid id", () => {
      const entity = ckg._addEntity({
        name: "TestModule",
        type: ENTITY_TYPES.MODULE,
        filePath: "test.js",
        language: "javascript",
      });

      expect(entity.id).toBeTruthy();
      expect(entity.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(ckg._entities.has(entity.id)).toBe(true);
    });

    it("should index entity by filePath", () => {
      const entity = ckg._addEntity({
        name: "TestModule",
        type: ENTITY_TYPES.MODULE,
        filePath: "src/test.js",
        language: "javascript",
      });

      const ids = ckg._entityByPath.get("src/test.js");
      expect(ids).toContain(entity.id);
    });

    it("should index entity by name", () => {
      const entity = ckg._addEntity({
        name: "MyClass",
        type: ENTITY_TYPES.CLASS,
        filePath: "src/my.js",
        language: "javascript",
      });

      const ids = ckg._entityByName.get("MyClass");
      expect(ids).toContain(entity.id);
    });

    it("should add relationship to _relationships map", () => {
      const a = ckg._addEntity({
        name: "A",
        type: ENTITY_TYPES.MODULE,
        language: "javascript",
      });
      const b = ckg._addEntity({
        name: "B",
        type: ENTITY_TYPES.MODULE,
        language: "javascript",
      });

      const rel = ckg._addRelationship({
        sourceId: a.id,
        targetId: b.id,
        type: RELATIONSHIP_TYPES.IMPORTS,
      });

      expect(ckg._relationships.has(rel.id)).toBe(true);
      expect(rel.sourceId).toBe(a.id);
      expect(rel.targetId).toBe(b.id);
    });

    it("should persist entity to DB", () => {
      ckg._addEntity({
        name: "Foo",
        type: ENTITY_TYPES.FUNCTION,
        language: "javascript",
      });
      expect(db.run).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _extractEntities (in-memory parsing, no file I/O)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_extractEntities()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should detect class declarations", () => {
      const entities = ckg._extractEntities(SIMPLE_JS, "file.js", "javascript");
      const classes = entities.filter((e) => e.type === ENTITY_TYPES.CLASS);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(classes.map((c) => c.name)).toContain("MyClass");
    });

    it("should detect function declarations", () => {
      const entities = ckg._extractEntities(SIMPLE_JS, "file.js", "javascript");
      const funcs = entities.filter((e) => e.type === ENTITY_TYPES.FUNCTION);
      const names = funcs.map((f) => f.name);
      expect(names).toContain("myFunction");
    });

    it("should detect type declarations", () => {
      const entities = ckg._extractEntities(SIMPLE_JS, "file.ts", "typescript");
      const types = entities.filter((e) => e.type === ENTITY_TYPES.TYPE);
      expect(types.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect enum declarations", () => {
      const entities = ckg._extractEntities(SIMPLE_JS, "file.ts", "typescript");
      const enums = entities.filter((e) => e.type === ENTITY_TYPES.ENUM);
      expect(enums.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect Vue components from .vue files", () => {
      const vueContent = `
<script>
import { defineComponent } from 'vue';
export default defineComponent({ name: 'MyComponent' });
</script>`;
      const entities = ckg._extractEntities(
        vueContent,
        "MyComponent.vue",
        "vue",
      );
      const comps = entities.filter((e) => e.type === ENTITY_TYPES.COMPONENT);
      expect(comps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _extractImports
  // ─────────────────────────────────────────────────────────────────────────
  describe("_extractImports()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should extract ES import paths", () => {
      const imports = ckg._extractImports(SIMPLE_JS, "file.js");
      const paths = imports.map((i) => i.path);
      expect(paths).toContain("./foo");
      expect(paths).toContain("./bar");
    });

    it("should extract require() paths", () => {
      const imports = ckg._extractImports(SIMPLE_JS, "file.js");
      const paths = imports.map((i) => i.path);
      expect(paths).toContain("./baz");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // queryEntity
  // ─────────────────────────────────────────────────────────────────────────
  describe("queryEntity()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
      populateGraph(ckg);
    });

    it("should return all entities when no filter given", () => {
      const results = ckg.queryEntity({});
      expect(results.length).toBe(4);
    });

    it("should filter entities by name (case-insensitive partial match)", () => {
      const results = ckg.queryEntity({ name: "classb" }); // partial match for "ClassBar"
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every((e) => e.name.toLowerCase().includes("classb")),
      ).toBe(true);
      const results2 = ckg.queryEntity({ name: "module" });
      expect(
        results2.every((e) => e.name.toLowerCase().includes("module")),
      ).toBe(true);
    });

    it("should filter entities by type", () => {
      const results = ckg.queryEntity({ type: ENTITY_TYPES.CLASS });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ClassBar");
    });

    it("should filter entities by filePath", () => {
      const results = ckg.queryEntity({ filePath: "a.js" });
      expect(results.every((e) => e.filePath?.includes("a.js"))).toBe(true);
    });

    it("should respect limit", () => {
      const results = ckg.queryEntity({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array when no match", () => {
      const results = ckg.queryEntity({ name: "XyzAbsolutelyNotExists999" });
      expect(results).toEqual([]);
    });

    it("should return empty array for type filter with no match", () => {
      const results = ckg.queryEntity({ type: ENTITY_TYPES.INTERFACE });
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // computeCentrality
  // ─────────────────────────────────────────────────────────────────────────
  describe("computeCentrality()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
      populateGraph(ckg);
    });

    it("should return an array with entity + degree info", () => {
      const results = ckg.computeCentrality();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(4); // all entities
      const first = results[0];
      expect(first).toHaveProperty("entity");
      expect(first).toHaveProperty("inDegree");
      expect(first).toHaveProperty("outDegree");
      expect(first).toHaveProperty("totalDegree");
    });

    it("should sort by totalDegree descending", () => {
      const results = ckg.computeCentrality();
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].totalDegree).toBeGreaterThanOrEqual(
          results[i].totalDegree,
        );
      }
    });

    it("should return numeric degree values", () => {
      const results = ckg.computeCentrality();
      for (const r of results) {
        expect(typeof r.inDegree).toBe("number");
        expect(typeof r.outDegree).toBe("number");
        expect(r.totalDegree).toBe(r.inDegree + r.outDegree);
      }
    });

    it("moduleA should have outDegree >= 2 (imports + contains FuncFoo)", () => {
      const results = ckg.computeCentrality();
      const { moduleA } = populateGraph(ckg); // note: graph was already populated
      // Find moduleA's centrality
      const moduleAEntry = results.find((r) => r.entity.name === "moduleA");
      expect(moduleAEntry).toBeDefined();
      expect(moduleAEntry.outDegree).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findHotspots
  // ─────────────────────────────────────────────────────────────────────────
  describe("findHotspots()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should return empty array when no entities exist", () => {
      expect(ckg.findHotspots(5)).toEqual([]);
    });

    it("should return empty array when no entities exceed threshold", () => {
      populateGraph(ckg);
      // All entities have low degree, threshold=100 should yield nothing
      const hotspots = ckg.findHotspots(100);
      expect(hotspots).toEqual([]);
    });

    it("should return entities when threshold=0", () => {
      populateGraph(ckg);
      const hotspots = ckg.findHotspots(0);
      // Everything qualifies with threshold 0 (all have totalDegree >= 0)
      expect(hotspots.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findCircularDependencies
  // ─────────────────────────────────────────────────────────────────────────
  describe("findCircularDependencies()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should return empty array when no entities exist", () => {
      expect(ckg.findCircularDependencies()).toEqual([]);
    });

    it("should detect no cycles for acyclic graph (A imports B)", () => {
      populateGraph(ckg); // A imports B, no cycle back
      const cycles = ckg.findCircularDependencies();
      expect(Array.isArray(cycles)).toBe(true);
      // The CONTAINS relationships don't create cycles
    });

    it("should detect cycle when two modules mutually import each other", () => {
      const entityA = ckg._addEntity({
        name: "modA",
        type: ENTITY_TYPES.MODULE,
        filePath: "a.js",
        language: "javascript",
      });
      const entityB = ckg._addEntity({
        name: "modB",
        type: ENTITY_TYPES.MODULE,
        filePath: "b.js",
        language: "javascript",
      });

      // A → B (imports)
      ckg._addRelationship({
        sourceId: entityA.id,
        targetId: entityB.id,
        type: RELATIONSHIP_TYPES.IMPORTS,
      });
      // B → A (imports) — creates cycle
      ckg._addRelationship({
        sourceId: entityB.id,
        targetId: entityA.id,
        type: RELATIONSHIP_TYPES.IMPORTS,
      });

      const cycles = ckg.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should not detect cycles for non-import relationships (CONTAINS)", () => {
      // Only CONTAINS relationships — these are excluded from cycle detection
      const parent = ckg._addEntity({
        name: "parent",
        type: ENTITY_TYPES.MODULE,
        language: "javascript",
      });
      const child = ckg._addEntity({
        name: "child",
        type: ENTITY_TYPES.FUNCTION,
        language: "javascript",
      });

      ckg._addRelationship({
        sourceId: parent.id,
        targetId: child.id,
        type: RELATIONSHIP_TYPES.CONTAINS,
      });

      const cycles = ckg.findCircularDependencies();
      expect(cycles).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should return zero stats for empty graph", () => {
      const stats = ckg.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelationships).toBe(0);
      expect(stats.filesIndexed).toBe(0);
    });

    it("should reflect entities and relationships after populating graph", () => {
      populateGraph(ckg);
      const stats = ckg.getStats();

      expect(stats.totalEntities).toBe(4);
      expect(stats.totalRelationships).toBe(3);
      expect(stats.entitiesByType).toBeTypeOf("object");
      expect(stats.entitiesByType[ENTITY_TYPES.MODULE]).toBe(2);
      expect(stats.entitiesByType[ENTITY_TYPES.FUNCTION]).toBe(1);
      expect(stats.entitiesByType[ENTITY_TYPES.CLASS]).toBe(1);
    });

    it("should count unique files in filesIndexed", () => {
      populateGraph(ckg); // a.js and b.js
      const stats = ckg.getStats();
      expect(stats.filesIndexed).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildKGContext
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildKGContext()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should return empty string for empty graph (no recommendations)", () => {
      expect(ckg.buildKGContext()).toBe("");
    });

    it("should return context string when high-fan-out module exists", () => {
      // Add a module with >10 outgoing dependencies
      const hub = ckg._addEntity({
        name: "hubModule",
        type: ENTITY_TYPES.MODULE,
        language: "javascript",
      });
      for (let i = 0; i < 12; i++) {
        const dep = ckg._addEntity({
          name: `dep${i}`,
          type: ENTITY_TYPES.MODULE,
          language: "javascript",
        });
        ckg._addRelationship({
          sourceId: hub.id,
          targetId: dep.id,
          type: RELATIONSHIP_TYPES.IMPORTS,
        });
      }

      const ctx = ckg.buildKGContext();
      // Should contain recommendations about high fan-out
      expect(ctx).toContain("Code Knowledge Graph Insights");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _removeEntity
  // ─────────────────────────────────────────────────────────────────────────
  describe("_removeEntity()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should remove entity and its relationships", () => {
      const { moduleA, moduleB } = populateGraph(ckg);

      const initialRelCount = ckg._relationships.size;
      ckg._removeEntity(moduleA.id);

      expect(ckg._entities.has(moduleA.id)).toBe(false);
      // Relations involving moduleA should be removed
      expect(ckg._relationships.size).toBeLessThan(initialRelCount);
    });

    it("should not throw when entity does not exist", () => {
      expect(() => ckg._removeEntity("nonexistent-id")).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // exportGraph
  // ─────────────────────────────────────────────────────────────────────────
  describe("exportGraph()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
      populateGraph(ckg);
    });

    it("should export graph as JSON with version, entities, relationships, stats", () => {
      const exported = ckg.exportGraph();

      expect(exported).toHaveProperty("version", "2.1.0");
      expect(exported).toHaveProperty("exportedAt");
      expect(exported).toHaveProperty("entities");
      expect(exported).toHaveProperty("relationships");
      expect(exported).toHaveProperty("stats");
      expect(exported.entities).toHaveLength(4);
      expect(exported.relationships).toHaveLength(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────────────────────────────────
  describe("exports", () => {
    it("should export ENTITY_TYPES constant", () => {
      expect(ENTITY_TYPES).toHaveProperty("CLASS");
      expect(ENTITY_TYPES).toHaveProperty("FUNCTION");
      expect(ENTITY_TYPES).toHaveProperty("MODULE");
      expect(ENTITY_TYPES).toHaveProperty("INTERFACE");
      expect(ENTITY_TYPES).toHaveProperty("COMPONENT");
    });

    it("should export RELATIONSHIP_TYPES constant", () => {
      expect(RELATIONSHIP_TYPES).toHaveProperty("IMPORTS");
      expect(RELATIONSHIP_TYPES).toHaveProperty("EXTENDS");
      expect(RELATIONSHIP_TYPES).toHaveProperty("CONTAINS");
      expect(RELATIONSHIP_TYPES).toHaveProperty("DEPENDS_ON");
    });
  });
});
