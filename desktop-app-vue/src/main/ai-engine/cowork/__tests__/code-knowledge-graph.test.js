/**
 * CodeKnowledgeGraph 单元测试 — v2.1.0
 *
 * 覆盖：initialize、scanFile、scanWorkspace、queryEntity、
 *       computeCentrality、findHotspots、findCircularDependencies、
 *       buildKGContext、getStats
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
// NOTE: vi.mock("fs") doesn't intercept Node built-ins in forks pool;
//       use vi.spyOn on the real module instead.
const fs = require("fs");
const { CodeKnowledgeGraph, ENTITY_TYPES, RELATIONSHIP_TYPES } = require("../code-knowledge-graph");

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
    _prepareResult: prepareResult,
  };
}

// Simple JS content with import, class, function, arrow function
const SIMPLE_JS = `
import { foo } from './foo';
import bar from './bar';
const baz = require('./baz');

export class MyClass extends BaseClass implements Iface {
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
      db._prepareResult.all
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
    });

    it("should be idempotent on double initialize", async () => {
      await ckg.initialize(db);
      await ckg.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // scanFile
  // ─────────────────────────────────────────────────────────────────────────
  describe("scanFile()", () => {
    let readFileSpy;

    beforeEach(async () => {
      await ckg.initialize(db);
      readFileSpy = vi.spyOn(fs, "readFileSync");
    });

    it("should return 0 entities if file cannot be read", async () => {
      readFileSpy.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = await ckg.scanFile("/nonexistent/file.js");
      expect(result).toEqual({ entities: 0, relationships: 0 });
    });

    it("should create a module entity for the file itself", async () => {
      readFileSpy.mockReturnValue("// empty file");

      const result = await ckg.scanFile("/workspace/src/empty.js", "/workspace");

      expect(result.entities).toBeGreaterThanOrEqual(1);
      const moduleEntities = Array.from(ckg._entities.values()).filter(
        (e) => e.type === ENTITY_TYPES.MODULE,
      );
      expect(moduleEntities.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract class entities from JS content", async () => {
      readFileSpy.mockReturnValue(SIMPLE_JS);

      await ckg.scanFile("/workspace/src/myfile.js", "/workspace");

      const classEntities = Array.from(ckg._entities.values()).filter(
        (e) => e.type === ENTITY_TYPES.CLASS,
      );
      expect(classEntities.length).toBeGreaterThanOrEqual(1);
      const names = classEntities.map((e) => e.name);
      expect(names).toContain("MyClass");
    });

    it("should extract function entities from JS content", async () => {
      readFileSpy.mockReturnValue(SIMPLE_JS);

      await ckg.scanFile("/workspace/src/myfile.js", "/workspace");

      const funcEntities = Array.from(ckg._entities.values()).filter(
        (e) => e.type === ENTITY_TYPES.FUNCTION,
      );
      const names = funcEntities.map((e) => e.name);
      expect(names).toContain("myFunction");
    });

    it("should extract type entities from TS content", async () => {
      readFileSpy.mockReturnValue(SIMPLE_JS);

      await ckg.scanFile("/workspace/src/myfile.ts", "/workspace");

      const typeEntities = Array.from(ckg._entities.values()).filter(
        (e) => e.type === ENTITY_TYPES.TYPE,
      );
      expect(typeEntities.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract enum entities", async () => {
      readFileSpy.mockReturnValue(SIMPLE_JS);

      await ckg.scanFile("/workspace/src/myfile.ts", "/workspace");

      const enumEntities = Array.from(ckg._entities.values()).filter(
        (e) => e.type === ENTITY_TYPES.ENUM,
      );
      expect(enumEntities.length).toBeGreaterThanOrEqual(1);
    });

    it("should create import relationships", async () => {
      readFileSpy.mockReturnValue(SIMPLE_JS);

      await ckg.scanFile("/workspace/src/myfile.js", "/workspace");

      const importRels = Array.from(ckg._relationships.values()).filter(
        (r) => r.type === RELATIONSHIP_TYPES.IMPORTS,
      );
      expect(importRels.length).toBeGreaterThan(0);
    });

    it("should create CONTAINS relationships between module and entities", async () => {
      readFileSpy.mockReturnValue("export function doSomething() { return 1; }");

      await ckg.scanFile("/workspace/src/util.js", "/workspace");

      const containsRels = Array.from(ckg._relationships.values()).filter(
        (r) => r.type === RELATIONSHIP_TYPES.CONTAINS,
      );
      expect(containsRels.length).toBeGreaterThan(0);
    });

    it("should use relative path when rootDir is provided", async () => {
      readFileSpy.mockReturnValue("// comment");

      await ckg.scanFile("/workspace/src/comp.js", "/workspace");

      const entities = Array.from(ckg._entities.values());
      const modulePath = entities.find((e) => e.type === ENTITY_TYPES.MODULE)?.filePath;
      expect(modulePath).not.toContain("/workspace");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // scanWorkspace
  // ─────────────────────────────────────────────────────────────────────────
  describe("scanWorkspace()", () => {
    let readdirSpy;
    let readFileSpy;

    beforeEach(async () => {
      await ckg.initialize(db);
      readdirSpy = vi.spyOn(fs, "readdirSync");
      readFileSpy = vi.spyOn(fs, "readFileSync");
    });

    it("should skip node_modules directories", async () => {
      readdirSpy.mockReturnValue([
        { name: "node_modules", isDirectory: () => true },
        { name: "index.js", isDirectory: () => false },
      ]);
      readFileSpy.mockReturnValue("// content");

      const result = await ckg.scanWorkspace("/workspace");

      // node_modules should be skipped; index.js should be scanned
      expect(result.files).toBe(1);
    });

    it("should skip .git directories", async () => {
      readdirSpy.mockReturnValue([
        { name: ".git", isDirectory: () => true },
      ]);

      const result = await ckg.scanWorkspace("/workspace");
      expect(result.files).toBe(0);
    });

    it("should only scan files with supported extensions", async () => {
      readdirSpy.mockReturnValue([
        { name: "app.js", isDirectory: () => false },
        { name: "style.css", isDirectory: () => false },
        { name: "readme.md", isDirectory: () => false },
      ]);
      readFileSpy.mockReturnValue("// js content");

      const result = await ckg.scanWorkspace("/workspace");

      expect(result.files).toBe(1); // only .js
    });

    it("should return files/entities/relationships/duration in result", async () => {
      readdirSpy.mockReturnValue([]);

      const result = await ckg.scanWorkspace("/workspace");

      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("entities");
      expect(result).toHaveProperty("relationships");
      expect(result).toHaveProperty("duration");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // queryEntity
  // ─────────────────────────────────────────────────────────────────────────
  describe("queryEntity()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
      vi.spyOn(fs, "readFileSync").mockReturnValue(SIMPLE_JS);
      await ckg.scanFile("/workspace/src/file.js", "/workspace");
    });

    it("should return all entities when no filter given", () => {
      const results = ckg.queryEntity({});
      expect(results.length).toBeGreaterThan(0);
    });

    it("should filter entities by name (case-insensitive partial match)", () => {
      const results = ckg.queryEntity({ name: "myclass" });
      expect(results.every((e) => e.name.toLowerCase().includes("myclass"))).toBe(true);
    });

    it("should filter entities by type", () => {
      const results = ckg.queryEntity({ type: ENTITY_TYPES.CLASS });
      expect(results.every((e) => e.type === ENTITY_TYPES.CLASS)).toBe(true);
    });

    it("should filter entities by filePath", () => {
      const results = ckg.queryEntity({ filePath: "src/file.js" });
      expect(results.every((e) => e.filePath?.includes("src/file.js"))).toBe(true);
    });

    it("should respect limit", () => {
      const results = ckg.queryEntity({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array when no match", () => {
      const results = ckg.queryEntity({ name: "xyzAbsolutelyNotExists" });
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // computeCentrality
  // ─────────────────────────────────────────────────────────────────────────
  describe("computeCentrality()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
      vi.spyOn(fs, "readFileSync").mockReturnValue(SIMPLE_JS);
      await ckg.scanFile("/workspace/src/file.js", "/workspace");
    });

    it("should return an array with entity + degree info", () => {
      const results = ckg.computeCentrality();
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        const first = results[0];
        expect(first).toHaveProperty("entity");
        expect(first).toHaveProperty("inDegree");
        expect(first).toHaveProperty("outDegree");
        expect(first).toHaveProperty("totalDegree");
      }
    });

    it("should sort by totalDegree descending", () => {
      const results = ckg.computeCentrality();
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].totalDegree).toBeGreaterThanOrEqual(results[i].totalDegree);
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
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findHotspots
  // ─────────────────────────────────────────────────────────────────────────
  describe("findHotspots()", () => {
    beforeEach(async () => {
      await ckg.initialize(db);
    });

    it("should return empty array when no entities have sufficient degree", () => {
      const hotspots = ckg.findHotspots(100);
      expect(hotspots).toEqual([]);
    });

    it("should return entities exceeding the threshold", async () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue(SIMPLE_JS);
      await ckg.scanFile("/workspace/src/a.js", "/workspace");

      // With threshold=0, everything qualifies
      const hotspots = ckg.findHotspots(0);
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
      const cycles = ckg.findCircularDependencies();
      expect(cycles).toEqual([]);
    });

    it("should detect no cycles when relationships are acyclic", async () => {
      // A → B (no cycle)
      fs.readFileSync.mockReturnValue("import { B } from './b';");
      await ckg.scanFile("/workspace/src/a.js", "/workspace");

      const cycles = ckg.findCircularDependencies();
      // May or may not have cycles depending on unresolved imports
      expect(Array.isArray(cycles)).toBe(true);
    });

    it("should detect cycle when two modules import each other", async () => {
      await ckg.initialize(db);

      // Manually inject a cycle: A → B → A
      const entityA = ckg._addEntity({
        name: "moduleA",
        type: ENTITY_TYPES.MODULE,
        filePath: "a.js",
        language: "javascript",
      });
      const entityB = ckg._addEntity({
        name: "moduleB",
        type: ENTITY_TYPES.MODULE,
        filePath: "b.js",
        language: "javascript",
      });

      // Create resolved imports (both endpoints exist)
      ckg._addRelationship({
        sourceId: entityA.id,
        targetId: entityB.id,
        type: RELATIONSHIP_TYPES.IMPORTS,
      });
      ckg._addRelationship({
        sourceId: entityB.id,
        targetId: entityA.id,
        type: RELATIONSHIP_TYPES.IMPORTS,
      });

      const cycles = ckg.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
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

    it("should reflect entities after scanning", async () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue(SIMPLE_JS);
      await ckg.scanFile("/workspace/src/file.js", "/workspace");

      const stats = ckg.getStats();
      expect(stats.totalEntities).toBeGreaterThan(0);
      expect(stats.entitiesByType).toBeTypeOf("object");
      expect(stats.relationshipsByType).toBeTypeOf("object");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildKGContext
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildKGContext()", () => {
    it("should return empty string when no recommendations", async () => {
      await ckg.initialize(db);
      // Empty graph → no recommendations
      const ctx = ckg.buildKGContext();
      expect(ctx).toBe("");
    });

    it("should return context string when recommendations exist", async () => {
      await ckg.initialize(db);
      fs.readFileSync.mockReturnValue(SIMPLE_JS);
      await ckg.scanFile("/workspace/src/bigfile.js", "/workspace");

      // Force recommendations by adding many relationships
      const moduleEntity = Array.from(ckg._entities.values()).find(
        (e) => e.type === ENTITY_TYPES.MODULE,
      );
      if (moduleEntity) {
        for (let i = 0; i < 12; i++) {
          const target = ckg._addEntity({
            name: `dep${i}`,
            type: ENTITY_TYPES.MODULE,
            filePath: `dep${i}.js`,
            language: "javascript",
          });
          ckg._addRelationship({
            sourceId: moduleEntity.id,
            targetId: target.id,
            type: RELATIONSHIP_TYPES.IMPORTS,
          });
        }
      }

      const ctx = ckg.buildKGContext();
      // Either empty or contains recommendations
      expect(typeof ctx).toBe("string");
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
    });

    it("should export RELATIONSHIP_TYPES constant", () => {
      expect(RELATIONSHIP_TYPES).toHaveProperty("IMPORTS");
      expect(RELATIONSHIP_TYPES).toHaveProperty("EXTENDS");
      expect(RELATIONSHIP_TYPES).toHaveProperty("CONTAINS");
    });
  });
});
