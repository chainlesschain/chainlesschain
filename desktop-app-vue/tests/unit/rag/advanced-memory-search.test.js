/**
 * AdvancedMemorySearch unit tests — src/main/rag/advanced-memory-search.js
 *
 * Tiered memory search (working/recall/archival classification, result sorting,
 * facet counting), previously untested. No bug found on review — this locks in
 * the pure tier/sort/facet logic. (Score combination is delegated to underlying
 * search engines and not exercised here.)
 *
 * Constructor only stores `database`, so the pure methods are offline-testable
 * with a dummy db.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  AdvancedMemorySearch,
  MEMORY_TIERS,
} from "../../../src/main/rag/advanced-memory-search.js";

const mk = () => new AdvancedMemorySearch({ database: {} });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe("AdvancedMemorySearch._determineTier", () => {
  it("returns archival for missing or invalid dates", () => {
    expect(mk()._determineTier(null)).toBe(MEMORY_TIERS.ARCHIVAL);
    expect(mk()._determineTier("not-a-date")).toBe(MEMORY_TIERS.ARCHIVAL);
  });

  it("classifies by age: working <= 7d, recall <= 30d, else archival", () => {
    const s = mk();
    expect(s._determineTier(daysAgo(1))).toBe(MEMORY_TIERS.WORKING);
    expect(s._determineTier(daysAgo(15))).toBe(MEMORY_TIERS.RECALL);
    expect(s._determineTier(daysAgo(60))).toBe(MEMORY_TIERS.ARCHIVAL);
  });
});

describe("AdvancedMemorySearch._sortResults", () => {
  const rows = () => [
    { score: 0.2, metadata: { importance: 5, date: daysAgo(10) } },
    { score: 0.9, metadata: { importance: 1, date: daysAgo(1) } },
    { score: 0.5, metadata: { importance: 3, date: daysAgo(30) } },
  ];

  it("sorts by relevance descending by default", () => {
    const r = mk()._sortResults(rows(), "relevance", "desc");
    expect(r.map((x) => x.score)).toEqual([0.9, 0.5, 0.2]);
  });

  it("supports ascending order", () => {
    const r = mk()._sortResults(rows(), "relevance", "asc");
    expect(r.map((x) => x.score)).toEqual([0.2, 0.5, 0.9]);
  });

  it("sorts by importance", () => {
    const r = mk()._sortResults(rows(), "importance", "desc");
    expect(r.map((x) => x.metadata.importance)).toEqual([5, 3, 1]);
  });

  it("sorts by date (newest first when desc)", () => {
    const r = mk()._sortResults(rows(), "date", "desc");
    expect(r.map((x) => x.score)).toEqual([0.9, 0.2, 0.5]);
  });

  it("treats a missing score as 0", () => {
    const r = mk()._sortResults([{}, { score: 0.5 }], "relevance", "desc");
    expect(r[0].score).toBe(0.5);
  });
});

describe("AdvancedMemorySearch._calculateFacets", () => {
  it("counts types, importance levels, and tiers", () => {
    const f = mk()._calculateFacets([
      { metadata: { type: "note", importance: 5, date: daysAgo(1) } },
      { metadata: { type: "note", importance: 3, date: daysAgo(40) } },
      { metadata: { type: "task" } }, // default importance 3, no date → archival
    ]);
    expect(f.types.note).toBe(2);
    expect(f.types.task).toBe(1);
    expect(f.importance[5]).toBe(1);
    expect(f.importance[3]).toBe(2); // one explicit + one default
    expect(f.tiers[MEMORY_TIERS.WORKING]).toBe(1);
    expect(f.tiers[MEMORY_TIERS.ARCHIVAL]).toBe(2);
  });

  it("uses 'unknown' for missing type", () => {
    const f = mk()._calculateFacets([{ metadata: {} }]);
    expect(f.types.unknown).toBe(1);
  });
});
