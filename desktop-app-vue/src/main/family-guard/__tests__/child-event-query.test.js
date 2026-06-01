/**
 * FAMILY-26 child-event-query 单测 — sql.js 内存库验只读查询 + app 聚合。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
const {
  listChildren,
  listChildEvents,
  summarizeAppUsage,
} = require("../child-event-query");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

class TestDbManager {
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

let dbManager;

function fgPayload(pkg, durationMs) {
  return JSON.stringify({ package: pkg, duration_ms: durationMs });
}

function insertEvent(o) {
  dbManager.db.run(
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
  dbManager = new TestDbManager(db);
});

describe("child-event-query · listChildren", () => {
  it("groups by child_did with count + last event, sorted by recency", () => {
    insertEvent({
      resourceId: "a1",
      childDid: "kidA",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 1000),
      timestampMs: 100,
      durationMs: 1000,
    });
    insertEvent({
      resourceId: "a2",
      childDid: "kidA",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.chat", 2000),
      timestampMs: 300,
      durationMs: 2000,
    });
    insertEvent({
      resourceId: "b1",
      childDid: "kidB",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.x", 500),
      timestampMs: 200,
      durationMs: 500,
    });

    const children = listChildren(dbManager);
    expect(children.map((c) => c.childDid)).toEqual(["kidA", "kidB"]); // kidA last=300 > kidB last=200
    expect(children[0]).toMatchObject({
      childDid: "kidA",
      eventCount: 2,
      lastEventMs: 300,
    });
  });
});

describe("child-event-query · summarizeAppUsage", () => {
  it("aggregates duration per package, sorted desc, with total", () => {
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
    insertEvent({
      resourceId: "3",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.chat", 10000),
      timestampMs: 300,
      durationMs: 10000,
    });

    const { totalMs, apps } = summarizeAppUsage(dbManager, { childDid: "kid" });
    expect(totalMs).toBe(100000);
    expect(apps[0]).toMatchObject({
      package: "com.game",
      totalMs: 90000,
      count: 2,
    });
    expect(apps[1]).toMatchObject({
      package: "com.chat",
      totalMs: 10000,
      count: 1,
    });
  });

  it("non-foreground events fall under '(其他)'", () => {
    insertEvent({
      resourceId: "p1",
      childDid: "kid",
      source: "pdh",
      kind: "message",
      payload: "{}",
      timestampMs: 100,
      durationMs: 5000,
    });
    const { apps } = summarizeAppUsage(dbManager, { childDid: "kid" });
    expect(apps[0]).toMatchObject({
      package: "(其他)",
      totalMs: 5000,
      count: 1,
    });
  });

  it("respects sinceMs filter", () => {
    insertEvent({
      resourceId: "old",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 1000),
      timestampMs: 100,
      durationMs: 1000,
    });
    insertEvent({
      resourceId: "new",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 2000),
      timestampMs: 5000,
      durationMs: 2000,
    });
    const { totalMs } = summarizeAppUsage(dbManager, {
      childDid: "kid",
      sinceMs: 1000,
    });
    expect(totalMs).toBe(2000); // only the 'new' event
  });
});

describe("child-event-query · listChildEvents", () => {
  it("returns events desc by time with parsed package", () => {
    insertEvent({
      resourceId: "1",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.game", 1000),
      timestampMs: 100,
      durationMs: 1000,
    });
    insertEvent({
      resourceId: "2",
      childDid: "kid",
      source: "foreground_app",
      kind: "run",
      payload: fgPayload("com.chat", 2000),
      timestampMs: 300,
      durationMs: 2000,
    });

    const events = listChildEvents(dbManager, { childDid: "kid" });
    expect(events.map((e) => e.resourceId)).toEqual(["2", "1"]); // desc
    expect(events[0].package).toBe("com.chat");
    expect(events[0].durationMs).toBe(2000);
  });

  it("empty childDid returns []", () => {
    expect(listChildEvents(dbManager, {})).toEqual([]);
  });
});
