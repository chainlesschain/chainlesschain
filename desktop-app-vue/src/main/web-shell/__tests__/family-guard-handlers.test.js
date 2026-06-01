/**
 * FAMILY-26 family-guard WS handlers 单测 — sql.js 内存库验 3 topic + db=null 降级。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
const {
  createFamilyGuardHandlers,
} = require("../handlers/family-guard-handlers");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

// DatabaseManager 形 stub：child-event-query 走 database.all(sql, params)。
class TestDb {
  constructor(db) {
    this.db = db;
  }
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

let database;

function fgPayload(pkg, durationMs) {
  return JSON.stringify({ package: pkg, duration_ms: durationMs });
}

function insertEvent(o) {
  database.db.run(
    `INSERT INTO family_child_event
     (resource_id, child_did, source, kind, payload, timestamp_ms, duration_ms, level, guardian_dids, device_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.resourceId,
      o.childDid,
      o.source,
      o.kind,
      o.payload,
      o.timestampMs,
      o.durationMs,
      o.level || "L1",
      "[]",
      "dev",
      o.timestampMs,
      o.timestampMs,
    ],
  );
}

beforeEach(() => {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE family_child_event (
      resource_id TEXT PRIMARY KEY,
      child_did TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT,
      timestamp_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'L1',
      guardian_dids TEXT,
      device_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database = new TestDb(db);
});

describe("family-guard WS handlers", () => {
  it("list-children returns aggregated children", async () => {
    insertEvent({
      resourceId: "1",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 1000),
      timestampMs: 100,
      durationMs: 1000,
    });
    const handlers = createFamilyGuardHandlers({ database });
    const res = await handlers["family-guard.list-children"]();
    expect(res.success).toBe(true);
    expect(res.data[0]).toMatchObject({ childDid: "kid", eventCount: 1 });
  });

  it("app-usage-summary aggregates per package via frame childDid", async () => {
    insertEvent({
      resourceId: "1",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 60000),
      timestampMs: 100,
      durationMs: 60000,
    });
    insertEvent({
      resourceId: "2",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 30000),
      timestampMs: 200,
      durationMs: 30000,
    });
    const handlers = createFamilyGuardHandlers({ database });
    const res = await handlers["family-guard.app-usage-summary"]({
      childDid: "kid",
    });
    expect(res.success).toBe(true);
    expect(res.data.totalMs).toBe(90000);
    expect(res.data.apps[0]).toMatchObject({
      package: "com.game",
      totalMs: 90000,
      count: 2,
    });
  });

  it("list-child-events returns events for the requested child", async () => {
    insertEvent({
      resourceId: "1",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.chat", 2000),
      timestampMs: 300,
      durationMs: 2000,
    });
    const handlers = createFamilyGuardHandlers({ database });
    const res = await handlers["family-guard.list-child-events"]({
      childDid: "kid",
    });
    expect(res.success).toBe(true);
    expect(res.data[0]).toMatchObject({
      package: "com.chat",
      durationMs: 2000,
    });
  });

  it("degrades to empty results when database is null", async () => {
    const handlers = createFamilyGuardHandlers({ database: null });
    expect(await handlers["family-guard.list-children"]()).toEqual({
      success: true,
      data: [],
    });
    expect(
      await handlers["family-guard.list-child-events"]({ childDid: "x" }),
    ).toEqual({ success: true, data: [] });
    expect(
      await handlers["family-guard.app-usage-summary"]({ childDid: "x" }),
    ).toEqual({ success: true, data: { totalMs: 0, apps: [] } });
  });
});
