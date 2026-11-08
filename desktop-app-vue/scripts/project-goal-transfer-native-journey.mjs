// Actual Windows file pickers and confirmations, isolated synthetic data only.
// Build main/preload and the production Vue renderer before running this file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync, spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { _electron, expect } = require("@playwright/test");
const {
  observeGoalJourneyErrors,
} = require("./lib/project-goal-journey-observer.cjs");
const {
  chooseTransferFile,
  confirmTransfer,
} = require("./lib/project-goal-transfer-native.cjs");
const { values } = parseArgs({
  options: { electron: { type: "string" }, output: { type: "string" } },
});
if (process.platform !== "win32" || !values.electron || !values.output)
  throw new Error(
    "Usage on Windows: --electron <exe> --output <new directory>",
  );
const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.dirname(desktop);
const output = path.resolve(values.output);
fs.mkdirSync(output);
const profile = fs.mkdtempSync(
  path.join(fs.realpathSync.native(os.tmpdir()), "dmm-native-transfer-"),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const evidence = {
  schema: "chainlesschain.dmm-native-transfer-journey/v1",
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceStatus: execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  startedAt: new Date().toISOString(),
  platform: process.platform,
  release: os.release(),
  synthetic: true,
  setupSeeded: true,
  realBusinessAcceptance: false,
  installedProductAcceptance: false,
  runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  native: [],
  cli: [],
  stages: [],
};
function stage(name) {
  evidence.stages.push({ name, at: new Date().toISOString() });
  console.log(JSON.stringify({ stage: name }));
}
const cliHome = path.join(profile, "cli-home");
const env = {
  ...process.env,
  NODE_ENV: "test",
  CHAINLESSCHAIN_WEB_SHELL: "0",
  CHAINLESSCHAIN_GRAPH_PROJECT_GOALS: "canonical",
  CHAINLESSCHAIN_PROJECT_GOALS: "1",
  CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION: "1",
  PROJECTS_ROOT_PATH: path.join(profile, "projects"),
  DEFAULT_USERNAME: "dmm-transfer",
  DEFAULT_PASSWORD: randomUUID(),
};
delete env.ELECTRON_RUN_AS_NODE;
const cliEnv = {
  ...process.env,
  CHAINLESSCHAIN_HOME: cliHome,
  CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(profile, "cli-security"),
  NO_COLOR: "1",
};
delete cliEnv.ELECTRON_RUN_AS_NODE;
delete cliEnv.FORCE_COLOR;
function cli(args, expectedCode = 0) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "packages/cli/bin/chainlesschain.js"), ...args],
    {
      cwd: root,
      env: cliEnv,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  evidence.cli.push({
    args,
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedCode, result.stderr || result.stdout);
  return expectedCode === 0
    ? JSON.parse(result.stdout)
    : result.stderr + result.stdout;
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
const main = path.join(profile, "main.cjs");
fs.writeFileSync(
  main,
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.disableHardwareAcceleration();app.on('browser-window-created',(_e,w)=>w.hide());require(${JSON.stringify(path.join(desktop, "dist/main/index.js"))});`,
);
let app, window, nativePid, log;
function terminate() {
  if (app?.process().exitCode === null) {
    if (nativePid) {
      try {
        process.kill(nativePid);
      } catch {}
    }
    app.process().kill();
  }
}
const watchdog = setTimeout(() => {
  console.error("Native transfer journey exceeded 10 minutes");
  terminate();
}, 600000);
try {
  app = await _electron.launch({
    executablePath: path.resolve(values.electron),
    args: [main, "--no-web-shell", `--user-data-dir=${profile}`],
    cwd: desktop,
    env,
    timeout: 30000,
  });
  nativePid = await app.evaluate(() => process.pid);
  log = fs.createWriteStream(path.join(profile, "application.log"));
  app.process().stdout?.on("data", (bytes) => log.write(bytes));
  app.process().stderr?.on("data", (bytes) => log.write(bytes));
  evidence.ipcErrors = observeGoalJourneyErrors(app.process(), {
    secrets: [env.DEFAULT_PASSWORD],
  });
  window = await app.firstWindow({ timeout: 180000 });
  window.setDefaultTimeout(30000);
  evidence.versions = await app.evaluate(() => process.versions);
  const api = (method, input) =>
    window.evaluate(
      async ({ method, input }) => window.electronAPI.project[method](input),
      { method, input },
    );
  await window
    .locator('[data-testid="username-input"]')
    .waitFor({ state: "visible" });
  const did = await window.evaluate(
    async () =>
      (
        await window.electronAPI.did.createIdentity(
          { name: "DMM synthetic transfer identity" },
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
    name: "DMM synthetic transfer project",
    description: "Temporary native GUI transfer acceptance",
    projectType: "document",
    enable_git: false,
    userId: did,
  });
  assert.ok(project.id);
  evidence.projectId = project.id;
  await window.evaluate((id) => {
    location.hash = "#/projects/" + id;
  }, project.id);
  await window.locator('[data-testid="project-tasks-button"]').click();
  await app.evaluate(({ BrowserWindow }) => {
    for (const candidate of BrowserWindow.getAllWindows())
      if (candidate.webContents.getURL().includes("/dist/renderer/index.html"))
        candidate.showInactive();
  });
  const panel = window.locator('[data-testid="goal-transfer-panel"]');
  await panel.waitFor();
  // Prove that input updates IFileDialog's actual selection before any business
  // IPC may save a file. A hidden legacy Edit can echo text yet retain defaults.
  const probeFile = path.join(profile, "picker-probe-selected.json");
  const [probeNative, probeResult] = await Promise.all([
    chooseTransferFile({
      pid: nativePid,
      title: "导出 CLI 目标导入凭据",
      file: probeFile,
      ownedRoot: profile,
      mode: "save",
    }),
    app.evaluate(
      async ({ dialog, BrowserWindow }, file) =>
        dialog.showSaveDialog(
          BrowserWindow.getAllWindows().find((candidate) =>
            candidate.webContents
              .getURL()
              .includes("/dist/renderer/index.html"),
          ),
          {
            title: "导出 CLI 目标导入凭据",
            defaultPath: file,
            filters: [{ name: "JSON", extensions: ["json"] }],
          },
        ),
      path.join(profile, "picker-probe-wrong-default.json"),
    ),
  ]);
  assert.equal(probeResult.canceled, false);
  assert.equal(probeResult.filePath, probeFile);
  evidence.pickerProbe = {
    native: probeNative,
    actualSelectedExpectedPath: true,
    changedDefaultFilename: true,
    businessFileWritten: false,
  };
  const openProbeFile = path.join(profile, "picker-probe-existing.json");
  fs.writeFileSync(openProbeFile, "{}\n");
  const [openProbeNative, openProbeResult] = await Promise.all([
    chooseTransferFile({
      pid: nativePid,
      title: "选择 CLI 目标移交文件",
      file: openProbeFile,
      ownedRoot: profile,
      mode: "open",
    }),
    app.evaluate(
      async ({ dialog, BrowserWindow }, directory) =>
        dialog.showOpenDialog(
          BrowserWindow.getAllWindows().find((candidate) =>
            candidate.webContents
              .getURL()
              .includes("/dist/renderer/index.html"),
          ),
          {
            title: "选择 CLI 目标移交文件",
            defaultPath: directory,
            properties: ["openFile"],
            filters: [{ name: "JSON", extensions: ["json"] }],
          },
        ),
      profile,
    ),
  ]);
  assert.equal(openProbeResult.canceled, false);
  assert.deepEqual(openProbeResult.filePaths, [openProbeFile]);
  evidence.pickerProbe.open = {
    native: openProbeNative,
    actualSelectedExpectedPath: true,
    syntheticInputFixture: true,
  };
  const transfers = () =>
    api("listGoalTransfers", { projectId: project.id, afterId: "" });
  const goals = () => api("listGoals", { projectId: project.id });
  async function nativeFlow(
    locator,
    pickerTitle,
    file,
    mode,
    confirmTitle,
    button,
    expectedText,
  ) {
    const [picked, confirmed] = await Promise.all([
      chooseTransferFile({
        pid: nativePid,
        title: pickerTitle,
        file,
        ownedRoot: profile,
        mode,
      }),
      confirmTransfer({
        pid: nativePid,
        title: confirmTitle,
        button,
        expectedText,
      }),
      locator.click(),
    ]);
    evidence.native.push(picked, confirmed);
    await expect(
      panel.locator('[data-testid="goal-transfer-target"]'),
    ).toBeEnabled(); // Also settles a refused operation whose record row was cleared.
  }
  stage("real-password-login-and-owned-project");
  const source = cli([
    "goal",
    "set",
    "DMM CLI source for actual native handoff",
    "--kr",
    "Keep the original source bytes",
    "--kr",
    "Do not inherit project permissions",
    "--json",
  ]);
  const sourceFile = path.join(cliHome, "goals", source.id + ".json");
  const originalBytes = fs.readFileSync(sourceFile);
  evidence.source = source;
  evidence.originalSha256 = hash(originalBytes);
  const targetFile = path.join(profile, "target.json");
  const transferFile = path.join(profile, "transfer.json");
  const cancellationFile = path.join(profile, "cancellation.json");
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-target"]'),
    "导出 CLI 目标导入凭据",
    targetFile,
    "save",
    "准备 CLI 目标移交",
    "取消",
    project.id,
  );
  assert.equal(fs.existsSync(targetFile), false);
  assert.equal((await transfers()).length, 0);
  stage("native-export-cancel-no-file-or-target");
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-target"]'),
    "导出 CLI 目标导入凭据",
    targetFile,
    "save",
    "准备 CLI 目标移交",
    "导出导入凭据",
    project.id,
  );
  await expect(panel).toContainText("项目导入凭据已保存");
  const target = JSON.parse(fs.readFileSync(targetFile, "utf8"));
  assert.equal(target.projectRef.id, project.id);
  assert.equal(target.ownerRef, did);
  assert.equal((await transfers()).length, 1);
  evidence.target = target;
  const frozen = cli([
    "goal",
    "transfer-to-project",
    source.id,
    "--target",
    targetFile,
    "--output",
    transferFile,
    "--revision",
    String(source.revision),
    "--confirm-transfer",
    "--json",
  ]);
  evidence.frozen = frozen;
  assert.equal(frozen.state, "frozen");
  assert.equal(fs.existsSync(sourceFile), false);
  assert.equal(
    hash(fs.readFileSync(frozen.backupFile)),
    evidence.originalSha256,
  );
  const packet = JSON.parse(fs.readFileSync(transferFile, "utf8"));
  assert.equal(hash(Buffer.from(packet.backup)), evidence.originalSha256);
  assert.match(
    cli(["goal", "progress", source.id, "--pct", "10"], 1),
    /GOAL_TRANSFER_FROZEN/,
  );
  stage("real-cli-frozen-with-exact-backup-and-write-rejection");

  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-import"]'),
    "选择 CLI 目标移交文件",
    transferFile,
    "open",
    "导入 CLI 目标",
    "取消",
    source.objective,
  );
  assert.equal((await transfers())[0].state, "prepared");
  assert.equal((await goals()).length, 0);
  assert.equal(fs.existsSync(sourceFile), false);
  stage("native-import-cancel-does-not-write-or-unfreeze");
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-import"]'),
    "选择 CLI 目标移交文件",
    transferFile,
    "open",
    "导入 CLI 目标",
    "导入并保存映射与备份",
    source.objective,
  );
  await expect(panel).toContainText("新导入目标保持暂停");
  const record = (await transfers())[0];
  assert.equal(record.state, "imported");
  assert.equal(record.source.id, source.id);
  assert.equal(record.source.revision, source.revision);
  assert.equal(record.source.digest, packet.source.digest);
  const imported = await api("readGoal", { id: record.goalRef.id });
  evidence.imported = { record, goal: imported };
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.status, "paused");
  assert.equal(imported.completion, null);
  assert.equal(imported.ownerRef, did);
  assert.equal(imported.objective, source.objective);
  assert.deepEqual(imported.keyResults, source.keyResults);
  for (const field of [
    "allowedActionTypes",
    "authorizationRefs",
    "memoryRefs",
    "triggerRefs",
  ])
    assert.deepEqual(imported[field], []);
  assert.equal((await goals()).length, 1);
  await expect(window.locator(`[data-goal-id="${imported.id}"]`)).toContainText(
    source.objective,
  );
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-import"]'),
    "选择 CLI 目标移交文件",
    transferFile,
    "open",
    "导入 CLI 目标",
    "导入并保存映射与备份",
    source.objective,
  );
  assert.equal((await goals()).length, 1);
  assert.equal((await transfers())[0].goalRef.id, imported.id);
  stage("native-import-persists-paused-unprivileged-goal-and-deduplicates");
  const row = panel.locator("li").filter({ hasText: target.id });
  await nativeFlow(
    row.locator('[data-testid="goal-transfer-cancel"]'),
    "保存 CLI 目标回退回执",
    cancellationFile,
    "save",
    "作废目标移交",
    "取消",
    target.id,
  );
  assert.equal(fs.existsSync(cancellationFile), false);
  assert.equal((await transfers())[0].state, "imported");
  assert.equal((await goals()).length, 1);
  await nativeFlow(
    row.locator('[data-testid="goal-transfer-cancel"]'),
    "保存 CLI 目标回退回执",
    cancellationFile,
    "save",
    "作废目标移交",
    "作废并导出回退回执",
    target.id,
  );
  await expect(panel).toContainText("签名回退回执已保存");
  assert.equal((await goals()).length, 0);
  evidence.cancelled = (await transfers())[0];
  assert.equal(evidence.cancelled.state, "cancelled");
  assert.equal(fs.existsSync(sourceFile), false);
  const signed = JSON.parse(fs.readFileSync(cancellationFile, "utf8"));
  evidence.cancellation = signed;
  const forgedFile = path.join(profile, "forged-cancellation.json");
  const forged = {
    ...signed,
    signature:
      (signed.signature[0] === "A" ? "B" : "A") + signed.signature.slice(1),
  };
  fs.writeFileSync(forgedFile, JSON.stringify(forged));
  const rejected = cli(
    [
      "goal",
      "restore-transfer",
      source.id,
      "--cancellation",
      forgedFile,
      "--json",
    ],
    1,
  );
  assert.match(rejected, /GOAL_TRANSFER_CANCELLATION_INVALID/);
  assert.equal(fs.existsSync(sourceFile), false);
  stage("native-cancellation-persists-before-cli-restore-and-rejects-forgery");
  evidence.restored = cli([
    "goal",
    "restore-transfer",
    source.id,
    "--cancellation",
    cancellationFile,
    "--json",
  ]);
  assert.equal(evidence.restored.state, "restored");
  const restoredBytes = fs.readFileSync(sourceFile);
  evidence.restoredSha256 = hash(restoredBytes);
  assert.deepEqual(restoredBytes, originalBytes);
  assert.deepEqual(cli(["goal", "show", source.id, "--json"]), source);
  assert.equal(
    hash(fs.readFileSync(frozen.backupFile)),
    evidence.originalSha256,
  );
  assert.equal((await transfers())[0].state, "cancelled");
  assert.equal((await goals()).length, 0);
  evidence.roundTripGoalCount = 0;
  await window.screenshot({
    path: path.join(output, "restored.png"),
    fullPage: true,
  });
  stage("real-cli-restores-original-bytes-and-native-history-remains");
  const reexportFile = path.join(profile, "cancellation-reexport.json");
  await nativeFlow(
    row.locator('[data-testid="goal-transfer-cancel"]'),
    "保存 CLI 目标回退回执",
    reexportFile,
    "save",
    "作废目标移交",
    "作废并导出回退回执",
    target.id,
  );
  assert.deepEqual(
    fs.readFileSync(reexportFile),
    fs.readFileSync(cancellationFile),
  );
  evidence.reexportedCancellationSha256 = hash(fs.readFileSync(reexportFile));
  assert.equal(hash(fs.readFileSync(sourceFile)), evidence.originalSha256);
  stage("native-reexports-the-same-durable-signed-receipt");

  // A second independent synthetic source exercises refusal after real UI
  // revision. It intentionally remains frozen/imported in the temporary profile.
  const guardedSource = cli([
    "goal",
    "set",
    "DMM changed target must not roll back",
    "--json",
  ]);
  const guardedSourceFile = path.join(
    cliHome,
    "goals",
    guardedSource.id + ".json",
  );
  const guardedTargetFile = path.join(profile, "guarded-target.json");
  const guardedTransferFile = path.join(profile, "guarded-transfer.json");
  const refusedReceiptFile = path.join(
    profile,
    "must-not-exist-cancellation.json",
  );
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-target"]'),
    "导出 CLI 目标导入凭据",
    guardedTargetFile,
    "save",
    "准备 CLI 目标移交",
    "导出导入凭据",
    project.id,
  );
  const guardedTarget = JSON.parse(fs.readFileSync(guardedTargetFile, "utf8"));
  cli([
    "goal",
    "transfer-to-project",
    guardedSource.id,
    "--target",
    guardedTargetFile,
    "--output",
    guardedTransferFile,
    "--revision",
    String(guardedSource.revision),
    "--confirm-transfer",
    "--json",
  ]);
  await nativeFlow(
    panel.locator('[data-testid="goal-transfer-import"]'),
    "选择 CLI 目标移交文件",
    guardedTransferFile,
    "open",
    "导入 CLI 目标",
    "导入并保存映射与备份",
    guardedSource.objective,
  );
  const guardedBefore = (await transfers()).find(
    (item) => item.target.id === guardedTarget.id,
  );
  const guardedArticle = window.locator(
    `[data-goal-id="${guardedBefore.goalRef.id}"]`,
  );
  await guardedArticle.locator('[data-testid="resume-goal"]').click();
  await expect
    .poll(
      async () =>
        (await api("readGoal", { id: guardedBefore.goalRef.id })).status,
    )
    .toBe("active");
  const revised = await api("readGoal", { id: guardedBefore.goalRef.id });
  assert.ok(revised.revision > 1);
  assert.deepEqual(revised.allowedActionTypes, []);
  const guardedRow = panel.locator("li").filter({ hasText: guardedTarget.id });
  await nativeFlow(
    guardedRow.locator('[data-testid="goal-transfer-cancel"]'),
    "保存 CLI 目标回退回执",
    refusedReceiptFile,
    "save",
    "作废目标移交",
    "作废并导出回退回执",
    guardedTarget.id,
  );
  await expect(panel).toContainText("操作结果尚未核实");
  const errorCode = "GOAL_TRANSFER_ROLLBACK_HAS_CHANGES";
  await expect
    .poll(() =>
      fs
        .readFileSync(path.join(profile, "application.log"), "utf8")
        .includes(errorCode),
    )
    .toBe(true);
  assert.equal(fs.existsSync(refusedReceiptFile), false);
  assert.equal(fs.existsSync(guardedSourceFile), false);
  assert.match(
    cli(["goal", "progress", guardedSource.id, "--pct", "1"], 1),
    /GOAL_TRANSFER_FROZEN/,
  );
  const guardedAfter = (await transfers()).find(
    (item) => item.target.id === guardedTarget.id,
  );
  assert.deepEqual(guardedAfter, guardedBefore);
  assert.deepEqual(await api("readGoal", { id: revised.id }), revised);
  evidence.changedTargetRefusal = {
    sourceId: guardedSource.id,
    target: guardedTarget,
    before: guardedBefore,
    after: guardedAfter,
    revised,
    errorCode,
    nativeConfirmationAttempted: true,
    cancellationFileAbsent: true,
    sourceStillFrozen: true,
  };
  await panel.locator('[data-testid="goal-transfer-refresh"]').click();
  await expect(panel).toContainText(guardedTarget.id);
  evidence.finalGoalCount = (await goals()).length;
  assert.equal(evidence.finalGoalCount, 1);
  await window.screenshot({
    path: path.join(output, "rollback-refused.png"),
    fullPage: true,
  });
  stage("actual-ui-revision-prevents-rollback-and-source-stays-frozen");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = { message: error.message, stack: error.stack };
  if (window)
    await window
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  clearTimeout(watchdog);
  if (app) {
    let timer;
    try {
      await Promise.race([
        app.close().catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            terminate();
            resolve();
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  log?.end();
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "journey.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify({ output, profile, status: evidence.status }));
}
