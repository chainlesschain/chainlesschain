// Windows engineering acceptance on synthetic, isolated data. Build the actual
// main/preload and production renderer first. No approval or IPC implementation
// is replaced. The only direct business-row fixture write seeds an overdue date.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const { values } = parseArgs({
  options: {
    electron: { type: "string" },
    output: { type: "string" },
    workspace: { type: "boolean", default: false },
    overnight: { type: "boolean", default: false },
    "risk-create": { type: "boolean", default: false },
    "default-off": { type: "boolean", default: false },
    "modal-revocation": { type: "boolean", default: false },
  },
});
if (process.platform !== "win32" || !values.electron || !values.output)
  throw new Error(
    "Usage on Windows: node scripts/project-goal-native-journey.mjs --electron <exe> --output <new-directory>",
  );
const require = createRequire(import.meta.url);
const { _electron, expect } = require("@playwright/test");
const { clickNativeDialog } = require("./lib/project-goal-native-dialog.cjs");
const {
  observeGoalJourneyErrors,
  withGoalJourneyTimeout,
  summarizeGoalJourneyError,
  writeGoalJourneyEvidence,
} = require("./lib/project-goal-journey-observer.cjs");
const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.dirname(desktop);
const output = path.resolve(values.output);
fs.mkdirSync(output); // Refuse to overwrite an earlier evidence capture.
const profile = fs.mkdtempSync(
  path.join(fs.realpathSync.native(os.tmpdir()), "dmm-native-journey-"),
);
const evidence = {
  schema: "chainlesschain.dmm-native-goal-journey/v1",
  startedAt: new Date().toISOString(),
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceStatus: execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  platform: process.platform,
  release: os.release(),
  synthetic: true,
  scenario: values["default-off"] ? "default-off" : "explicit-opt-in",
  setupSeeded: true,
  realBusinessAcceptance: false,
  installedProductAcceptance: false,
  profileRetainedLocally: true,
  dialogs: [],
  stages: [],
  artifacts: Object.fromEntries(
    [
      "dist/main/index.js",
      "dist/main/task/project-goal-auth-session.js",
      "dist/main/llm/permanent-memory-manager.js",
      "dist/main/task/project-goal-feature-policy.js",
      "dist/preload/index.js",
      "dist/renderer/index.html",
    ].map((relative) => [
      relative,
      createHash("sha256")
        .update(fs.readFileSync(path.join(desktop, relative)))
        .digest("hex"),
    ]),
  ),
  runnerSha256: createHash("sha256")
    .update(fs.readFileSync(fileURLToPath(import.meta.url)))
    .digest("hex"),
  nativeDialogHelperSha256: createHash("sha256")
    .update(
      fs.readFileSync(
        new URL("./lib/project-goal-native-dialog.cjs", import.meta.url),
      ),
    )
    .digest("hex"),
};
function saveEvidence(terminal = false, required = true) {
  const saved = writeGoalJourneyEvidence(output, evidence, {
    terminal,
    required,
  });
  if (!saved) process.exitCode = 1;
  return saved;
}
function stage(name, detail = {}, required = true) {
  evidence.stages.push({ name, at: new Date().toISOString(), ...detail });
  saveEvidence(false, required);
  console.log(JSON.stringify({ stage: name, ...detail }));
}
fs.writeFileSync(
  path.join(profile, "initial-setup-config.json"),
  JSON.stringify({
    setupCompleted: true,
    completedAt: new Date().toISOString(),
    edition: "personal",
  }),
);
fs.writeFileSync(
  path.join(profile, "app-config.json"),
  JSON.stringify({ ui: { useWebShellExperimental: false } }),
);
const wrapper = path.join(profile, "main.cjs");
if (
  values.overnight &&
  (values.workspace ||
    values["default-off"] ||
    values["risk-create"] ||
    values["modal-revocation"])
)
  throw new Error("Overnight is a separate synthetic-clock journey");
const clockBootstrap = values.overnight
  ? `globalThis.__dmmJourneyClock=require(${JSON.stringify(path.join(desktop, "scripts/lib/project-goal-journey-clock.cjs"))}).installGoalJourneyClock('2026-11-11T13:50:00.000Z');`
  : "";
if (values.overnight) {
  evidence.clockMode = "synthetic-main-process-wall-clock-real-timers";
  evidence.realOvernightWallTimeAcceptance = false;
  evidence.clockHelperSha256 = createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(desktop, "scripts/lib/project-goal-journey-clock.cjs"),
      ),
    )
    .digest("hex");
}
fs.writeFileSync(
  wrapper,
  `${clockBootstrap}const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.disableHardwareAcceleration();app.on('browser-window-created',(_event,window)=>window.hide());require(${JSON.stringify(path.join(desktop, "dist/main/index.js"))});`,
);
const env = {
  ...process.env,
  NODE_ENV: "test",
  CHAINLESSCHAIN_WEB_SHELL: "0",
  CHAINLESSCHAIN_GRAPH_PROJECT_GOALS: "canonical",
  CHAINLESSCHAIN_PROJECT_GOALS: "1",
  CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION: "1",
  PROJECTS_ROOT_PATH: path.join(profile, "projects"),
  DEFAULT_USERNAME: "dmm-journey",
  DEFAULT_PASSWORD: randomUUID(),
};
delete env.ELECTRON_RUN_AS_NODE;
if (values["default-off"]) {
  if (values.workspace || values["risk-create"] || values["modal-revocation"])
    throw new Error("Default-off is a separate journey");
  delete env.CHAINLESSCHAIN_PROJECT_GOALS;
}
let app, window, log, nativePid;
function terminateOwnedApp() {
  // On Windows app.process() can be a cmd.exe launcher. Terminate the actual
  // test-owned browser process too, only while its launcher is still live.
  if (app?.process().exitCode === null) {
    if (nativePid) {
      try {
        process.kill(nativePid);
      } catch {
        // The owned native process may already have exited.
      }
    }
    app.process().kill();
  }
}
const watchdog = setTimeout(() => {
  evidence.status = "failed";
  evidence.watchdogExpired = true;
  process.exitCode = 1;
  saveEvidence(false, false);
  console.error("Native product journey exceeded 10 minutes");
  terminateOwnedApp();
}, 600000);
process.on("uncaughtExceptionMonitor", (error, origin) => {
  evidence.status = "failed";
  evidence.unexpectedFailure = { ...summarizeGoalJourneyError(error), origin };
  evidence.finishedAt = new Date().toISOString();
  try {
    saveEvidence(true, false);
  } catch {
    // Emergency observation must not prevent process termination.
  }
});
journey: try {
  stage("native-launch-requested");
  app = await _electron.launch({
    executablePath: path.resolve(values.electron),
    args: [wrapper, "--no-web-shell", `--user-data-dir=${profile}`],
    cwd: profile,
    env,
    timeout: 30000,
  });
  stage("native-launch-resolved");
  // Raw logs and the encrypted DB stay in the owned temporary profile; never
  // publish login material, keys, or environment-bearing application logs.
  log = fs.createWriteStream(path.join(profile, "application.log"));
  app.process().stdout?.on("data", (bytes) => log.write(bytes));
  app.process().stderr?.on("data", (bytes) => log.write(bytes));
  evidence.ipcErrors = observeGoalJourneyErrors(app.process(), {
    secrets: [env.DEFAULT_PASSWORD],
  });
  stage("native-main-pid-requested");
  const pid = await app.evaluate(() => process.pid); // Windows launcher PID differs.
  nativePid = pid;
  evidence.nativePid = pid;
  stage("native-main-pid-resolved");
  const isolatedWorkingDirectory = await app.evaluate(() => process.cwd());
  assert.equal(
    fs.realpathSync.native(isolatedWorkingDirectory),
    fs.realpathSync.native(profile),
  );
  evidence.isolatedWorkingDirectory = true;
  stage("native-first-window-requested");
  window = await app.firstWindow({ timeout: 180000 });
  stage("native-first-window-resolved");
  window.setDefaultTimeout(30000);
  evidence.versions = await app.evaluate(() => process.versions);
  await app.evaluate(({ BrowserWindow }, desktop) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(desktop + "/package.json");
    const auth = require(
      desktop + "/dist/main/task/project-goal-auth-session.js",
    );
    globalThis.__dmmJourneyDiagnostics = [];
    const record = (event, detail) =>
      globalThis.__dmmJourneyDiagnostics.push({
        event,
        detail,
        at: new Date().toISOString(),
      });
    auth.subscribeProjectGoalAuthChanges(() => record("auth-changed"));
    for (const candidate of BrowserWindow.getAllWindows()) {
      for (const event of [
        "did-start-navigation",
        "did-navigate-in-page",
        "render-process-gone",
        "destroyed",
      ])
        candidate.webContents.on(event, (_event, url) =>
          record(event, typeof url === "string" ? url : undefined),
        );
    }
  }, desktop);
  async function choose(
    locator,
    title,
    button,
    expectedText,
    beforeClick = null,
  ) {
    const [receipt] = await Promise.all([
      clickNativeDialog({ pid, title, button, expectedText, beforeClick }),
      locator.click(),
    ]);
    evidence.dialogs.push(receipt);
    return receipt;
  }
  const api = (method, input, namespace = "project") =>
    window.evaluate(
      async ({ method, input, namespace }) =>
        window.electronAPI[namespace][method](input),
      { method, input, namespace },
    );
  await window
    .locator('[data-testid="username-input"]')
    .waitFor({ state: "visible" });
  const did = await window.evaluate(
    async () =>
      (
        await window.electronAPI.did.createIdentity(
          { name: "DMM synthetic native journey" },
          { setAsDefault: true },
        )
      ).did,
  );
  assert.ok(did.startsWith("did:"));
  await window
    .locator('[data-testid="username-input"]')
    .fill(env.DEFAULT_USERNAME);
  await window
    .locator('[data-testid="password-input"]')
    .fill(env.DEFAULT_PASSWORD);
  await window.locator('[data-testid="login-button"]').click();
  await window
    .locator('[data-testid="login-container"]')
    .waitFor({ state: "hidden" });
  const project = await api("createQuick", {
    name: "DMM synthetic native journey",
    description: "Isolated engineering acceptance",
    projectType: "document",
    enable_git: false,
    userId: did,
  });
  assert.ok(project.id);
  evidence.projectId = project.id;
  await window.evaluate((id) => {
    window.location.hash = "#/projects/" + id;
  }, project.id);
  await window.locator('[data-testid="project-tasks-button"]').click();
  await app.evaluate(({ BrowserWindow }) => {
    for (const candidate of BrowserWindow.getAllWindows())
      if (candidate.webContents.getURL().includes("/dist/renderer/index.html"))
        candidate.showInactive();
  });
  stage("real-password-login-and-did");

  const form = window.locator('[data-testid="controlled-task-create"]');
  const description = "DMM synthetic overdue task";
  await form.locator('[data-testid="create-description"]').fill(description);
  await form.locator('[data-testid="preview-create"]').click();
  await form.locator('[data-testid="create-preview"]').waitFor();
  await choose(
    form.locator('[data-testid="execute-create"]'),
    "确认创建项目任务",
    "取消",
    description,
  );
  await expect(form).toContainText("用户已取消");
  assert.equal(
    (await api("listControlledTasks", { projectId: project.id }, "task")).tasks
      .length,
    0,
  );
  await form.locator('[data-testid="new-create-intent"]').click();
  await form.locator('[data-testid="create-description"]').fill(description);
  await form.locator('[data-testid="preview-create"]').click();
  await form.locator('[data-testid="create-preview"]').waitFor();
  await choose(
    form.locator('[data-testid="execute-create"]'),
    "确认创建项目任务",
    "确认创建",
    description,
  );
  await expect
    .poll(
      async () =>
        (await api("listControlledTasks", { projectId: project.id }, "task"))
          .tasks.length,
    )
    .toBe(1);
  const task = (
    await api("listControlledTasks", { projectId: project.id }, "task")
  ).tasks[0];
  evidence.taskId = task.id;
  assert.equal(
    (await api("readControlledTask", { taskId: task.id }, "task")).description,
    description,
  );
  evidence.createRuns = await api(
    "listControlledCreateRuns",
    { projectId: project.id },
    "task",
  );
  assert.equal(
    evidence.createRuns.runs.filter(
      (item) => (item.run ?? item).status === "succeeded",
    ).length,
    1,
  );
  stage("native-cancel-no-write-and-single-create");

  if (values["default-off"]) {
    await require("./lib/project-goal-default-off-journey.cjs").exerciseDefaultOff(
      {
        app,
        window,
        desktop,
        profile,
        output,
        projectId: project.id,
        taskId: task.id,
        evidence,
        stage,
      },
    );
    evidence.status = "passed";
    break journey;
  }

  // Synthetic input setup only: the product exposes description/create actions,
  // not a deadline edit. Bind to the actual trusted native DB in this temp profile.
  evidence.fixture = await app.evaluate(
    async (_, { desktop, profile, taskId, projectId, did }) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(desktop + "/package.json");
      const path = require("node:path");
      const manager = require(
        path.join(desktop, "dist/main/database.js"),
      ).getDatabase();
      const wrapper = manager.getDatabase();
      const db = wrapper.db;
      const fs = require("node:fs");
      if (!db?.open || typeof db.name !== "string")
        throw new Error("Native fixture database is not open");
      const nativePath = fs.realpathSync.native(db.name);
      const relative = path.relative(profile, nativePath);
      if (
        !relative ||
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        fs.realpathSync.native(wrapper.dbPath) !== nativePath
      )
        throw new Error("Fixture DB is not the owned open temporary native DB");
      const owner = db
        .prepare("SELECT user_id FROM projects WHERE id=?")
        .get(projectId);
      if (owner?.user_id !== did) throw new Error("Fixture owner differs");
      const Driver = require("better-sqlite3-multiple-ciphers");
      let withoutKey,
        noKeyReadRejected = false;
      try {
        withoutKey = new Driver(nativePath, {
          readonly: true,
          fileMustExist: true,
        });
        withoutKey.prepare("SELECT count(*) FROM sqlite_master").get();
      } catch (error) {
        if (!["SQLITE_NOTADB", "SQLITE_CORRUPT"].includes(error.code))
          throw error;
        noKeyReadRejected = true;
      } finally {
        withoutKey?.close();
      }
      const plaintextHeader = fs
        .readFileSync(nativePath)
        .subarray(0, 16)
        .equals(Buffer.from("SQLite format 3\0"));
      if (plaintextHeader || !noKeyReadRejected)
        throw new Error("Product fixture database encryption was not verified");
      const dueDate = Date.now() - 86400000;
      const result = db
        .prepare(
          "UPDATE project_tasks SET due_date=?,updated_at=? WHERE id=? AND project_id=? AND deleted=0",
        )
        .run(dueDate, Date.now(), taskId, projectId);
      if (result.changes !== 1)
        throw new Error("Fixture must affect exactly the owned synthetic task");
      return {
        kind: "synthetic-overdue-date",
        dueDate,
        rows: result.changes,
        nativeDbOwnedByTemporaryProfile: true,
        encryption: {
          plaintextHeader,
          noKeyReadRejected,
          driverVersion: require("better-sqlite3-multiple-ciphers/package.json")
            .version,
        },
      };
    },
    { desktop, profile, taskId: task.id, projectId: project.id, did },
  );
  if (values.overnight) {
    const helper = "./lib/project-goal-overnight-journey.cjs";
    evidence.overnightHelperSha256 = createHash("sha256")
      .update(fs.readFileSync(new URL(helper, import.meta.url)))
      .digest("hex");
    evidence.overnight = {
      synthetic: true,
      realBusinessAcceptance: false,
      realOvernightWallTimeAcceptance: false,
      status: "running",
    };
    await require(helper).exerciseGoalOvernight({
      window,
      api,
      expect,
      output,
      stage,
      result: evidence.overnight,
      advanceClock: (iso) =>
        app.evaluate(
          (_, stamp) => globalThis.__dmmJourneyClock.advanceTo(stamp),
          iso,
        ),
      readEvents: (goalId) =>
        app.evaluate(
          (_, input) => {
            const require = process
              .getBuiltinModule("module")
              .createRequire(input.desktop + "/package.json");
            const fs = require("node:fs"),
              path = require("node:path");
            const wrapper = require(
              path.join(input.desktop, "dist/main/database.js"),
            )
              .getDatabase()
              .getDatabase();
            const db = wrapper.db;
            if (!db?.open) throw new Error("Owned native database is not open");
            const relative = path.relative(
              fs.realpathSync.native(input.profile),
              fs.realpathSync.native(db.name),
            );
            if (
              !relative ||
              relative.startsWith("..") ||
              path.isAbsolute(relative)
            )
              throw new Error(
                "Database is outside the owned synthetic profile",
              );
            return db
              .prepare(
                "SELECT record_json FROM cc_project_goal_notice_events WHERE goal_id=? ORDER BY id LIMIT 10",
              )
              .all(input.goalId)
              .map((row) => {
                const event = JSON.parse(row.record_json);
                return {
                  id: event.id,
                  goalId: event.goalId,
                  kind: event.kind,
                  deliveryState: event.deliveryState,
                  dueAt: event.dueAt,
                  deliveredAt: event.deliveredAt,
                  sourceVersion: event.sourceVersion,
                };
              });
          },
          { desktop, profile, goalId },
        ),
    });
    evidence.status = "passed";
    break journey;
  }
  const panel = window.locator('[data-testid="project-goal-panel"]');
  await panel
    .locator('[data-testid="goal-objective"]')
    .fill("DMM native risk follow-up");
  await panel
    .locator('[data-testid="goal-max-runs"]')
    .fill(values["modal-revocation"] ? "60" : "20");
  await panel
    .locator('form[data-testid="create-goal"] button[type="submit"]')
    .click();
  const article = panel
    .locator("[data-goal-id]")
    .filter({ hasText: "DMM native risk follow-up" });
  await article.waitFor();
  const goalId = await article.getAttribute("data-goal-id");
  evidence.goalId = goalId;
  await article.locator('[data-testid="enable-goal-actions"]').click();
  await expect(
    article.locator('[data-testid="enable-goal-actions"]'),
  ).toHaveCount(0);
  await article.locator(":scope > .actions select").selectOption("60000");
  await article.locator('[data-testid="start-goal"]').click();
  await expect
    .poll(async () =>
      Boolean(
        (await api("getGoalMonitoringStatus", { id: goalId })).monitor?.enabled,
      ),
    )
    .toBe(true);
  await article.locator('[data-testid="check-goal"]').click();
  await expect(
    article.locator('[data-testid="goal-check-history"]'),
  ).toContainText("1 个信号");
  evidence.initialStatus = await api("getGoalMonitoringStatus", { id: goalId });
  const reviewId = evidence.initialStatus.history[0].reviewId;
  evidence.initialReview = await api("getRiskReview", { reviewId });
  assert.ok(
    JSON.stringify(evidence.initialReview).includes("OVERDUE_INCOMPLETE_TASK"),
  );
  assert.equal(
    (await api("readGoal", { id: goalId })).schema,
    "chainlesschain.goal/v2",
  );
  stage("canonical-goal-detects-overdue-risk");

  const proposal = article
    .locator('[data-testid="goal-actions-panel"] [data-proposal-id]')
    .filter({ hasText: "更新风险任务说明" });
  const proposalId = await proposal.getAttribute("data-proposal-id");
  const after = "DMM reviewed the overdue risk; deadline remains unresolved";
  await proposal.locator('[data-testid="goal-action-description"]').fill(after);
  await proposal.locator('[data-testid="prepare-goal-intent"]').click();
  await choose(
    proposal.locator('[data-testid="execute-goal-intent"]'),
    "确认目标建议：修改描述",
    "确认修改",
    after,
  );
  await expect
    .poll(
      async () =>
        (await api("readControlledTask", { taskId: task.id }, "task"))
          .description,
    )
    .toBe(after);
  const proposals = await api("listGoalProposals", { goalId });
  const saved = proposals.proposals.find(
    (item) => item.proposal.id === proposalId,
  );
  evidence.intent = await api("readGoalIntent", {
    intentId: saved.intent.intent.id,
  });
  assert.equal(evidence.intent.executionState, "succeeded");
  assert.equal(evidence.intent.intent.runId, evidence.intent.receipt.run.id);
  // An immediate scheduled occurrence and the explicit check may both have
  // valid reviews. The proposal's current observation may advance again after
  // preparation; the prepared intent retains the exact immutable source.
  const intentReviewId = evidence.intent.intent.reviewId;
  assert.equal(evidence.intent.intent.proposalId, proposalId);
  assert.equal(intentReviewId, saved.intent.intent.reviewId);
  evidence.intentSourceReview = await api("getRiskReview", {
    reviewId: intentReviewId,
  });
  assert.equal(
    evidence.intent.intent.reviewDigest,
    require(
      path.join(root, "packages/session-core/lib/business-object-contract.js"),
    ).digestBusinessObjectContent(evidence.intentSourceReview),
  );
  assert.ok(
    JSON.stringify(evidence.intentSourceReview).includes(
      "OVERDUE_INCOMPLETE_TASK",
    ),
  );
  assert.ok(
    (await api("getGoalMonitoringStatus", { id: goalId })).history.some(
      (item) => item.reviewId === intentReviewId,
    ),
  );
  evidence.lineage = await api("getRiskLineage", { reviewId: intentReviewId });
  const linked = evidence.lineage.actionRuns.find(
    (item) => item.run.id === evidence.intent.receipt.run.id,
  );
  assert.ok(linked);
  assert.deepEqual(
    linked.evidence.map((item) => item.kind),
    [
      "project-risk-review",
      "project-goal-intent",
      "local-user-confirmation",
      "sqlite-task-description-update",
    ],
  );
  assert.equal(evidence.intent.intent.goalId, goalId);
  assert.equal(evidence.lineage.review.id, intentReviewId);
  stage("goal-native-confirmation-and-persisted-action-lineage");

  const checks = (await api("getGoalMonitoringStatus", { id: goalId })).usage
    .checks;
  await article.locator('[data-testid="check-goal"]').click();
  await expect
    .poll(
      async () =>
        (await api("getGoalMonitoringStatus", { id: goalId })).usage.checks,
    )
    .toBeGreaterThan(checks);
  evidence.afterActionStatus = await api("getGoalMonitoringStatus", {
    id: goalId,
  });
  assert.equal(evidence.afterActionStatus.history[0].result.riskTaskCount, 1);
  const stillActive = await api("readGoal", { id: goalId });
  assert.equal(stillActive.status, "active");
  assert.equal(stillActive.completion, null);
  if (values["risk-create"]) {
    const helper = "./lib/project-goal-risk-create-journey.cjs";
    evidence.riskCreateHelperSha256 = createHash("sha256")
      .update(fs.readFileSync(new URL(helper, import.meta.url)))
      .digest("hex");
    evidence.riskCreate = {
      synthetic: true,
      realBusinessAcceptance: false,
      status: "running",
    };
    await require(helper).exerciseRiskTaskCreation({
      window,
      article,
      api,
      expect,
      choose,
      goalId,
      projectId: project.id,
      sourceTaskId: task.id,
      output,
      stage,
      result: evidence.riskCreate,
    });
  }
  if (values["modal-revocation"]) {
    const helper = "./lib/project-goal-modal-revocation-journey.cjs";
    evidence.modalRevocationHelperSha256 = createHash("sha256")
      .update(fs.readFileSync(new URL(helper, import.meta.url)))
      .digest("hex");
    evidence.modalRevocation = {
      synthetic: true,
      realBusinessAcceptance: false,
      status: "running",
      cases: [],
    };
    const authState = () =>
      app.evaluate((_, desktop) => {
        const require = process
          .getBuiltinModule("module")
          .createRequire(desktop + "/package.json");
        const auth = require(
          desktop + "/dist/main/task/project-goal-auth-session.js",
        );
        return {
          actorDid: auth.getProjectGoalActor(),
          generation: auth.getProjectGoalAuthGeneration(),
        };
      }, desktop);
    await require(helper).exerciseModalRevocation({
      window,
      article,
      api,
      expect,
      choose,
      authState,
      goalId,
      projectId: project.id,
      sourceTaskId: task.id,
      output,
      stage,
      result: evidence.modalRevocation,
      reauthenticate: async () => {
        await window.evaluate(() => window.electronAPI.auth.logout());
        const locked = await authState();
        assert.equal(locked.actorDid, null);
        const verified = await window.evaluate(
          async ({ username, password }) => {
            const result = await window.electronAPI.auth.verifyPassword(
              username,
              password,
            );
            return { success: result.success === true };
          },
          { username: env.DEFAULT_USERNAME, password: env.DEFAULT_PASSWORD },
        );
        assert.equal(verified.success, true);
        return {
          locked,
          restored: await authState(),
          via: "actual public auth.logout and auth.verifyPassword IPC",
        };
      },
    });
  }
  if (values.workspace) {
    const helper = "./lib/project-goal-workspace-journey.cjs";
    evidence.workspaceHelperSha256 = createHash("sha256")
      .update(fs.readFileSync(new URL(helper, import.meta.url)))
      .digest("hex");
    evidence.workspace = {
      synthetic: true,
      realBusinessAcceptance: false,
      status: "running",
    };
    await require(helper).exerciseGoalWorkspace({
      window,
      article,
      api,
      expect,
      goalId,
      projectId: project.id,
      output,
      stage,
      result: evidence.workspace,
    });
  }
  const acceptance = article.locator('[data-testid="goal-acceptance-panel"]');
  for (const [index, checked] of [false, true, false, false].entries())
    await acceptance
      .locator('input[type="checkbox"]')
      .nth(index)
      .setChecked(checked);
  await acceptance.locator('[data-testid="configure-acceptance"]').click();
  await acceptance.locator('[data-testid="complete-goal"]').click();
  await expect(acceptance).toContainText("该次条件未满足");
  evidence.acceptance = await api("getGoalAcceptanceStatus", { goalId });
  assert.equal(evidence.acceptance.reports[0].met, false);
  assert.equal(evidence.acceptance.goal.status, "active");
  stage("description-success-does-not-clear-risk-or-complete-goal");
  await article.locator('[data-testid="end-goal-follow-up"]').click();
  await expect
    .poll(async () => (await api("readGoal", { id: goalId })).status)
    .toBe("abandoned");
  evidence.stopped = await api("getGoalMonitoringStatus", { id: goalId });
  assert.equal(Boolean(evidence.stopped.monitor?.enabled), false);
  await window.screenshot({
    path: path.join(output, "stopped.png"),
    fullPage: true,
  });
  stage("follow-up-ended-observing-real-70-seconds");
  for (let i = 0; i < 7; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    if (i === 3) stage("stop-observation-40-seconds");
  }
  evidence.afterStopObservation = await api("getGoalMonitoringStatus", {
    id: goalId,
  });
  assert.equal(
    evidence.afterStopObservation.usage.checks,
    evidence.stopped.usage.checks,
  );
  assert.deepEqual(
    evidence.afterStopObservation.history,
    evidence.stopped.history,
  );
  const rejection = await window.evaluate(
    async ({ id, expectedRevision, requestId }) => {
      try {
        await window.electronAPI.project.checkGoalNow({
          id,
          expectedRevision,
          requestId,
        });
        return null;
      } catch (error) {
        return String(error);
      }
    },
    {
      id: goalId,
      expectedRevision: evidence.afterStopObservation.goal.revision,
      requestId: randomUUID(),
    },
  );
  assert.match(rejection ?? "", /GOAL_MONITOR_NOT_ACTIVE/);
  evidence.afterEndCheckRejection = rejection;
  evidence.status = "passed";
  stage("no-new-checks-after-real-scheduled-interval");
} catch (error) {
  evidence.status = "failed";
  evidence.error = summarizeGoalJourneyError(error);
  evidence.failurePhase = evidence.stages.at(-1)?.name || "startup";
  try {
    fs.writeFileSync(
      path.join(profile, "journey-error.log"),
      String(error.stack || error),
    );
    evidence.privateFailureDetailsRetained = true;
  } catch {
    // Retain the original failure if private diagnostic persistence fails.
  }
  process.exitCode = 1;
  saveEvidence(false, false);
  if (window && evidence.projectId) {
    evidence.failureGoalReadback = await window
      .evaluate(
        async ({ projectId }) => {
          try {
            const goals = await window.electronAPI.project.listGoals({
              projectId,
            });
            const statuses = [];
            for (const goal of goals.slice(0, 3)) {
              try {
                statuses.push(
                  await window.electronAPI.project.getGoalMonitoringStatus({
                    id: goal.id,
                  }),
                );
              } catch (error) {
                statuses.push({ id: goal.id, error: String(error) });
              }
            }
            return { goals, statuses };
          } catch (error) {
            return { error: String(error) };
          }
        },
        { projectId: evidence.projectId },
      )
      .catch((error) => ({ error: String(error) }));
  }
  if (window)
    await window
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  process.exitCode = 1;
  console.error(evidence.error);
} finally {
  saveEvidence(false, false);
  if (app)
    evidence.diagnostics = await withGoalJourneyTimeout(() =>
      app.evaluate(() => globalThis.__dmmJourneyDiagnostics),
    ).catch((error) => {
      evidence.status = "failed";
      evidence.diagnosticsError = { name: error.name, code: error.code };
      process.exitCode = 1;
      return null;
    });
  if (app) {
    try {
      stage("native-close-requested", {}, false);
      await withGoalJourneyTimeout(() => app.close(), 15000);
      stage("native-close-resolved", {}, false);
    } catch (error) {
      evidence.status = "failed";
      evidence.closeError = { name: error.name, code: error.code };
      process.exitCode = 1;
      terminateOwnedApp();
    }
  }
  clearTimeout(watchdog);
  log?.end();
  if (process.exitCode) evidence.status = "failed";
  evidence.finishedAt = new Date().toISOString();
  saveEvidence(true, false);
  console.log(JSON.stringify({ output, profile, status: evidence.status }));
}
