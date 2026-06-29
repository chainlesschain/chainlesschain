/**
 * Security regression: getAll() interpolates filters.orderBy into ORDER BY
 * (can't be a bound param), and filters is reachable via instinct-ipc. safeOrderBy
 * must reject anything that isn't an allowlisted column + optional ASC/DESC so a
 * caller can't inject SQL.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(),
}));

const { safeOrderBy } = require("../../../src/main/llm/instinct-manager.js");

const FB = "confidence DESC, use_count DESC";

describe("instinct-manager safeOrderBy (ORDER BY injection guard)", () => {
  it("passes valid single + multi column clauses", () => {
    expect(safeOrderBy("confidence DESC", FB)).toBe("confidence DESC");
    expect(safeOrderBy("use_count ASC, created_at DESC", FB)).toBe(
      "use_count ASC, created_at DESC",
    );
    expect(safeOrderBy("category", FB)).toBe("category");
  });

  it("falls back for empty / non-string", () => {
    expect(safeOrderBy(undefined, FB)).toBe(FB);
    expect(safeOrderBy("", FB)).toBe(FB);
    expect(safeOrderBy("   ", FB)).toBe(FB);
    expect(safeOrderBy(123, FB)).toBe(FB);
  });

  it("rejects unknown columns and injection attempts", () => {
    expect(safeOrderBy("1; DROP TABLE instincts--", FB)).toBe(FB);
    expect(safeOrderBy("confidence DESC; DELETE FROM instincts", FB)).toBe(FB);
    expect(safeOrderBy("(SELECT password FROM users LIMIT 1)", FB)).toBe(FB);
    expect(safeOrderBy("not_a_column", FB)).toBe(FB);
    expect(safeOrderBy("confidence EVIL", FB)).toBe(FB); // bad direction
    // one bad term in a list rejects the whole clause
    expect(safeOrderBy("confidence DESC, nope ASC", FB)).toBe(FB);
  });
});
