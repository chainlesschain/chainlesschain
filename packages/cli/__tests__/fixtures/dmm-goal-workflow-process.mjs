/** Actual Node/native SQLite driver. Only identity, clock and the native
 * confirmation callback are synthetic. The confirmation barrier runs after
 * admission commits and outside any transaction; the parent owns SIGKILL. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const [root, encoded] = process.argv.slice(2);
const options = JSON.parse(encoded);
if (!isAbsolute(root)) throw new Error("Absolute fixture root required");
const actor = "did:chainless:workflow-process-owner";
const now = 1791244800000;
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
const wait = (command) =>
  commands.delete(command)
    ? Promise.resolve()
    : new Promise((resolve) => waiters.set(command, resolve));
const send = (message) =>
  new Promise((resolve, reject) => {
    process.send({ pid: process.pid, ...message }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
let db, workflow, binding;
function snapshot() {
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const goal = workflow.goals.get({ id: binding.goalId });
  return {
    inTransaction: db.inTransaction,
    tasks: count("project_tasks"),
    confirmations: count("fixture_confirmations"),
    runs: db
      .prepare("SELECT run_json FROM cc_business_action_runs ORDER BY id")
      .all()
      .map((row) => JSON.parse(row.run_json)),
    ledger: db
      .prepare(
        "SELECT record_json FROM cc_project_goal_usage ORDER BY operation_id",
      )
      .all()
      .map((row) => JSON.parse(row.record_json)),
    usage: db
      .transaction(() => workflow.usage.summary(goal, actor))
      .immediate(),
    intent: workflow.getIntent({ intentId: binding.intentId }),
  };
}
async function execute(intentId) {
  try {
    return { result: await workflow.execute({ intentId }) };
  } catch (error) {
    return { error: error.code || error.message };
  }
}
try {
  db = new Database(join(root, "project.sqlite"), { timeout: 15_000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  const dependencies = { db, getActor: () => actor, clock: () => now };
  workflow = new ProjectGoalWorkflow({
    ...dependencies,
    approvalGate: new ApprovalGate({
      confirm: async () => {
        db.prepare("INSERT INTO fixture_confirmations(pid) VALUES (?)").run(
          process.pid,
        );
        if (options.mode === "pending") {
          await send({ type: "barrier", snapshot: snapshot() });
          if (options.recoverWhilePending) {
            const otherHost = new ProjectGoalWorkflow(dependencies);
            const recovered = otherHost.recoverUnresolved();
            await send({
              type: "active-recovery",
              recovered,
              snapshot: snapshot(),
            });
          }
          await wait("release");
        }
        return true;
      },
    }),
  });
  if (options.mode === "initialize") {
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      CREATE TABLE fixture_confirmations(id INTEGER PRIMARY KEY,pid INTEGER NOT NULL);`);
    db.prepare("INSERT INTO projects VALUES ('p1',?,'active',10,0)").run(actor);
    db.exec(
      "INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL)",
    );
    let goal = workflow.goals.create({
      projectId: "p1",
      objective: "Recover native goal actions",
      budgetPolicy: { maxRuns: 10, maxTimeMs: 1000 },
    });
    goal = workflow.goals.revise({
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { allowedActionTypes: ["task.create", "task.update-description"] },
    });
    const review = workflow.risk.evaluate({ projectId: "p1" });
    db.transaction(() =>
      workflow.observeInTransaction({
        goalId: goal.id,
        reviewId: review.review.id,
      }),
    ).immediate();
    const proposals = workflow.list({ goalId: goal.id }).proposals;
    const prepare = (type, requestId) =>
      workflow.prepare({
        goalId: goal.id,
        expectedRevision: goal.revision,
        proposalId: proposals.find((item) => item.proposal.actionType === type)
          .proposal.id,
        requestId,
        description: "Confirmed delivery follow-up",
        ...(type === "task.create" ? { taskType: "query_info" } : {}),
      });
    binding = {
      goalId: goal.id,
      intentId: prepare("task.create", "create-request").intent.id,
      nextIntentId: prepare("task.update-description", "description-request")
        .intent.id,
    };
    writeFileSync(join(root, "binding.json"), JSON.stringify(binding));
  } else binding = JSON.parse(readFileSync(join(root, "binding.json"), "utf8"));
  await send({
    type: "ready",
    database: "native-better-sqlite3",
    projectOpen: db.open,
  });
  await wait("go");
  let outcome;
  if (options.mode === "initialize") outcome = { binding };
  else if (options.mode === "pending")
    outcome = await execute(binding.intentId);
  else if (options.mode === "recover") {
    // Constructor recovery has already run. Capture its result before any
    // execute call can mark an error as unknown in its catch block.
    const recovered = snapshot();
    const replay = await execute(binding.intentId);
    const next = await execute(binding.nextIntentId);
    outcome = { recovered, replay, next };
  } else throw new Error("Unknown driver mode");
  await send({ type: "done", outcome, snapshot: snapshot() });
} catch (error) {
  await send({
    type: "fatal",
    code: error.code,
    message: error.message,
    stack: error.stack,
  });
  process.exitCode = 1;
} finally {
  if (db?.open) db.close();
  if (process.connected) process.disconnect();
}
