/**
 * Tests for safeOrderByClause — guards ORDER BY (which can't be a bound ? param)
 * against SQL injection from caller-supplied sort options (image/video/audio
 * storage list methods are IPC-reachable).
 */
import { describe, it, expect } from "vitest";

const {
  safeOrderByClause,
} = require("../../../src/main/utils/sql-order-by.js");

describe("safeOrderByClause", () => {
  it("passes a valid column + direction", () => {
    expect(safeOrderByClause("created_at", "DESC")).toEqual({
      column: "created_at",
      direction: "DESC",
    });
    expect(safeOrderByClause("file_name", "asc")).toEqual({
      column: "file_name",
      direction: "ASC",
    });
  });

  it("falls back the column for injection / non-identifier input", () => {
    expect(safeOrderByClause("1; DROP TABLE images--", "DESC").column).toBe(
      "created_at",
    );
    expect(safeOrderByClause("(SELECT x FROM y)", "DESC").column).toBe(
      "created_at",
    );
    expect(safeOrderByClause("a b", "DESC").column).toBe("created_at"); // space
    expect(safeOrderByClause(undefined, "DESC").column).toBe("created_at");
    expect(safeOrderByClause(123, "DESC").column).toBe("created_at");
  });

  it("only allows ASC/DESC for direction (anything else → DESC)", () => {
    expect(safeOrderByClause("created_at", "ASC").direction).toBe("ASC");
    expect(safeOrderByClause("created_at", "desc").direction).toBe("DESC");
    expect(safeOrderByClause("created_at", "; DELETE").direction).toBe("DESC");
    expect(safeOrderByClause("created_at", undefined).direction).toBe("DESC");
  });

  it("honours a custom fallback column", () => {
    expect(
      safeOrderByClause("bad input!", "DESC", { fallbackColumn: "id" }).column,
    ).toBe("id");
  });
});
