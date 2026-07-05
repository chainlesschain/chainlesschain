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

describe("recallMemory — LIKE-wildcard safety (real db)", () => {
  it("matches the DB layer literally, consistent with the in-memory .includes()", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { ensureMemoryTables, recallMemory } =
      await import("../../src/lib/hierarchical-memory.js");
    const db = new Database(":memory:");
    try {
      ensureMemoryTables(db);
      // Seed memory_core (no retention gate → always returned when it matches).
      const ins = db.prepare(
        "INSERT INTO memory_core(id,content,importance) VALUES (?,?,?)",
      );
      ins.run("core-1", "save 50% today", 1.0);
      ins.run("core-2", "we have 5000 units", 1.0);
      ins.run("core-3", "plain body", 1.0);

      // The in-memory layers use `.includes()` (literal); the DB LIKE must match
      // the same way. Searching "50%" must NOT wildcard-match "5000".
      const r1 = recallMemory(db, "50%")
        .map((m) => m.content)
        .sort();
      expect(r1).toEqual(["save 50% today"]);

      // "%" is literal — only the entry that actually contains a '%'.
      const r2 = recallMemory(db, "%")
        .map((m) => m.content)
        .sort();
      expect(r2).toEqual(["save 50% today"]);

      // A plain word still recalls the expected entry.
      const r3 = recallMemory(db, "body")
        .map((m) => m.content)
        .sort();
      expect(r3).toEqual(["plain body"]);
    } finally {
      db.close();
    }
  });
});

describe("queryLogs — LIKE-wildcard safety (real db)", () => {
  it("search filter matches the operation literally, not as a wildcard", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { ensureAuditTables, queryLogs } =
      await import("../../src/lib/audit-logger.js");
    const db = new Database(":memory:");
    try {
      ensureAuditTables(db);
      const ins = db.prepare(
        "INSERT INTO audit_log(id,event_type,operation) VALUES (?,?,?)",
      );
      ins.run("a1", "op", "discount-50%-applied");
      ins.run("a2", "op", "restock-5000-units");
      ins.run("a3", "op", "login-success");

      // `cc audit search "50%"` must not also match "5000".
      const s1 = queryLogs(db, { search: "50%" }).map((r) => r.operation);
      expect(s1).toEqual(["discount-50%-applied"]);

      // `cc audit search "%"` (a bare wildcard) must not match every row.
      const s2 = queryLogs(db, { search: "%" }).map((r) => r.operation);
      expect(s2).toEqual(["discount-50%-applied"]);

      // A plain substring still filters correctly.
      const s3 = queryLogs(db, { search: "login" }).map((r) => r.operation);
      expect(s3).toEqual(["login-success"]);
    } finally {
      db.close();
    }
  });
});
