import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, "..", "..");
const desktopRoot = path.join(repoRoot, "desktop-app-vue");
const selectorPath = path.join(
  desktopRoot,
  "scripts",
  "cowork-ci-test-selector.js",
);
const selector = require(selectorPath);
const TestRunner = require(path.join(desktopRoot, "scripts", "test-runner.js"));
const AutoFixRunner = require(
  path.join(desktopRoot, "scripts", "auto-fix-runner.js"),
);
const cliWindowsSandboxContractChanges = [
  "packages/cli/__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
  "packages/cli/__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
  "packages/cli/test/fixtures/windows-sandbox-global-teardown/contract-case.mjs",
  "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
];
const cliWindowsSandboxContractTests = [
  "__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
  "__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
];

function extractNodeVerdict(workflow, stepName) {
  const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(
    new RegExp(`name: ${escapedStepName}[\\s\\S]*?node -e "([^"\\r\\n]+)"`),
  );
  assert.ok(match, `Unable to find inline Node verdict for ${stepName}`);
  return match[1];
}

function runNodeVerdict(source, environment) {
  return spawnSync(process.execPath, ["-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function extractYamlScript(workflow, anchor) {
  const anchoredWorkflow = workflow.slice(workflow.indexOf(anchor));
  const lines = anchoredWorkflow.split(/\r?\n/);
  const scriptLineIndex = lines.findIndex(
    (line) => line.trim() === "script: |",
  );
  assert.notEqual(
    scriptLineIndex,
    -1,
    `Unable to find script block for ${anchor}`,
  );

  const scriptIndent = lines[scriptLineIndex].match(/^\s*/)[0].length;
  const contentIndent = scriptIndent + 2;
  const scriptLines = [];

  for (const line of lines.slice(scriptLineIndex + 1)) {
    if (line.trim() === "") {
      scriptLines.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length <= scriptIndent) {
      break;
    }
    scriptLines.push(line.slice(contentIndent));
  }

  return scriptLines.join("\n");
}

test("root compatibility entry points fail loudly instead of passing", () => {
  for (const scriptName of [
    "cowork-ci-test-selector.js",
    "test-runner.js",
    "auto-fix-runner.js",
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", scriptName)],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 2, `${scriptName} must not report success`);
    assert.match(result.stderr, /desktop-app-vue|WRONG_ENTRY_POINT/);
  }
});

test("selector invokes git diff with validated argument arrays", () => {
  let invocation;
  const changedFiles = selector.getChangedFilesCI({
    baseRef: "feature/safe-ref",
    spawn(command, args, options) {
      invocation = { command, args, options };
      return {
        status: 0,
        stdout:
          "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js\n",
        stderr: "",
      };
    },
  });

  assert.deepEqual(changedFiles, [
    "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js",
  ]);
  assert.equal(invocation.command, "git");
  assert.deepEqual(invocation.args, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "origin/feature/safe-ref...HEAD",
    "--",
  ]);
  assert.equal(invocation.options.shell, undefined);
  assert.throws(
    () => selector.validateBaseRef("main; echo injected"),
    (error) => error.code === "INVALID_BASE_REF",
  );

  const pushBaseSha = "a".repeat(40);
  const pushChangedFiles = selector.getChangedFilesCI({
    baseSha: pushBaseSha,
    spawn(command, args) {
      invocation = { command, args };
      return {
        status: 0,
        stdout: ".github/workflows/test.yml\n",
        stderr: "",
      };
    },
  });
  assert.deepEqual(pushChangedFiles, [".github/workflows/test.yml"]);
  assert.deepEqual(invocation.args, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    `${pushBaseSha}...HEAD`,
    "--",
  ]);
  assert.throws(
    () => selector.validateBaseSha("main; echo injected"),
    (error) => error.code === "INVALID_BASE_SHA",
  );
  assert.throws(
    () => selector.validateBaseSha("0".repeat(40)),
    (error) => error.code === "INVALID_BASE_SHA",
  );
});

test("selector maps repository-root paths to executable desktop unit tests", () => {
  const selection = selector.createSelection([
    "desktop-app-vue/src/main/auth/sso-session-manager.js",
  ]);

  assert.equal(selection.suite, "desktop-unit");
  assert.equal(selection.mode, "targeted");
  assert.ok(
    selection.selectedTests.includes(
      "src/main/auth/__tests__/sso-session-manager.test.js",
    ),
  );
  assert.ok(selection.selectedTests.every((file) => !file.includes("\\")));

  const command = selector.commandForSelection(selection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.equal(command.executable, process.execPath);
  assert.equal(command.args[0], "C:/safe/vitest.mjs");
  assert.equal(command.args[1], "run");

  const coordinatorSelection = selector.createSelection([
    "desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js",
  ]);
  for (const relatedTest of [
    "src/main/ai-engine/agents/__tests__/agent-coordinator-parallel.test.js",
    "src/main/ai-engine/agents/__tests__/agent-coordinator-eviction.test.js",
    "src/main/ai-engine/agents/__tests__/agent-coordinator-sessions-eviction.test.js",
    "tests/unit/ai-engine/agents/agent-coordinator-select.test.js",
  ]) {
    assert.ok(
      coordinatorSelection.selectedTests.includes(relatedTest),
      `missing related test ${relatedTest}`,
    );
  }

  const fullSelection = selector.createSelection([
    "desktop-app-vue/package.json",
  ]);
  assert.equal(fullSelection.mode, "full");
  assert.deepEqual(fullSelection.selectedTests, ["tests/unit", "src"]);

  const ideSelection = selector.createSelection([
    "packages/vscode-extension/package.json",
    "packages/jetbrains-plugin/build.gradle.kts",
  ]);
  assert.equal(ideSelection.mode, "targeted");
  assert.deepEqual(ideSelection.selectedTests, [
    "tests/unit/did/did-manager.test.js",
    "tests/unit/llm/llm-service.test.js",
  ]);
  assert.ok(
    ideSelection.mappings.every(
      (mapping) => mapping.reason === "covered-by-ide-dedicated-gates",
    ),
  );

  const ideCommand = selector.commandForSelection(ideSelection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.ok(ideCommand.args.includes("--pool=forks"));
  assert.ok(ideCommand.args.includes("--maxWorkers=2"));
  assert.ok(!ideCommand.args.includes("--pool=threads"));
});

test("selector maps exact Windows sandbox support paths to CLI contracts", () => {
  const selection = selector.createSelection(cliWindowsSandboxContractChanges);

  assert.equal(selection.suite, "cli-unit");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(selection.selectedTests, cliWindowsSandboxContractTests);
  assert.deepEqual(selection.testSuites, [
    {
      suite: "cli-unit",
      runner: "vitest",
      root: "packages/cli",
      mode: "targeted",
      selectedTests: cliWindowsSandboxContractTests,
    },
  ]);

  const expectedTestsByChange = new Map([
    [cliWindowsSandboxContractChanges[0], [cliWindowsSandboxContractTests[0]]],
    [cliWindowsSandboxContractChanges[1], [cliWindowsSandboxContractTests[1]]],
    [cliWindowsSandboxContractChanges[2], [cliWindowsSandboxContractTests[0]]],
    [cliWindowsSandboxContractChanges[3], cliWindowsSandboxContractTests],
  ]);
  for (const mapping of selection.mappings) {
    assert.equal(mapping.suite, "cli-unit");
    assert.deepEqual(mapping.tests, expectedTestsByChange.get(mapping.file));
  }

  const command = selector.commandForSelection(selection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.equal(command.cwd, path.join(repoRoot, "packages", "cli"));
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args.slice(0, 2), ["C:/safe/vitest.mjs", "run"]);
  assert.deepEqual(
    command.args.filter((argument) => argument.endsWith(".test.js")),
    cliWindowsSandboxContractTests,
  );
  assert.ok(!command.args.includes("--pool=threads"));
});

test("selector changes run integrity and CLI contracts without desktop fallback", () => {
  const selection = selector.createSelection([
    ...cliWindowsSandboxContractChanges,
    "desktop-app-vue/scripts/cowork-ci-test-selector.js",
    "scripts/__tests__/ci-gate-integrity.test.mjs",
  ]);

  assert.equal(selection.suite, "unit-matrix");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(
    selection.testSuites.map((testSuite) => testSuite.suite),
    ["ci-gate-integrity", "cli-unit"],
  );
  assert.ok(
    selection.testSuites.every(
      (testSuite) => testSuite.suite !== "desktop-unit",
    ),
  );

  const commands = selector.commandsForSelection(selection, {
    cliVitestEntrypoint: "C:/safe/cli-vitest.mjs",
  });
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], {
    suite: "ci-gate-integrity",
    cwd: repoRoot,
    executable: process.execPath,
    args: ["--test", "scripts/__tests__/ci-gate-integrity.test.mjs"],
  });
  assert.equal(commands[1].suite, "cli-unit");
  assert.equal(commands[1].cwd, path.join(repoRoot, "packages", "cli"));
  assert.deepEqual(commands[1].args.slice(0, 2), [
    "C:/safe/cli-vitest.mjs",
    "run",
  ]);
  assert.throws(
    () => selector.commandForSelection(selection),
    (error) => error.code === "MULTIPLE_TEST_COMMANDS",
  );
});

test("selector fails closed for an unmapped change or failed detection", () => {
  assert.throws(
    () => selector.createSelection(["packages/cli/src/index.js"]),
    (error) =>
      error.code === "UNMAPPED_CHANGED_FILES" &&
      error.details.unmappedFiles.includes("packages/cli/src/index.js"),
  );
  assert.throws(
    () =>
      selector.createSelection([
        "packages/vscode-extension/../../packages/cli/src/index.js",
      ]),
    (error) =>
      error.code === "UNMAPPED_CHANGED_FILES" &&
      error.details.unmappedFiles.includes(
        "packages/vscode-extension/../../packages/cli/src/index.js",
      ),
  );

  assert.throws(
    () =>
      selector.getChangedFilesCI({
        spawn() {
          return { status: 128, stdout: "", stderr: "missing base" };
        },
      }),
    (error) => error.code === "GIT_DIFF_FAILED",
  );
});

test("IDE selector delegation stays bound to both dedicated PR workflows", () => {
  const workflowFiles = [
    ".github/workflows/ide-extensions.yml",
    ".github/workflows/ide-arm64-validation.yml",
  ];
  const delegatedPaths = [
    '      - "packages/vscode-extension/**"',
    '      - "packages/jetbrains-plugin/**"',
  ];

  for (const workflowFile of workflowFiles) {
    const workflow = fs.readFileSync(path.join(repoRoot, workflowFile), "utf8");
    for (const delegatedPath of delegatedPaths) {
      assert.ok(
        workflow.split(delegatedPath).length - 1 >= 2,
        `${workflowFile} must cover ${delegatedPath.trim()} on push and pull_request`,
      );
    }
  }
});

test("selector CLI emits machine-readable output and non-zero fail-closed status", () => {
  const known = spawnSync(
    process.execPath,
    [
      selectorPath,
      "--dry-run",
      "--json",
      "--changed-file",
      "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js",
    ],
    { cwd: desktopRoot, encoding: "utf8" },
  );
  assert.equal(known.status, 0, known.stderr);
  const machineLine = known.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("COWORK_TEST_SELECTION_JSON="));
  assert.ok(machineLine);
  const payload = JSON.parse(
    machineLine.slice("COWORK_TEST_SELECTION_JSON=".length),
  );
  assert.equal(payload.status, "dry-run");
  assert.equal(payload.suite, "desktop-unit");
  assert.ok(payload.selectedTests.length > 0);

  const unknown = spawnSync(
    process.execPath,
    [
      selectorPath,
      "--dry-run",
      "--json",
      "--changed-file",
      "packages/cli/src/index.js",
    ],
    { cwd: desktopRoot, encoding: "utf8" },
  );
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /"status":"fail-closed"/);
});

test("CLI suite spawn failures cannot downgrade to desktop fallback", (t) => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-selector-output-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const githubOutput = path.join(temporaryRoot, "github-output.txt");
  const output = [];
  const originalLog = console.log;
  const originalGitHubOutput = process.env.GITHUB_OUTPUT;
  console.log = (...values) => output.push(values.join(" "));
  process.env.GITHUB_OUTPUT = githubOutput;

  let exitCode;
  let spawnOptions;
  try {
    exitCode = selector.main(
      [
        "--json",
        "--changed-file",
        "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
      ],
      {
        spawn(_command, _args, options) {
          spawnOptions = options;
          return { error: new Error("spawn denied") };
        },
      },
    );
  } finally {
    console.log = originalLog;
    if (originalGitHubOutput === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = originalGitHubOutput;
    }
  }

  assert.equal(exitCode, 1);
  const machineLine = output.find((line) =>
    line.startsWith("COWORK_TEST_SELECTION_JSON="),
  );
  assert.ok(machineLine);
  const payload = JSON.parse(
    machineLine.slice("COWORK_TEST_SELECTION_JSON=".length),
  );
  assert.equal(payload.status, "failed");
  assert.equal(payload.mode, "targeted");
  assert.equal(payload.failedSuite, "cli-unit");
  assert.equal(payload.code, "TEST_SPAWN_FAILED");
  assert.equal(
    Object.hasOwn(spawnOptions.env, "GITHUB_OUTPUT"),
    false,
    "nested tests must not overwrite the selector step outputs",
  );
  assert.match(fs.readFileSync(githubOutput, "utf8"), /test-mode=targeted/);
});

test("test runner records spawn failures and returns a failing aggregate code", async (t) => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "cc-ci-test-runner-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));

  const runner = new TestRunner({
    cwd: temporaryRoot,
    spawn() {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn denied")));
      return child;
    },
  });
  const result = await runner.runTestSuite("Unit", "npm", ["run", "test:unit"]);

  assert.equal(result.passed, false);
  assert.equal(runner.results.unit.error, "spawn denied");
  assert.equal(await runner.generateReport(), 1);
});

test("test runner is wired to real suite commands", async () => {
  const runner = new TestRunner();
  const calls = [];
  runner.runTestSuite = async (name, command, args) => {
    calls.push({ name, command, args });
    const result = { name, passed: true, exitCode: 0, duration: 0 };
    runner.results[name.toLowerCase().replace(/\s+/g, "")] = result;
    return result;
  };
  runner.generateReport = async () => 0;

  assert.equal(await runner.runAll(), 0);
  assert.deepEqual(
    calls.map((call) => [call.name, call.command, call.args]),
    [
      ["Unit", "npm", ["run", "test:unit"]],
      ["Integration", "npm", ["run", "test:integration"]],
      ["Database", "node", ["scripts/test-database.js"]],
      ["UKey", "node", ["scripts/test-ukey.js"]],
      ["Performance", "npm", ["run", "test:performance"]],
    ],
  );
});

test("UKey smoke skips unsupported hosts and propagates real failures", () => {
  const script = fs.readFileSync(
    path.join(desktopRoot, "scripts", "test-ukey.js"),
    "utf8",
  );

  assert.match(script, /process\.platform !== ["']win32["']/);
  assert.match(script, /UKey hardware smoke SKIPPED/);
  assert.match(script, /no XinJinKe device detected/);
  assert.match(script, /catch \(error\)[\s\S]*?throw error/);
  assert.match(script, /process\.exitCode = 1/);
  assert.equal(
    (script.match(/assertSmoke\(\s*verifyResult\.success/g) ?? []).length,
    1,
  );
  assert.match(script, /assertSmoke\(\s*decrypted === testData/);
  assert.match(script, /assertSmoke\(verified/);
  assert.match(script, /assertSmoke\(!isUnlocked/);
  assert.match(script, /assertSmoke\(\s*testValue === ["']testValue["']/);
  assert.ok((script.match(/throw error;/g) ?? []).length >= 4);
  assert.doesNotMatch(script, /runTests\(\)\.catch\(console\.error\)/);
});

test("sharp-loading main-process tests stay out of the jsdom canvas process", () => {
  const nodeEnvironmentTests = [
    "desktop-app-vue/tests/unit/media/image-engine.test.js",
    "desktop-app-vue/src/main/blockchain/__tests__/order-export.test.js",
    "desktop-app-vue/src/main/ai-engine/__tests__/real-implementations-reminder.test.js",
    "desktop-app-vue/src/main/remote/__tests__/remote-gateway.test.js",
    "desktop-app-vue/tests/remote/integration/remote-integration.test.js",
  ];

  for (const relativePath of nodeEnvironmentTests) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(
      source,
      /^\/\/ @vitest-environment node/m,
      `${relativePath} must not load sharp in Vitest's jsdom/canvas process`,
    );
  }
});

test("auto-fix command is diagnostic-only and fails when no safe fix exists", async (t) => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "cc-ci-auto-fix-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const resultsDirectory = path.join(temporaryRoot, "test-results");
  const sentinelDirectory = path.join(temporaryRoot, "node_modules");
  const sentinel = path.join(sentinelDirectory, "sentinel.txt");
  await fsp.mkdir(resultsDirectory, { recursive: true });
  await fsp.mkdir(sentinelDirectory, { recursive: true });
  await fsp.writeFile(sentinel, "preserve", "utf8");
  await fsp.writeFile(
    path.join(resultsDirectory, "test-report.json"),
    JSON.stringify({
      results: {
        unit: {
          name: "Unit",
          passed: false,
          exitCode: 1,
          error: "Cannot find module example",
        },
      },
    }),
    "utf8",
  );

  const runner = new AutoFixRunner({ cwd: temporaryRoot });
  assert.equal(await runner.run(), 2);
  assert.equal(await fsp.readFile(sentinel, "utf8"), "preserve");
  const report = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "auto-fix-report.json"),
      "utf8",
    ),
  );
  assert.equal(report.mode, "diagnostic-only");
  assert.deepEqual(report.mutationsApplied, []);
  assert.equal(report.diagnostics[0].safeAutomaticFixAvailable, false);

  const retryRunner = new TestRunner({
    cwd: temporaryRoot,
    reportSuffix: "retry",
  });
  retryRunner.results.unit = {
    name: "Unit",
    passed: true,
    exitCode: 0,
    duration: 1,
  };
  assert.equal(await retryRunner.generateReport(), 0);
  const primaryReportAfterRetry = JSON.parse(
    await fsp.readFile(path.join(resultsDirectory, "test-report.json"), "utf8"),
  );
  const retryReport = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "test-report-retry.json"),
      "utf8",
    ),
  );
  assert.equal(primaryReportAfterRetry.results.unit.passed, false);
  assert.equal(retryReport.results.unit.passed, true);
  const reportAfterRetry = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "auto-fix-report.json"),
      "utf8",
    ),
  );
  assert.deepEqual(reportAfterRetry, report);
});

test("standalone CLI dependency install vendors exact checkout packages", () => {
  const installer = fs.readFileSync(
    path.join(
      repoRoot,
      ".github",
      "scripts",
      "ci-install-cli-production-deps.sh",
    ),
    "utf8",
  );
  const cliManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json")),
  );
  const internalPackages = Object.keys(cliManifest.dependencies).filter(
    (name) => name.startsWith("@chainlesschain/"),
  );

  for (const packageName of internalPackages) {
    const directoryName = packageName.slice("@chainlesschain/".length);
    assert.ok(
      installer.includes(`"$repo_root/packages/${directoryName}"`),
      `${packageName} must be installed from the exact checkout`,
    );
  }
  assert.match(installer, /expectedVersion !== manifest\.version/);
  assert.match(installer, /--install-links/);
  assert.match(installer, /--workspaces=false/);
  assert.match(installer, /ci-npm-retry\.sh/);
  assert.match(installer, /isSymbolicLink\(\)/);
  assert.match(installer, /"\$mode" == "--pack-candidates"/);

  const testWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  assert.match(
    testWorkflow,
    /name: Pack CLI and exact internal dependency candidates[\s\S]*?ci-install-cli-production-deps\.sh[\s\S]*?--pack-candidates/,
  );
  assert.match(
    testWorkflow,
    /name: Global install from tarball \(exercises postinstall\)[\s\S]*?npm install -g "\$RUNNER_TEMP\/cli-global-install-candidates\/"\*\.tgz/,
  );
  assert.match(
    testWorkflow,
    /name: Global install from tarball \(exercises postinstall\)[\s\S]*?npm_config_build_from_source: "true"[\s\S]*?NODE_GYP_FORCE_PYTHON:/,
  );
});

test("workflow uses step outcomes and a final non-zero verdict", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test-automation-full.yml"),
    "utf8",
  );

  assert.match(workflow, /^name: Full Test Automation with Diagnostics/m);
  assert.doesNotMatch(workflow, /Attempt auto-fix|无法自动修复|尝试运行/);
  assert.match(
    workflow,
    /name: Install dependencies[\s\S]*?ci-npm-retry\.sh" \\\n\s+npm install --legacy-peer-deps/,
  );
  assert.match(
    workflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?ci-install-cli-production-deps\.sh/,
  );
  assert.match(workflow, /Re-run tests for failure diagnosis/);
  assert.match(workflow, /TEST_REPORT_SUFFIX: retry/);
  assert.ok(
    workflow.indexOf("id: failure-diagnostics") <
      workflow.indexOf("id: retry-tests"),
  );
  assert.ok(
    workflow.indexOf("id: retry-tests") <
      workflow.indexOf("name: Upload test results"),
  );
  assert.match(workflow, /test-results\/auto-fix-report\.json/);
  assert.match(
    workflow,
    /Verify CI gate integrity contracts\s+run: node --test scripts\/__tests__\/ci-gate-integrity\.test\.mjs/,
  );
  assert.match(
    workflow,
    /id: primary-tests[\s\S]*?run: node scripts\/test-runner\.js[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /id: failure-diagnostics\s+if: steps\.primary-tests\.outcome == 'failure'[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /id: retry-tests\s+if: steps\.primary-tests\.outcome == 'failure'[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /name: Enforce comprehensive test result\s+if: always\(\)/,
  );
  assert.match(
    workflow,
    /PRIMARY_TEST_OUTCOME: \$\{\{ steps\.primary-tests\.outcome \}\}/,
  );
  assert.match(
    workflow,
    /RETRY_TEST_OUTCOME: \$\{\{ steps\.retry-tests\.outcome \}\}/,
  );
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /const dedupeMarker = `<!-- automated-test-failure:/);
  assert.match(workflow, /github\.paginate\(github\.rest\.issues\.listForRepo/);
  assert.match(workflow, /labels: 'automated-detection,test-failure'/);
  assert.match(workflow, /state: 'open'/);
  assert.match(workflow, /issues\.createComment\(/);
  assert.match(workflow, /Recorded repeated failure in issue/);
  assert.doesNotMatch(workflow, /title: `自动测试失败 - \$\{date\}`/);

  const verdict = extractNodeVerdict(
    workflow,
    "Enforce comprehensive test result",
  );
  assert.equal(
    runNodeVerdict(verdict, {
      PRIMARY_TEST_OUTCOME: "success",
      RETRY_TEST_OUTCOME: "skipped",
    }).status,
    0,
  );
  for (const retryOutcome of ["success", "failure", "skipped"]) {
    assert.equal(
      runNodeVerdict(verdict, {
        PRIMARY_TEST_OUTCOME: "failure",
        RETRY_TEST_OUTCOME: retryOutcome,
      }).status,
      1,
    );
  }
});

test("failure issue reporter updates an existing scope instead of duplicating it", async () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test-automation-full.yml"),
    "utf8",
  );
  const script = extractYamlScript(workflow, "name: Create Issue on Failure");
  const runReporter = new Function(
    "github",
    "context",
    "core",
    `return (async () => { ${script} })();`,
  );
  const marker =
    "<!-- automated-test-failure:Full Test Automation with Diagnostics:refs/heads/main -->";
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "chainlesschain", repo: "chainlesschain" },
    runId: 12345,
    ref: "refs/heads/main",
    sha: "abc123",
    actor: "chainlesschain",
    workflow: "Full Test Automation with Diagnostics",
    payload: {},
  };

  async function execute(openIssues) {
    const calls = { create: [], createComment: [], list: [], notices: [] };
    const listForRepo = () => {};
    const github = {
      paginate: async (endpoint, options) => {
        assert.equal(endpoint, listForRepo);
        calls.list.push(options);
        return openIssues;
      },
      rest: {
        issues: {
          listForRepo,
          create: async (options) => calls.create.push(options),
          createComment: async (options) => calls.createComment.push(options),
        },
      },
    };
    await runReporter(github, context, {
      notice: (message) => calls.notices.push(message),
    });
    return calls;
  }

  const repeated = await execute([{ number: 247, body: marker }]);
  assert.equal(repeated.create.length, 0);
  assert.equal(repeated.createComment.length, 1);
  assert.equal(repeated.createComment[0].issue_number, 247);
  assert.match(repeated.createComment[0].body, /不再重复建单/);
  assert.match(repeated.notices[0], /issue #247/);

  const firstOccurrence = await execute([]);
  assert.equal(firstOccurrence.createComment.length, 0);
  assert.equal(firstOccurrence.create.length, 1);
  assert.equal(firstOccurrence.list[0].state, "open");
  assert.equal(
    firstOccurrence.list[0].labels,
    "automated-detection,test-failure",
  );
  assert.match(firstOccurrence.create[0].title, /main/);
  assert.match(firstOccurrence.create[0].body, /automated-test-failure/);
});

test("unit workflow distinguishes selected-test failures from fail-closed fallback", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?ci-install-cli-production-deps\.sh/,
  );
  assert.match(
    workflow,
    /name: Checkout code[\s\S]*?uses: actions\/checkout@v5[\s\S]*?fetch-depth: 0/,
  );
  assert.match(workflow, /timeout-minutes: 75/);
  assert.match(
    workflow,
    /COWORK_PUSH_BASE_SHA: \$\{\{ github\.event_name == 'push' && github\.event\.before \|\| '' \}\}/,
  );
  assert.match(
    workflow,
    /id: fallback-tests\s+if: steps\.test-selector\.outcome == 'failure' && steps\.test-selector\.outputs\.test-mode == 'fail-closed'/,
  );
  assert.match(workflow, /npm exec --offline -- vitest run tests\/unit src/);
  assert.match(workflow, /--pool=forks --maxWorkers=2/);
  assert.doesNotMatch(workflow, /--pool=threads/);
  assert.doesNotMatch(workflow, /src\/main\/\*\*\/__tests__/);
  const fullSuiteWorkflow = workflow.slice(workflow.indexOf("full-tests:"));
  assert.match(
    fullSuiteWorkflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?name: Run all unit tests/,
  );
  const verdict = extractNodeVerdict(
    workflow,
    "Enforce selector or fallback result",
  );

  const selectedTestFailed = runNodeVerdict(verdict, {
    SELECTOR_OUTCOME: "failure",
    SELECTOR_MODE: "targeted",
    FALLBACK_OUTCOME: "skipped",
  });
  assert.equal(selectedTestFailed.status, 1);

  const fallbackPassed = runNodeVerdict(verdict, {
    SELECTOR_OUTCOME: "failure",
    SELECTOR_MODE: "fail-closed",
    FALLBACK_OUTCOME: "success",
  });
  assert.equal(fallbackPassed.status, 0, fallbackPassed.stderr);

  for (const fallbackOutcome of ["failure", "skipped"]) {
    const fallbackDidNotPass = runNodeVerdict(verdict, {
      SELECTOR_OUTCOME: "failure",
      SELECTOR_MODE: "fail-closed",
      FALLBACK_OUTCOME: fallbackOutcome,
    });
    assert.equal(fallbackDidNotPass.status, 1);
  }
});

test("PDH workflow bounds native test concurrency on Windows", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  const pdhWorkflow = workflow.slice(
    workflow.indexOf("  pdh-tests:"),
    workflow.indexOf("  full-tests:"),
  );

  assert.match(pdhWorkflow, /if \[\[ "\$RUNNER_OS" == "Windows" \]\]; then/);
  assert.match(pdhWorkflow, /VITEST_ARGS\+=\(--pool=forks --maxWorkers=2\)/);
  assert.match(
    pdhWorkflow,
    /npx vitest run --reporter=default "\$\{VITEST_ARGS\[@\]\}"/,
  );
});

test("legacy Linux release builds the embedded web panel before packaging", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release-linux-packages.yml"),
    "utf8",
  );
  const installPanel = workflow.indexOf(
    "name: Install embedded web panel dependencies",
  );
  const buildPanel = workflow.indexOf("name: Build embedded web panel");
  const buildPackages = workflow.indexOf("name: Build Linux packages");

  assert.ok(installPanel >= 0);
  assert.ok(buildPanel > installPanel);
  assert.ok(buildPackages > buildPanel);
  assert.match(
    workflow,
    /name: Install embedded web panel dependencies[\s\S]*?working-directory: packages\/web-panel[\s\S]*?npm ci --legacy-peer-deps[\s\S]*?name: Build embedded web panel[\s\S]*?working-directory: packages\/web-panel[\s\S]*?npm run build/,
  );
});

test("Android MobSF gate uses an immutable image and the supported REST API", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-build.yml"),
    "utf8",
  );
  const securityScan = workflow.slice(workflow.indexOf("  security-scan:"));

  assert.match(workflow, /- "packages\/agent-protocol\/\*\*"/);
  assert.doesNotMatch(securityScan, /continue-on-error:\s*true/);
  assert.doesNotMatch(securityScan, /manage\.py\s+scan/);
  assert.doesNotMatch(securityScan, /mobile-security-framework-mobsf:latest/);
  assert.match(
    securityScan,
    /mobile-security-framework-mobsf@sha256:[a-f0-9]{64}/,
  );
  for (const endpoint of ["upload", "scan", "report_json"]) {
    assert.match(securityScan, new RegExp(`/api/v1/${endpoint}`));
  }
  assert.match(securityScan, /jq --exit-status/);
  assert.match(securityScan, /name: Upload MobSF Report/);
});

test("Android remaining-module unit tests are a blocking gate", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const aggregateStart = workflow.indexOf(
    "- name: Run Remaining Module Tests and Generate Report",
  );
  const aggregateEnd = workflow.indexOf(
    "- name: Upload Test Results",
    aggregateStart,
  );

  assert.ok(aggregateStart >= 0);
  assert.ok(aggregateEnd > aggregateStart);
  const aggregateStep = workflow.slice(aggregateStart, aggregateEnd);
  assert.match(aggregateStep, /\.\/gradlew testDebugUnitTest --no-daemon/);
  assert.doesNotMatch(aggregateStep, /continue-on-error:\s*true/);
});

test("Android emulator matrix runs real instrumented tests from the project directory", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const matrixStart = workflow.indexOf("  instrumented-tests:");
  const matrixEnd = workflow.indexOf("  code-coverage:", matrixStart);
  assert.ok(matrixStart >= 0);
  assert.ok(matrixEnd > matrixStart);
  const matrix = workflow.slice(matrixStart, matrixEnd);

  assert.doesNotMatch(matrix, /continue-on-error:\s*true/);
  assert.doesNotMatch(matrix, /connectedAndroidTest --tests/);
  assert.doesNotMatch(
    matrix,
    /(P2PIntegrationTest|SocialPostUITest|ProjectEditorUITest)/,
  );
  assert.doesNotMatch(matrix, /^\s+cd android-app\s*$/m);
  assert.match(
    matrix,
    /cd android-app && \.\/gradlew :core-e2ee:connectedDebugAndroidTest/,
  );
  assert.match(
    matrix,
    /-Pandroid\.testInstrumentationRunnerArguments\.class=/,
  );
});
