import { describe, it, expect, vi } from "vitest";

const { getGraphData, deleteRelations } = require("../database-graph");

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
