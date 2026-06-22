/**
 * Integration: instinct export/import (§8.3 learning-layer backup, store 2) against
 * a REAL better-sqlite3 DB (ON CONFLICT upsert + named params the JS mock can't do).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  recordInstinct,
  exportInstincts,
  importInstincts,
} from "../../src/lib/instinct-manager.js";

describe("instinct export/import — real sqlite round-trip", () => {
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

  it("exports all and imports losslessly into a fresh DB", () => {
    recordInstinct(dbA, "tool_preference", "外卖 → 美团");
    recordInstinct(dbA, "language", "回复用中文");
    const exported = exportInstincts(dbA);
    expect(exported.length).toBe(2);

    const r = importInstincts(dbB, exported);
    expect(r).toMatchObject({ ok: true, imported: 2, failed: 0 });
    expect(exportInstincts(dbB).map((e) => e.pattern).sort()).toEqual(
      ["回复用中文", "外卖 → 美团"].sort(),
    );
  });

  it("import is idempotent (upsert by id, no dup)", () => {
    recordInstinct(dbA, "workflow", "p");
    const exp = exportInstincts(dbA);
    importInstincts(dbB, exp);
    const again = importInstincts(dbB, exp);
    expect(again.ok).toBe(true);
    expect(exportInstincts(dbB).length).toBe(1);
  });

  it("upsert updates confidence/occurrences but preserves created_at", () => {
    recordInstinct(dbA, "behavior", "b");
    const exp = exportInstincts(dbA);
    importInstincts(dbB, exp);
    const createdAt = exportInstincts(dbB)[0].created_at;

    importInstincts(dbB, [{ ...exp[0], confidence: 0.95, occurrences: 9 }]);
    const after = exportInstincts(dbB);
    expect(after.length).toBe(1);
    expect(after[0].confidence).toBeCloseTo(0.95);
    expect(after[0].occurrences).toBe(9);
    expect(after[0].created_at).toBe(createdAt); // immutable on upsert
  });

  it("counts failures without aborting the batch", () => {
    const r = importInstincts(dbB, [
      { id: "i1", category: "c", pattern: "p" },
      { id: "i2", category: "c" }, // missing pattern
      { category: "c", pattern: "p" }, // missing id
    ]);
    expect(r.imported).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.ok).toBe(false);
  });
});
