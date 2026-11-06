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
const ownSources = ["README.md", "verify.cjs", "verify-artifacts.py"].map(
  (file) => relative(path.join(__dirname, file)),
);
const checks = [];
function check(binary, args) {
  const result = cp.spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
  });
  checks.push({
    command: [binary === process.execPath ? "node" : binary, ...args],
    exitCode: result.status,
    stdout: result.stdout?.slice(-4000),
    stderr: result.stderr?.slice(-4000),
    error: result.error?.message,
  });
}
for (const file of changed.filter((file) => /\.(?:js|mjs)$/u.test(file)))
  check(process.execPath, ["--check", file]);
check(process.execPath, ["--check", relative(__filename)]);
check(process.execPath, [
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  ...changed.filter((file) => /\.(?:js|mjs|vue|ts|md)$/u.test(file)),
  ...ownSources.filter((file) => /\.(?:cjs|md)$/u.test(file)),
]);
for (const script of [
  "gen-command-manifest",
  "gen-command-help-index",
  "gen-shell-completions",
])
  check(process.execPath, [`packages/cli/scripts/${script}.mjs`, "--check"]);
check(process.execPath, [
  "packages/cli/scripts/gen-cli-reference.mjs",
  "--check",
  "docs/cli/CLI_REFERENCE.generated.md",
]);
check("git", ["diff", "--check"]);
if (!process.argv[2])
  throw new Error("Supply the exact local VSIX path for metadata verification");
check(process.execPath, [
  "packages/vscode-extension/scripts/verify-vsix.mjs",
  process.argv[2],
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
const evidenceName = path.basename(__dirname);
const cliFiles = [
  "unit/vscode-ext-goal-drafts.test.js",
  "unit/vscode-ext-goal-draft-request-view.test.js",
  "unit/vscode-ext-introspect-commands.test.js",
  "unit/vscode-ext-plugin-manager.test.js",
  "unit/vscode-ext-goal-panels-view.test.js",
  "unit/vscode-ext-goal-events-view.test.js",
  "unit/vscode-ext-goal-history-view.test.js",
  "unit/cli-goal-drafts.test.js",
  "unit/cli-goal-drafts-command.test.js",
  "unit/project-goal-external-drafts.test.js",
  "unit/project-goal-drafts-transport.test.js",
  "unit/project-delivery-assistant-lifecycle.test.js",
  "unit/goal-draft-submission-reference.test.js",
  "integration/vscode-goal-create-drafts-process.test.js",
].map((file) => "__tests__/" + file);
const desktopFiles = [
  "project-goal-external-drafts-ipc",
  "project-goal-draft-imports-ipc",
  "project-goal-event-history-ipc",
].map((file) => `src/main/task/__tests__/${file}.test.js`);
const gradleCommand =
  "JAVA_HOME=<local-JBR-21>; .\\gradlew.bat '-Porg.gradle.java.installations.paths=C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr' --offline --no-daemon test --tests com.chainlesschain.ide.PluginManagerTest --tests com.chainlesschain.ide.GoalTaskCreateExportTest buildPlugin --console=plain";
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
      "approved outside sandbox; isolated synthetic data, real Windows ACL/HTTP/SQLite",
    command: `node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs ${desktopFiles.join(" ")} --reporter=json --outputFile=../docs/research/agents/evidence/${evidenceName}/desktop-tests.json`,
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
for (const name of [
  "jetbrains-plugin-manager-tests.xml",
  "jetbrains-capture-tests.xml",
]) {
  const file = path.join(__dirname, name),
    xml = fs.readFileSync(file, "utf8");
  const attributes = /<testsuite\s+([^>]+)>/u.exec(xml)[1];
  const n = (key) =>
    Number(new RegExp(`\\b${key}="([0-9]+)"`, "u").exec(attributes)[1]);
  reports.push({
    file: name,
    cwd: "packages/jetbrains-plugin",
    command: gradleCommand,
    environment:
      "approved outside sandbox; offline Gradle 8.7, JBR 21.0.8, IntelliJ 2024.2 SDK",
    sha256: sha(file),
    testFiles: 1,
    passed: n("tests") - n("failures") - n("errors") - n("skipped"),
    failed: n("failures") + n("errors"),
    skipped: n("skipped"),
    success: n("failures") + n("errors") === 0,
  });
}
const totals = Object.fromEntries(
  ["testFiles", "passed", "failed", "skipped"].map((key) => [
    key,
    reports.reduce((total, item) => total + item[key], 0),
  ]),
);
const summary = {
  localDate: "2026-11-06",
  recordedAt: new Date().toISOString(),
  taskIds: ["DMM-07", "DMM-08"],
  result:
    "VS Code and JetBrains dedicated online v6 creation access/send/receipt with native selections, action-specific responses and bounded zero-exit UTF-8 capture. Pending only; desktop preview/confirmation remain required. Completion tables updated.",
  source: {
    baseCommit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    state:
      "Uncommitted combined worktree; previous batch evidence retained, totals not accumulated",
    sha256: Object.fromEntries(
      [...new Set([...changed, ...ownSources])]
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
    java: "JBR 21.0.8",
    gradle: "8.7 offline",
    intellijSdk: "2024.2",
    publicVersionsUnchanged: {
      cli: "0.166.142",
      sessionCore: "0.3.25",
      vscode: "0.37.178",
      jetbrains: "0.4.195",
    },
    sourceScenarioVersion: "0.3.0",
  },
  totals,
  reports,
  artifacts: {
    file: "artifacts.json",
    sha256: sha(path.join(__dirname, "artifacts.json")),
    countedAsTests: false,
    commands: [
      "node <cached-vsce>/vsce package --no-dependencies --out <Temp>/dmm-ide-online-create-20261106/ide-online-create-local.vsix (cwd packages/vscode-extension)",
      gradleCommand,
      "python docs/research/agents/evidence/dmm-ide-online-create-2026-11-06/verify-artifacts.py <exact-local-vsix> packages/jetbrains-plugin/build/distributions/chainlesschain-ide-bridge-0.4.195.zip",
    ],
  },
  checks: {
    file: "checks.json",
    sha256: sha(path.join(__dirname, "checks.json")),
    passed: checks.filter((item) => item.exitCode === 0).length,
    failed: checks.filter((item) => item.exitCode !== 0).length,
  },
  boundaries: {
    real: [
      "actual Node/Java subprocess stdout/exit/bounds/UTF-8/timeout capture",
      "native v6 plugin admission and real Windows ACL/HTTP/SQLite pending/preview/confirmation data validated by IDE parser",
      "JetBrains IntelliJ SDK/UI compilation",
      "local VSIX metadata and packaged source/class byte comparisons",
    ],
    substitutes: [
      "VS Code API dialogs/webview and creation UI CLI response fixture",
      "Electron window/identity/native confirmation results",
      "synthetic personal project",
      "subprocesses are protocol fixtures, not a live native GUI/CLI crash journey",
    ],
    pending: [
      "model drafting and Memory output authorization adapter",
      "real IDE/Electron GUI",
      "independent business-effect samples",
      "exact-commit full platform release CI, rollout and migration rollback",
    ],
    published: false,
    versionsChanged: false,
  },
};
fs.writeFileSync(
  path.join(__dirname, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    totals,
    checks: summary.checks,
    sourceFiles: Object.keys(summary.source.sha256).length,
  }),
);
if (
  totals.failed ||
  totals.skipped ||
  totals.testFiles !== 19 ||
  totals.passed !== 255 ||
  reports.some((item) => !item.success) ||
  checks.some((item) => item.exitCode !== 0)
)
  process.exitCode = 1;
