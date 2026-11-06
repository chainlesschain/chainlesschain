import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const directory = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(directory, "../../../../..");
const require = createRequire(path.join(root, "package.json"));
const sha = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const reports = [
  "cli-tests.json",
  "desktop-tests.json",
  "contract-tests.json",
  "organization-host-tests.json",
].map((file) => {
  const data = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  if (
    !data.success ||
    data.numFailedTests ||
    data.numPendingTests ||
    data.testResults.some((r) => r.status !== "passed")
  )
    throw new Error(`Incomplete test scope: ${file}`);
  return {
    file,
    sha256: sha(path.join(directory, file)),
    passed: data.numPassedTests,
    failed: data.numFailedTests,
    skipped: data.numPendingTests,
    startTime: data.startTime,
    files: data.testResults.map((r) =>
      path.relative(root, r.name).replaceAll("\\", "/"),
    ),
  };
});
const testFiles = reports.flatMap((r) => r.files);
if (new Set(testFiles).size !== testFiles.length)
  throw new Error("Overlapping report files");
const tap = fs.readFileSync(path.join(directory, "packed-host.tap"), "utf8");
if (
  !/# tests 3\b/u.test(tap) ||
  !/# pass 3\b/u.test(tap) ||
  !/# fail 0\b/u.test(tap) ||
  !/# skipped 0\b/u.test(tap)
)
  throw new Error("Incomplete packed-host scope");
const sources = [
  ...testFiles,
  "packages/session-core/lib/goal-contract.js",
  "packages/session-core/lib/project-goal-service.js",
  "packages/session-core/lib/project-goal-monitoring.js",
  "packages/session-core/lib/project-goal-graph-journal.js",
  "packages/session-core/__tests__/scheduler-host-boundary.node.cjs",
  "packages/session-core/__tests__/project-goal-graph-packed.node.cjs",
  "packages/cli/src/host/project-goal-graph.js",
  "packages/cli/src/host/README.md",
  "packages/cli/src/lib/scheduler-kernel/graph-authority-adapter.js",
  "packages/cli/src/lib/graph-kernel/runtime.js",
  "packages/cli/src/lib/graph-kernel/graph-runtime-surfaces.json",
  "packages/cli/src/lib/graph-kernel/runtime-surface-manifest.js",
  "packages/cli/src/lib/graph-kernel/production-source-evidence.js",
  "packages/cli/scripts/assemble-graph-production-cutover-evidence.mjs",
  "packages/cli/scripts/collect-graph-production-source-receipts.mjs",
  "packages/cli/scripts/budget-egress-reviewed-sources.json",
  ".github/graph-kernel-production-source-registry.json",
  ".github/graph-kernel-production-source-registry.md",
  "packages/cli/__tests__/fixtures/dmm-goal-graph-process.mjs",
  "packages/cli/__tests__/fixtures/session-core-0.3.26-goal-contract.cjs",
  "desktop-app-vue/src/main/task/project-goal-monitoring-host.js",
  "desktop-app-vue/src/main/task/project-goal-graph-host.js",
  "desktop-app-vue/vitest.business-actions.config.mjs",
  ".github/workflows/cli-ci.yml",
];
function run(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Check failed: ${binary} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`,
    );
  return {
    command: [binary, ...args],
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
const checks = [
  run("git", ["diff", "HEAD", "--check", "--", ...new Set(sources)]),
  run(process.execPath, [
    "desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs",
  ]),
  run(process.execPath, [
    "packages/cli/scripts/implementation-plan-budget-egress.mjs",
    "--check",
    "--include-scripts",
  ]),
];
const legacy = run("git", [
  "show",
  "3fa3a4b258bbcb60b23b4298cec375661ad6f410:packages/session-core/lib/goal-contract.js",
]);
const normalizedLegacy = legacy.stdout.replaceAll("\r\n", "\n");
const fixture = fs
  .readFileSync(
    path.join(
      root,
      "packages/cli/__tests__/fixtures/session-core-0.3.26-goal-contract.cjs",
    ),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
if (fixture !== normalizedLegacy)
  throw new Error(
    "Old validator fixture differs from the verified release source",
  );
const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
const commands = [
  {
    cwd: "packages/cli",
    command:
      "node ../../node_modules/vitest/vitest.mjs run __tests__/unit/graph- __tests__/unit/scheduler-kernel-runtime.test.js __tests__/unit/scheduler-graph-authority-adapter.test.js __tests__/unit/project-goal-graph.test.js __tests__/unit/project-goal-monitoring.test.js __tests__/unit/project-goal-workflow.test.js __tests__/unit/project-goal-completion.test.js __tests__/unit/project-goal-memory.test.js __tests__/unit/project-goal-notifications.test.js __tests__/unit/goal-usage-ledger.test.js __tests__/unit/goal-store.test.js __tests__/unit/goal-repository.test.js __tests__/unit/project-goal-service.test.js __tests__/unit/runtime-entry-cutover-wiring.test.js __tests__/integration/project-goal-process-recovery.test.js __tests__/integration/project-goal-workflow-process-recovery.test.js __tests__/integration/project-goal-graph-process-recovery.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-goal-graph-2026-11-07/cli-tests.json",
  },
  {
    cwd: "desktop-app-vue",
    command:
      "node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs --reporter=json --outputFile=../docs/research/agents/evidence/dmm-goal-graph-2026-11-07/desktop-tests.json",
    environment:
      "Real Windows ACL run outside sandbox; isolated temporary SQLite and localhost HTTP.",
  },
  {
    cwd: "packages/session-core",
    command:
      "node ../../node_modules/vitest/vitest.mjs run __tests__/goal-contract.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-goal-graph-2026-11-07/contract-tests.json",
  },
  {
    cwd: "desktop-app-vue",
    command:
      "node ../node_modules/vitest/vitest.mjs run --config vitest.organization-authority.config.mjs src/main/task/__tests__/organization-project-goal-host.test.js src/main/task/__tests__/organization-project-goal-periodic-host.test.js --reporter=json --outputFile=../docs/research/agents/evidence/dmm-goal-graph-2026-11-07/organization-host-tests.json",
  },
  {
    cwd: ".",
    command:
      "node --test packages/session-core/__tests__/scheduler-host-boundary.node.cjs packages/session-core/__tests__/project-goal-graph-packed.node.cjs",
  },
];
const summary = {
  taskIds: ["DMM-00", "DMM-01", "DMM-03", "DMM-09"],
  createdAt: new Date().toISOString(),
  checkoutHead: head,
  sourceState:
    "local worktree snapshot bound by file hashes; not remote exact-commit CI or production cutover evidence",
  host: {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    vitest: require("vitest/package.json").version,
    sqlite: require("better-sqlite3/package.json").version,
  },
  total: {
    files: testFiles.length + 2,
    passed: reports.reduce((n, r) => n + r.passed, 0) + 3,
    failed: 0,
    skipped: 0,
  },
  reports,
  packedHost: {
    file: "packed-host.tap",
    sha256: sha(path.join(directory, "packed-host.tap")),
    files: 2,
    passed: 3,
  },
  commands,
  checks,
  sources: Object.fromEntries(
    [...new Set(sources)].map((f) => [f, sha(path.join(root, f))]),
  ),
  compatibility: {
    schema: "chainlesschain.goal/v2",
    activation: "explicit Graph participation only; untouched goals stay v1",
    oldValidatorSource: "3fa3a4b258bbcb60b23b4298cec375661ad6f410",
    oldValidatorVersion: "Session Core 0.3.26",
    normalizedSha256: crypto
      .createHash("sha256")
      .update(normalizedLegacy)
      .digest("hex"),
    verifiedReleasedSourceMatch: true,
  },
  inventory: {
    surfaces: 5,
    entries: 24,
    durableEntries: 21,
    migratableEntries: 8,
    retiredEntries: 13,
    disabledEntries: 3,
    storeSlots: 22,
    platformStoreSlots: 66,
    requiredSignedProductionReceipts: 72,
    productionObservationVerified: false,
  },
  scenarios: [
    "native participation/head watermark with durable canonical Graph result",
    "native commit before Graph receipt: revalidate and recover exact native result without replay or duplicate goal usage",
    "Graph commit before scheduler projection: retain original canonical authority even after the flag returns to legacy",
    "unknown effect without a native receipt: preserve reconciliation, do not execute again",
    "late live writer after scheduler lease takeover: old fence cannot write native state",
    "missing/replaced/rolled-back journal and cached terminal result validation fail closed",
    "schema v2 rejects the frozen released validator; current native CAS cannot drop the reader floor",
    "default legacy creates no Graph journal; organization host remains separate",
    "actual packed source imports and validates a terminal result without CLI program startup or profile writes",
  ],
  boundaries: {
    real: [
      "native SQLite across three storage domains",
      "existing canonical Graph kernel",
      "file identities and head watermarks",
      "forced child exits and live lease takeover",
      "Windows native ACL",
      "npm packing and isolated Node imports",
    ],
    doubles: [
      "Electron window/dialog/app-path and login state",
      "synthetic project/task data",
      "signed production-source and store-coverage fixtures",
    ],
    notRun: [
      "real product Electron/IDE GUI",
      "independent real business sample/effect",
      "Linux/macOS execution",
      "new exact-source remote release matrices",
      "real 24-entry production observations and staged cutover",
      "client installers",
      "new package publication",
      "arbitrary backup-database or power-loss recovery",
    ],
  },
};
fs.writeFileSync(
  path.join(directory, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary.total));
