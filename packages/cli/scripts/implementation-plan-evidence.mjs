#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const directory = path.join(
  repository,
  "docs/research/cli/evidence/implementation-plan-2026-10-15",
);
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const git = (args) =>
  execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  }).trim();
const read = (name) => fs.readFileSync(path.join(directory, name));
const suites = new Map();
const reports = [];
// Later targeted reports supersede the same file's earlier run; no double count.
for (const name of [
  "cli-tests-final.json",
  "context-tier-tests.json",
  "usage-ui-tests.json",
  "tier-entry-tests-final.json",
]) {
  const bytes = read(name);
  const value = JSON.parse(bytes);
  if (!value.success || value.numFailedTests || value.numPendingTests)
    throw new Error(`Test report is not fully passing: ${name}`);
  reports.push({ path: name, digest: digest(bytes), success: value.success });
  for (const suite of value.testResults) {
    const normalized = suite.name.replaceAll("\\", "/");
    const start = normalized.indexOf("/packages/cli/");
    if (start < 0)
      throw new Error("Test suite is outside the CLI evidence scope");
    if (suite.assertionResults.some((item) => item.status !== "passed"))
      throw new Error("Unverified assertion in evidence");
    suites.set(normalized.slice(start + 1), {
      path: normalized.slice(start + 1),
      assertions: suite.assertionResults.length,
      status: "passed",
      report: name,
    });
  }
}
function nodeResult(name) {
  const bytes = read(name),
    xml = bytes.toString("utf8");
  const total = Number(xml.match(/<!-- tests (\d+) -->/u)?.[1]);
  const pass = Number(xml.match(/<!-- pass (\d+) -->/u)?.[1]);
  if (
    !Number.isSafeInteger(total) ||
    total !== pass ||
    /<(?:failure|error|skipped)\b/u.test(xml)
  )
    throw new Error(`Node test report is not passing: ${name}`);
  return { report: name, digest: digest(bytes), tests: total, passed: pass };
}
const javaBytes = read("jetbrains-tests-final.xml"),
  javaXml = javaBytes.toString("utf8");
const javaTests = Number(javaXml.match(/<testsuite[^>]*\btests="(\d+)"/u)?.[1]);
if (
  !Number.isSafeInteger(javaTests) ||
  /<(?:failure|error|skipped)\b/u.test(javaXml)
)
  throw new Error("JetBrains test evidence is not passing");
const liveBytes = read("volcengine-live.json"),
  live = JSON.parse(liveBytes);
const finalMemoryBytes = read("memory-query-verified-cache-final.json"),
  memory = JSON.parse(finalMemoryBytes);
for (const [file, expected] of Object.entries(memory.implementationSha256)) {
  if (
    digest(
      fs.readFileSync(
        path.join(
          repository,
          "packages/cli/src/lib/context-memory-kernel",
          file,
        ),
      ),
    ) !==
    "sha256:" + expected
  )
    throw new Error("Measured memory implementation has changed");
}
const sourcePaths = [
  ...new Set([
    ...git([
      "diff",
      "--name-only",
      "HEAD",
      "--",
      "packages/cli",
      "packages/vscode-extension",
      "packages/jetbrains-plugin",
    ]).split("\n"),
    ...git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "packages/cli",
      "packages/vscode-extension",
      "packages/jetbrains-plugin",
    ]).split("\n"),
  ]),
]
  .filter(Boolean)
  .sort();
const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw new Error("--output is required");
const summary = {
  schema: "chainlesschain.implementation-plan-evidence-summary/v1",
  capturedAt: new Date().toISOString(),
  sourceCommit: git(["rev-parse", "HEAD"]),
  sourceBindingBasis:
    "Worktree snapshot captured after testing; per-run immutable source binding is only asserted where the original report recorded it.",
  worktreeBindings: sourcePaths.map((file) => ({
    path: file,
    digest: digest(fs.readFileSync(path.join(repository, file))),
  })),
  cli: {
    files: suites.size,
    assertions: [...suites.values()].reduce(
      (sum, suite) => sum + suite.assertions,
      0,
    ),
    passed: true,
    reports,
    suites: [...suites.values()],
  },
  budgetAndCatalog: nodeResult("budget-and-review-final.xml"),
  vscodeGoals: nodeResult("vscode-goal-tests.xml"),
  jetbrains: {
    report: "jetbrains-tests-final.xml",
    digest: digest(javaBytes),
    tests: javaTests,
    passed: true,
    realCompilation: true,
  },
  volcengine: {
    report: "volcengine-live.json",
    digest: digest(liveBytes),
    functionalChecks: live.checks.length,
    functionalChecksPassed: live.checks.filter((row) => row.status === "passed")
      .length,
    requests: live.requests.length,
    knownEstimatedCostUsd: live.knownEstimatedCostUsd,
    totalEstimatedCostUsd: live.totalEstimatedCostUsd,
    billingVerified: false,
    outputUpperBoundVerified: false,
    originalSourceBindingRecorded: false,
    formalSample: false,
  },
  memory: {
    report: "memory-query-verified-cache-final.json",
    digest: digest(finalMemoryBytes),
    sourceBindingsMatchCurrent: true,
    approvedSlo: false,
  },
  formalEvaluation: {
    tasks: 36,
    executedTasks: 0,
    firstRuns: 9,
    executedFirstRuns: 0,
    executionStatus: "NOT_RUN",
    paidReady: false,
    nativeAdmission: "NOT_ADMITTED",
    promotion: "HOLD",
  },
};
fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
fs.writeFileSync(values.output, JSON.stringify(summary, null, 2) + "\n");
console.log(
  JSON.stringify({
    cliFiles: summary.cli.files,
    cliAssertions: summary.cli.assertions,
    budgetAndCatalog: summary.budgetAndCatalog.tests,
    vscodeGoals: summary.vscodeGoals.tests,
    jetbrains: javaTests,
    formalEvaluation: summary.formalEvaluation,
  }),
);
