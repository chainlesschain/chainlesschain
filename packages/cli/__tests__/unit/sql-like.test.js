/**
 * SQL LIKE-wildcard escaping (sql-like.js) + the id-prefix DELETE sites that
 * rely on it. An unescaped `id LIKE '<input>%'` lets a user-supplied id of "%"
 * (or one containing % / _) match-all or match-wrong — and for deleteInstinct
 * (an UNBOUNDED delete) that wipes the whole table.
 *
 * The ESCAPE behavior is SQL-level, which the JS MockDatabase can't represent,
 * so the manager regressions run against a real in-memory better-sqlite3.
 */

import { describe, it, expect } from "vitest";
import { escapeLike, likePrefix } from "../../src/lib/sql-like.js";

describe("escapeLike / likePrefix", () => {
  it("escapes % _ \\ and leaves other chars alone", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain-id")).toBe("plain-id");
    expect(escapeLike("")).toBe("");
    expect(escapeLike(null)).toBe("");
  });
  it("likePrefix appends a trailing wildcard to the escaped value", () => {
    expect(likePrefix("abc")).toBe("abc%");
    expect(likePrefix("a%b")).toBe("a\\%b%");
  });
});

describe("deleteInstinct — LIKE-wildcard safety (real db)", () => {
  it("does not wipe the table on '%' / '_' / empty, but legit prefixes work", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { ensureInstinctsTable, deleteInstinct } =
      await import("../../src/lib/instinct-manager.js");
    const db = new Database(":memory:");
    try {
      ensureInstinctsTable(db);
      const ins = db.prepare(
        "INSERT INTO instincts(id,category,pattern) VALUES (?,?,?)",
      );
      ins.run("inst-aaa", "c", "p");
      ins.run("inst-bbb", "c", "p");
      const count = () =>
        db.prepare("SELECT COUNT(*) c FROM instincts").get().c;

      expect(deleteInstinct(db, "%")).toBe(false); // would have wiped both
      expect(count()).toBe(2);
      expect(deleteInstinct(db, "_")).toBe(false);
      expect(deleteInstinct(db, "")).toBe(false);
      expect(deleteInstinct(db, null)).toBe(false);
      expect(count()).toBe(2);

      // Legit prefix delete still works.
      expect(deleteInstinct(db, "inst-aaa")).toBe(true);
      expect(count()).toBe(1);
      expect(deleteInstinct(db, "inst-")).toBe(true); // prefix matches the rest
      expect(count()).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("deleteMemory — LIKE-wildcard safety (real db)", () => {
  it("a wildcard id does not delete a wrong literal-prefix entry", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { deleteMemory } = await import("../../src/lib/memory-manager.js");
    const db = new Database(":memory:");
    try {
      // memory_entries' ensure-table is internal; create the minimal schema here.
      db.exec(
        "CREATE TABLE memory_entries (id TEXT PRIMARY KEY, content TEXT NOT NULL)",
      );
      const ins = db.prepare(
        "INSERT INTO memory_entries(id,content) VALUES (?,?)",
      );
      ins.run("mem-abcd", "x");
      ins.run("mem-efgh", "y");
      const count = () =>
        db.prepare("SELECT COUNT(*) c FROM memory_entries").get().c;

      // length>=4 reaches the prefix branch; the % must be literal, matching no
      // id that starts with "%abc", so nothing is deleted.
      expect(deleteMemory(db, "%abc")).toBe(false);
      expect(count()).toBe(2);
      // "____" (4 underscores) must not wildcard-match a 4+ char id.
      expect(deleteMemory(db, "____")).toBe(false);
      expect(count()).toBe(2);

      // Legit exact + prefix still work.
      expect(deleteMemory(db, "mem-abcd")).toBe(true);
      expect(count()).toBe(1);
    } finally {
      db.close();
    }
  });
});
