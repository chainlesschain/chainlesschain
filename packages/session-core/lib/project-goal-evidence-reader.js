"use strict";

const { readOnlyNativeDatabase } = require("./read-only-native-database.js");
const { ProjectGoalWorkflow } = require("./project-goal-workflow.js");
const {
  validateStoredProjectGoalCheck,
} = require("./project-goal-monitoring.js");
const { goalExtensionRef } = require("./goal-extension-proposal-contract.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  validateGoalEvidenceProjection,
} = require("./goal-evidence-contract.js");
function fail() {
  throw Object.assign(new Error("GOAL_EVIDENCE_INVALID"), {
    code: "GOAL_EVIDENCE_INVALID",
  });
}
const MAX_RECEIPT = 64 * 1024;
/** Existing native validators over a read-only facade. No recovery or writes. */
class ProjectGoalEvidenceReader {
  constructor({ db, getActor, clock = Date.now }) {
    const view = readOnlyNativeDatabase(db);
    const workflow = new ProjectGoalWorkflow({ db: view, getActor, clock });
    this.readSummary = (raw) => {
      const ref = goalExtensionRef(raw);
      return view
        .transaction(() => {
          const actor = workflow.adapter._actor();
          const goal = workflow._goal(ref.id, actor);
          workflow._live(
            goal,
            {
              storeId: ref.storeId,
              goalRevision: ref.revision,
              controlGeneration: ref.controlGeneration,
            },
            actor,
          );
          if (workflow.adapter._actor() !== actor) fail();
          return {
            goalRef: ref,
            objective: goal.objective.slice(0, 4096),
            status: goal.status,
          };
        })
        .deferred();
    };
    // Only this bounded projection is exposed, never the workflow/action ports.
    this.read = (raw) => {
      const ref = goalExtensionRef(raw);
      return view
        .transaction(() => {
          const actor = workflow.adapter._actor();
          const goal = workflow._goal(ref.id, actor);
          workflow._live(
            goal,
            {
              storeId: ref.storeId,
              goalRevision: ref.revision,
              controlGeneration: ref.controlGeneration,
            },
            actor,
          );
          const exists = (table) =>
            !!view
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(table);
          let risk = { state: "unavailable" };
          if (exists("cc_project_goal_checks")) {
            const row = view
              .prepare(
                `SELECT occurrence_id,goal_id,actor_did,goal_revision,control_generation,request_digest,
            CASE WHEN length(CAST(payload_json AS BLOB))<=4096 THEN payload_json END AS payload_json,
            review_id,CASE WHEN length(CAST(result_json AS BLOB))<=4096 THEN result_json END AS result_json,
            result_digest,checked_at,elapsed_ms FROM cc_project_goal_checks
            WHERE goal_id=? AND actor_did=? ORDER BY rowid DESC LIMIT 1`,
              )
              .get(goal.id, actor);
            risk = { state: "not-recorded" };
            if (row) {
              const result = validateStoredProjectGoalCheck({
                row,
                goal,
                actor,
                risk: workflow.risk,
              });
              const review = workflow.risk.getReviewInTransaction({
                reviewId: row.review_id,
              });
              risk = {
                state: result.status,
                reviewId: row.review_id,
                checkedAt: result.checkedAt,
                goalRevision: row.goal_revision,
                controlGeneration: row.control_generation,
                riskTaskCount: result.riskTaskCount,
                reasonCodes: review.evaluation.reasonCodes,
                history: true,
              };
            }
          }
          const receipts = [];
          let receiptState = "unavailable",
            hasMore = false;
          if (
            exists("cc_project_goal_workflow") &&
            exists("cc_business_action_runs")
          ) {
            // Classify from bounded verified intent records before paging true runs.
            // At most 1000 records are permitted by the native workflow contract.
            const candidates = view
              .prepare(
                `SELECT id
            FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind='intent' ORDER BY rowid DESC LIMIT 1001`,
              )
              .all(goal.id, actor);
            if (candidates.length > 1000) fail();
            const ids = [];
            for (const row of candidates) {
              const intent = workflow._read(row.id, "intent", actor);
              if (
                intent.goalId !== goal.id ||
                intent.storeId !== goal.storeId ||
                intent.goalRevision > goal.revision ||
                intent.controlGeneration > goal.controlGeneration
              )
                fail();
              if (intent.runId !== null) {
                const row = view
                  .prepare(
                    "SELECT rowid AS ordinal FROM cc_business_action_runs WHERE id=? AND actor_did=?",
                  )
                  .get(intent.runId, actor);
                if (!row || !Number.isSafeInteger(row.ordinal)) fail();
                ids.push({ intentId: intent.id, ordinal: row.ordinal });
              }
            }
            receiptState = "recorded";
            ids.sort((a, b) => b.ordinal - a.ordinal);
            hasMore = ids.length > 20;
            for (const selected of ids.slice(0, 20)) {
              const intent = workflow._read(selected.intentId, "intent", actor);
              const size = view
                .prepare(
                  `SELECT length(CAST(run_json AS BLOB)) AS runBytes,length(CAST(evidence_json AS BLOB)) AS evidenceBytes
              FROM cc_business_action_runs WHERE id=? AND actor_did=?`,
                )
                .get(intent.runId, actor);
              if (
                !size ||
                size.runBytes > MAX_RECEIPT ||
                size.evidenceBytes > MAX_RECEIPT
              )
                fail();
              const result = workflow._intentResult(intent, actor);
              const run = result.receipt?.run;
              if (
                !run ||
                run.id !== intent.runId ||
                !["running", "succeeded", "denied", "cancelled"].includes(
                  run.status,
                )
              )
                fail();
              receipts.push({
                id: run.id,
                status: result.executionState,
                actionType: run.actionType,
                goalRevision: intent.goalRevision,
                controlGeneration: intent.controlGeneration,
                history: true,
              });
            }
          }
          if (
            workflow.adapter._actor() !== actor ||
            digest(workflow._goal(ref.id, actor)) !== digest(goal)
          )
            fail();
          workflow._live(
            goal,
            {
              storeId: ref.storeId,
              goalRevision: ref.revision,
              controlGeneration: ref.controlGeneration,
            },
            actor,
          );
          return validateGoalEvidenceProjection({
            risk,
            receipts: { state: receiptState, entries: receipts, hasMore },
          });
        })
        .deferred();
    };
    Object.freeze(this);
  }
}
module.exports = { ProjectGoalEvidenceReader };
