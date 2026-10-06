import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectRiskReviewService,
} = require("../../../session-core/lib/project-risk-review-service");
const {
  TaskDescriptionActionService,
} = require("../../../session-core/lib/task-description-action-service");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate");

describe("authorized risk history, human feedback and atomic action lineage", () => {
  const owner = "did:chainless:owner";
  const instant = 1791244800000;
  let db, actor, now, confirm, risk, actions;
  const evaluate = () => risk.evaluate({ projectId: "p1" });
  const feedback = (reviewId, extra = {}) =>
    risk.recordFeedback({
      reviewId,
      taskId: "t1",
      verdict: "dismissed",
      reasonCodes: [],
      comment: "Deadline agreed separately",
      ...extra,
    });
  const preview = (reviewId, extra = {}) =>
    actions.preview({
      taskId: "t1",
      description: "Reviewed task",
      idempotencyKey: "operation-one",
      reviewId,
      ...extra,
    }).request;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
    actor = owner;
    now = instant;
    confirm = vi.fn(async () => true);
    risk = new ProjectRiskReviewService({
      db,
      getActor: () => actor,
      now: () => now,
    });
    actions = new TaskDescriptionActionService({
      db,
      getActor: () => actor,
      now: () => now,
      approvalGate: new ApprovalGate({ confirm }),
    });
  });
  afterEach(() => {
    if (db?.open) db.close();
  });

  it("paginates verified metadata in insertion order and rejects foreign cursors", () => {
    const first = evaluate(),
      second = evaluate();
    const page = risk.listReviews({ projectId: "p1", limit: 1 });
    expect(page.reviews[0].review.id).toBe(second.review.id);
    expect(page.reviews[0].summary.riskTaskCount).toBe(1);
    expect(JSON.stringify(page)).not.toContain("Original");
    expect(page.nextCursor).toBe(second.review.id);
    expect(
      risk.listReviews({ projectId: "p1", limit: 1, beforeId: page.nextCursor })
        .reviews[0].review.id,
    ).toBe(first.review.id);
    expect(() =>
      risk.listReviews({ projectId: "p1", beforeId: "missing" }),
    ).toThrow("PROJECT_RISK_INVALID_CURSOR");
  });

  it("appends human corrections without overwriting independent rules or claiming known cost", () => {
    const review = evaluate();
    const saved = feedback(review.review.id);
    expect(risk.getReview({ reviewId: review.review.id })).toEqual(review);
    const lineage = risk.getLineage({ reviewId: review.review.id });
    expect(lineage.feedback[0]).toEqual(saved);
    expect(lineage.evaluation.summary.riskTaskCount).toBe(1);
    expect(lineage.modelUsage).toBeNull();
    expect(lineage.cost.status).toBe("unknown");
    expect(lineage.proof).toBe("local-content-binding");
  });

  it("paginates feedback independently from action receipts", () => {
    const reviewId = evaluate().review.id;
    const first = feedback(reviewId),
      second = feedback(reviewId);
    const page = risk.getLineage({ reviewId, limit: 1 });
    expect(page.feedback[0].feedback.id).toBe(second.feedback.id);
    expect(page.nextFeedbackCursor).toBe(second.feedback.id);
    expect(
      risk.getLineage({
        reviewId,
        limit: 1,
        feedbackBeforeId: page.nextFeedbackCursor,
      }).feedback[0].feedback.id,
    ).toBe(first.feedback.id);
  });

  it.each([
    { verdict: "success" },
    { taskId: "missing" },
    { verdict: "dismissed", reasonCodes: ["OVERDUE_INCOMPLETE_TASK"] },
    { reasonCodes: ["fabricated"] },
    { comment: "x".repeat(4097) },
    { actorDid: owner },
  ])("refuses invalid feedback without creating a record: %j", (extra) => {
    const reviewId = evaluate().review.id;
    expect(() => feedback(reviewId, extra)).toThrow();
    expect(risk.getLineage({ reviewId }).feedback).toEqual([]);
  });

  it.each(["transfer", "delete", "workspace"])(
    "rechecks authorization on every history and feedback path: %s",
    (change) => {
      const reviewId = evaluate().review.id;
      feedback(reviewId);
      if (change === "transfer")
        db.prepare("UPDATE projects SET user_id='did:other'").run();
      if (change === "delete")
        db.prepare("UPDATE project_tasks SET deleted=1").run();
      if (change === "workspace")
        db.exec(
          "CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT); INSERT INTO workspace_resources VALUES ('w','task','t1')",
        );
      for (const read of [
        () => risk.listReviews({ projectId: "p1" }),
        () => risk.getLineage({ reviewId }),
        () => feedback(reviewId),
      ])
        expect(read).toThrow();
    },
  );

  it("rejects stale selected fields and added tasks before admission", async () => {
    const reviewId = evaluate().review.id;
    const request = preview(reviewId);
    db.prepare("UPDATE project_tasks SET due_date=30").run();
    await expect(actions.execute(request)).rejects.toThrow(
      "PROJECT_RISK_REVIEW_STALE",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
    expect(() => preview(reviewId)).toThrow("PROJECT_RISK_REVIEW_STALE");
    db.prepare("UPDATE project_tasks SET due_date=20").run();
    db.exec(
      "INSERT INTO project_tasks SELECT 't2',project_id,task_type,description,status,created_at,updated_at,deleted,sync_status,due_date,blocked_by FROM project_tasks",
    );
    expect(() => preview(reviewId)).toThrow("PROJECT_RISK_REVIEW_STALE");
  });

  it("links source, native confirmation and successful mutation and retains the historical review", async () => {
    const review = evaluate();
    const request = preview(review.review.id);
    expect(request.input.riskReview.id).toBe(review.review.id);
    const receipt = await actions.execute(structuredClone(request));
    expect(receipt.run.status).toBe("succeeded");
    const lineage = risk.getLineage({ reviewId: review.review.id });
    expect(lineage.actionRuns).toEqual([
      { run: receipt.run, evidence: receipt.evidence },
    ]);
    expect(risk.getReview({ reviewId: review.review.id })).toEqual(review);
    expect(lineage.actionRuns[0].evidence.map((item) => item.kind)).toEqual([
      "project-risk-review",
      "local-user-confirmation",
      "sqlite-task-description-update",
    ]);
    const replay = await actions.execute(request);
    expect(replay.replayed).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_risk_action_links").get()
        .n,
    ).toBe(1);
  });

  it("retains cancelled intent lineage without changing the task", async () => {
    confirm.mockResolvedValue(false);
    const reviewId = evaluate().review.id;
    const receipt = await actions.execute(preview(reviewId));
    expect(receipt.run.status).toBe("cancelled");
    expect(risk.getLineage({ reviewId }).actionRuns[0].run.status).toBe(
      "cancelled",
    );
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
  });

  it("revalidates the review after confirmation and records denial without a write", async () => {
    const reviewId = evaluate().review.id;
    const request = preview(reviewId);
    confirm.mockImplementation(async () => {
      db.prepare("UPDATE project_tasks SET due_date=40").run();
      return true;
    });
    await expect(actions.execute(request)).rejects.toThrow(
      "PROJECT_RISK_REVIEW_STALE",
    );
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    const lineage = risk.getLineage({ reviewId });
    expect(lineage.actionRuns[0].run.status).toBe("denied");
  });

  it("rolls back admission when the lineage insert cannot commit", async () => {
    const reviewId = evaluate().review.id;
    const request = preview(reviewId);
    db.exec(
      "CREATE TRIGGER reject_link BEFORE INSERT ON cc_project_risk_action_links BEGIN SELECT RAISE(ABORT,'refused'); END",
    );
    await expect(actions.execute(request)).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
  });

  it.each(["identity", "ownership"])(
    "persists denial after %s is revoked during confirmation",
    async (change) => {
      const reviewId = evaluate().review.id;
      const request = preview(reviewId);
      confirm.mockImplementation(async () => {
        if (change === "identity") actor = "did:chainless:other";
        else
          db.prepare("UPDATE projects SET user_id='did:chainless:other'").run();
        return true;
      });
      await expect(actions.execute(request)).rejects.toThrow();
      const stored = JSON.parse(
        db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      );
      expect(stored.status).toBe("denied");
      expect(
        db.prepare("SELECT description FROM project_tasks").get().description,
      ).toBe("Original");
      expect(() => risk.getLineage({ reviewId })).toThrow(
        "PROJECT_RISK_NOT_FOUND_OR_DENIED",
      );
      actor = owner;
      db.prepare("UPDATE projects SET user_id=?").run(owner);
      expect(risk.getLineage({ reviewId }).actionRuns[0].run.status).toBe(
        "denied",
      );
    },
  );

  it("retains unresolved admission after native confirmation loss and prevents a new key", async () => {
    let unblock;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          unblock = resolve;
        }),
    );
    const reviewId = evaluate().review.id;
    const pending = actions.execute(preview(reviewId));
    const lineage = risk.getLineage({ reviewId });
    expect(lineage.actionRuns[0].run.status).toBe("running");
    expect(() =>
      preview(reviewId, { idempotencyKey: "different-key" }),
    ).toThrow("ACTION_UNRESOLVED_ACTION");
    unblock(false);
    await pending;
  });

  it.each(["feedback", "link", "receipt"])(
    "rejects corrupted %s evidence",
    async (kind) => {
      const reviewId = evaluate().review.id;
      feedback(reviewId);
      await actions.execute(preview(reviewId));
      if (kind === "feedback")
        db.exec("UPDATE cc_project_risk_feedback SET feedback_json='{}'");
      if (kind === "link")
        db.exec(
          "UPDATE cc_project_risk_action_links SET invocation_digest='sha256:fake'",
        );
      if (kind === "receipt")
        db.exec("UPDATE cc_business_action_runs SET evidence_json='[]'");
      expect(() => risk.getLineage({ reviewId })).toThrow(
        /PROJECT_RISK_(FEEDBACK|LINEAGE)_CORRUPT/,
      );
    },
  );

  it("requires an existing action transaction for binding and fresh verification", () => {
    const context = risk.getActionContext({
      reviewId: evaluate().review.id,
      taskId: "t1",
    });
    expect(() =>
      risk.verifyActionContext({
        reviewId: context.id,
        taskId: "t1",
        contentDigest: context.contentDigest,
      }),
    ).toThrow("PROJECT_RISK_TRANSACTION_REQUIRED");
    expect(() => risk.bindActionRun({})).toThrow(
      "PROJECT_RISK_TRANSACTION_REQUIRED",
    );
  });
});
