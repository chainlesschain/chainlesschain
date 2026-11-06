import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createProjectGoalGraphAuthority } from "../../src/host/project-goal-graph.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
const fixture = fileURLToPath(
  new URL("../fixtures/dmm-goal-graph-process.mjs", import.meta.url),
);
describe("native/Graph/scheduler exact-result recovery across real process exits", () => {
  let root, db, engine, goal, workers;
  const file = (name) => path.join(root, name);
  const counts = () => ({
    checks: db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks").get()
      .n,
    reviews: db
      .prepare("SELECT COUNT(*) AS n FROM cc_project_risk_reviews")
      .get().n,
  });
  function launch(phase) {
    const child = fork(fixture, [root, phase, goal.id], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      windowsHide: true,
    });
    const worker = { child, closed: false, stdout: "", stderr: "" };
    worker.done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        worker.closed = true;
        resolve({ code, signal });
      });
    });
    child.stdout.on("data", (v) => {
      worker.stdout = (worker.stdout + v).slice(-16384);
    });
    child.stderr.on("data", (v) => {
      worker.stderr = (worker.stderr + v).slice(-16384);
    });
    workers.push(worker);
    return worker;
  }
  async function checkpoint(worker) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (fs.existsSync(file(`barrier-${worker.child.pid}`))) {
        expect(worker.closed).toBe(false);
        return;
      }
      if (worker.closed)
        throw new Error(`Worker ended before checkpoint: ${worker.stderr}`);
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`Worker checkpoint timeout: ${worker.stderr}`);
  }
  async function kill(worker) {
    expect(worker.closed).toBe(false);
    expect(worker.child.kill("SIGKILL")).toBe(true);
    await worker.done;
  }
  async function recover(mode = "canonical") {
    // Wait for the actual persisted owner lease, not a guessed child lifetime.
    const inspector = openSchedulerStore({
      file: file("scheduler.db"),
      Database,
      clock: Date.now,
      protectStorage: () => true,
    });
    const rows = inspector.db
      .prepare(
        "SELECT lease_expires_at FROM occurrences WHERE status='running'",
      )
      .all();
    inspector.close();
    for (const row of rows) {
      const remaining = Number(row.lease_expires_at) - Date.now() + 20;
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    }
    const store = openSchedulerStore({
      file: file("scheduler.db"),
      Database,
      clock: Date.now,
      protectStorage: () => true,
    });
    engine = new ProjectGoalMonitoringEngine({
      db,
      store,
      getActor: () => "did:chainless:owner",
      leaseMs: 1000,
      graphAuthorityFactory: ({ readCommittedResult, clock }) =>
        createProjectGoalGraphAuthority({
          database: new Database(file("graph.db")),
          mode,
          clock,
          readCommittedResult,
        }),
    });
    const perform = vi.spyOn(engine.state, "perform");
    const result = await engine.checkNow({
      id: goal.id,
      expectedRevision: 1,
      requestId: "process-graph-check",
    });
    expect(perform).not.toHaveBeenCalled();
    return result;
  }
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-graph-process-"));
    workers = [];
    engine = null;
    db = new Database(file("project.db"));
    db.pragma("journal_mode=WAL");
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      "did:chainless:owner",
      "active",
      Date.now(),
    );
    const {
      PersonalProjectGoalService,
    } = require("@chainlesschain/session-core/project-goal-service");
    goal = new PersonalProjectGoalService({
      db,
      getActor: () => "did:chainless:owner",
    }).create({
      projectId: "p1",
      objective: "Survive actual native/Graph cutpoints",
      budgetPolicy: { maxRuns: 10 },
    });
  });
  afterEach(async () => {
    for (const worker of workers) {
      if (!worker.closed) worker.child.kill("SIGKILL");
      await worker.done;
    }
    await engine?.close();
    if (db?.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("recovers only the original native result after SIGKILL before Graph receipt commit", async () => {
    const worker = launch("native-committed");
    await checkpoint(worker);
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    expect(
      JSON.parse(
        db
          .prepare("SELECT record_json FROM cc_project_goal_graph_occurrences")
          .get().record_json,
      ).phase,
    ).toBe("started");
    await kill(worker);
    expect((await recover()).status).toBe("succeeded");
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
  });
  it("retains canonical terminal authority after SIGKILL and a legacy flag rollback", async () => {
    const worker = launch("graph-committed");
    await checkpoint(worker);
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
    expect(
      JSON.parse(
        db
          .prepare("SELECT record_json FROM cc_project_goal_graph_occurrences")
          .get().record_json,
      ).phase,
    ).toBe("settled");
    await kill(worker);
    expect((await recover("legacy")).status).toBe("succeeded");
    expect(counts()).toEqual({ checks: 1, reviews: 1 });
  });
  it("preserves an unknown Graph effect after SIGKILL without guessing that the native action never started", async () => {
    const worker = launch("graph-started");
    await checkpoint(worker);
    expect(counts()).toEqual({ checks: 0, reviews: 0 });
    await kill(worker);
    const result = await recover();
    expect(result.status).not.toBe("succeeded");
    expect(result.result).toBeNull();
    expect(counts()).toEqual({ checks: 0, reviews: 0 });
  });
  it("fences a still-live old process after lease takeover without allowing a late native write", async () => {
    const worker = launch("late-writer");
    await checkpoint(worker);
    const result = await recover();
    expect(result.status).not.toBe("succeeded");
    fs.writeFileSync(file(`resume-${worker.child.pid}`), "resume");
    await worker.done;
    expect(worker.closed).toBe(true);
    expect(counts()).toEqual({ checks: 0, reviews: 0 });
    expect(worker.stdout).not.toContain('"status":"succeeded"');
  });
});
