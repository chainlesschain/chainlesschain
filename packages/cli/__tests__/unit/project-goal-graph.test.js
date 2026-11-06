import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  createProjectGoalGraphAuthority,
  projectGoalGraphMode,
} from "../../src/host/project-goal-graph.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
const owner = "did:chainless:owner";
describe("native project monitoring through the canonical Graph kernel", () => {
  let root, db, store, engine, graphDb, actor, now, mode;
  const file = (name) => path.join(root, name);
  function open() {
    db = new Database(file("project.db"));
    store = openSchedulerStore({
      file: file("scheduler.db"),
      Database,
      clock: () => now,
      protectStorage: () => true,
    });
    engine = new ProjectGoalMonitoringEngine({
      db,
      store,
      getActor: () => actor,
      clock: () => now,
      leaseMs: 1000,
      graphAuthorityFactory: ({ clock, readCommittedResult }) => {
        graphDb = new Database(file("graph.db"));
        return createProjectGoalGraphAuthority({
          database: graphDb,
          mode,
          clock,
          readCommittedResult,
        });
      },
    });
  }
  async function reopen(selected = mode) {
    await engine.close();
    db.close();
    mode = selected;
    now += 2000;
    open();
  }
  const goal = () =>
    engine.state.goals.create({
      projectId: "p1",
      objective: "Track actual native risk evidence",
      budgetPolicy: { maxRuns: 10 },
    });
  const request = (g) => ({
    id: g.id,
    expectedRevision: g.revision,
    requestId: "graph-request",
  });
  const counts = () => ({
    checks: db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks").get()
      .n,
    reviews: db
      .prepare("SELECT COUNT(*) AS n FROM cc_project_risk_reviews")
      .get().n,
  });
  const rawAuthority = () => engine.graphAuthority.authority;
  const context = (occurrenceId) => {
    const occurrence = store.getOccurrence(occurrenceId);
    return { occurrence, job: store.getJob(occurrence.jobId) };
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-canonical-graph-"));
    actor = owner;
    now = Date.now();
    mode = "canonical";
    open();
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      now,
    );
    db.prepare("INSERT INTO project_tasks VALUES (?,?,?,?,0,?,NULL)").run(
      "task-1",
      "p1",
      "pending",
      now,
      now - 10000,
    );
  });
  afterEach(async () => {
    await engine?.close();
    if (db?.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("uses a durable separate Graph journal and leaves long-term completion to the native verifier", async () => {
    const g = goal(),
      result = await engine.checkNow(request(g));
    expect(result.status).toBe("succeeded");
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    const occurrence = store.getOccurrence(result.occurrenceId);
    expect(occurrence.result.graphAuthority).toMatchObject({
      status: "succeeded",
      authoritySource: "graph_kernel",
      originSurface: "scheduler",
    });
    expect(
      rawAuthority().inspectOccurrence(context(result.occurrenceId)),
    ).toMatchObject({
      present: true,
      authorityMode: "canonical",
      containsHead: true,
    });
    expect(
      db
        .prepare("SELECT record_json FROM cc_project_goal_graph_occurrences")
        .get().record_json,
    ).toContain('"phase":"settled"');
    expect(engine.state.goals.get({ id: g.id }).status).toBe("active");
    expect((await engine.checkNow(request(g))).occurrenceId).toBe(
      result.occurrenceId,
    );
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
  });
  it("can compare in shadow without making Graph the scheduler terminal receipt", async () => {
    await reopen("shadow");
    const g = goal(),
      result = await engine.checkNow(request(g));
    expect(result.status).toBe("succeeded");
    expect(store.getOccurrence(result.occurrenceId).result).not.toHaveProperty(
      "graphAuthority",
    );
    expect(
      rawAuthority().inspectOccurrence(context(result.occurrenceId))
        .authorityMode,
    ).toBe("shadow");
  });
  it("recovers a committed Graph terminal after flag rollback without running or charging the adapter again", async () => {
    const g = goal();
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    await reopen("legacy");
    const perform = vi.spyOn(engine.state, "perform");
    const result = await engine.checkNow(request(g));
    expect(result.status).toBe("succeeded");
    expect(perform).not.toHaveBeenCalled();
    expect(
      rawAuthority().inspectOccurrence(context(result.occurrenceId))
        .authorityMode,
    ).toBe("canonical");
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    expect(engine.status({ id: g.id }).usage.totalRuns).toBe(1);
  });
  it("recovers the exact authorized native receipt after native commit but before Graph receipt", async () => {
    const g = goal();
    vi.spyOn(rawAuthority(), "settleSuccess").mockImplementation(() => {
      throw new Error("crash before graph receipt");
    });
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    await reopen();
    const perform = vi.spyOn(engine.state, "perform");
    const result = await engine.checkNow(request(g));
    expect(result.status).toBe("succeeded");
    expect(perform).not.toHaveBeenCalled();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
  });
  it("refuses unknown Graph effects without an independent native result instead of replaying", async () => {
    const g = goal();
    vi.spyOn(engine.state, "perform").mockImplementation(() => {
      throw new Error("unknown before native receipt");
    });
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    expect(counts()).toEqual({ checks: 0, reviews: 0 });
    await reopen();
    const perform = vi.spyOn(engine.state, "perform"),
      result = await engine.checkNow(request(g));
    expect(result.status).not.toBe("succeeded");
    expect(result.result).toBeNull();
    expect(perform).not.toHaveBeenCalled();
    expect(counts()).toEqual({ checks: 0, reviews: 0 });
  });
  it("does not downgrade or recreate lost Graph history even with the feature flag disabled", async () => {
    const g = goal();
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    await engine.close();
    db.close();
    fs.unlinkSync(file("graph.db"));
    mode = "legacy";
    now += 2000;
    open();
    const perform = vi.spyOn(engine.state, "perform"),
      result = await engine.checkNow(request(g));
    expect(result.status).not.toBe("succeeded");
    expect(perform).not.toHaveBeenCalled();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    expect(
      graphDb.prepare("SELECT COUNT(*) AS n FROM cc_rollout_events").get().n,
    ).toBe(0);
  });
  it("detects a valid older Graph prefix that lacks the native recorded head", async () => {
    const g = goal();
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    const row = graphDb
      .prepare(
        "SELECT thread_id,MAX(event_seq) AS last FROM cc_rollout_events WHERE thread_id LIKE 'scheduler:%' GROUP BY thread_id",
      )
      .get();
    graphDb
      .prepare(
        "DELETE FROM cc_rollout_events WHERE thread_id=? AND event_seq=?",
      )
      .run(row.thread_id, row.last);
    await reopen("legacy");
    const perform = vi.spyOn(engine.state, "perform"),
      result = await engine.checkNow(request(g));
    expect(result.status).not.toBe("succeeded");
    expect(perform).not.toHaveBeenCalled();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
  });
  it("revalidates native identity before returning a saved result", async () => {
    const g = goal();
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("projection interrupted");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    await reopen();
    actor = "did:other";
    const perform = vi.spyOn(engine.state, "perform");
    await expect(engine.checkNow(request(g))).rejects.toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    expect(perform).not.toHaveBeenCalled();
  });
  it("keeps default selection legacy and rejects invalid opt-ins", () => {
    expect(projectGoalGraphMode({})).toBe("legacy");
    expect(() =>
      projectGoalGraphMode({ CHAINLESSCHAIN_GRAPH_PROJECT_GOALS: "auto" }),
    ).toThrow();
  });
  it("does not allow a lower-level legacy caller to bypass an activated native Graph journal", async () => {
    const g = goal();
    await engine.checkNow(request(g));
    await engine.close();
    store = openSchedulerStore({
      file: file("scheduler.db"),
      Database,
      clock: () => now,
      protectStorage: () => true,
    });
    try {
      expect(
        () =>
          new ProjectGoalMonitoringEngine({
            db,
            store,
            getActor: () => actor,
            clock: () => now,
          }),
      ).toThrow("GOAL_MONITOR_GRAPH_AUTHORITY_REQUIRED");
    } finally {
      store.close();
    }
  });
  it("revalidates Graph history even when the scheduler returns a cached successful occurrence", async () => {
    const g = goal(),
      result = await engine.checkNow(request(g));
    const row = graphDb
      .prepare(
        "SELECT thread_id,MAX(event_seq) AS last FROM cc_rollout_events WHERE thread_id LIKE 'scheduler:%' GROUP BY thread_id",
      )
      .get();
    graphDb
      .prepare(
        "DELETE FROM cc_rollout_events WHERE thread_id=? AND event_seq=?",
      )
      .run(row.thread_id, row.last);
    const perform = vi.spyOn(engine.state, "perform");
    await expect(engine.checkNow(request(g))).rejects.toThrow(
      "GOAL_MONITOR_GRAPH_HISTORY_MISSING",
    );
    expect(perform).not.toHaveBeenCalled();
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
  });
  it("upgrades only participating goals and keeps old released validators from writing them", async () => {
    const legacy = { exports: {} };
    const legacyRequire = createRequire(
      new URL("../../../session-core/lib/goal-contract.js", import.meta.url),
    );
    const code = fs.readFileSync(
      new URL(
        "../fixtures/session-core-0.3.26-goal-contract.cjs",
        import.meta.url,
      ),
      "utf8",
    );
    new vm.Script(`(function(require,module,exports){${code}\n})`, {
      filename: "session-core-0.3.26/goal-contract.cjs",
    }).runInThisContext()(legacyRequire, legacy, legacy.exports);
    const g = goal(),
      untouched = goal();
    expect(legacy.exports.validateGoalRecord(g)).toEqual(g);
    await engine.checkNow(request(g));
    const current = engine.state.goals.get({ id: g.id });
    expect(current).toMatchObject({
      schema: "chainlesschain.goal/v2",
      schemaVersion: 2,
      requiresGraphAwareHost: true,
      revision: 1,
      controlGeneration: 0,
    });
    expect(engine.state.goals.get({ id: untouched.id })).toEqual(untouched);
    expect(() => legacy.exports.validateGoalRecord(current)).toThrow();
    expect(() =>
      legacy.exports.reviseGoalRecord(current, { status: "paused" }),
    ).toThrow();
    expect(() =>
      engine.state.goals.adapter.compareAndSwap(current.id, 1, (value) => {
        const next = {
          ...value,
          schema: "chainlesschain.goal/v1",
          schemaVersion: 1,
          revision: 2,
        };
        delete next.requiresGraphAwareHost;
        return next;
      }),
    ).toThrow("GOAL_SCHEMA_DOWNGRADE_DENIED");
    const revised = engine.state.goals.revise({
      id: current.id,
      expectedRevision: 1,
      patch: { status: "paused" },
    });
    expect(revised).toMatchObject({
      schemaVersion: 2,
      requiresGraphAwareHost: true,
      revision: 2,
      status: "paused",
    });
  });
});
