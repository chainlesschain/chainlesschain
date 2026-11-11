"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

// Real Vue, public preload IPC and the production background flush. The driver
// advances only its test-owned main-process wall clock, and reads DB metadata.
async function exerciseGoalOvernight({
  window,
  api,
  expect,
  output,
  stage,
  result,
  advanceClock,
  readEvents,
}) {
  const panel = window.locator('[data-testid="project-goal-panel"]');
  const objective = "DMM synthetic Shanghai overnight notification";
  await panel.locator('[data-testid="goal-objective"]').fill(objective);
  await panel.locator('[data-testid="goal-max-runs"]').fill("5");
  await panel
    .locator('form[data-testid="create-goal"] button[type="submit"]')
    .click();
  const article = panel
    .locator("[data-goal-id]")
    .filter({ hasText: objective });
  await article.waitFor();
  const goalId = await article.getAttribute("data-goal-id");
  result.goalId = goalId;
  const policy = article.locator('[data-testid="goal-notification-policy"]');
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
        (await api("readGoal", { id: goalId })).notificationPolicy.quietHours,
    )
    .toEqual({
      timeZone: "Asia/Shanghai",
      startMinute: 1320,
      endMinute: 480,
    });
  const notices = async () => {
    const response = await api("getGoals", { limit: 50 }, "notification");
    assert.equal(response.success, true);
    return response.notifications.filter((row) => {
      const reference =
        typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      return reference.goalId === goalId;
    });
  };
  result.startedAt = await advanceClock("2026-11-11T14:10:00.000Z");
  await article.locator('[data-testid="check-goal"]').click();
  await expect
    .poll(
      async () =>
        (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
    )
    .toBe(1);
  result.night = await readEvents(goalId);
  assert.equal(result.night.length, 1);
  const pending = result.night[0];
  assert.equal(pending.deliveryState, "pending");
  assert.equal(pending.dueAt, Date.parse("2026-11-12T00:00:00.000Z"));
  assert.deepEqual(await notices(), []);
  await window.screenshot({
    path: path.join(output, "overnight-quiet-pending.png"),
    fullPage: true,
  });
  stage("overnight-real-vue-policy-and-quiet-pending-metadata", { goalId });

  for (const [name, at] of [
    ["midnight", "2026-11-11T16:05:00.000Z"],
    ["beforeEnd", "2026-11-11T23:55:00.000Z"],
  ]) {
    await advanceClock(at);
    // Real background timer opportunities, with no direct flush/tick call.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result[name] = await readEvents(goalId);
    assert.deepEqual(result[name], result.night);
    assert.deepEqual(await notices(), []);
    assert.equal(
      (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
      1,
    );
    stage(`overnight-${name}-same-pending-id-no-extra-check`);
  }

  result.boundaryAt = await advanceClock("2026-11-12T00:00:00.000Z");
  await expect
    .poll(async () => (await notices()).length, { timeout: 30000 })
    .toBe(1);
  const delivered = (await notices())[0];
  assert.equal(delivered.id, pending.id);
  assert.equal(delivered.is_read, 0);
  result.morning = await readEvents(goalId);
  assert.equal(result.morning.length, 1);
  assert.equal(result.morning[0].deliveryState, "delivered");
  assert.equal(result.morning[0].id, pending.id);
  assert.equal(
    (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
    1,
  );
  stage("overnight-production-background-flush-at-quiet-end-once");

  const drawerContent = article.locator(
    "xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' ant-drawer-content ')]",
  );
  await drawerContent
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await window.locator(".notification-center .notification-trigger").click();
  const list = window.locator('section[aria-label="目标通知"]');
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: /^刷\s*新$/u }).click();
  const row = list.locator(`[data-notice-id="${pending.id}"]`);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "标记已读", exact: true }).click();
  await expect(row).toContainText("已读");
  await row.getByRole("button", { name: /目标状态有更新/ }).click();
  const target = window.locator('[data-testid="goal-notification-drawer"]');
  await expect(target).toBeVisible();
  await expect(target.locator(`[data-goal-id="${goalId}"]`)).toBeVisible();
  assert(window.url().includes(`goalId=${goalId}`));
  assert(window.url().includes(`goalNoticeId=${pending.id}`));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  result.finalNotices = await notices();
  assert.equal(result.finalNotices.length, 1);
  assert.equal(result.finalNotices[0].id, pending.id);
  assert.equal(result.finalNotices[0].is_read, 1);
  result.finalStatus = await api("getGoalMonitoringStatus", { id: goalId });
  assert.equal(result.finalStatus.usage.checks, 1);
  assert.equal(result.finalStatus.monitor?.enabled ?? false, false);
  await window.screenshot({
    path: path.join(output, "overnight-delivered-read-and-authorized-link.png"),
    fullPage: true,
  });
  result.status = "passed";
  stage("overnight-real-center-read-deep-link-and-dedup");
}

module.exports = { exerciseGoalOvernight };
