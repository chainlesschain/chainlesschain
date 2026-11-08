import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createProjectGoalGraphAuthority } from "../../src/host/project-goal-graph.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
const [root, phase, goalId] = process.argv.slice(2),
  file = (name) => path.join(root, name);
function barrier() {
  fs.writeFileSync(
    file(`barrier-${process.pid}`),
    JSON.stringify({ phase, pid: process.pid }),
  );
  // Poll only the fixture's explicit resume flag while the real scheduler lease
  // expires. The parent verifies independent DB state before kill/takeover.
  while (!fs.existsSync(file(`resume-${process.pid}`)))
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
}
let engine, db;
try {
  db = new Database(file("project.db"));
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
        mode: "canonical",
        clock,
        readCommittedResult,
      }),
  });
  if (phase === "native-committed") {
    const perform = engine.state.perform.bind(engine.state);
    engine.state.perform = (...args) => {
      const value = perform(...args);
      barrier();
      return value;
    };
  } else if (phase === "graph-committed") {
    const settle = engine.graphAuthority.settleSuccess.bind(
      engine.graphAuthority,
    );
    engine.graphAuthority.settleSuccess = (...args) => {
      const value = settle(...args);
      barrier();
      return value;
    };
  } else if (phase === "graph-started" || phase === "late-writer") {
    const begin = engine.graphAuthority.begin.bind(engine.graphAuthority);
    engine.graphAuthority.begin = (...args) => {
      const value = begin(...args);
      barrier();
      return value;
    };
  }
  const result = await engine.checkNow({
    id: goalId,
    expectedRevision: 1,
    requestId: "process-graph-check",
  });
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      occurrenceId: result.occurrenceId,
    }),
  );
} catch (error) {
  process.stderr.write(error.stack);
  process.exitCode = 1;
} finally {
  await engine?.close();
  if (db?.open) db.close();
}
