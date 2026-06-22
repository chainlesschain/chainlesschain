/**
 * Integration: learning-trajectories export/import (§8.3 learning backup, store 3)
 * against a REAL better-sqlite3 DB. Tests the export/import functions directly
 * (hand-built rows) — no TrajectoryStore dependency.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  exportTrajectories,
  importTrajectories,
} from "../../src/lib/learning/learning-tables.js";

const row = (id, intent) => ({
  id,
  session_id: "s1",
  user_intent: intent,
  tool_chain: '["query_vault"]',
  tool_count: 1,
  complexity_level: "simple",
  synthesized_skill: null,
  created_at: "2026-01-01 00:00:00",
});

describe("trajectories export/import — real sqlite round-trip", () => {
  let dbA;
  let dbB;

  beforeEach(() => {
    dbA = new Database(":memory:");
    dbB = new Database(":memory:");
  });

  afterEach(() => {
    dbA.close();
    dbB.close();
  });

  it("exports all and imports losslessly (incl. synthesized_skill linkage)", () => {
    importTrajectories(dbA, [
      row("t1", "查账单"),
      { ...row("t2", "总结本周"), synthesized_skill: "weekly-summary" },
    ]);
    const exported = exportTrajectories(dbA);
    expect(exported.length).toBe(2);

    const r = importTrajectories(dbB, exported);
    expect(r).toMatchObject({ ok: true, imported: 2, failed: 0 });
    const inB = exportTrajectories(dbB);
    expect(inB.find((t) => t.id === "t1").user_intent).toBe("查账单");
    expect(inB.find((t) => t.id === "t2").synthesized_skill).toBe("weekly-summary");
  });

  it("import is idempotent (upsert by id, no dup)", () => {
    importTrajectories(dbA, [row("t1", "x")]);
    const exp = exportTrajectories(dbA);
    importTrajectories(dbB, exp);
    const again = importTrajectories(dbB, exp);
    expect(again.ok).toBe(true);
    expect(exportTrajectories(dbB).length).toBe(1);
  });

  it("upsert updates fields but preserves created_at", () => {
    importTrajectories(dbB, [row("t1", "old")]);
    const createdAt = exportTrajectories(dbB)[0].created_at;
    importTrajectories(dbB, [{ ...row("t1", "new"), outcome_score: 0.9 }]);
    const after = exportTrajectories(dbB);
    expect(after.length).toBe(1);
    expect(after[0].user_intent).toBe("new");
    expect(after[0].outcome_score).toBeCloseTo(0.9);
    expect(after[0].created_at).toBe(createdAt);
  });

  it("counts failures without aborting the batch", () => {
    const r = importTrajectories(dbB, [
      row("t1", "ok"),
      { id: "t2" }, // missing session_id
      { session_id: "s" }, // missing id
    ]);
    expect(r.imported).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.ok).toBe(false);
  });
});
