"use strict";
// Read-only checks and evidence indexing. NEVER invokes a paid/live probe.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, "../../../../..");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const git = (...args) =>
  cp
    .execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
const checks = [];
function command(binary, args) {
  const result = cp.spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  checks.push({
    command: [binary === process.execPath ? "node" : binary, ...args],
    exitCode: result.status,
    stdout: result.stdout?.slice(-2500),
    stderr: result.stderr?.slice(-2500),
  });
}
const owned = [
  "desktop-app-vue/scripts/project-goal-volcengine-live.cjs",
  "desktop-app-vue/scripts/project-goal-private-openai-discover.cjs",
  "desktop-app-vue/src/main/task/project-goal-volcengine-model.js",
  "desktop-app-vue/src/main/task/project-goal-model-drafts.js",
  "desktop-app-vue/src/main/task/project-goal-ipc.js",
  "desktop-app-vue/src/main/task/__tests__/project-goal-volcengine-fixture.cjs",
  "desktop-app-vue/src/main/task/__tests__/project-goal-openai-protocol.test.cjs",
  "desktop-app-vue/src/main/task/__tests__/project-goal-model-drafts-ipc.test.js",
  "desktop-app-vue/src/renderer/components/projects/ProjectGoalModelDraftsPanel.vue",
  "desktop-app-vue/src/renderer/components/LLMSettings.vue",
  "packages/cli/src/commands/setup.js",
  "packages/cli/src/lib/llm-onboarding-catalog.json",
  "packages/cli/scripts/sync-llm-onboarding.mjs",
  "packages/cli/__tests__/unit/llm-onboarding-catalog.test.js",
  "packages/cli/__tests__/unit/setup-deployment-readiness.test.js",
  "packages/cli/__tests__/unit/vscode-ext-llm-connection-test.test.js",
  "packages/cli/__tests__/unit/vscode-ext-local-compute-form.test.js",
  "packages/cli/__tests__/integration/llm-connection-config.test.js",
  "packages/vscode-extension/src/ui/llm-config-panel.js",
  "packages/vscode-extension/src/vendor/llm-onboarding-presets.json",
  "packages/vscode-extension/media/llm-config.js",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LlmConfig.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LlmConnectionPanel.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConfigureLlmAction.java",
  "packages/jetbrains-plugin/src/main/resources/messages/CcBundle.properties",
  "packages/jetbrains-plugin/src/main/resources/messages/CcBundle_zh.properties",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/LlmConfigTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/LlmConnectionPanelTest.java",
  "packages/vscode-extension/README.md",
  "packages/jetbrains-plugin/README.md",
  "packages/cli/README.md",
  "docs/research/agents/README.md",
  "docs/research/agents/chainlesschain-dots-muse-mods-analysis-2026-10-06.md",
  "docs/research/agents/dots-muse-mods-implementation-progress-2026-10-07.md",
];
for (const file of [
  ...owned.filter((file) => /\.(?:js|mjs|cjs)$/u.test(file)),
  relative(__filename),
])
  command(process.execPath, ["--check", file]);
command(process.execPath, [
  "packages/cli/scripts/sync-llm-onboarding.mjs",
  "--check",
]);
command(process.execPath, [
  "desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs",
]);
command("git", ["diff", "--check"]);
command(process.execPath, [
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  ...owned.filter((file) => /\.(?:js|mjs|cjs|json|md|vue)$/u.test(file)),
  relative(__filename),
  relative(path.join(__dirname, "README.md")),
]);
fs.writeFileSync(
  path.join(__dirname, "checks.json"),
  JSON.stringify(checks, null, 2) + "\n",
);
// PowerShell redirected the TAP report as UTF-16; store portable UTF-8.
const tapFile = path.join(__dirname, "protocol-tests.tap");
const tapBytes = fs.readFileSync(tapFile);
if (tapBytes[0] === 255 && tapBytes[1] === 254)
  fs.writeFileSync(tapFile, tapBytes.subarray(2).toString("utf16le"));
const tap = fs.readFileSync(tapFile, "utf8");
const jsonTests = [
  "cli-ide-tests.json",
  "desktop-tests.json",
  "renderer-tests.json",
].map((file) => {
  const r = read(file);
  return {
    file,
    files: r.testResults.length,
    tests: r.numTotalTests,
    passed: r.numPassedTests,
    failed: r.numFailedTests,
    skipped: r.numPendingTests,
  };
});
const nodeTests = {
  file: "protocol-tests.tap",
  files: 4,
  tests: Number(tap.match(/^# tests (\d+)$/mu)?.[1]),
  passed: Number(tap.match(/^# pass (\d+)$/mu)?.[1]),
  failed: Number(tap.match(/^# fail (\d+)$/mu)?.[1]),
  skipped: Number(tap.match(/^# skipped (\d+)$/mu)?.[1]),
};
const junit = ["LlmConfigTest", "LlmConnectionPanelTest"].map((name) => {
  const file = `TEST-com.chainlesschain.ide.${name}.xml`;
  const xml = fs.readFileSync(
    path.join(root, "packages/jetbrains-plugin/build/test-results/test", file),
    "utf8",
  );
  fs.writeFileSync(path.join(__dirname, file), xml);
  const attribute = (key) =>
    Number(xml.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1]);
  return {
    file,
    files: 1,
    tests: attribute("tests"),
    passed:
      attribute("tests") -
      attribute("failures") -
      attribute("errors") -
      attribute("skipped"),
    failed: attribute("failures") + attribute("errors"),
    skipped: attribute("skipped"),
  };
});
const live = read("live-results.json");
const providerUsage = live.cases
  .flatMap((row) => row.providerUsage)
  .map((row) => row.usage);
const modelSource =
  "desktop-app-vue/src/main/task/project-goal-volcengine-model.js";
const currentSource = fs.readFileSync(path.join(root, modelSource), "utf8");
const newline = currentSource.includes("\r\n") ? "\r\n" : "\n";
const oldSource = currentSource.replace(
  /  let url;\r?\n  try \{\r?\n    url = new URL\(value\);\r?\n  \} catch \{\r?\n    fail\("GOAL_MODEL_PRIVATE_ENDPOINT_REQUIRED"\);\r?\n  \}/u,
  "  const url = new URL(value);",
);
const reconstructed = oldSource.replace(/\r?\n/gu, newline);
if (hash(reconstructed) === live.sources[modelSource])
  fs.writeFileSync(
    path.join(__dirname, "live-adapter-source.js.txt"),
    reconstructed,
  );
const suites = [...jsonTests, nodeTests, ...junit];
const reportFiles = (file, cwd) =>
  read(file)
    .testResults.map((row) =>
      path.relative(path.join(root, cwd), row.name).split(path.sep).join("/"),
    )
    .join(" ");
const jetbrainsArtifact =
  "packages/jetbrains-plugin/build/distributions/chainlesschain-ide-bridge-0.4.195.zip";
const summary = {
  generatedAt: new Date().toISOString(),
  baseline: git("rev-parse", "HEAD"),
  branch: git("branch", "--show-current"),
  tests: suites,
  totals: suites.reduce(
    (sum, row) =>
      Object.fromEntries(
        Object.keys(sum).map((key) => [key, sum[key] + row[key]]),
      ),
    { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 },
  ),
  live: {
    file: "live-results.json",
    status: live.status,
    calls: live.cases.length,
    promptTokens: providerUsage.reduce((n, u) => n + u.promptTokens, 0),
    completionTokens: providerUsage.reduce((n, u) => n + u.completionTokens, 0),
    costUsd: null,
    billingVerified: false,
    independentBusinessEvaluation: false,
  },
  checks: {
    file: "checks.json",
    passed: checks.filter((row) => row.exitCode === 0).length,
    failed: checks.filter((row) => row.exitCode !== 0).length,
  },
  jetbrainsBuild: {
    result: "passed",
    artifact: jetbrainsArtifact,
    bytes: fs.statSync(path.join(root, jetbrainsArtifact)).size,
    sha256: hash(fs.readFileSync(path.join(root, jetbrainsArtifact))),
    published: false,
  },
  verifierSha256: hash(fs.readFileSync(__filename)),
  sources: Object.fromEntries(
    owned.map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
  ),
  liveSourceBoundary:
    "Paid calls ran before private URL error normalization was hardened. The original adapter is archived if its recorded hash matches; the Volcengine wire payload/transport did not change. No paid rerun.",
  commands: [
    "node desktop-app-vue/scripts/project-goal-volcengine-live.cjs --confirm-live (explicit paid opt-in, exactly two synthetic cases)",
    "node --test desktop-app-vue/src/main/task/__tests__/project-goal-model-protocol.test.cjs desktop-app-vue/src/main/task/__tests__/project-goal-openai-protocol.test.cjs desktop-app-vue/src/main/task/__tests__/project-goal-model-crash.test.cjs desktop-app-vue/src/main/task/__tests__/board-report-summary-model.test.cjs",
    `cwd packages/cli: node ../../node_modules/vitest/vitest.mjs run --config vitest.config.js ${reportFiles("cli-ide-tests.json", "packages/cli")} --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-volcengine-live-2026-11-06/cli-ide-tests.json`,
    `cwd desktop-app-vue: node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs ${reportFiles("desktop-tests.json", "desktop-app-vue")} --reporter=json --outputFile=../docs/research/agents/evidence/dmm-volcengine-live-2026-11-06/desktop-tests.json (real Windows ACL/loopback environment)`,
    `cwd desktop-app-vue: node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs ${reportFiles("renderer-tests.json", "desktop-app-vue")} --reporter=json --outputFile=../docs/research/agents/evidence/dmm-volcengine-live-2026-11-06/renderer-tests.json`,
    "cwd packages/jetbrains-plugin: JAVA_HOME=<local JBR 21>; gradlew.bat -Porg.gradle.java.installations.paths=<local JBR 21> --offline --no-daemon test --tests com.chainlesschain.ide.LlmConfigTest --tests com.chainlesschain.ide.LlmConnectionPanelTest buildPlugin --console=plain",
    "node docs/research/agents/evidence/dmm-volcengine-live-2026-11-06/verify.cjs (no inference)",
  ],
  boundaries: {
    syntheticProjectAndMemory: true,
    signedTestDeployment: true,
    actualVolcengineInference: true,
    lexdataInference: false,
    lexdataDiscovery:
      "Two failed discovery attempts; the second reported ECONNRESET. No HTTP status and zero inference.",
    actualElectronOrIdeGui: false,
    published: false,
    versionsChanged: false,
    pending: [
      "LEXDATA network/model integration",
      "Independent business samples and effect assessment",
      "Other/background execution domains",
      "Actual GUI journey",
      "Exact commit multi-platform release gates and rollout/rollback",
    ],
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
    live: summary.live,
  }),
);
if (
  summary.totals.failed ||
  summary.checks.failed ||
  summary.live.status !== "passed"
)
  process.exitCode = 1;
