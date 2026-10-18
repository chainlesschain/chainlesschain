"use strict";
const assert = require("node:assert/strict");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  ProjectGoalDraftImports,
} = require("@chainlesschain/session-core/project-goal-draft-imports");
const {
  createGoalDraftRequest,
} = require("@chainlesschain/session-core/goal-draft-request-contract");
const Database = require(process.argv[2]);
(async () => {
  assert.equal(
    (await import("@chainlesschain/session-core/project-goal-draft-imports"))
      .ProjectGoalDraftImports,
    ProjectGoalDraftImports,
  );
  const db = new Database(":memory:"),
    actor = "did:owner";
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','did:owner','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  let imports;
  const workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    verifyExtensionIntent: (context) =>
      imports.verifyIntentInTransaction(context),
  });
  let goal = workflow.goals.create({
    projectId: "p1",
    objective: "Packed import",
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
      (item) => item.proposal.actionType === "task.update-description",
    ).proposal;
  const goalRef = {
    id: goal.id,
    storeId: goal.storeId,
    revision: goal.revision,
    controlGeneration: goal.controlGeneration,
  };
  const envelope = createGoalDraftRequest({
    declaredPlugin: { name: "drafter", scope: "project", version: "0.1.0" },
    declarationDigest: `sha256:${"a".repeat(64)}`,
    proposal: {
      type: "task.description.update",
      goalRef,
      sourceRef: source.id,
      requestId: "packed-request",
      title: "Follow up",
      description: "Packed request body",
    },
  });
  imports = new ProjectGoalDraftImports({
    workflow,
    confirm: async () => true,
  });
  const saved = await imports.adopt({ goalRef, envelope });
  assert.equal(saved.state, "saved");
  assert.equal((await imports.adopt({ goalRef, envelope })).id, saved.id);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts")
      .get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT description FROM project_tasks").get().description,
    "Original",
  );
  const prepared = imports.prepare({ goalRef, id: saved.id });
  assert.equal(prepared.intent.status, "prepared");
  imports.revoke({ goalRef, id: saved.id, expectedEpoch: 1 });
  assert.equal((await imports.adopt({ goalRef, envelope })).state, "revoked");
  assert.throws(() => imports.prepare({ goalRef, id: saved.id }));
  assert.ok(
    !Object.keys(require.cache).some((name) =>
      /[\\/]packages[\\/]cli[\\/]src[\\/]/u.test(name),
    ),
  );
  db.close();
  console.log(
    JSON.stringify({
      publicCjsAndEsmExports: true,
      realSqlite: true,
      atomicAdoptionAndPending: true,
      idempotentReimport: true,
      nativePreview: true,
      revocationPreventsRestore: true,
      noTaskModification: true,
      noCliPrivateImports: true,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
