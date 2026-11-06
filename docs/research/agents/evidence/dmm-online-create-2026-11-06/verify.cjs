"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../../../../..");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const sha = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const git = (...args) =>
  cp.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const changed = [
  ...new Set([
    ...git("diff", "HEAD", "--name-only").split(/\r?\n/u),
    ...git("ls-files", "--others", "--exclude-standard").split(/\r?\n/u),
  ]),
].filter(
  (file) =>
    file &&
    !file.includes("/evidence/") &&
    fs.existsSync(path.join(root, file)),
);
const formatFiles = changed.filter((file) =>
  /\.(?:js|mjs|vue|ts|md)$/u.test(file),
);
formatFiles.push(
  relative(__filename),
  relative(path.join(__dirname, "README.md")),
);
const checks = [];
function check(args) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
  });
  checks.push({
    command: ["node", ...args],
    exitCode: result.status,
    stdout: result.stdout?.slice(-4000),
    stderr: result.stderr?.slice(-4000),
    error: result.error?.message,
  });
}
for (const file of changed.filter((file) => /\.(?:js|mjs)$/u.test(file)))
  check(["--check", file]);
check(["--check", relative(__filename)]);
check(["node_modules/prettier/bin/prettier.cjs", "--check", ...formatFiles]);
check(["packages/cli/scripts/gen-command-manifest.mjs", "--check"]);
check(["packages/cli/scripts/gen-command-help-index.mjs", "--check"]);
check(["packages/cli/scripts/gen-shell-completions.mjs", "--check"]);
check([
  "packages/cli/scripts/gen-cli-reference.mjs",
  "--check",
  "docs/cli/CLI_REFERENCE.generated.md",
]);
fs.writeFileSync(
  path.join(__dirname, "checks.json"),
  JSON.stringify(
    {
      checks,
      passed: checks.filter((item) => item.exitCode === 0).length,
      failed: checks.filter((item) => item.exitCode !== 0).length,
    },
    null,
    2,
  ) + "\n",
);
const cliFiles = [
  "unit/cli-goal-draft-request.test.js",
  "unit/cli-goal-drafts-command.test.js",
  "unit/cli-goal-capabilities.test.js",
  "unit/cli-goal-drafts.test.js",
  "unit/project-goal-external-drafts.test.js",
  "unit/project-goal-extension-queue.test.js",
  "unit/plugin-goal-extension.test.js",
  "unit/project-goal-drafts-transport.test.js",
  "unit/project-goal-workflow.test.js",
  "unit/task-create-action-service.test.js",
  "unit/project-delivery-assistant-lifecycle.test.js",
  "unit/goal-draft-submission-reference.test.js",
  "unit/vscode-ext-goal-drafts.test.js",
  "integration/goal-extension-conversion-process.test.js",
].map((file) => "__tests__/" + file);
const desktopFiles = [
  "project-goal-draft-imports-ipc",
  "project-goal-delivery-drafts-ipc",
  "project-goal-workflow-ipc",
  "project-goal-external-drafts-ipc",
  "project-goal-event-history-ipc",
].map((file) => `src/main/task/__tests__/${file}.test.js`);
const rendererFiles = [
  "project-goal-cli-connection-panel",
  "project-goal-external-drafts-panel",
].map((file) => `src/renderer/components/projects/__tests__/${file}.test.ts`);
const evidenceName = path.basename(__dirname);
const reports = [
  {
    file: "cli-tests.json",
    cwd: ".",
    environment: "workspace sandbox",
    command: `npm.cmd --prefix packages/cli test -- ${cliFiles.join(" ")} --reporter=json --outputFile=../../docs/research/agents/evidence/${evidenceName}/cli-tests.json`,
  },
  {
    file: "desktop-tests.json",
    cwd: "desktop-app-vue",
    environment:
      "approved outside sandbox; synthetic isolated data, real Windows ACL",
    command: `node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs ${desktopFiles.join(" ")} --reporter=json --outputFile=../docs/research/agents/evidence/${evidenceName}/desktop-tests.json`,
  },
  {
    file: "renderer-tests.json",
    cwd: "desktop-app-vue",
    environment: "workspace sandbox; Vue IPC substitute",
    command: `node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs ${rendererFiles.join(" ")} --reporter=json --outputFile=../docs/research/agents/evidence/${evidenceName}/renderer-tests.json`,
  },
].map((item) => {
  const file = path.join(__dirname, item.file),
    result = JSON.parse(fs.readFileSync(file));
  return {
    ...item,
    sha256: sha(file),
    testFiles: result.testResults.length,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    skipped: result.numPendingTests,
    success: result.success,
  };
});
const testFiles = reports.reduce((total, item) => total + item.testFiles, 0);
const passed = reports.reduce((total, item) => total + item.passed, 0);
const failed = reports.reduce((total, item) => total + item.failed, 0);
const skipped = reports.reduce((total, item) => total + item.skipped, 0);
const snapshot = [
  ...changed,
  relative(__filename),
  relative(path.join(__dirname, "README.md")),
  relative(path.join(__dirname, "verify-artifacts.py")),
];
const summary = {
  taskIds: ["DMM-07", "DMM-08"],
  localDate: "2026-11-06",
  recordedAt: new Date().toISOString(),
  result:
    "Separate native v6 pending-creation grant/HTTP/CLI/desktop controls. Task creation still requires current desktop preview and individual native confirmation. Completion status tables updated.",
  source: {
    baseCommit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    state:
      "Uncommitted combined worktree; earlier batch evidence unchanged; totals not accumulated",
    sha256: Object.fromEntries(
      [...new Set(snapshot)]
        .sort()
        .map((file) => [file, sha(path.join(root, file))]),
    ),
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    vitest: require(path.join(root, "node_modules/vitest/package.json"))
      .version,
    betterSqlite3: require(
      path.join(root, "node_modules/better-sqlite3/package.json"),
    ).version,
    koffi: require(path.join(root, "node_modules/koffi/package.json")).version,
  },
  totals: { testFiles, passed, failed, skipped },
  reports,
  checks: {
    file: "checks.json",
    sha256: sha(path.join(__dirname, "checks.json")),
    passed: checks.filter((item) => item.exitCode === 0).length,
    failed: checks.filter((item) => item.exitCode !== 0).length,
  },
  artifacts: {
    file: "artifacts.json",
    sha256: sha(path.join(__dirname, "artifacts.json")),
    countedAsTests: false,
    commands: [
      "npm.cmd pack --ignore-scripts --json --pack-destination <Temp>/dmm-online-create-20261106 --cache <Temp>/dmm-native-create-npm-cache (cwd packages/cli and packages/session-core)",
      "python docs/research/agents/evidence/dmm-online-create-2026-11-06/verify-artifacts.py <local-cli-tarball> <local-core-tarball>",
    ],
  },
  boundaries: {
    real: [
      "plugin discovery/trust/capability consent",
      "Windows ACL, loopback HTTP HMAC, SQLite pending/native action storage",
      "grant disconnect/reopen/revoke and terminal replay",
      "existing shared creation conversion child-process recovery",
    ],
    substitutes: [
      "Electron window/actor/dialog results",
      "Vue IPC",
      "synthetic personal-project data",
      "CLI fault-retry connection fixture; transport faults separately use actual HTTP",
    ],
    pending: [
      "IDE online creation controls",
      "model drafting and Memory output authorization adapter",
      "actual Electron/IDE GUI",
      "independent business-effect samples",
      "exact-commit full-platform release gates, rollout and migration rollback",
    ],
    published: false,
    versionsChanged: false,
    fullIsolatedCliInstall: false,
  },
};
fs.writeFileSync(
  path.join(__dirname, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    totals: summary.totals,
    checks: summary.checks,
    sourceFiles: snapshot.length,
  }),
);
if (
  failed ||
  skipped ||
  reports.some((item) => !item.success) ||
  checks.some((item) => item.exitCode !== 0) ||
  testFiles !== 21 ||
  passed !== 365
)
  process.exitCode = 1;
