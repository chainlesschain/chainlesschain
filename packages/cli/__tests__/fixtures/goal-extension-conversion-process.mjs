import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  ProjectGoalExtensionQueue,
} = require("@chainlesschain/session-core/project-goal-extension-queue");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const [mode, directory] = process.argv.slice(2);
const db = new Database(path.join(directory, "project.sqlite"));
const owner = "did:chainless:fixture-owner",
  now = 1791244800000;
if (mode === "setup")
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
  CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
  created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
  INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
  INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
let queue;
const workflow = new ProjectGoalWorkflow({
  db,
  getActor: () => owner,
  clock: () => now,
  verifyExtensionIntent: (context) =>
    queue ? queue.verifyIntentInTransaction(context) : false,
  approvalGate: new ApprovalGate({
    confirm: async () => {
      if (mode === "running-gap") process.exit(45);
      return true;
    },
  }),
});
queue = new ProjectGoalExtensionQueue({
  workflow,
  plugin: { name: "process-fixture", scope: "project", version: "1.0.0" },
  authorizeExtension: () => "fixture-grant:1",
  clock: () => now,
});
const stateFile = path.join(directory, "state.json");
async function main() {
  if (mode === "setup") {
    let goal = workflow.goals.create({
      projectId: "p1",
      objective: "Recover extension conversion",
      budgetPolicy: { maxRuns: 10 },
    });
    goal = workflow.goals.revise({
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { allowedActionTypes: ["task.update-description"] },
    });
    const review = workflow.risk.evaluate({ projectId: "p1" });
    db.transaction(() =>
      workflow.observeInTransaction({
        goalId: goal.id,
        reviewId: review.review.id,
      }),
    ).immediate();
    const source = workflow
      .list({ goalId: goal.id })
      .proposals.find(
        (e) => e.proposal.actionType === "task.update-description",
      ).proposal;
    const draft = queue.enqueue({
      type: "task.description.update",
      goalRef: {
        id: goal.id,
        storeId: goal.storeId,
        revision: goal.revision,
        controlGeneration: goal.controlGeneration,
      },
      sourceRef: source.id,
      requestId: "fixture-request",
      title: "Recover delivery",
      description: "Persisted extension recovery",
    });
    fs.writeFileSync(stateFile, JSON.stringify({ draftId: draft.proposalId }));
    return draft;
  }
  const { draftId } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (mode === "conversion-gap") workflow.prepare = () => process.exit(41);
  if (mode === "native-draft-gap")
    workflow.descriptionActions.preview = () => process.exit(42);
  if (
    [
      "conversion-gap",
      "native-draft-gap",
      "preview-gap",
      "run-gap",
      "running-gap",
    ].includes(mode)
  ) {
    const prepared = queue.prepareDraft({ id: draftId });
    if (mode === "preview-gap") process.exit(43);
    if (mode === "run-gap" || mode === "running-gap") {
      await workflow.execute({ intentId: prepared.intent.id });
      process.exit(44);
    }
    return prepared;
  }
  const row = db
    .prepare(
      "SELECT record_json FROM cc_project_goal_extension_conversions WHERE draft_id=?",
    )
    .get(draftId);
  const conversion = row ? JSON.parse(row.record_json) : null;
  const exists =
    conversion &&
    db
      .prepare("SELECT 1 FROM cc_project_goal_workflow WHERE id=?")
      .get(conversion.intentId);
  if (mode === "replay")
    return workflow.execute({ intentId: conversion.intentId });
  if (mode !== "inspect") throw new Error("unknown fixture mode");
  const intent = exists
    ? workflow.getIntent({ intentId: conversion.intentId })
    : null;
  return {
    conversion,
    nativeIntents: db
      .prepare(
        "SELECT count(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
      )
      .get().n,
    conversions: db
      .prepare(
        "SELECT count(*) AS n FROM cc_project_goal_extension_conversions",
      )
      .get().n,
    actionRuns: db
      .prepare("SELECT count(*) AS n FROM cc_business_action_runs")
      .get().n,
    description: db.prepare("SELECT description FROM project_tasks").get()
      .description,
    intentStatus: intent?.intent.status ?? null,
    runId: intent?.receipt?.run.id ?? null,
    runStatus: intent?.receipt?.run.status ?? null,
    usage: conversion
      ? (db
          .prepare(
            "SELECT json_extract(record_json,'$.status') AS status FROM cc_project_goal_usage WHERE operation_id=?",
          )
          .get(conversion.intentId)?.status ?? null)
      : null,
  };
}
main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    db.close();
  })
  .catch((error) => {
    process.stderr.write(String(error.stack));
    if (db.open) db.close();
    process.exitCode = 1;
  });
