import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectRiskReviewService,
} = require("../../../session-core/lib/project-risk-review-service");
const {
  TaskDescriptionActionService,
  TaskCreateActionService,
} = require("../../../session-core/lib/task-description-action-service");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate");

describe("independent risk and typed action history authorization audit", () => {
  let db, edits, creates, risk;
  const owner = "did:chainless:owner";
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('same-id','${owner}','active',10,0),('other-project','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('same-id','other-project','query_info','private task','pending',10,10,0,'synced',20,NULL);`);
    const dependencies = {
      db,
      getActor: () => owner,
      now: () => 1791244800000,
      approvalGate: new ApprovalGate({ confirm: async () => true }),
    };
    edits = new TaskDescriptionActionService(dependencies);
    creates = new TaskCreateActionService(dependencies);
    risk = new ProjectRiskReviewService(dependencies);
  });
  afterEach(() => db.close());

  it("does not expose a revoked task's receipt through a same-ID owned project history", async () => {
    const request = edits.preview({
      taskId: "same-id",
      description: "changed",
      idempotencyKey: "edit",
    }).request;
    const receipt = await edits.execute(request);
    db.prepare(
      "UPDATE projects SET user_id='did:other' WHERE id='other-project'",
    ).run();
    expect(() => edits.getRun(receipt.run.id)).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(creates.listProjectRuns({ projectId: "same-id" }).runs).toEqual([]);
    expect(() =>
      creates.listProjectRuns({
        projectId: "same-id",
        beforeId: receipt.run.id,
      }),
    ).toThrow("ACTION_INVALID_CURSOR");
  });

  it("does not expose a revoked project's creation receipt through a same-ID owned task history", async () => {
    const request = creates.preview({
      projectId: "same-id",
      taskType: "query_info",
      description: "created",
      idempotencyKey: "create",
    }).request;
    const receipt = await creates.execute(request);
    db.prepare(
      "UPDATE projects SET user_id='did:other' WHERE id='same-id'",
    ).run();
    expect(() => creates.getRun(receipt.run.id)).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(edits.listRuns({ taskId: "same-id" }).runs).toEqual([]);
    expect(() =>
      edits.listRuns({ taskId: "same-id", beforeId: receipt.run.id }),
    ).toThrow("ACTION_INVALID_CURSOR");
  });

  it("rejects a same-ID project review that never contained the target task", () => {
    const review = risk.evaluate({ projectId: "same-id" });
    expect(() =>
      edits.preview({
        taskId: "same-id",
        description: "changed",
        idempotencyKey: "cross-review",
        reviewId: review.review.id,
      }),
    ).toThrow("PROJECT_RISK_ACTION_SOURCE_INVALID");
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
  });

  it("rejects a substituted review digest before admission and preserves the source", async () => {
    const review = risk.evaluate({ projectId: "other-project" });
    const request = edits.preview({
      taskId: "same-id",
      description: "changed",
      idempotencyKey: "bad-digest",
      reviewId: review.review.id,
    }).request;
    // Rebuild a syntactically valid request so this exercises source binding,
    // rather than merely invalidating the request's self-consistency digest.
    const {
      createBusinessActionRequest,
    } = require("../../../session-core/lib/business-object-contract");
    const forged = createBusinessActionRequest({
      actionType: request.actionType,
      actionVersion: request.actionVersion,
      target: request.target,
      expectedVersion: request.expectedVersion,
      input: {
        description: "changed",
        riskReview: {
          id: review.review.id,
          contentDigest: `sha256:${"0".repeat(64)}`,
        },
      },
      idempotencyKey: "forged-digest",
    });
    await expect(edits.execute(forged)).rejects.toThrow(
      "PROJECT_RISK_REVIEW_CONFLICT",
    );
    expect(
      db
        .prepare("SELECT description FROM project_tasks WHERE id='same-id'")
        .get().description,
    ).toBe("private task");
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
  });
});
