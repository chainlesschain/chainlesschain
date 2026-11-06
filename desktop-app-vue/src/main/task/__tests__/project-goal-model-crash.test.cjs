"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const Database = require("better-sqlite3");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const { ProjectGoalModelDrafts } = require("../project-goal-model-drafts");
const actor = "did:chainless:owner",
  now = 1791321600000;
function open(file, mode, onDispatch) {
  const db = new Database(file);
  const workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
  });
  let calls = 0;
  const manager = {};
  const service = new ProjectGoalModelDrafts({
    workflow,
    memory: {},
    clock: () => now,
    getManager: () => manager,
    confirm: async () => true,
    captureModel: () => ({
      provider: "ollama",
      model: "fixture",
      endpoint: "http://127.0.0.1:11434",
      check() {},
      async run(_messages, options) {
        calls++;
        options.beforeDispatch({
          runId: "evidence-worker",
          tenantId: "tenant-worker",
        });
        if (mode === "dispatched") {
          onDispatch();
          return new Promise(() => {});
        }
        return {
          summary: JSON.stringify({
            title: "Durable model draft",
            description: "Protocol-fixture pending body",
          }),
          usage: { promptTokens: 5, completionTokens: 3 },
        };
      },
    }),
  });
  return { db, workflow, service, calls: () => calls };
}
async function worker(file, mode) {
  let request;
  const f = open(file, mode, () => process.send({ phase: mode, request }));
  f.db
    .exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','${actor}','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  let goal = f.workflow.goals.create({
    projectId: "p1",
    objective: "Follow delivery",
  });
  goal = f.workflow.goals.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.create"] },
  });
  const review = f.workflow.risk.evaluate({ projectId: "p1" });
  f.db
    .transaction(() =>
      f.workflow.observeInTransaction({
        goalId: goal.id,
        reviewId: review.review.id,
      }),
    )
    .immediate();
  const source = f.workflow
    .list({ goalId: goal.id })
    .proposals.find((r) => r.current && r.proposal.actionType === "task.create")
    .proposal.id;
  request = {
    goalRef: {
      id: goal.id,
      storeId: goal.storeId,
      revision: goal.revision,
      controlGeneration: goal.controlGeneration,
    },
    sourceRef: source,
    requestId: "crash-model-1",
    type: "task.create",
    taskType: "analyze_data",
    useMemory: false,
  };
  const result = await f.service.generate(request);
  if (mode === "saved") {
    assert.equal(result.state, "saved");
    process.send({ phase: mode, request, proposalId: result.proposalId });
    await new Promise(() => {});
  }
}
if (process.argv[2] === "--model-worker") {
  worker(process.argv[3], process.argv[4]).catch(() => process.exit(1));
} else {
  for (const mode of ["dispatched", "saved"]) {
    test(
      `forced worker exit after ${mode} preserves the model identity without redispatch`,
      { timeout: 15000 },
      async () => {
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), "cc-model-crash-"),
          ),
          file = path.join(directory, "project.sqlite");
        const child = fork(__filename, ["--model-worker", file, mode], {
          execArgv: [],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        });
        let reopened;
        try {
          const checkpoint = await new Promise((resolve, reject) => {
            child.once("message", resolve);
            child.once("error", reject);
            child.once("exit", () =>
              reject(new Error("worker exited before checkpoint")),
            );
          });
          assert.equal(checkpoint.phase, mode);
          await new Promise((resolve, reject) => {
            child.once("exit", resolve);
            if (!child.kill("SIGKILL"))
              reject(new Error("worker termination failed"));
          });
          reopened = open(file, "must-not-call", () => {});
          const result = await reopened.service.generate(checkpoint.request);
          assert.equal(result.state, mode === "saved" ? "saved" : "unknown");
          assert.equal(reopened.calls(), 0);
          assert.equal(
            reopened.db.prepare("SELECT COUNT(*) AS n FROM project_tasks").get()
              .n,
            1,
          );
          const usage = JSON.parse(
            reopened.db
              .prepare("SELECT record_json FROM cc_project_goal_usage")
              .get().record_json,
          );
          assert.equal(usage.status, mode === "saved" ? "settled" : "unknown");
          if (mode === "saved")
            assert.equal(
              reopened.service.read({ id: result.proposalId }).id,
              checkpoint.proposalId,
            );
          else
            assert.equal(
              reopened.db
                .prepare(
                  "SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts",
                )
                .get().n,
              0,
            );
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve) => {
              child.once("exit", resolve);
              child.kill("SIGKILL");
            });
          }
          reopened?.db.close();
          const resolved = path.resolve(directory);
          assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
          assert.ok(path.basename(resolved).startsWith("cc-model-crash-"));
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      },
    );
  }
}
