import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const reports = ["desktop-tests.json", "organization-host-tests.json"].map(
  (file) => {
    const report = JSON.parse(
      fs.readFileSync(path.join(directory, file), "utf8"),
    );
    if (
      !report.success ||
      report.numFailedTests ||
      report.numPendingTests ||
      report.testResults.some((result) => result.status !== "passed")
    )
      throw new Error(`Incomplete report: ${file}`);
    return {
      file,
      sha256: hash(path.join(directory, file)),
      passed: report.numPassedTests,
      files: report.testResults.map((result) =>
        path.relative(root, result.name).replaceAll("\\", "/"),
      ),
    };
  },
);
const testFiles = reports.flatMap((report) => report.files);
if (testFiles.length !== new Set(testFiles).size)
  throw new Error("Overlapping test reports");
const probe = JSON.parse(
  fs.readFileSync(path.join(directory, "electron-probe.json"), "utf8"),
);
const startup = JSON.parse(fs.readFileSync(path.join(directory, "product-startup.json"), "utf8"));
if (startup.exitCode !== 0 || hash(path.join(directory, startup.screenshot)) !== startup.screenshotSha256) throw new Error("Product startup observation or screenshot changed");
if (
  !probe.passed ||
  probe.platform !== "win32" ||
  Object.values(probe.checks).some((value) => value !== true)
)
  throw new Error("Incomplete real encrypted Electron probe");
for (const [file, expectedHash] of Object.entries(probe.sources)) {
  if (hash(path.join(root, file)) !== expectedHash)
    throw new Error(`Probe source changed: ${file}`);
}
const sources = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(probe.sources),
      ...testFiles,
      "desktop-app-vue/vitest.business-actions.config.mjs",
    ]),
  ].map((file) => [file, hash(path.join(root, file))]),
);
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`,
    );
  return {
    command: [command, ...args],
    status: result.status,
    stdout: result.stdout,
  };
}
const checks = [
  run("git", ["diff", "HEAD", "--check", "--", ...Object.keys(sources)]),
  run(process.execPath, [
    "desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs",
  ]),
  run(process.execPath, [
    "packages/cli/scripts/implementation-plan-budget-egress.mjs",
    "--check",
    "--include-scripts",
  ]),
];
const commands = [
  {
    cwd: "desktop-app-vue",
    command:
      "node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs --reporter=json --outputFile=../docs/research/agents/evidence/dmm-encrypted-goal-host-2026-11-07/desktop-tests.json",
    nativeWindowsAcl: true,
  },
  {
    cwd: "desktop-app-vue",
    command:
      "node ../node_modules/vitest/vitest.mjs run --config vitest.organization-authority.config.mjs src/main/task/__tests__/organization-project-goal-host.test.js src/main/task/__tests__/organization-project-goal-periodic-host.test.js --reporter=json --outputFile=../docs/research/agents/evidence/dmm-encrypted-goal-host-2026-11-07/organization-host-tests.json",
  },
  {
    cwd: ".",
    command:
      "node desktop-app-vue/scripts/project-goal-encrypted-electron-probe.mjs --electron <verified Electron 39.8.10 executable> --output <new result file>",
  },
];
const summary = {
  createdAt: new Date().toISOString(),
  checkoutHead: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
  sourceState:
    "local source snapshot bound by hashes; not remote CI or installed product acceptance",
  total: {
    files: testFiles.length,
    passed: reports.reduce((sum, report) => sum + report.passed, 0),
    failed: 0,
    skipped: 0,
  },
  reports,
  commands,
  checks,
  sources,
  realElectron: {
    file: "electron-probe.json",
    sha256: hash(path.join(directory, "electron-probe.json")),
    electron: probe.versions.electron,
    node: probe.versions.node,
    abi: probe.versions.modules,
    databasePackage: probe.databasePackage,
    passed: true,
    checks: probe.checks,
  },
  productBuild: {
    commands: [
      "node scripts/build-main.js",
      "node ../node_modules/vite/bin/vite.js build",
    ],
    cwd: "desktop-app-vue",
    observedExitCodes: [0, 0],
    rendererModules: 8018,
    rendererIndexSha256: hash(
      path.join(root, "desktop-app-vue/dist/renderer/index.html"),
    ),
    installer: false,
    fullProductGuiJourney: false,
  },
  productStartup: { file: "product-startup.json", sha256: hash(path.join(directory, "product-startup.json")), screenshot: startup.screenshot, screenshotSha256: startup.screenshotSha256, loginFormObserved: true, passwordLoginPerformed: false, fullDmmJourney: false },
  boundaries: {
    real: [
      "actual desktop SQLCipherWrapper",
      "native SQLite and immediate transactions",
      "Electron 39.8.10 with actual encrypted database and rejected no-key read",
      "Windows ACL",
      "canonical Graph kernel",
    ],
    doubles: [
      "unit-test Electron windows/dialogs",
      "synthetic project and trusted probe identity",
    ],
    pending: [
      "full product login and DMM renderer journey",
      "real native confirmation interaction",
      "independent business effect",
      "Linux/macOS",
      "installers",
      "exact-source remote matrices",
      "new publication",
      "production Graph enrollment and cutover",
    ],
  },
};
fs.writeFileSync(
  path.join(directory, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary.total));
