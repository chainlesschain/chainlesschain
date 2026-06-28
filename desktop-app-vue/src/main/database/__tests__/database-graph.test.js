import { describe, it, expect, vi } from "vitest";

const graph = require("../database-graph");
const {
  getGraphData,
  deleteRelations,
  getKnowledgeRelations,
  findRelationPath,
} = graph;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// better-sqlite3-style prepared-statement stub (all/get/run/free). The module
// must use these — NOT sql.js step()/getAsObject()/bind(), which the real
// SQLCipher wrapper stubs to false/null (see real-wrapper block below).
function makeStmt(rows = []) {
  return {
    all: vi.fn(() => rows),
    get: vi.fn(() => rows[0] || null),
    run: vi.fn(() => ({ changes: rows.length, lastInsertRowid: 0 })),
    free: vi.fn(),
  };
}

describe("database-graph getGraphData — empty IN guard", () => {
  it("returns an empty graph for an explicit empty relationTypes (no `IN ()`, no db call)", () => {
    const db = { prepare: vi.fn() };
    const result = getGraphData({ db }, logger, { relationTypes: [] });
    expect(result).toEqual({ nodes: [], edges: [] });
    expect(db.prepare).not.toHaveBeenCalled(); // short-circuits before any SQL
  });

  it("returns an empty graph for an explicit empty nodeTypes (no `IN ()`, no db call)", () => {
    const db = { prepare: vi.fn() };
    const result = getGraphData({ db }, logger, { nodeTypes: [] });
    expect(result).toEqual({ nodes: [], edges: [] });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("still runs the normal path when filters are non-empty (defaults)", () => {
    // All queries return no rows → empty graph, but the DB IS consulted.
    const db = { prepare: vi.fn(() => makeStmt([])) };
    const result = getGraphData({ db }, logger, {});
    expect(result).toEqual({ nodes: [], edges: [] });
    expect(db.prepare).toHaveBeenCalled(); // not short-circuited
  });
});

describe("database-graph deleteRelations — already-guarded empty types", () => {
  it("omits the IN clause entirely when types is empty (never builds `IN ()`)", () => {
    let capturedSql = "";
    const stmt = makeStmt([{}, {}, {}]); // run() → changes: 3
    const db = {
      prepare: vi.fn((sql) => {
        capturedSql = sql;
        return stmt;
      }),
    };
    const changes = deleteRelations({ db }, logger, "note-1", []);
    expect(capturedSql).not.toContain("IN ()");
    expect(capturedSql).not.toContain("relation_type IN");
    expect(changes).toBe(3); // from run().changes, not db.getRowsModified()
  });
});

describe("database-graph metadata parsing — a corrupt row must not crash", () => {
  it("getKnowledgeRelations parses valid metadata and falls back to null on bad JSON", () => {
    const stmt = makeStmt([
      {
        id: "r1",
        source_id: "a",
        target_id: "b",
        relation_type: "link",
        weight: 1,
        metadata: '{"k":1}',
        created_at: 1,
      },
      {
        id: "r2",
        source_id: "a",
        target_id: "c",
        relation_type: "tag",
        weight: 1,
        metadata: "{corrupt", // not valid JSON
        created_at: 2,
      },
    ]);
    const db = { prepare: vi.fn(() => stmt) };

    const rels = getKnowledgeRelations({ db }, logger, "a");
    expect(rels).toHaveLength(2);
    expect(rels[0].metadata).toEqual({ k: 1 }); // valid → parsed
    expect(rels[1].metadata).toBeNull(); // corrupt → null, not a throw
  });
});

describe("database-graph findRelationPath — BFS shortest path", () => {
  // Build a db whose single `knowledge_relations` scan yields these edges.
  // The SELECT aliases `id AS edge_id`, so rows expose `edge_id`.
  function graphDb(edges) {
    const rows = edges.map(([source_id, target_id, edge_id]) => ({
      source_id,
      target_id,
      edge_id,
      relation_type: "link",
      weight: 1,
    }));
    return { db: { prepare: vi.fn(() => makeStmt(rows)) } };
  }

  it("returns a zero-length path when source equals target", () => {
    const dbManager = { db: { prepare: vi.fn() } };
    expect(findRelationPath(dbManager, logger, "x", "x")).toEqual({
      nodes: ["x"],
      edges: [],
      length: 0,
    });
    expect(dbManager.db.prepare).not.toHaveBeenCalled();
  });

  it("finds a direct (1-edge) path", () => {
    const db = graphDb([["a", "b", "e1"]]);
    expect(findRelationPath(db, logger, "a", "b")).toEqual({
      nodes: ["a", "b"],
      edges: ["e1"],
      length: 1,
    });
  });

  it("finds the shortest 2-edge path", () => {
    const db = graphDb([
      ["a", "b", "e1"],
      ["b", "c", "e2"],
    ]);
    expect(findRelationPath(db, logger, "a", "c")).toEqual({
      nodes: ["a", "b", "c"],
      edges: ["e1", "e2"],
      length: 2,
    });
  });

  it("traverses edges as undirected (reverse direction works)", () => {
    const db = graphDb([["a", "b", "e1"]]);
    expect(findRelationPath(db, logger, "b", "a")).toEqual({
      nodes: ["b", "a"],
      edges: ["e1"],
      length: 1,
    });
  });

  it("returns null when no path exists", () => {
    const db = graphDb([["a", "b", "e1"]]);
    expect(findRelationPath(db, logger, "a", "z")).toBeNull();
  });

  it("excludes paths longer than maxDepth", () => {
    const chain = [
      ["a", "b", "e1"],
      ["b", "c", "e2"],
      ["c", "d", "e3"],
    ];
    // a→d is 3 edges; maxDepth 2 must not find it, maxDepth 3 must.
    expect(findRelationPath(graphDb(chain), logger, "a", "d", 2)).toBeNull();
    expect(findRelationPath(graphDb(chain), logger, "a", "d", 3)).toMatchObject(
      {
        length: 3,
      },
    );
  });

  it("terminates on a cycle without finding an unreachable target", () => {
    // a-b-c-a is a cycle; `d` is unreachable. Must return null, not hang.
    const db = graphDb([
      ["a", "b", "e1"],
      ["b", "c", "e2"],
      ["c", "a", "e3"],
    ]);
    expect(findRelationPath(db, logger, "a", "d")).toBeNull();
  });
});

// ── Integration: drive the REAL SQLCipher wrapper over in-memory better-sqlite3.
// This is what production uses; the old sql.js stub masked that the wrapper
// stubs step()/getAsObject() → every read returned empty/null. These tests fail
// if the module regresses to the sql.js iteration API.
let Database;
let hasSqlite = true;
try {
  Database = require("better-sqlite3");
  const t = new Database(":memory:");
  t.close();
} catch {
  hasSqlite = false;
}
const { SQLCipherWrapper } = require("../sqlcipher-wrapper");
const describeIf = hasSqlite ? describe : describe.skip;

describeIf("database-graph via real SQLCipher wrapper (end-to-end)", () => {
  let wrapper, dbManager, idCounter;

  beforeEach(() => {
    wrapper = new SQLCipherWrapper(":memory:", {}, Database);
    wrapper.open();
    wrapper.db.exec(`
      CREATE TABLE knowledge_relations (
        id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT,
        relation_type TEXT, weight REAL, metadata TEXT, created_at INTEGER);
      CREATE TABLE knowledge_items (
        id TEXT PRIMARY KEY, title TEXT, type TEXT,
        created_at INTEGER, updated_at INTEGER);
      CREATE TABLE knowledge_tags (knowledge_id TEXT, tag_id TEXT);
    `);
    idCounter = 0;
    dbManager = {
      db: wrapper,
      generateId: () => `id-${++idCounter}`,
      // used by buildTagRelations / buildTemporalRelations
      addRelations: (rels) => graph.addRelations(dbManager, logger, rels),
      getKnowledgeTags: (kid) =>
        wrapper.db
          .prepare("SELECT tag_id FROM knowledge_tags WHERE knowledge_id = ?")
          .all(kid),
    };
  });

  afterEach(() => {
    try {
      wrapper.db.close();
    } catch {
      /* ignore */
    }
  });

  function addItem(id, type = "note", createdAt = 0) {
    wrapper.db
      .prepare(
        "INSERT INTO knowledge_items (id, title, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, `title-${id}`, type, createdAt, createdAt);
  }

  it("addRelation + getKnowledgeRelations round-trip (not empty)", () => {
    addItem("a");
    addItem("b");
    graph.addRelation(dbManager, logger, "a", "b", "link", 0.9, { x: 1 });

    const rels = getKnowledgeRelations(dbManager, logger, "a");
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ source: "a", target: "b", type: "link" });
    expect(rels[0].metadata).toEqual({ x: 1 });
  });

  it("getGraphData returns the nodes and edges (would be empty under the bug)", () => {
    addItem("a");
    addItem("b");
    graph.addRelation(dbManager, logger, "a", "b", "link", 1.0);

    const { nodes, edges } = getGraphData(dbManager, logger, {});
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "a", target: "b", type: "link" });
  });

  it("getKnowledgeNeighbors walks one hop", () => {
    addItem("a");
    addItem("b");
    addItem("c");
    graph.addRelation(dbManager, logger, "a", "b", "link", 1.0);
    graph.addRelation(dbManager, logger, "b", "c", "link", 1.0);

    const { nodes, edges } = graph.getKnowledgeNeighbors(
      dbManager,
      logger,
      "a",
      1,
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(edges).toHaveLength(1);
  });

  it("findRelationPath finds a real 2-edge path", () => {
    graph.addRelation(dbManager, logger, "a", "b", "link", 1.0);
    graph.addRelation(dbManager, logger, "b", "c", "link", 1.0);
    const path = findRelationPath(dbManager, logger, "a", "c");
    expect(path).toMatchObject({ nodes: ["a", "b", "c"], length: 2 });
  });

  it("deleteRelations reports the real number of deleted rows", () => {
    graph.addRelation(dbManager, logger, "a", "b", "link", 1.0);
    graph.addRelation(dbManager, logger, "a", "c", "tag", 1.0);
    const changes = deleteRelations(dbManager, logger, "a");
    expect(changes).toBe(2);
    expect(getKnowledgeRelations(dbManager, logger, "a")).toHaveLength(0);
  });

  it("buildTagRelations clears old tag relations (DELETE actually runs) and builds new", () => {
    // stale tag relation that must be cleared by the DELETE
    graph.addRelation(dbManager, logger, "old", "stale", "tag", 1.0);
    // two notes sharing a tag
    wrapper.db
      .prepare(
        "INSERT INTO knowledge_tags (knowledge_id, tag_id) VALUES (?, ?)",
      )
      .run("a", "t1");
    wrapper.db
      .prepare(
        "INSERT INTO knowledge_tags (knowledge_id, tag_id) VALUES (?, ?)",
      )
      .run("b", "t1");

    graph.buildTagRelations(dbManager, logger);

    const tagRels = wrapper.db
      .prepare("SELECT * FROM knowledge_relations WHERE relation_type = 'tag'")
      .all();
    // stale 'old'->'stale' was deleted; new 'a'->'b' built
    expect(tagRels).toHaveLength(1);
    expect(tagRels[0]).toMatchObject({ source_id: "a", target_id: "b" });
  });

  it("buildTemporalRelations clears old temporal relations and builds within window", () => {
    graph.addRelation(dbManager, logger, "old", "stale", "temporal", 1.0);
    addItem("a", "note", 1000);
    addItem("b", "note", 2000); // 1s apart, within 7d window

    graph.buildTemporalRelations(dbManager, logger);

    const tRels = wrapper.db
      .prepare(
        "SELECT * FROM knowledge_relations WHERE relation_type = 'temporal'",
      )
      .all();
    expect(tRels).toHaveLength(1);
    expect(tRels[0]).toMatchObject({ source_id: "a", target_id: "b" });
  });
});
