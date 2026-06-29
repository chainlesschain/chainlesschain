/**
 * SmartConflictResolver._learnFromChoice — pattern cache sync
 *
 * Regression: _matchPattern reads only _patternCache (loaded once at init by
 * _loadPatterns, which keeps confidence>0.5 patterns). _learnFromChoice wrote
 * new/updated patterns to the DB but never updated the cache, so a learned
 * pattern was invisible to resolution until the next restart.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { SmartConflictResolver } = require("../conflict-resolver.js");

describe("SmartConflictResolver._learnFromChoice — cache sync", () => {
  it("caches an updated pattern with confidence>0.5 (visible same session)", async () => {
    const db = {
      get: vi.fn((sql) => {
        if (sql.includes("conflict_resolution_history")) {
          return { id: "c1", file_path: "a/b.js", conflict_type: "content" };
        }
        if (sql.includes("conflict_signature")) {
          return { id: "p1" }; // existing pattern → UPDATE branch
        }
        if (sql.includes("WHERE id = ?")) {
          return {
            id: "p1",
            confidence: 0.8,
            file_pattern: "a/*",
            metadata: "{}",
          };
        }
        return null;
      }),
      run: vi.fn(),
      all: vi.fn(() => []),
    };
    const resolver = new SmartConflictResolver({ database: db });

    await resolver._learnFromChoice("c1", "content", "auto");

    expect(resolver._patternCache.has("p1")).toBe(true);
    expect(resolver._patternCache.get("p1").confidence).toBe(0.8);
  });

  it("does not cache a fresh pattern at confidence 0.5 (respects _loadPatterns threshold)", async () => {
    const db = {
      get: vi.fn((sql) => {
        if (sql.includes("conflict_resolution_history")) {
          return { id: "c2", file_path: "x.js", conflict_type: "content" };
        }
        if (sql.includes("conflict_signature")) {
          return null; // no existing pattern → INSERT branch (confidence 0.5)
        }
        if (sql.includes("WHERE id = ?")) {
          return { id: "new-1", confidence: 0.5, metadata: "{}" };
        }
        return null;
      }),
      run: vi.fn(),
      all: vi.fn(() => []),
    };
    const resolver = new SmartConflictResolver({ database: db });

    await resolver._learnFromChoice("c2", "content", "manual");

    expect(resolver._patternCache.size).toBe(0);
  });
});
