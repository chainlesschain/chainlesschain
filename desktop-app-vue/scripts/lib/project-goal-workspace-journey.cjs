"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

// Actual Vue controls and public preload APIs only. No body/authority/clock,
// notification projection or memory database fixture is injected here.
async function exerciseGoalWorkspace({
  window,
  article,
  api,
  expect,
  goalId,
  projectId,
  output,
  stage,
  result,
}) {
  const memory = article.locator('[data-testid="goal-memory-panel"]');
  const memories = () => api("listGoalMemories", { goalId, limit: 20 });
  const original = "DMM synthetic memory: an overdue deadline is not approval";
  const corrected =
    "DMM corrected execution note: independent acceptance is required";
  await memory
    .locator('[data-testid="memory-category"]')
    .selectOption("user-fact");
  await memory.locator('[data-testid="memory-content"]').fill(original);
  await memory.locator('[data-testid="save-memory"]').click();
  await expect(memory.locator('[data-testid="memory-body"]')).toHaveText(
    original,
  );
  result.created = await memories();
  const first = result.created.items.find(
    (item) => item.record?.content === original,
  );
  assert(first);
  assert.equal(first.grantState, "active");
  assert.equal(first.record.category, "user-fact");
  const firstRow = memory.locator(`[data-memory-id="${first.memoryId}"]`);
  await firstRow.getByRole("button", { name: "修正", exact: true }).click();
  await memory
    .locator('[data-testid="memory-category"]')
    .selectOption("execution-note");
  await memory.locator('[data-testid="memory-content"]').fill(corrected);
  await memory.locator('[data-testid="save-memory"]').click();
  await expect(memory.locator('[data-testid="memory-body"]')).toHaveText(
    corrected,
  );
  result.corrected = await memories();
  const successor = result.corrected.items.find(
    (item) => item.record?.content === corrected,
  );
  assert(successor);
  assert.notEqual(successor.memoryId, first.memoryId);
  assert.equal(successor.record.category, "execution-note");
  assert.equal(
    result.corrected.items.find((item) => item.memoryId === first.memoryId)
      .record,
    null,
  );
  stage("workspace-memory-create-and-correct-through-vue");
  const successorRow = memory.locator(
    `[data-memory-id="${successor.memoryId}"]`,
  );
  await successorRow.locator('[data-testid="revoke-memory"]').click();
  await expect(successorRow).toContainText("使用权已撤销");
  await expect(memory.locator('[data-testid="memory-body"]')).toHaveCount(0);
  result.revoked = await memories();
  const revoked = result.revoked.items.find(
    (item) => item.memoryId === successor.memoryId,
  );
  assert.equal(revoked.grantState, "revoked");
  assert.equal(revoked.record, null);
  await successorRow.locator('[data-testid="delete-memory"]').click();
  await successorRow.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    (await memories()).items.find(
      (item) => item.memoryId === successor.memoryId,
    ).grantState,
    "revoked",
  );
  await successorRow.locator('[data-testid="delete-memory"]').click();
  await successorRow.locator('[data-testid="confirm-memory-delete"]').click();
  await expect(successorRow).toContainText("读取已阻断");
  result.deleted = await memories();
  const deleted = result.deleted.items.find(
    (item) => item.memoryId === successor.memoryId,
  );
  assert.equal(deleted.grantState, "deleted");
  assert.equal(deleted.record, null);
  result.operations = await api("listGoalMemoryOperations", {
    goalId,
    limit: 20,
  });
  assert.deepEqual(result.operations.items.map((item) => item.type).sort(), [
    "correct",
    "create",
    "delete",
    "revoke",
  ]);
  assert(result.operations.items.every((item) => item.status === "complete"));
  assert(!JSON.stringify(result.operations).includes(original));
  assert(!JSON.stringify(result.operations).includes(corrected));
  stage(
    "workspace-memory-revoke-cancel-delete-and-persisted-body-free-history",
  );

  const policy = article.locator('[data-testid="goal-notification-policy"]');
  const notices = async () => {
    const response = await api("getGoals", { limit: 50 }, "notification");
    assert.equal(response.success, true);
    return response.notifications.filter((row) => {
      const data =
        typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      return data.goalId === goalId;
    });
  };
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
  };
  await check();
  await expect.poll(async () => (await notices()).length).toBeGreaterThan(0);
  result.noticeBeforeRead = await notices();
  const notice = result.noticeBeforeRead[0];
  assert.equal(notice.is_read, 0);
  const center = window.locator(".notification-center");
  await center.locator(".notification-trigger").click();
  const list = window.locator('section[aria-label="目标通知"]');
  await list.getByRole("button", { name: "刷新", exact: true }).click();
  const noticeRow = list.locator(`[data-notice-id="${notice.id}"]`);
  await expect(noticeRow).toBeVisible();
  await noticeRow
    .getByRole("button", { name: "标记已读", exact: true })
    .click();
  await expect(noticeRow).toContainText("已读");
  result.noticeAfterRead = await notices();
  assert.equal(
    result.noticeAfterRead.find((row) => row.id === notice.id).is_read,
    1,
  );
  await noticeRow.getByRole("button", { name: /目标状态有更新/ }).click();
  const drawer = window.locator('[data-testid="goal-notification-drawer"]');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(`[data-goal-id="${goalId}"]`)).toBeVisible();
  assert(window.url().includes(`goalId=${goalId}`));
  assert(window.url().includes(`goalNoticeId=${notice.id}`));
  result.opened = await api("openGoal", notice.id, "notification");
  assert.equal(result.opened.success, true);
  assert.equal(result.opened.target.goalId, goalId);
  assert.equal(result.opened.target.projectId, projectId);
  await window.screenshot({
    path: path.join(output, "workspace-notice-open.png"),
    fullPage: true,
  });
  await drawer
    .locator("xpath=ancestor::div[contains(@class,'ant-drawer-content')]")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(drawer).toHaveCount(0);
  const centerClose = window
    .locator(".ant-drawer-content")
    .filter({ has: list })
    .getByRole("button", { name: "Close", exact: true });
  if (await centerClose.isVisible()) await centerClose.click();
  stage("workspace-notice-real-center-mark-read-and-authorized-deep-link");

  const snapshot = await notices();
  await check();
  result.noticeAfterRepeat = await notices();
  assert.deepEqual(
    result.noticeAfterRepeat.map((row) => row.id).sort(),
    snapshot.map((row) => row.id).sort(),
  );
  assert.equal(
    result.noticeAfterRepeat.find((row) => row.id === notice.id).is_read,
    1,
  );
  await policy
    .locator('[data-testid="goal-notification-mode"]')
    .selectOption("silent");
  await policy.locator('[data-testid="save-goal-notification-policy"]').click();
  await expect
    .poll(
      async () =>
        (await api("readGoal", { id: goalId })).notificationPolicy.mode,
    )
    .toBe("silent");
  result.silentPolicy = (
    await api("readGoal", { id: goalId })
  ).notificationPolicy;
  const beforeSilentCheck = await notices();
  await check();
  result.silentStatus = await api("getGoalMonitoringStatus", { id: goalId });
  result.silentNotices = await notices();
  // Silent policy suppresses new delivery; historical authorized notices may
  // remain readable. Do not equate silence with deletion of existing evidence.
  assert.deepEqual(
    result.silentNotices.map((row) => row.id).sort(),
    beforeSilentCheck.map((row) => row.id).sort(),
  );
  assert.equal(result.silentStatus.history[0].result.riskTaskCount, 1);
  await policy
    .locator('[data-testid="goal-notification-mode"]')
    .selectOption("changes-only");
  await policy
    .locator('[data-testid="goal-notification-quiet-enabled"]')
    .check();
  await policy
    .locator('[data-testid="goal-notification-time-zone"]')
    .fill("Asia/Shanghai");
  await policy.locator('[data-testid="goal-notification-start"]').fill("22:00");
  await policy.locator('[data-testid="goal-notification-end"]').fill("08:00");
  await policy.locator('[data-testid="save-goal-notification-policy"]').click();
  await expect
    .poll(
      async () =>
        (await api("readGoal", { id: goalId })).notificationPolicy.mode,
    )
    .toBe("changes-only");
  result.quietHoursPolicy = (
    await api("readGoal", { id: goalId })
  ).notificationPolicy;
  assert.deepEqual(result.quietHoursPolicy.quietHours, {
    timeZone: "Asia/Shanghai",
    startMinute: 1320,
    endMinute: 480,
  });
  // Verify persistence and UI round-trip, without changing the wall clock or
  // claiming this run observed a real overnight delivery boundary.
  await article.locator('[data-testid="refresh-memories"]').click();
  await expect(memory.locator('[data-testid="memory-body"]')).toHaveCount(0);
  result.finalGoal = await api("readGoal", { id: goalId });
  assert.equal(result.finalGoal.status, "active");
  assert.equal(result.finalGoal.completion, null);
  await window.screenshot({
    path: path.join(output, "workspace-memory-notifications.png"),
    fullPage: true,
  });
  stage("workspace-notice-dedup-silent-checks-and-quiet-policy-persistence");
  result.status = "passed";
  return result;
}

module.exports = { exerciseGoalWorkspace };
