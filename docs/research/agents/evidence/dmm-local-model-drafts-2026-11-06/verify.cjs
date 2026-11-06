"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, "../../../../..");
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
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
const own = ["README.md", "verify.cjs", "verify-artifacts.py"].map((file) =>
  rel(path.join(__dirname, file)),
);
const checks = [];
function check(binary, args) {
  const r = cp.spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
  });
  checks.push({
    command: [binary === process.execPath ? "node" : binary, ...args],
    exitCode: r.status,
    stdout: r.stdout?.slice(-4000),
    stderr: r.stderr?.slice(-4000),
    error: r.error?.message,
  });
}
for (const file of changed.filter((file) => /\.(?:js|mjs|cjs)$/u.test(file)))
  check(process.execPath, ["--check", file]);
check(process.execPath, ["--check", rel(__filename)]);
check(process.execPath, [
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  ...changed.filter((file) => /\.(?:js|mjs|cjs|ts|vue|md)$/u.test(file)),
  ...own.filter((file) => /\.(?:md|cjs)$/u.test(file)),
]);
check(process.execPath, [
  "desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs",
]);
check(process.execPath, [
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  ".github/workflows/test.yml",
  "desktop-app-vue/package.json",
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
fs.writeFileSync(
  path.join(__dirname, "checks.json"),
  JSON.stringify(
    {
      checks,
      passed: checks.filter((r) => r.exitCode === 0).length,
      failed: checks.filter((r) => r.exitCode !== 0).length,
    },
    null,
    2,
  ) + "\n",
);
const folder = path.basename(__dirname);
const cliFiles = [
  "project-goal-memory",
  "goal-usage-ledger",
  "project-goal-workflow",
  "project-goal-extension-queue",
  "task-create-action-service",
].map((file) => `__tests__/unit/${file}.test.js`);
const desktopFiles = [
  "project-goal-model-drafts-ipc",
  "project-goal-memory-ipc",
  "project-goal-delivery-drafts-ipc",
  "project-goal-workflow-ipc",
  "project-goal-external-drafts-ipc",
  "project-goal-draft-imports-ipc",
]
  .map((file) => `src/main/task/__tests__/${file}.test.js`)
  .concat("src/preload/__tests__/legacy-ipc-policy.test.js");
const rendererFiles = [
  "project-goal-model-drafts-panel",
  "project-goal-actions-panel",
  "project-goal-memory-panel",
  "project-goal-extension-drafts-panel",
].map((file) => `src/renderer/components/projects/__tests__/${file}.test.ts`);
const nodeFiles = [
  "project-goal-model-protocol",
  "project-goal-model-crash",
  "board-report-summary-model",
].map((file) => `desktop-app-vue/src/main/task/__tests__/${file}.test.cjs`);
const reports = [
  {
    file: "cli-tests.json",
    cwd: ".",
    environment: "workspace sandbox",
    command: `npm.cmd --prefix packages/cli test -- ${cliFiles.join(" ")} --reporter=json --outputFile=../../docs/research/agents/evidence/${folder}/cli-tests.json`,
  },
  {
    file: "desktop-tests.json",
    cwd: "desktop-app-vue",
    environment:
      "approved outside sandbox; synthetic isolated project data and real Windows ACL for old HTTP regressions",
    command: `node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs ${desktopFiles.join(" ")} --reporter=json --outputFile=../docs/research/agents/evidence/${folder}/desktop-tests.json`,
  },
  {
    file: "renderer-tests.json",
    cwd: "desktop-app-vue",
    environment: "workspace sandbox; Vue IPC substitutes",
    command: `node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs ${rendererFiles.join(" ")} --reporter=json --outputFile=../docs/research/agents/evidence/${folder}/renderer-tests.json`,
  },
].map((item) => {
  const file = path.join(__dirname, item.file),
    r = JSON.parse(fs.readFileSync(file));
  return {
    ...item,
    sha256: sha(file),
    testFiles: r.testResults.length,
    passed: r.numPassedTests,
    failed: r.numFailedTests,
    skipped: r.numPendingTests,
    success: r.success,
  };
});
const tapPath = path.join(__dirname, "model-protocol-tests.tap"),
  tap = fs.readFileSync(tapPath, "utf8");
const tapCount = (key) =>
  Number(
    [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))].at(-1)?.[1] ??
      NaN,
  );
reports.push({
  file: "model-protocol-tests.tap",
  cwd: ".",
  environment:
    "approved outside sandbox; real signed test storage ACL, synthetic loopback responses, actual Node forced exits",
  command: `node --test --test-reporter=tap --test-reporter-destination=docs/research/agents/evidence/${folder}/model-protocol-tests.tap ${nodeFiles.join(" ")}`,
  sha256: sha(tapPath),
  testFiles: 3,
  passed: tapCount("pass"),
  failed: tapCount("fail"),
  skipped: tapCount("skipped"),
  success:
    tapCount("fail") === 0 &&
    tapCount("cancelled") === 0 &&
    tapCount("tests") === 19,
});
const totals = Object.fromEntries(
  ["testFiles", "passed", "failed", "skipped"].map((key) => [
    key,
    reports.reduce((n, r) => n + r[key], 0),
  ]),
);
const summary = {
  localDate: "2026-11-06",
  recordedAt: new Date().toISOString(),
  taskIds: ["DMM-01", "DMM-05", "DMM-08", "DMM-09"],
  result:
    "On-demand native-consented local Ollama pending drafts; explicit optional goal memory, transaction-bound output revalidation, expiry UI invalidation, shared usage and query-only recovery with a body-free request history. Unknown requests block new IDs until revoked. Actual tasks still require native preview/confirmation.",
  source: {
    baseCommit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    state:
      "Uncommitted combined worktree; previous batch evidence unchanged; totals not accumulated",
    sha256: Object.fromEntries(
      [...new Set([...changed, ...own])]
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
    publicVersionsUnchanged: {
      sessionCore: "0.3.25",
      cli: "0.166.142",
      vscode: "0.37.178",
      jetbrains: "0.4.195",
    },
  },
  totals,
  reports,
  checks: {
    file: "checks.json",
    sha256: sha(path.join(__dirname, "checks.json")),
    passed: checks.filter((r) => r.exitCode === 0).length,
    failed: checks.filter((r) => r.exitCode !== 0).length,
  },
  artifacts: {
    file: "artifacts.json",
    sha256: sha(path.join(__dirname, "artifacts.json")),
    countedAsTests: false,
    commands: [
      "npm.cmd pack --ignore-scripts --json --pack-destination <Temp>/dmm-local-model-drafts-20261106 --cache <Temp>/dmm-native-create-npm-cache (cwd packages/session-core)",
      "python docs/research/agents/evidence/dmm-local-model-drafts-2026-11-06/verify-artifacts.py <exact-local-core-tarball>",
    ],
  },
  boundaries: {
    real: [
      "SQLite and Kernel record/grant/expiry checks in native output/action transactions",
      "governed manager/client branding and signed test ingress/projector with literal loopback HTTP",
      "two actual Node forced exits after dispatch and after pending commit, followed by SQLite reopen and zero new calls",
      "generated exact IPC manifest and public Core CJS/ESM loading from local package",
    ],
    substitutes: [
      "synthetic Ollama protocol responses; no actual model weights/inference quality or production deployment",
      "Electron window/identity/native confirmation results",
      "Vue IPC",
      "inactive provider modules and health probes in protocol fixture",
    ],
    limits: [
      "local Ollama literal loopback only; no remote provider or background model scheduling",
      "finite token/cost budget cannot be reliably reserved and is refused; actual cost remains unknown",
      "at most 100 request identities per personal goal, 20 linked memories and 16 KiB model input",
      "revocation prevents unconfirmed reuse but does not erase already-sent input or governance history",
    ],
    pending: [
      "actual model-quality and independent business-effect samples",
      "other provider/background adapters",
      "actual Electron/IDE GUI and Electron packaging",
      "exact-commit full platform release gates, rollout and migration rollback",
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
  totals.testFiles !== 19 ||
  totals.passed !== 363 ||
  totals.failed ||
  totals.skipped ||
  reports.some((r) => !r.success) ||
  checks.some((r) => r.exitCode !== 0)
)
  process.exitCode = 1;
