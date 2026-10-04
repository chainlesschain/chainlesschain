import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  outcomeDigest,
  validateOutcomePlan,
  buildOutcomeReport,
} from "../../../../packages/cli/src/lib/eval/outcomes.js";

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, import.meta.url), "utf8"));
const plan = read("plan.json");
const catalog = read("tasks.json");
const bindings = read("comparison-bindings.json");
const fingerprint = fs
  .readFileSync(new URL("plan.sha256", import.meta.url), "utf8")
  .trim();
validateOutcomePlan(plan);
assert.equal(outcomeDigest(plan), fingerprint);
assert.equal(catalog.projectCommit, plan.commitSha);
assert.equal(catalog.tasks.length, 36);
assert.equal(new Set(catalog.tasks.map((task) => task.id)).size, 36);
assert.equal(
  plan.samples.filter((sample) => sample.kind === "task").length,
  36,
);
assert.equal(
  plan.samples.filter((sample) => sample.kind === "first-run").length,
  9,
);
assert.equal(
  plan.samples.reduce((sum, sample) => sum + sample.costBudget, 0),
  99,
);
for (const task of catalog.tasks) {
  assert.equal(task.status, "NOT_RUN");
  assert.ok(
    task.prompt && task.acceptance.length >= 3 && task.expectedFiles.length,
  );
  for (const source of task.sourcePaths)
    assert.ok(
      fs.existsSync(
        fileURLToPath(new URL(`../../../../${source}`, import.meta.url)),
      ),
      source,
    );
}
for (const sample of plan.samples) {
  assert.ok(catalog.tasks.some((task) => task.id === sample.taskId));
  const comparison = bindings.comparisons[sample.stratum];
  assert.equal(outcomeDigest(comparison), sample.comparisonDigest);
  assert.equal(comparison.corpusDigest, outcomeDigest(catalog));
}
const report = buildOutcomeReport(
  { plan, history: { runs: [], issues: [] } },
  { expectedPlanDigest: fingerprint },
);
assert.equal(report.status, "INSUFFICIENT_EVIDENCE");
assert.equal(report.task.observed, 0);
assert.equal(report.task.missing, 36);
assert.equal(report.firstRun.missing, 9);
assert.equal(report.task.totalCost, null);
assert.equal(report.maintenance.totalHours, null);
assert.equal(report.productionAttested, false);
const cliResult = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL(
        "../../../../packages/cli/scripts/task-outcome-report.mjs",
        import.meta.url,
      ),
    ),
    "--plan",
    fileURLToPath(new URL("plan.json", import.meta.url)),
    "--plan-digest",
    fingerprint,
  ],
  { encoding: "utf8" },
);
assert.equal(cliResult.status, 2, cliResult.stderr);
const cliReport = JSON.parse(cliResult.stdout);
assert.equal(cliReport.status, "INSUFFICIENT_EVIDENCE");
assert.equal(cliReport.task.missing, 36);
assert.equal(cliReport.firstRun.missing, 9);
assert.equal(cliReport.task.totalCost, null);
console.log(
  JSON.stringify(
    {
      planDigest: fingerprint,
      tasks: 36,
      firstRuns: 9,
      executionStatus: "NOT_RUN",
      emptyReportStatus: report.status,
    },
    null,
    2,
  ),
);
