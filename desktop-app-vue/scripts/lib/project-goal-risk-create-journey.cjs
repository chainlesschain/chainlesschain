"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  digestBusinessObjectContent,
} = require("../../../packages/session-core/lib/business-object-contract.js");

// Actual Vue controls, native dialog clicks and public authenticated IPC.
// Public IPC is used explicitly for stale-preview/replay probes; those calls
// are not represented as GUI clicks. No approval or business service is mocked.
async function exerciseRiskTaskCreation({
  window,
  article,
  api,
  expect,
  choose,
  goalId,
  projectId,
  sourceTaskId,
  output,
  stage,
  result,
}) {
  const tasks = async () =>
    (await api("listControlledTasks", { projectId }, "task")).tasks;
  const taskIds = async () => (await tasks()).map((task) => task.id).sort();
  const proposals = () => api("listGoalProposals", { goalId, limit: 50 });
  const readIntent = (intentId) => api("readGoalIntent", { intentId });
  const check = async () => {
    const before = (await api("getGoalMonitoringStatus", { id: goalId })).usage
      .checks;
    await article.locator('[data-testid="check-goal"]').click();
    await expect
      .poll(
        async () =>
          (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
      )
      .toBeGreaterThan(before);
    await article.locator('[data-testid="refresh-goal-actions"]').click();
  };
  const prepare = async (description) => {
    const available = (await proposals()).proposals.filter(
      (item) =>
        item.current &&
        !item.intent &&
        !item.intentUnavailable &&
        item.proposal.actionType === "task.create" &&
        item.proposal.sourceTaskId === sourceTaskId,
    );
    assert.equal(
      available.length,
      1,
      "Exactly one authorized current creation suggestion is required",
    );
    const proposal = available[0].proposal;
    const row = article.locator(`[data-proposal-id="${proposal.id}"]`);
    await row
      .locator('[data-testid="goal-action-description"]')
      .fill(description);
    await row.locator('[data-testid="prepare-goal-intent"]').click();
    await expect(
      row.locator('[data-testid="execute-goal-intent"]'),
    ).toBeVisible();
    const saved = (await proposals()).proposals.find(
      (item) => item.proposal.id === proposal.id,
    );
    assert(saved?.intent);
    const intent = await readIntent(saved.intent.intent.id);
    assert.equal(intent.intent.status, "prepared");
    assert.equal(intent.intent.goalId, goalId);
    assert.equal(intent.intent.proposalId, proposal.id);
    assert.equal(intent.intent.description, description);
    // This built-in UI explicitly previews the existing query_info default.
    assert.equal(intent.intent.taskType, "query_info");
    assert.equal(intent.intent.preview.request.actionType, "task.create");
    assert.equal(intent.intent.preview.request.target.id, projectId);
    assert.equal(
      intent.intent.preview.request.input.goalIntent.id,
      intent.intent.id,
    );
    assert.equal(
      intent.intent.preview.request.input.riskReview.id,
      intent.intent.reviewId,
    );
    const review = await api("getRiskReview", {
      reviewId: intent.intent.reviewId,
    });
    assert.equal(
      digestBusinessObjectContent(review),
      intent.intent.reviewDigest,
    );
    assert(review.evaluation.taskRefs.some((ref) => ref.id === sourceTaskId));
    assert(
      JSON.stringify(review.evaluation).includes("OVERDUE_INCOMPLETE_TASK"),
    );
    return { row, proposal, intent, review };
  };
  const pauseResume = async () => {
    const before = await api("readGoal", { id: goalId });
    await article.locator('[data-testid="stop-goal"]').click();
    await expect
      .poll(async () => (await api("readGoal", { id: goalId })).status)
      .toBe("paused");
    await expect
      .poll(
        async () =>
          (await api("getGoalMonitoringStatus", { id: goalId })).executionState,
      )
      .toBe("paused");
    const paused = await api("getGoalMonitoringStatus", { id: goalId });
    assert.equal(Boolean(paused.monitor?.enabled), false);
    await window.locator('[data-testid="refresh-goals"]').click();
    await article.locator('[data-testid="resume-goal"]').click();
    await expect
      .poll(async () => (await api("readGoal", { id: goalId })).status)
      .toBe("active");
    const resumed = await api("readGoal", { id: goalId });
    assert(resumed.revision > before.revision);
    assert(resumed.controlGeneration > before.controlGeneration);
    assert.equal(resumed.schema, "chainlesschain.goal/v2");
    assert.equal(resumed.completion, null);
    (result.pauseResumes ??= []).push({ before, paused, resumed });
    await article.locator('[data-testid="start-goal"]').click();
    await expect
      .poll(async () =>
        Boolean(
          (await api("getGoalMonitoringStatus", { id: goalId })).monitor
            ?.enabled,
        ),
      )
      .toBe(true);
    await check();
  };
  const boundedPublicExecution = async (intentId) => {
    let timer;
    try {
      return await Promise.race([
        api("executeGoalIntent", { intentId }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Public intent probe did not settle without a new approval",
                ),
              ),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  result.originalTaskIds = await taskIds();
  assert(result.originalTaskIds.includes(sourceTaskId));
  const cancelledText = `DMM cancelled risk creation ${goalId}`;
  const cancelled = await prepare(cancelledText);
  result.cancelPrepared = {
    proposal: cancelled.proposal,
    intent: cancelled.intent,
    review: cancelled.review,
  };
  assert.deepEqual(await taskIds(), result.originalTaskIds);
  await choose(
    cancelled.row.locator('[data-testid="execute-goal-intent"]'),
    "确认目标建议：创建任务",
    "取消",
    cancelledText,
  );
  await expect(
    cancelled.row.locator('[data-testid="goal-intent-state"]'),
  ).toContainText("已取消");
  result.cancelled = await readIntent(cancelled.intent.intent.id);
  assert.equal(result.cancelled.receipt.run.status, "cancelled");
  assert.equal(result.cancelled.receipt.run.actionType, "task.create");
  assert.deepEqual(await taskIds(), result.originalTaskIds);
  stage("risk-create-native-cancellation-does-not-create-a-task");

  await pauseResume();
  const stale = await prepare(`DMM stale risk creation ${goalId}`);
  result.stalePrepared = {
    proposal: stale.proposal,
    intent: stale.intent,
    review: stale.review,
  };
  await pauseResume();
  let rejection = null;
  try {
    await boundedPublicExecution(stale.intent.intent.id);
  } catch (error) {
    rejection = String(error.message || error);
  }
  assert.match(rejection || "", /ACTION_GOAL_REVISION_CONFLICT/u);
  result.stalePreviewRejection = {
    via: "actual public authenticated IPC",
    error: rejection,
  };
  assert.deepEqual(await taskIds(), result.originalTaskIds);
  stage("risk-create-actual-pause-resume-rejects-old-prepared-intent");

  const description = `DMM accepted risk follow-up ${goalId}`;
  const prepared = await prepare(description);
  result.confirmPrepared = {
    proposal: prepared.proposal,
    intent: prepared.intent,
    review: prepared.review,
  };
  await choose(
    prepared.row.locator('[data-testid="execute-goal-intent"]'),
    "确认目标建议：创建任务",
    "确认创建",
    description,
  );
  await expect
    .poll(async () => (await tasks()).length)
    .toBe(result.originalTaskIds.length + 1);
  result.executed = await readIntent(prepared.intent.intent.id);
  assert.equal(result.executed.executionState, "succeeded");
  const receipt = result.executed.receipt;
  assert.equal(receipt.run.actionType, "task.create");
  assert.equal(receipt.run.id, result.executed.intent.runId);
  const creation = receipt.evidence.find(
    (item) => item.kind === "sqlite-task-create",
  );
  assert(creation?.createdTaskRef);
  const created = (await tasks()).filter(
    (task) => !result.originalTaskIds.includes(task.id),
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].id, creation.createdTaskRef.id);
  assert.equal(created[0].taskType, "query_info");
  result.createdTask = await api(
    "readControlledTask",
    { taskId: created[0].id },
    "task",
  );
  assert.equal(result.createdTask.description, description);
  assert.equal(created[0].status, "pending");
  result.lineage = await api("getRiskLineage", {
    reviewId: result.executed.intent.reviewId,
  });
  const linked = result.lineage.actionRuns.find(
    (item) => item.run.id === receipt.run.id,
  );
  assert(linked);
  assert.deepEqual(
    linked.evidence.map((item) => item.kind),
    [
      "project-risk-review",
      "project-goal-intent",
      "local-user-confirmation",
      "sqlite-task-create",
    ],
  );
  assert.equal(
    result.executed.intent.reviewDigest,
    digestBusinessObjectContent(prepared.review),
  );
  const afterCreateIds = await taskIds();
  result.replay = await boundedPublicExecution(prepared.intent.intent.id);
  assert.equal(result.replay.replayed, true);
  assert.deepEqual(result.replay.run, receipt.run);
  assert.deepEqual(await taskIds(), afterCreateIds);
  stage("risk-create-native-confirmation-creates-once-with-four-kind-lineage");

  await check();
  result.afterCreationStatus = await api("getGoalMonitoringStatus", {
    id: goalId,
  });
  assert.equal(result.afterCreationStatus.history[0].result.riskTaskCount, 1);
  result.afterCreationReview = await api("getRiskReview", {
    reviewId: result.afterCreationStatus.history[0].reviewId,
  });
  assert(
    result.afterCreationReview.evaluation.taskRefs.some(
      (ref) => ref.id === sourceTaskId,
    ),
  );
  assert(
    JSON.stringify(result.afterCreationReview.evaluation).includes(
      "OVERDUE_INCOMPLETE_TASK",
    ),
  );
  assert.equal(result.afterCreationStatus.goal.status, "active");
  assert.equal(result.afterCreationStatus.goal.completion, null);
  await window.screenshot({
    path: path.join(output, "risk-created-task.png"),
    fullPage: true,
  });
  result.status = "passed";
  stage("risk-created-task-does-not-resolve-the-original-overdue-risk");
}

module.exports = { exerciseRiskTaskCreation };
