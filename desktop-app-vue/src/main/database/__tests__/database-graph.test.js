import { describe, it, expect, vi } from "vitest";

const {
  getGraphData,
  deleteRelations,
  getKnowledgeRelations,
  findRelationPath,
} = require("../database-graph");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// Minimal sql.js-style prepared-statement stub (bind/step/getAsObject/free).
function makeStmt(rows = []) {
  let i = 0;
  return {
    bind: vi.fn(),
    step: vi.fn(() => (i < rows.length ? ((i += 1), true) : false)),
    getAsObject: vi.fn(() => rows[i - 1]),
    free: vi.fn(),
    run: vi.fn(),
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
    const db = { prepare: vi.fn(() => makeStmt([])), getRowsModified: vi.fn() };
    const result = getGraphData({ db }, logger, {});
    expect(result).toEqual({ nodes: [], edges: [] });
    expect(db.prepare).toHaveBeenCalled(); // not short-circuited
  });
});

describe("database-graph deleteRelations — already-guarded empty types", () => {
  it("omits the IN clause entirely when types is empty (never builds `IN ()`)", () => {
    let capturedSql = "";
    const stmt = makeStmt();
    const db = {
      prepare: vi.fn((sql) => {
        capturedSql = sql;
        return stmt;
      }),
      getRowsModified: vi.fn(() => 3),
    };
    const changes = deleteRelations({ db }, logger, "note-1", []);
    expect(capturedSql).not.toContain("IN ()");
    expect(capturedSql).not.toContain("relation_type IN");
    expect(changes).toBe(3);
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
