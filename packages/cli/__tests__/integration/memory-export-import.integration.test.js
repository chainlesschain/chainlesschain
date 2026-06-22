/**
 * Integration: memory export/import (§8.3 learning-layer backup) against a REAL
 * better-sqlite3 DB (the export/import use ON CONFLICT upsert + named params that
 * the JS MockDatabase can't emulate). Mirrors the vault round-trip test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  addMemory,
  exportMemory,
  importMemory,
} from "../../src/lib/memory-manager.js";

describe("memory export/import — real sqlite round-trip", () => {
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
    addMemory(dbA, "妈妈 = 张三", { category: "person", importance: 5 });
    addMemory(dbA, "外卖 = 美团、饿了么", { category: "pref" });
    const exported = exportMemory(dbA);
    expect(exported.length).toBe(2);

    const r = importMemory(dbB, exported);
    expect(r).toMatchObject({ ok: true, imported: 2, failed: 0 });
    expect(exportMemory(dbB).map((e) => e.content).sort()).toEqual(
      ["外卖 = 美团、饿了么", "妈妈 = 张三"].sort(),
    );
  });

  it("import is idempotent (upsert by id, no dup)", () => {
    addMemory(dbA, "x", {});
    const exp = exportMemory(dbA);
    importMemory(dbB, exp);
    const again = importMemory(dbB, exp);
    expect(again.ok).toBe(true);
    expect(exportMemory(dbB).length).toBe(1);
  });

  it("upsert updates content for an existing id but preserves created_at", () => {
    addMemory(dbA, "old", {});
    const exp = exportMemory(dbA);
    importMemory(dbB, exp);
    const createdAt = exportMemory(dbB)[0].created_at;

    importMemory(dbB, [{ ...exp[0], content: "new" }]);
    const after = exportMemory(dbB);
    expect(after.length).toBe(1);
    expect(after[0].content).toBe("new");
    expect(after[0].created_at).toBe(createdAt); // immutable on upsert
  });

  it("counts failures without aborting the batch", () => {
    const r = importMemory(dbB, [
      { id: "a", content: "ok" },
      { id: "", content: "missing-id" },
      { content: "no-id-field" },
    ]);
    expect(r.imported).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.ok).toBe(false);
  });
});
