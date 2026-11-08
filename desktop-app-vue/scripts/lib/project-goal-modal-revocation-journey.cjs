"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

// The action starts in Vue and ends with a real Win32 native-confirmation click.
// Concurrent changes use real public IPC, explicitly not a pause-button click
// on the window blocked by its own modal. No host/auth/approval is replaced.
async function exerciseModalRevocation({
  window,
  article,
  api,
  expect,
  choose,
  authState,
  reauthenticate,
  goalId,
  projectId,
  sourceTaskId,
  output,
  stage,
  result,
}) {
  const tasks = async () => {
    const list = (await api("listControlledTasks", { projectId }, "task"))
      .tasks;
    return Promise.all(
      list
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((task) => api("readControlledTask", { taskId: task.id }, "task")),
    );
  };
  async function restoreThroughVue() {
    await window.locator('[data-testid="refresh-goals"]').click();
    await article.waitFor();
    const current = await api("readGoal", { id: goalId });
    if (
      !["task.create", "task.update-description"].every((type) =>
        current.allowedActionTypes.includes(type),
      )
    ) {
      await article.locator('[data-testid="enable-goal-actions"]').click();
      await expect
        .poll(
          async () =>
            (await api("readGoal", { id: goalId })).allowedActionTypes.length,
        )
        .toBe(2);
    }
    if ((await api("readGoal", { id: goalId })).status === "active") {
      await article.locator('[data-testid="stop-goal"]').click();
      await expect
        .poll(
          async () =>
            (await api("getGoalMonitoringStatus", { id: goalId }))
              .executionState,
        )
        .toBe("paused");
    }
    await window.locator('[data-testid="refresh-goals"]').click();
    await article.locator('[data-testid="resume-goal"]').click();
    await expect
      .poll(async () => (await api("readGoal", { id: goalId })).status)
      .toBe("active");
    await article.locator('[data-testid="start-goal"]').click();
    await expect
      .poll(
        async () =>
          (await api("getGoalMonitoringStatus", { id: goalId })).monitor
            ?.enabled,
      )
      .toBe(1);
    const checks = (await api("getGoalMonitoringStatus", { id: goalId })).usage
      .checks;
    await article.locator('[data-testid="check-goal"]').click();
    await expect
      .poll(
        async () =>
          (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
      )
      .toBeGreaterThan(checks);
    await article.locator('[data-testid="refresh-goal-actions"]').click();
  }
  // The preceding positive journey has already consumed its current suggestion.
  // A real pause/resume and check establish a fresh revision for this batch.
  await restoreThroughVue();
  for (const actionType of ["task.create", "task.update-description"]) {
    for (const change of [
      "pause",
      "revoke-action",
      "same-did-reauthentication",
    ]) {
      const id = `${actionType}:${change}`;
      const entry = {
        id,
        actionType,
        change,
        mutationVia: "actual public authenticated IPC",
        status: "running",
      };
      result.cases.push(entry);
      const available = (
        await api("listGoalProposals", { goalId, limit: 50 })
      ).proposals.filter(
        (item) =>
          item.current &&
          !item.intent &&
          !item.intentUnavailable &&
          item.proposal.actionType === actionType &&
          item.proposal.sourceTaskId === sourceTaskId,
      );
      assert.equal(
        available.length,
        1,
        `${id}: exactly one current suggestion required`,
      );
      const row = article.locator(
        `[data-proposal-id="${available[0].proposal.id}"]`,
      );
      const description = `DMM must refuse ${id} ${goalId}`;
      await row
        .locator('[data-testid="goal-action-description"]')
        .fill(description);
      await row.locator('[data-testid="prepare-goal-intent"]').click();
      await row.locator('[data-testid="execute-goal-intent"]').waitFor();
      const prepared = (
        await api("listGoalProposals", { goalId, limit: 50 })
      ).proposals.find((item) => item.proposal.id === available[0].proposal.id);
      assert(prepared?.intent);
      entry.prepared = await api("readGoalIntent", {
        intentId: prepared.intent.intent.id,
      });
      assert.equal(entry.prepared.intent.status, "prepared");
      assert.equal(
        entry.prepared.intent.preview.request.actionType,
        actionType,
      );
      entry.beforeTasks = await tasks();
      entry.beforeGoal = await api("readGoal", { id: goalId });
      entry.beforeAuth = await authState();
      assert.equal(entry.beforeAuth.actorDid, entry.beforeGoal.ownerRef);
      stage("real-modal-revocation-prepared", { case: id });
      const creation = actionType === "task.create";
      entry.nativeReceipt = await choose(
        row.locator('[data-testid="execute-goal-intent"]'),
        creation ? "确认目标建议：创建任务" : "确认目标建议：修改描述",
        creation ? "确认创建" : "确认修改",
        description,
        async (observed) => {
          assert.equal(observed.expectedTextVerified, true);
          entry.modalObserved = observed;
          entry.changeStartedAt = new Date().toISOString();
          // Every mutation here goes through the actual sandboxed preload.
          const current = await api("readGoal", { id: goalId });
          assert.equal(current.revision, entry.prepared.intent.goalRevision);
          if (change === "pause") {
            entry.changed = await api("stopGoalMonitoring", {
              id: goalId,
              expectedRevision: current.revision,
            });
            assert.equal(entry.changed.goal.status, "paused");
            assert.equal(entry.changed.monitor.enabled, 0);
          } else if (change === "revoke-action") {
            entry.changed = await api("reviseGoal", {
              id: goalId,
              expectedRevision: current.revision,
              patch: {
                allowedActionTypes: current.allowedActionTypes.filter(
                  (type) => type !== actionType,
                ),
              },
            });
            assert(!entry.changed.allowedActionTypes.includes(actionType));
          } else {
            entry.changed = await reauthenticate();
            assert.equal(entry.changed.locked.actorDid, null);
            assert.equal(
              entry.changed.restored.actorDid,
              entry.beforeAuth.actorDid,
            );
            assert(
              entry.changed.restored.generation > entry.beforeAuth.generation,
            );
          }
          entry.changeFinishedAt = new Date().toISOString();
          stage("real-modal-revocation-applied-before-native-click", {
            case: id,
          });
        },
      );
      assert.equal(
        entry.nativeReceipt.beforeConcurrentOperation.hwnd,
        entry.modalObserved.hwnd,
      );
      assert.equal(
        entry.nativeReceipt.afterConcurrentOperation.hwnd,
        entry.modalObserved.hwnd,
      );
      assert(
        Date.parse(entry.nativeReceipt.afterConcurrentOperation.observedAt) >=
          Date.parse(entry.changeFinishedAt),
      );
      await expect
        .poll(
          async () =>
            (
              await api("readGoalIntent", {
                intentId: entry.prepared.intent.id,
              })
            ).receipt?.run?.status,
        )
        .toBe("denied");
      entry.denied = await api("readGoalIntent", {
        intentId: entry.prepared.intent.id,
      });
      assert.equal(entry.denied.receipt.run.actionType, actionType);
      assert.equal(entry.denied.receipt.run.id, entry.denied.intent.runId);
      const approvals = entry.denied.receipt.evidence.filter((item) =>
        ["local-user-confirmation", "approval-gate-decision"].includes(
          item.kind,
        ),
      );
      assert.equal(approvals.length, 1);
      assert.equal(
        approvals[0].decision,
        change === "same-did-reauthentication" ? "deny" : "allow",
      );
      assert.equal(
        approvals[0].via,
        change === "same-did-reauthentication"
          ? "confirm-error"
          : "user-confirm",
      );
      assert(
        !entry.denied.receipt.evidence.some((item) =>
          ["sqlite-task-create", "sqlite-task-description-update"].includes(
            item.kind,
          ),
        ),
      );
      entry.afterTasks = await tasks();
      assert.deepEqual(entry.afterTasks, entry.beforeTasks);
      entry.afterGoal = await api("readGoal", { id: goalId });
      assert.equal(entry.afterGoal.completion, null);
      if (change === "same-did-reauthentication") {
        assert.equal(entry.afterGoal.revision, entry.beforeGoal.revision);
        assert.equal(
          entry.afterGoal.controlGeneration,
          entry.beforeGoal.controlGeneration,
        );
      } else {
        assert(entry.afterGoal.revision > entry.beforeGoal.revision);
        assert(
          entry.afterGoal.controlGeneration >
            entry.beforeGoal.controlGeneration,
        );
      }
      await window.screenshot({
        path: path.join(
          output,
          `modal-${creation ? "create" : "description"}-${change}-denied.png`,
        ),
        fullPage: true,
      });
      entry.status = "passed";
      stage("real-modal-confirmation-refused-without-task-write", {
        case: id,
        runId: entry.denied.receipt.run.id,
      });
      await restoreThroughVue();
    }
  }
  result.afterRecovery = await api("getGoalMonitoringStatus", { id: goalId });
  assert.equal(result.afterRecovery.goal.status, "active");
  assert.equal(result.afterRecovery.goal.completion, null);
  assert.equal(result.afterRecovery.history[0].result.riskTaskCount, 1);
  result.status = "passed";
}
module.exports = { exerciseModalRevocation };
