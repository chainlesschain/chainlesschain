import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  createFlow,
  ensureAutomationTables,
  listExecutions,
} from "../../src/lib/automation-engine.js";

describe("bounded automation execution history", () => {
  let db;
  let flowId;
  let sequence;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureAutomationTables(db);
    flowId = createFlow(db, { name: "History" }).id;
    sequence = 0;
  });

  afterEach(() => db.close());

  function insert({
    status = "success",
    output = null,
    steps = [],
    testMode = false,
    error = null,
    flow = flowId,
    time,
  } = {}) {
    const number = ++sequence;
    const id = `history-${String(number).padStart(5, "0")}`;
    const startedAt =
      time ?? new Date(Date.UTC(2026, 0, 1) + number).toISOString();
    db.prepare(
      `INSERT INTO auto_executions
      (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
       duration_ms, error, test_mode, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      flow,
      "manual",
      "{}",
      JSON.stringify(output),
      status,
      JSON.stringify(steps),
      1,
      error,
      testMode ? 1 : 0,
      startedAt,
      startedAt,
    );
    return id;
  }

  function observedDatabase() {
    const reads = [];
    return {
      reads,
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          all(...params) {
            const rows = statement.all(...params);
            reads.push({ sql, params, rowCount: rows.length });
            return rows;
          },
        };
      },
    };
  }

  it.each(["failed", "running", "unsupported", "cancelled"])(
    "keeps %s filtering and limit in SQL",
    (status) => {
      const target = insert({ status });
      const otherFlow = createFlow(db, { name: "Other" }).id;
      for (let index = 0; index < 300; index++) {
        insert({ status: "simulated", testMode: true });
        insert({ status, flow: otherFlow });
      }
      const observed = observedDatabase();
      expect(
        listExecutions(observed, { flowId, status, limit: 1 }).map(
          (entry) => entry.id,
        ),
      ).toEqual([target]);
      expect(observed.reads).toHaveLength(1);
      expect(observed.reads[0]).toMatchObject({
        params: [flowId, status, 1],
        rowCount: 1,
      });
      expect(observed.reads[0].sql).toMatch(
        /WHERE flow_id = \? AND status = \?.*LIMIT \?/,
      );
    },
  );

  it("finds confirmed successes past multiple pages of historical simulator successes", () => {
    const target = insert({
      error: JSON.stringify({
        authority: "scheduler-adjudication",
        decision: "confirmed_applied",
      }),
    });
    for (let index = 0; index < 300; index++)
      insert({ output: { simulated: true } });
    for (let index = 0; index < 300; index++) insert({ status: "failed" });
    const observed = observedDatabase();
    const executions = listExecutions(observed, {
      status: "success",
      limit: 1,
    });
    expect(executions).toMatchObject([
      { id: target, status: "success", mode: "live" },
    ]);
    expect(observed.reads.length).toBeGreaterThan(1);
    expect(
      observed.reads.every(
        (read) => read.rowCount <= 128 && /LIMIT \? OFFSET \?/.test(read.sql),
      ),
    ).toBe(true);
    expect(
      observed.reads.reduce((total, read) => total + read.rowCount, 0),
    ).toBe(301);
  });

  it.each(["simulated", "legacy-unverified"])(
    "normalizes %s before limiting and excludes other flows",
    (status) => {
      const target = insert({
        output: status === "simulated" ? { simulated: true } : null,
      });
      const otherFlow = createFlow(db, { name: "Other" }).id;
      for (let index = 0; index < 300; index++) {
        insert({
          error: JSON.stringify({
            authority: "scheduler-adjudication",
            decision: "confirmed_applied",
          }),
        });
        insert({ status, flow: otherFlow });
      }
      const observed = observedDatabase();
      const executions = listExecutions(observed, { flowId, status, limit: 1 });
      expect(executions).toMatchObject([
        { id: target, flowId, status, recordedStatus: "success" },
      ]);
      expect(observed.reads.length).toBeGreaterThan(1);
      expect(
        observed.reads.every(
          (read) =>
            read.rowCount <= 128 && read.sql.includes("status IN (?, ?)"),
        ),
      ).toBe(true);
      expect(
        observed.reads.reduce((total, read) => total + read.rowCount, 0),
      ).toBe(301);
      expect(
        db
          .prepare("SELECT status FROM auto_executions WHERE id = ?")
          .get(target).status,
      ).toBe("success");
    },
  );

  it("preserves ordering across equal timestamps and stops after enough normalized results", () => {
    const time = "2026-01-01T00:00:00.000Z";
    const expected = [];
    for (let index = 0; index < 400; index++)
      expected.unshift(insert({ status: "simulated", testMode: true, time }));
    const observed = observedDatabase();
    expect(
      listExecutions(observed, { status: "simulated", limit: 140 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(expected.slice(0, 140));
    expect(observed.reads).toHaveLength(2);
    expect(
      observed.reads.reduce((total, read) => total + read.rowCount, 0),
    ).toBeLessThan(400);
  });

  it("returns bounded unfiltered history, honors zero, and exhausts candidates without false matches", () => {
    for (let index = 0; index < 280; index++)
      insert({ output: { simulated: true } });
    expect(listExecutions(db)).toHaveLength(50);
    expect(listExecutions(db, { flowId, limit: 3 })).toHaveLength(3);
    const observed = observedDatabase();
    expect(listExecutions(observed, { status: "success", limit: 0 })).toEqual(
      [],
    );
    expect(observed.reads).toEqual([]);
    expect(listExecutions(observed, { status: "success", limit: 2 })).toEqual(
      [],
    );
    expect(observed.reads.every((read) => read.rowCount <= 128)).toBe(true);
    expect(() => listExecutions(db, { limit: -1 })).toThrow(
      /non-negative integer/,
    );
  });
});
