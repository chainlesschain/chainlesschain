/**
 * Unit tests: the sql.js compatibility shim inside database-manager.js.
 *
 * Exercises `createSqlJsCompat(rawDb, dbPath)` directly against a real
 * sql.js Database instance. This is the same wrapper the manager installs
 * when the native drivers refuse to load (ABI mismatch / missing binary),
 * and it presents the better-sqlite3 surface our callers assume:
 * prepare().all/get/run, transaction commit+rollback, exec, pragma no-op,
 * close-with-persist.
 *
 * Testing the shim directly (rather than via `DatabaseManager.initialize`)
 * sidesteps `vi.mock()` not intercepting CJS `require()` — the native
 * drivers on a dev machine will happily claim themselves usable during
 * the probe, defeating any attempt to force the wasm path from above.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createSqlJsCompat } = require("../lib/database-manager.js");
const initSqlJs = require("sql.js");

describe("createSqlJsCompat — better-sqlite3 API shim over sql.js", () => {
  let tmpDir;
  let dbPath;
  let SQL;
  let compat;
  let raw;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sqljs-"));
    dbPath = path.join(tmpDir, "test.db");
    SQL = await initSqlJs();
    raw = new SQL.Database();
    compat = createSqlJsCompat(raw, dbPath);
  });

  afterEach(() => {
    try {
      compat.close();
    } catch {
      /* best effort */
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("advertises __isSqlJsCompat so callers can detect the wrapper", () => {
    expect(compat.__isSqlJsCompat).toBe(true);
    expect(compat._raw).toBe(raw);
  });

  it("prepare().all returns row objects for multi-row queries", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    compat.exec("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')");

    const rows = compat.prepare("SELECT id, name FROM t ORDER BY id").all();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ id: 1, name: "a" });
    expect(rows[2]).toEqual({ id: 3, name: "c" });
  });

  it("prepare().get returns first row or undefined (never null)", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    compat.exec("INSERT INTO t (v) VALUES ('hello')");

    expect(compat.prepare("SELECT v FROM t WHERE id = ?").get(1)).toEqual({
      v: "hello",
    });
    expect(
      compat.prepare("SELECT v FROM t WHERE id = ?").get(999),
    ).toBeUndefined();
  });

  it("prepare().run returns {changes, lastInsertRowid} matching better-sqlite3", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

    const r1 = compat.prepare("INSERT INTO t (v) VALUES (?)").run("first");
    expect(r1.changes).toBe(1);
    expect(r1.lastInsertRowid).toBe(1);

    compat.prepare("INSERT INTO t (v) VALUES (?)").run("second");
    const r3 = compat
      .prepare("UPDATE t SET v = ? WHERE id > 0")
      .run("updated");
    expect(r3.changes).toBe(2);
  });

  it("prepare accepts positional, array, and object param shapes", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    compat.exec("INSERT INTO t (v) VALUES ('x'), ('y'), ('z')");

    // positional — better-sqlite3 style
    expect(compat.prepare("SELECT v FROM t WHERE id = ?").all(2)).toEqual([
      { v: "y" },
    ]);

    // array — sql.js native bind style
    expect(compat.prepare("SELECT v FROM t WHERE id = ?").all([3])).toEqual([
      { v: "z" },
    ]);

    // object — named-param style
    expect(
      compat.prepare("SELECT v FROM t WHERE id = :id").all({ ":id": 1 }),
    ).toEqual([{ v: "x" }]);
  });

  it("transaction commits on success", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");

    const txn = compat.transaction((a, b) => {
      compat.prepare("INSERT INTO t (v) VALUES (?)").run(a);
      compat.prepare("INSERT INTO t (v) VALUES (?)").run(b);
    });
    txn(10, 20);

    const rows = compat.prepare("SELECT v FROM t ORDER BY v").all();
    expect(rows.map((r) => r.v)).toEqual([10, 20]);
  });

  it("transaction rolls back on thrown error", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    compat.prepare("INSERT INTO t (v) VALUES (?)").run(1);

    const bad = compat.transaction(() => {
      compat.prepare("INSERT INTO t (v) VALUES (?)").run(2);
      throw new Error("boom");
    });
    expect(() => bad()).toThrow("boom");

    const rows = compat.prepare("SELECT v FROM t ORDER BY v").all();
    // Only the pre-txn row remains; the row inserted before the throw
    // must have been rolled back by the shim's BEGIN/ROLLBACK wrapping.
    expect(rows.map((r) => r.v)).toEqual([1]);
  });

  it("pragma is a no-op (not a rejection) under sql.js", () => {
    // The legacy code path threw `pragma is not a function` because raw
    // sql.js Database has no pragma() method. The shim gives us a no-op
    // so WAL/foreign_keys toggles used in DatabaseManager.initialize()
    // just flow through harmlessly.
    expect(() => compat.pragma("journal_mode = WAL")).not.toThrow();
    expect(() => compat.pragma("foreign_keys = ON")).not.toThrow();
    expect(compat.pragma("journal_mode = WAL")).toBeUndefined();
  });

  it("exec persists after a DDL/DML batch", () => {
    compat.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('one');",
    );
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0);
  });

  it("close persists and the file round-trips through a fresh shim", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    compat.prepare("INSERT INTO t (v) VALUES (?)").run("persisted");
    compat.close();
    expect(fs.existsSync(dbPath)).toBe(true);

    // Re-open through the shim and verify the row survived.
    const raw2 = new SQL.Database(fs.readFileSync(dbPath));
    const compat2 = createSqlJsCompat(raw2, dbPath);
    try {
      const rows = compat2.prepare("SELECT v FROM t").all();
      expect(rows).toEqual([{ v: "persisted" }]);
    } finally {
      compat2.close();
    }
  });

  it("run auto-persists — a crash after an insert should not lose the row", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    compat.prepare("INSERT INTO t (v) VALUES (?)").run("crash-safe");
    // Do NOT close. Simulate a crash by reading the file directly.
    const raw2 = new SQL.Database(fs.readFileSync(dbPath));
    const compat2 = createSqlJsCompat(raw2, dbPath);
    try {
      const rows = compat2.prepare("SELECT v FROM t").all();
      expect(rows).toEqual([{ v: "crash-safe" }]);
    } finally {
      compat2.close();
    }
  });

  it("exports the raw database bytes for backup", () => {
    compat.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const bytes = compat.export();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
