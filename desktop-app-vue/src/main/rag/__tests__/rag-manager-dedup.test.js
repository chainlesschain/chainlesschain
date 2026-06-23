import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { RAGManager } = require("../rag-manager.js");

// _deduplicateResults uses no `this`, so call it via the prototype to avoid
// constructing the full (heavy) RAGManager.
const dedup = (results) =>
  RAGManager.prototype._deduplicateResults.call(null, results);

describe("RAGManager._deduplicateResults", () => {
  it("keeps the higher-scored duplicate", () => {
    const out = dedup([
      { id: "d1", score: 0.8 },
      { id: "d1", score: 0.9 },
      { id: "d2", score: 0.5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.id === "d1").score).toBe(0.9);
  });

  it("keeps a scored duplicate over an earlier scoreless one (regression)", () => {
    const out = dedup([
      { id: "d1" }, // no score, arrives first
      { id: "d1", score: 0.9 }, // scored, arrives later — must win
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.9);
  });

  it("does not let a scoreless duplicate replace an earlier scored one", () => {
    const out = dedup([
      { id: "d1", score: 0.7 },
      { id: "d1" }, // no score — must NOT replace
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.7);
  });

  it("preserves distinct ids and original order", () => {
    const out = dedup([
      { id: "a", score: 1 },
      { id: "b", score: 2 },
      { id: "c", score: 3 },
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("a later-arriving winning duplicate keeps the id's ORIGINAL position", () => {
    // 'd1' first appears at index 0; its higher-scored version arrives last.
    // Order must stay [d1, d2] (first-seen), and d1 must carry the higher score.
    const out = dedup([
      { id: "d1", score: 0.8 },
      { id: "d2", score: 0.5 },
      { id: "d1", score: 0.9 },
    ]);
    expect(out.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(out[0].score).toBe(0.9);
  });
});
