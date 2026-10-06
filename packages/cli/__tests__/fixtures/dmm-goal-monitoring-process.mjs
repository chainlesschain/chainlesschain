/**
 * Test driver for actual native SQLite and Node process recovery.
 * Only the clock, synthetic identity, owner-only opener acknowledgment, and
 * execution/first-job-read barriers are test seams. Neither database nor
 * scheduler is mocked, and intercepted reads retain their actual SQLite result.
 * Barriers run outside the project transaction; SIGKILL comes from the parent.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");

const [root, encoded] = process.argv.slice(2);
const options = JSON.parse(encoded);
if (!isAbsolute(root)) throw new Error("Absolute fixture root required");
const owner = "did:chainless:dmm-process-owner";
const now = options.now;
const commands = new Set();
const waiters = new Map();
process.on("message", ({ command } = {}) => {
  if (!command) return;
  const resolve = waiters.get(command);
  if (resolve) {
    waiters.delete(command);
    resolve();
  } else commands.add(command);
});
const wait = (command) => {
  if (commands.delete(command)) return Promise.resolve();
  return new Promise((resolve) => waiters.set(command, resolve));
};
const send = (message) =>
  new Promise((resolve, reject) => {
    process.send({ pid: process.pid, ...message }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

let db, store, engine;
function snapshot() {
  const count = (database, table) =>
    database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    reviews: count(db, "cc_project_risk_reviews"),
    checks: count(db, "cc_project_goal_checks"),
    occurrences: count(store.db, "occurrences"),
    reservations: count(store.db, "scheduler_authority_reservations"),
    usage: store.db
      .prepare(
        "SELECT COALESCE(SUM(runs),0) AS runs,COALESCE(SUM(units),0) AS units FROM scheduler_authority_usage",
      )
      .get(),
    checksRows: db
      .prepare(
        "SELECT occurrence_id,review_id FROM cc_project_goal_checks ORDER BY occurrence_id",
      )
      .all(),
  };
}

try {
  db = new Database(join(root, "project.sqlite"), { timeout: 15_000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  store = openSchedulerStore({
    file: join(root, "scheduler.sqlite"),
    Database,
    clock: () => now,
    // Production ACL correctness is covered by desktop host tests separately.
    protectStorage: () => true,
    busyTimeoutMs: 15_000,
  });
  engine = new ProjectGoalMonitoringEngine({
    db,
    store,
    getActor: () => (options.actor === undefined ? owner : options.actor),
    clock: () => now,
    ownerId: `dmm-process-${process.pid}`,
    leaseMs: 60_000,
  });
  if (options.barrier === "first-job-miss") {
    const readJob = store.getJob.bind(store);
    let intercepted = false;
    store.getJob = (id) => {
      const actual = readJob(id);
      if (!intercepted && !actual) {
        intercepted = true;
        const marker = join(root, `job-miss-${process.pid}.json`);
        writeFileSync(
          `${marker}.pending`,
          JSON.stringify({
            pid: process.pid,
            jobId: id,
            missing: actual == null,
            inProjectTransaction: db.inTransaction,
            inSchedulerTransaction: store.db.inTransaction,
          }),
        );
        renameSync(`${marker}.pending`, marker);
        // _job is deliberately synchronous. A parent-controlled file barrier
        // forces both real readers to observe absence before either inserts.
        const release = join(root, "release-job-creation");
        const deadline = Date.now() + 20_000;
        const pause = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(release)) {
          if (Date.now() >= deadline)
            throw new Error("First-job barrier timeout");
          Atomics.wait(pause, 0, 0, 10);
        }
      }
      return actual;
    };
  }
  if (options.mode === "initialize") {
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      now,
    );
    db.prepare(
      "INSERT INTO project_tasks VALUES (?,?,?,?,0,?,NULL,NULL,NULL)",
    ).run("t1", "p1", "pending", now, now - 1);
  }

  const adapter = engine.runtime.adapters.get("project-goal-risk");
  const execute = adapter.execute.bind(adapter);
  adapter.execute = async (context) => {
    if (options.barrier === "before-execute") {
      await send({
        type: "barrier",
        stage: options.barrier,
        inProjectTransaction: db.inTransaction,
        occurrence: store.getOccurrence(context.occurrence.id),
        snapshot: snapshot(),
      });
      await wait("release");
    }
    const result = execute(context);
    if (options.barrier === "after-project-commit") {
      await send({
        type: "barrier",
        stage: options.barrier,
        inProjectTransaction: db.inTransaction,
        occurrence: store.getOccurrence(context.occurrence.id),
        result,
        snapshot: snapshot(),
      });
      await wait("release");
    }
    return result;
  };

  await send({
    type: "ready",
    driver: "synthetic-clock-and-adapter-barrier",
    database: "native-better-sqlite3",
    projectOpen: db.open,
    schedulerOpen: store.db.open,
  });
  await wait("go");
  let outcome;
  if (options.mode === "initialize") {
    const goal = engine.state.goals.create({
      projectId: "p1",
      objective: "Recover one authorized delivery-risk check",
      budgetPolicy: { maxRuns: options.maxRuns ?? 1 },
    });
    const request = {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "one-durable-request",
    };
    writeFileSync(join(root, "request.json"), JSON.stringify(request));
    outcome = { request };
  } else if (options.mode === "revoke-policy") {
    const principal = { type: "user", id: owner };
    const policy = store.getAuthorityPolicy(principal);
    outcome = store.setAuthorityPolicy(principal, {
      capabilities: policy.capabilities,
      windowMs: policy.windowMs,
      maxRuns: policy.maxRuns,
      maxUnits: policy.maxUnits,
      expectedRevision: policy.revision,
      enabled: false,
    });
  } else {
    try {
      const request = JSON.parse(
        readFileSync(join(root, "request.json"), "utf8"),
      );
      if (options.requestId) request.requestId = options.requestId;
      outcome =
        options.mode === "recover-occurrence"
          ? await engine.runtime.runOccurrence(options.occurrenceId)
          : await engine.checkNow(request);
    } catch (error) {
      outcome = {
        thrown: { code: error.code ?? "UNEXPECTED", message: error.message },
      };
    }
  }
  const durable = snapshot();
  await engine.close();
  db.close();
  await send({ type: "done", outcome, snapshot: durable });
  process.disconnect();
} catch (error) {
  try {
    await engine?.close();
  } catch {}
  try {
    if (db?.open) db.close();
  } catch {}
  await send({
    type: "fatal",
    error: { code: error.code, message: error.message, stack: error.stack },
  });
  process.exitCode = 1;
  process.disconnect();
}
