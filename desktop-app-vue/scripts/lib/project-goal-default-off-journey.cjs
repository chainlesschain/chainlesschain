"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

/** Actual product window and IPC. Read-only main-process probes independently
 * verify the startup environment and absence of background goal storage. */
async function exerciseDefaultOff({
  app,
  window,
  desktop,
  profile,
  output,
  projectId,
  taskId,
  evidence,
  stage,
}) {
  await window
    .locator('[data-testid="project-goal-panel"]')
    .waitFor({ state: "hidden" });
  const feature = await window.evaluate(() =>
    window.electronAPI.project.getGoalFeatureStatus(),
  );
  assert.deepEqual(feature, { enabled: false, startupOptInRequired: true });
  const probes = await window.evaluate(
    async ({ projectId }) => {
      const api = window.electronAPI.project;
      const results = [];
      for (const [method, input] of [
        ["createGoal", { projectId, objective: "Must be refused while off" }],
        ["listGoals", { projectId }],
        [
          "checkGoalNow",
          { id: "disabled", expectedRevision: 1, requestId: "off-check" },
        ],
        ["openGoalCliConnection", { goalRef: {} }],
      ]) {
        try {
          await api[method](input);
          results.push({ method, error: null });
        } catch (error) {
          results.push({ method, error: String(error) });
        }
      }
      return results;
    },
    { projectId },
  );
  for (const probe of probes)
    assert.match(probe.error ?? "", /GOAL_FEATURE_DISABLED/);
  const inspect = () =>
    app.evaluate(
      async (_, { desktop, profile, projectId, taskId }) => {
        const require = process
          .getBuiltinModule("module")
          .createRequire(desktop + "/package.json");
        const fs = require("node:fs"),
          path = require("node:path");
        const manager = require(
          path.join(desktop, "dist/main/database.js"),
        ).getDatabase();
        const db = manager.getDatabase().db;
        const feature = require(
          path.join(desktop, "dist/main/task/project-goal-feature-policy.js"),
        ).projectGoalFeaturePolicy;
        return {
          startupFlagAbsent:
            process.env.CHAINLESSCHAIN_PROJECT_GOALS === undefined,
          feature: feature.status(),
          goalTables: db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name IN ('cc_project_goals','cc_organization_project_goals') ORDER BY name",
            )
            .all(),
          personalSchedulerDirectory: fs.existsSync(
            path.join(profile, "goal-monitoring"),
          ),
          organizationSchedulerDirectory: fs.existsSync(
            path.join(profile, "organization-goal-monitoring"),
          ),
          task: db
            .prepare(
              "SELECT id,description,status FROM project_tasks WHERE id=? AND project_id=?",
            )
            .get(taskId, projectId),
          taskCount: db
            .prepare(
              "SELECT count(*) AS n FROM project_tasks WHERE project_id=?",
            )
            .get(projectId).n,
        };
      },
      { desktop, profile, projectId, taskId },
    );
  const before = await inspect();
  assert.equal(before.startupFlagAbsent, true);
  assert.equal(before.feature.enabled, false);
  assert.deepEqual(before.goalTables, []);
  assert.equal(before.personalSchedulerDirectory, false);
  assert.equal(before.organizationSchedulerDirectory, false);
  assert.equal(before.task.id, taskId);
  assert.equal(before.taskCount, 1);
  const startedAt = Date.now();
  stage("default-off-observing-real-70-seconds");
  for (let i = 0; i < 7; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    if (i === 3) stage("default-off-observation-40-seconds");
  }
  const after = await inspect();
  assert.deepEqual(after, before);
  evidence.defaultOff = {
    helperSha256: require("node:crypto")
      .createHash("sha256")
      .update(require("node:fs").readFileSync(__filename))
      .digest("hex"),
    feature,
    probes,
    before,
    after,
    observationMs: Date.now() - startedAt,
  };
  await window.screenshot({
    path: path.join(output, "default-off-task-workspace.png"),
    fullPage: true,
  });
  stage("default-off-preserves-real-task-workspace-without-goal-dispatch");
}
module.exports = { exerciseDefaultOff };
