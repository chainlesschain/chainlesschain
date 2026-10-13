import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  outcomeDigest,
  buildOutcomeReport,
} from "../../../../packages/cli/src/lib/eval/outcomes.js";
import { validateVerify01Bundle } from "../../../../packages/cli/src/lib/eval/verify01-contracts.js";

export const ROOT_DIGEST =
  "sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0";
export const PREVIOUS_DIGEST =
  "sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd";
export const PLAN_DIGEST =
  "sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13";
export const IDENTITY = Object.freeze({
  provider: "volcengine",
  model: "deepseek-v4-flash-ga-260731",
  modelRevision:
    "deepseek-v4-flash-ga-260731@https://ark.cn-beijing.volces.com/api/v3",
  endpoint: "https://ark.cn-beijing.volces.com/api/v3",
});

export function readPlanRevision(
  directory = fileURLToPath(new URL(".", import.meta.url)),
) {
  const read = (name, base = directory) =>
    JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));
  const bundle = (base) => ({
    plan: read("plan.json", base),
    catalog: read("tasks.json", base),
    bindings: read("comparison-bindings.json", base),
    expectedPlanDigest: fs
      .readFileSync(path.join(base, "plan.sha256"), "utf8")
      .trim(),
  });
  const previousDirectory = path.resolve(
    directory,
    "../verify01-plan-2026-10-12-v2",
  );
  const rootDirectory = path.resolve(directory, "../verify01-plan-2026-10-04");
  return {
    ...bundle(directory),
    catalogBytes: fs.readFileSync(path.join(directory, "tasks.json"), "utf8"),
    previousCatalogBytes: fs.readFileSync(
      path.join(previousDirectory, "tasks.json"),
      "utf8",
    ),
    previous: bundle(previousDirectory),
    original: bundle(rootDirectory),
    revision: read("revision.json"),
    required: read("required-inputs.json"),
    readiness: read("execution-readiness.json"),
    reviewPolicy: read("review-policy.json"),
  };
}

/** Validate the immutable revision and its initial, unexecuted readiness snapshot. */
export function validatePlanRevision(input) {
  const {
    plan,
    catalog,
    bindings,
    expectedPlanDigest,
    previous,
    original,
    revision,
    required,
    readiness,
    reviewPolicy,
  } = input;
  for (const [bundle, digest] of [
    [original, ROOT_DIGEST],
    [previous, PREVIOUS_DIGEST],
  ]) {
    assert.equal(bundle.expectedPlanDigest, digest);
    validateVerify01Bundle(bundle);
  }
  assert.deepEqual(previous.catalog, original.catalog);
  assert.deepEqual(previous.bindings, original.bindings);
  const { window: oldWindow, ...oldRest } = original.plan;
  const { window: previousWindow, ...previousRest } = previous.plan;
  assert.notDeepEqual(previousWindow, oldWindow);
  assert.deepEqual(previousRest, oldRest);
  assert.equal(
    input.catalogBytes,
    input.previousCatalogBytes,
    "catalog bytes must be preserved",
  );
  assert.deepEqual(
    catalog,
    previous.catalog,
    "all task prompts and deliverables must be preserved",
  );
  assert.equal(
    outcomeDigest(catalog),
    "sha256:b9dc7b3ae9e7ea126c7bece9617686e3c3187c32212eff1d5d9ea6dde51d012c",
  );
  assert.equal(
    outcomeDigest(previous.bindings),
    "sha256:e5db1d0992753efefa2ddbf7abf09d846c8984b26e6046563619181bb2ad23f7",
  );

  const expectedBindings = structuredClone(previous.bindings);
  expectedBindings.providers = [IDENTITY];
  expectedBindings.providerPolicy = {
    endpoint: IDENTITY.endpoint,
    thinking: "provider-default-no-override",
    fallback: false,
    providerAssignments: "all-36-tasks-and-9-first-runs",
    endpointVerification:
      "Actual request/endpoint evidence is still required; this is a frozen operator declaration.",
  };
  expectedBindings.comparisons = {};
  for (const host of previous.bindings.matrix) {
    const stratum = `${host.id}-volcengine`;
    const comparison = structuredClone(previous.bindings.comparisons[stratum]);
    comparison.declared.modelRevision = IDENTITY.modelRevision;
    expectedBindings.comparisons[stratum] = comparison;
  }
  assert.deepEqual(
    bindings,
    expectedBindings,
    "only the authorized provider identity may change in bindings",
  );
  const expectedPlan = structuredClone(previous.plan);
  for (const sample of expectedPlan.samples) {
    sample.stratum = sample.stratum.replace(/-openai$/u, "-volcengine");
    sample.comparisonDigest = outcomeDigest(
      expectedBindings.comparisons[sample.stratum],
    );
  }
  assert.deepEqual(
    plan,
    expectedPlan,
    "sample identity, task assignment, window and budgets must be preserved",
  );
  assert.equal(expectedPlanDigest, PLAN_DIGEST);
  validateVerify01Bundle(input);
  assert.equal(plan.commitSha, "b2aa3aba082873570e85dce39b00754e5504ff37");
  assert.deepEqual(plan.window, {
    start: "2026-10-12T14:46:52.556Z",
    end: "2026-10-19T14:46:52.556Z",
  });
  assert.equal(
    plan.samples.reduce((sum, row) => sum + row.costBudget, 0),
    99,
  );
  for (const host of bindings.matrix) {
    const samples = plan.samples.filter(
      (row) => row.stratum === `${host.id}-volcengine`,
    );
    assert.equal(samples.filter((row) => row.kind === "task").length, 4);
    assert.equal(samples.filter((row) => row.kind === "first-run").length, 1);
  }

  assert.equal(revision.version, 3);
  assert.equal(
    revision.previousPlan,
    "../verify01-plan-2026-10-12-v2/plan.json",
  );
  assert.equal(revision.previousPlanDigest, PREVIOUS_DIGEST);
  assert.equal(revision.rootPlanDigest, ROOT_DIGEST);
  assert.equal(revision.planDigest, PLAN_DIGEST);
  assert.deepEqual(revision.previousWindow, plan.window);
  assert.deepEqual(revision.window, plan.window);
  assert.deepEqual(revision.providerIdentity, IDENTITY);
  assert.deepEqual(revision.previousProviders, previous.bindings.providers);
  assert.deepEqual(revision.authorization.quotes, [
    "用火山引擎测试",
    "可以依据火山引擎做36+9任务",
  ]);
  assert.equal(revision.authorization.allSamplesVolcengineAuthorized, true);
  assert.equal(revision.authorization.additionalBudgetAuthorized, false);
  const changed = previous.plan.samples
    .filter((row) => row.stratum.endsWith("-openai"))
    .map((row) => ({
      sampleId: row.id,
      taskId: row.taskId,
      previousStratum: row.stratum,
      stratum: row.stratum.replace(/-openai$/u, "-volcengine"),
      previousProvider: "openai",
      provider: "volcengine",
    }));
  assert.equal(changed.length, 18);
  assert.deepEqual(revision.changedAssignments, changed);
  assert.deepEqual(revision.preserved, {
    taskCount: 36,
    firstRunCount: 9,
    projectCommit: plan.commitSha,
    catalogDigest: outcomeDigest(catalog),
    previousBindingsDigest: outcomeDigest(previous.bindings),
    bindingsDigest: outcomeDigest(bindings),
    sampleIdsAndTaskAssignmentsUnchanged: true,
    catalogBytesUnchanged: true,
    windowUnchanged: true,
    runtimeTargetsUnchanged: true,
    inferenceDefaultsUnchanged: true,
    taskCostUsd: 2,
    taskTimeBudgetMs: 1200000,
    firstRunCostUsd: 3,
    firstRunTimeBudgetMs: 1800000,
    totalPlannedBudgetUsd: 99,
    maintenanceBudgetHours: 16,
  });
  assert.deepEqual(revision.testedPublication, {
    cli: "0.166.99",
    vscode: "0.37.143",
    jetbrains: "0.4.161",
    sourceCommit: "311e01a5ec34a8e433c7abde0e4b6b05bce4513b",
  });
  for (const lineage of [revision.budgetLineage, readiness.budgetLineage]) {
    assert.equal(
      lineage.rootPlanDigest,
      ROOT_DIGEST,
      "budget lineage cannot reset",
    );
    assert.equal(lineage.sharedLimitUsd, 99);
    assert.equal(lineage.additionalBudgetAuthorized, false);
    assert.equal(
      lineage.availableAmountUsd,
      null,
      "remaining budget has not been verified",
    );
  }
  assert.deepEqual(revision.budgetLineage.sharedAcrossPlanDigests, [
    ROOT_DIGEST,
    PREVIOUS_DIGEST,
    PLAN_DIGEST,
  ]);
  assert.equal(revision.budgetLineage.billingControlVerified, false);
  assert.equal(required.sharedBudgetControl.maximumUsd, 99);
  assert.equal(required.sharedBudgetControl.lineageRootPlanDigest, ROOT_DIGEST);
  assert.equal(required.sharedBudgetControl.remainingUsd, null);
  assert.equal(required.sharedBudgetControl.controlReceipt, null);
  assert.equal(
    required.sharedBudgetControl
      .previousSpendAndOutstandingReservationsMustBeReconciled,
    true,
  );

  assert.equal(revision.executionStatus, "NOT_RUN");
  assert.equal(revision.paidExecutionReady, false);
  assert.equal(revision.exactPackReviewRequired, true);
  assert.equal(revision.observationsCreated, false);
  assert.deepEqual(revision.previousStatus, {
    tasksObserved: 0,
    firstRunsObserved: 0,
    executionStatus: "NOT_RUN",
  });
  for (const record of [required, readiness, reviewPolicy])
    assert.equal(record.planDigest, PLAN_DIGEST);
  for (const record of [revision, reviewPolicy])
    assert.equal(record.independentHumanReview, false);
  assert.equal(reviewPolicy.exactPackReviewRequired, true);
  assert.equal(required.reviewDigest, null);
  assert.equal(required.paidExecutionReady, false);
  assert.equal(
    required.productSourceCommit,
    revision.testedPublication.sourceCommit,
  );
  assert.equal(required.providerControls.length, 1);
  const control = required.providerControls[0];
  for (const key of ["provider", "model", "endpoint"])
    assert.equal(control[key], IDENTITY[key]);
  assert.equal(control.thinking, "provider-default-no-override");
  for (const key of ["endpointReceipt", "quotaReceipt", "quotaReceiptDigest"])
    assert.equal(control[key], null);
  const pendingReview = {
    reviewer: "Astra",
    reviewerKind: "AI",
    verdict: "REVIEW_REQUIRED",
    recordPath: null,
    recordPlanDigest: PLAN_DIGEST,
    recordReviewDigest: null,
    imageId: null,
    recordDigest: null,
    reviewedAt: null,
    acceptedForDeclaredEvaluatorScope: false,
  };
  assert.deepEqual(
    required.authorizedAIReview,
    pendingReview,
    "v2 reviewer approval must not transfer",
  );
  assert.deepEqual(readiness.authorizedAIReview, pendingReview);
  assert.deepEqual(readiness.linuxReview, {
    reviewDigest: null,
    generatedArtifacts: 0,
    imageId: null,
    imageStatus: "EXACT_V3_PACK_REQUIRED",
    independentHumanReview: false,
    reviewerKind: "AI",
    reviewer: "Astra",
    reviewVerdict: "REVIEW_REQUIRED",
  });
  for (const historical of [
    readiness.historicalLinuxReview,
    readiness.historicalKeylessPreflight,
  ]) {
    assert.equal(historical.planDigest, PREVIOUS_DIGEST);
    assert.equal(historical.appliesToThisRevision, false);
  }
  assert.equal(readiness.readyForPaidExecution, false);
  assert.equal(readiness.observationsCreated, false);
  assert.equal(readiness.totalTasks, 36);
  assert.equal(readiness.totalFirstRuns, 9);
  assert.equal(readiness.totalPlannedBudgetUsd, 99);
  assert.deepEqual(readiness.window, plan.window);
  assert.deepEqual(readiness.providers, [IDENTITY]);
  assert.deepEqual(readiness.formalProviderTaskCounts, { volcengine: 36 });
  assert.deepEqual(readiness.formalProviderFirstRunCounts, { volcengine: 9 });
  assert.equal(readiness.matrix.length, 9);
  for (const [index, row] of readiness.matrix.entries()) {
    const host = bindings.matrix[index];
    assert.equal(row.id, host.id);
    assert.deepEqual(row.target, host);
    assert.deepEqual(
      row.taskSamples,
      plan.samples
        .filter(
          (sample) =>
            sample.stratum === `${host.id}-volcengine` &&
            sample.kind === "task",
        )
        .map((sample) => sample.id),
    );
    assert.equal(row.firstRunSample, `first-run-${host.id}`);
    assert.equal(row.maximumBudgetUsd, 11);
    assert.equal(row.state, "NOT_RUN");
    for (const key of [
      "hostVerified",
      "independentHumanReview",
      "accountBudgetVerified",
    ])
      assert.equal(row[key], false);
    for (const key of ["taskObservationCount", "firstRunObservationCount"])
      assert.equal(row[key], 0);
    assert.equal(
      row.acceptanceBackend,
      host.platform === "linux" ? "linux-docker" : "native-not-admitted",
    );
    assert.equal(row.authorizedAiEvaluatorReview, undefined);
    assert.equal(row.keylessPreflightHostVerified, undefined);
  }
  assert.equal(readiness.firstBatch.target, "linux-cli");
  assert.deepEqual([...readiness.firstBatch.taskSamples].sort(), [
    "verify-04",
    "verify-13",
    "verify-22",
    "verify-31",
  ]);
  assert.equal(readiness.firstBatch.firstRunSample, "first-run-linux-cli");
  assert.equal(readiness.firstBatch.maximumBudgetUsd, 11);
  const report = buildOutcomeReport(
    { plan, history: { runs: [], issues: [] } },
    { expectedPlanDigest },
  );
  assert.equal(report.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.task.observed, 0);
  assert.equal(report.task.missing, 36);
  assert.equal(report.firstRun.observed, 0);
  assert.equal(report.firstRun.missing, 9);
  assert.equal(report.task.totalCost, null);
  assert.equal(report.maintenance.totalHours, null);
  assert.equal(report.productionAttested, false);
  return {
    planDigest: expectedPlanDigest,
    tasks: 36,
    firstRuns: 9,
    provider: IDENTITY.provider,
    strata: 9,
    remappedTasks: changed.length,
    executionStatus: "NOT_RUN",
    emptyReportStatus: report.status,
    paidExecutionReady: false,
    catalogBytesPreserved: true,
    sharedBudgetUsd: 99,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(validatePlanRevision(readPlanRevision()), null, 2),
  );
}
