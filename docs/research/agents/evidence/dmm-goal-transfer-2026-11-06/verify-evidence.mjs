import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const directory = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(directory, "../../../../..");
const require = createRequire(path.join(root, "package.json"));
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const commands = [
  {
    cwd: "packages/cli",
    args: [
      "../../node_modules/vitest/vitest.mjs",
      "run",
      "__tests__/unit/goal-project-transfer.test.js",
      "__tests__/unit/goal-store.test.js",
      "__tests__/unit/goal-repository.test.js",
      "__tests__/unit/project-goal-service.test.js",
      "__tests__/unit/goal-context.test.js",
      "__tests__/unit/agent-goal-binding.test.js",
      "__tests__/unit/repl-goal.test.js",
      "__tests__/unit/cli-goal-drafts-command.test.js",
      "__tests__/integration/goal-project-transfer-process-recovery.test.js",
      "__tests__/integration/goal-project-transfer-cli.test.js",
      "--reporter=json",
      "--outputFile=../../docs/research/agents/evidence/dmm-goal-transfer-2026-11-06/cli-all-tests.json",
    ],
  },
  {
    cwd: "desktop-app-vue",
    args: [
      "../node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.business-actions.config.mjs",
      "--reporter=json",
      "--outputFile=../docs/research/agents/evidence/dmm-goal-transfer-2026-11-06/desktop-all-tests.json",
    ],
  },
  {
    cwd: "desktop-app-vue",
    args: [
      "../node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.business-actions-renderer.config.mjs",
      "--reporter=json",
      "--outputFile=../docs/research/agents/evidence/dmm-goal-transfer-2026-11-06/renderer-all-tests.json",
    ],
  },
  {
    cwd: ".",
    args: [
      "--test",
      "packages/session-core/__tests__/scheduler-host-boundary.node.cjs",
    ],
  },
];
const reports = [
  "cli-all-tests.json",
  "desktop-all-tests.json",
  "renderer-all-tests.json",
].map((file) => {
  const report = JSON.parse(
    fs.readFileSync(path.join(directory, file), "utf8"),
  );
  if (
    !report.success ||
    report.numFailedTests ||
    report.numPendingTests ||
    report.testResults.some((r) => r.status !== "passed")
  )
    throw new Error(`Incomplete regression: ${file}`);
  return {
    file,
    sha256: hash(path.join(directory, file)),
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    startTime: report.startTime,
    files: report.testResults.map((r) =>
      path.relative(root, r.name).replaceAll("\\", "/"),
    ),
  };
});
const allFiles = reports.flatMap((r) => r.files);
if (new Set(allFiles).size !== allFiles.length)
  throw new Error("Overlapping report scopes");
const tap = fs.readFileSync(path.join(directory, "packed-host.tap"), "utf8");
if (
  !/# tests 2\b/u.test(tap) ||
  !/# pass 2\b/u.test(tap) ||
  !/# fail 0\b/u.test(tap) ||
  !/# skipped 0\b/u.test(tap)
)
  throw new Error("Incomplete packed-host report");
const sources = [
  "packages/session-core/lib/goal-transfer-contract.js",
  "packages/session-core/lib/goal-transfer-files.js",
  "packages/session-core/lib/project-goal-transfer.js",
  "packages/session-core/lib/project-goal-service.js",
  "packages/session-core/lib/goal-contract.js",
  "packages/session-core/package.json",
  "packages/session-core/__tests__/scheduler-host-boundary.node.cjs",
  "packages/cli/src/lib/goal-store.js",
  "packages/cli/src/lib/with-file-lock.js",
  "packages/cli/src/commands/goal.js",
  "packages/cli/src/command-help-index.json",
  "packages/cli/vitest.config.js",
  "packages/cli/__tests__/fixtures/dmm-goal-transfer-process.mjs",
  ...allFiles,
  "desktop-app-vue/src/main/task/project-goal-transfer-host.js",
  "desktop-app-vue/src/main/task/project-goal-ipc.js",
  "desktop-app-vue/src/preload/index.js",
  "desktop-app-vue/src/preload/renderer-ipc-capabilities.json",
  "desktop-app-vue/src/renderer/components/projects/ProjectGoalTransferPanel.vue",
  "desktop-app-vue/src/renderer/components/projects/ProjectGoalMonitoringPanel.vue",
  "desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs",
  "desktop-app-vue/vitest.business-actions.config.mjs",
  "desktop-app-vue/vitest.business-actions-renderer.config.mjs",
];
const checks = [
  ["git", ["diff", "--check"]],
  [process.execPath, ["desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs"]],
  [
    process.execPath,
    ["packages/cli/scripts/gen-command-manifest.mjs", "--check"],
  ],
  [
    process.execPath,
    ["packages/cli/scripts/gen-command-help-index.mjs", "--check"],
  ],
  [
    process.execPath,
    ["packages/cli/scripts/gen-shell-completions.mjs", "--check"],
  ],
  [
    process.execPath,
    [
      "packages/cli/scripts/gen-cli-reference.mjs",
      "--check",
      "docs/cli/CLI_REFERENCE.generated.md",
    ],
  ],
].map(([binary, args]) => {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Check failed: ${binary} ${args.join(" ")}\n${result.stderr}`,
    );
  return {
    command: [binary, ...args],
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
});
const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (commit.status !== 0) throw new Error("Missing source baseline");
const summary = {
  taskIds: ["DMM-02", "DMM-09"],
  createdAt: new Date().toISOString(),
  baseline: commit.stdout.trim(),
  sourceState:
    "local worktree snapshot bound by file hashes; not remote exact-commit CI or a release gate",
  host: {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    vitest: require("vitest/package.json").version,
    sqlite: require("better-sqlite3/package.json").version,
    vue: require("vue/package.json").version,
    pinia: require("pinia/package.json").version,
    devtools: require("@vue/devtools-api/package.json").version,
  },
  total: {
    files: allFiles.length + 1,
    passed: reports.reduce((n, r) => n + r.passed, 0) + 2,
    failed: 0,
    skipped: 0,
  },
  reports,
  packedHost: {
    file: "packed-host.tap",
    sha256: hash(path.join(directory, "packed-host.tap")),
    passed: 2,
  },
  commands,
  checks,
  sources: Object.fromEntries(
    [...new Set(sources)].map((f) => [f, hash(path.join(root, f))]),
  ),
  scenarios: [
    "explicit native destination -> CLI strict lock/exact byte backup/freeze -> one native SQLite goal+mapping+backup",
    "durable cancellation -> signed receipt -> exact source restoration; no target resurrection",
    "changed goal or goal-dependent data rejects rollback",
    "four actual killed child checkpoints and concurrent native importers",
    "real CLI binary create/freeze/retry/list/restore",
    "native confirmation invalidation by actor/auth/frame/navigation/window/database change",
  ],
  boundaries: {
    real: [
      "filesystem",
      "strict cross-process lock",
      "native SQLite transactions",
      "Ed25519 receipt verification",
      "CLI binary",
      "forced process exits",
      "npm packing and isolated CJS/ESM loading",
    ],
    doubles: ["Electron window/dialog/identity", "Vue IPC"],
    notRun: [
      "real Electron GUI",
      "real IDE GUI",
      "independent real business sample",
      "Linux/macOS execution",
      "exact-commit release CI",
      "new package/client publication",
      "power-loss or backup-database rollback",
    ],
  },
  environmentRepair: {
    desktop:
      "Initial sandbox run rejected actual Windows ACL checks; repeated without reducing ACL requirements outside sandbox.",
    renderer:
      "Initial run could not load four suites because @vue/devtools-api was empty; restored locked 6.6.4 bytes without manifest/lock changes.",
  },
};
fs.writeFileSync(
  path.join(directory, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary.total));
