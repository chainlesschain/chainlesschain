/**
 * BehaviorTracker._ensureTables — schema self-sufficiency
 *
 * Regression: _analyzeTimePreferences writes to a time_preferences table, but
 * the defensive _ensureTables (which redundantly creates the other 4 behavior
 * tables) omitted it. Production is covered by migration 015, but on a DB where
 * that migration has not run (direct/test usage) the writes failed
 * "no such table" and the hourly analysis was silently dropped.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { BehaviorTracker } = require("../behavior-tracker.js");

function mockDb() {
  const prep = {
    run: vi.fn(),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn(() => prep),
    _prep: prep,
  };
}

describe("BehaviorTracker._ensureTables", () => {
  it("creates the time_preferences table (self-sufficient without migration 015)", async () => {
    const db = mockDb();
    const tracker = new BehaviorTracker({ database: db });

    await tracker._ensureTables();

    const createdTimePrefs = db.prepare.mock.calls
      .map((c) => c[0])
      .some((s) => /CREATE TABLE IF NOT EXISTS time_preferences/i.test(s));
    expect(createdTimePrefs).toBe(true);
  });
});
