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
      selector.getChangedFilesCI({
        spawn() {
          return { status: 128, stdout: "", stderr: "missing base" };
        },
      }),
    (error) => error.code === "GIT_DIFF_FAILED",
  );
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
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?npm install --no-package-lock --no-save --omit=dev --workspaces=false --legacy-peer-deps/,
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

test("unit workflow distinguishes selected-test failures from fail-closed fallback", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?ci-npm-retry\.sh" \\\n\s+npm install --no-package-lock --no-save --omit=dev --workspaces=false --legacy-peer-deps/,
  );
  assert.match(
    workflow,
    /id: fallback-tests\s+if: steps\.test-selector\.outcome == 'failure' && steps\.test-selector\.outputs\.test-mode == 'fail-closed'/,
  );
  assert.match(workflow, /npm exec --offline -- vitest run tests\/unit src/);
  assert.doesNotMatch(workflow, /src\/main\/\*\*\/__tests__/);
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
