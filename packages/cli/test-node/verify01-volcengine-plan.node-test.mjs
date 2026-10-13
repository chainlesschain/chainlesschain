import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PLAN_DIGEST,
  readPlanRevision,
  validatePlanRevision,
} from "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/validate-plan.mjs";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { validateVerify01Bundle } from "../src/lib/eval/verify01-contracts.js";

const fixture = readPlanRevision();
// Rehash deliberate changes so negative tests reach policy checks instead of
// succeeding merely because an operator forgot to update a digest.
function rehash(input) {
  for (const sample of input.plan.samples) {
    sample.comparisonDigest = outcomeDigest(
      input.bindings.comparisons[sample.stratum],
    );
  }
  input.expectedPlanDigest = outcomeDigest(input.plan);
  input.revision.planDigest = input.expectedPlanDigest;
  input.revision.preserved.catalogDigest = outcomeDigest(input.catalog);
  input.revision.preserved.bindingsDigest = outcomeDigest(input.bindings);
}

test("v3 preserves all 45 samples and the shared lineage while remapping exactly 18 tasks", () => {
  const result = validatePlanRevision(fixture);
  assert.equal(result.planDigest, PLAN_DIGEST);
  assert.equal(result.remappedTasks, 18);
  assert.equal(result.paidExecutionReady, false);
});

for (const version of ["original", "previous"]) {
  test(`${version} bundle still passes the unchanged production contract`, () => {
    const result = validateVerify01Bundle(fixture[version]);
    assert.equal(result.tasks.size, 36);
    assert.equal(result.samples.size, 45);
    assert.equal(
      fixture[version].plan.samples.filter((row) =>
        row.stratum.endsWith("-openai"),
      ).length,
      18,
    );
  });
}

const mutations = [
  [
    "provider reverted even with refreshed comparisons",
    (b) => {
      b.bindings.comparisons["linux-cli-volcengine"].provider = "openai";
      b.bindings.comparisons["linux-cli-volcengine"].declared.provider =
        "openai";
    },
    /authorized provider/,
  ],
  [
    "different endpoint",
    (b) => {
      b.bindings.providers[0].endpoint = "https://example.invalid/api/v3";
    },
    /authorized provider/,
  ],
  [
    "different endpoint revision even after rehash",
    (b) => {
      b.bindings.comparisons["linux-cli-volcengine"].declared.modelRevision =
        "deepseek-v4-flash-ga-260731@https://example.invalid/api/v3";
    },
    /authorized provider/,
  ],
  [
    "different model",
    (b) => {
      b.bindings.comparisons["linux-cli-volcengine"].model = "different-model";
    },
    /authorized provider/,
  ],
  [
    "thinking override",
    (b) => {
      b.bindings.providerPolicy.thinking = "disabled";
    },
    /authorized provider/,
  ],
  [
    "fallback enabled",
    (b) => {
      b.bindings.inference.fallback = true;
    },
    /authorized provider/,
  ],
  [
    "OS downgraded",
    (b) => {
      b.bindings.matrix[0].os = "Windows 10";
    },
    /authorized provider/,
  ],
  [
    "task budget increased",
    (b) => {
      b.plan.samples[0].costBudget = 3;
    },
    /sample identity/,
  ],
  [
    "window extended",
    (b) => {
      b.plan.window.end = "2026-10-20T14:46:52.556Z";
    },
    /sample identity/,
  ],
  [
    "task removed",
    (b) => {
      b.plan.samples.splice(0, 1);
    },
    /sample identity/,
  ],
  [
    "task duplicated",
    (b) => {
      b.plan.samples[1] = structuredClone(b.plan.samples[0]);
    },
    /sample identity/,
  ],
  [
    "first-run removed",
    (b) => {
      b.plan.samples = b.plan.samples.filter(
        (row) => row.id !== "first-run-linux-cli",
      );
    },
    /sample identity/,
  ],
  [
    "prompt rewritten",
    (b) => {
      b.catalog.tasks[0].prompt += " Changed prompt.";
    },
    /all task prompts/,
  ],
  [
    "catalog bytes reformatted",
    (b) => {
      b.catalogBytes += "\n";
    },
    /catalog bytes/,
  ],
  [
    "budget lineage reset",
    (b) => {
      b.revision.budgetLineage.rootPlanDigest = PLAN_DIGEST;
    },
    /budget lineage/,
  ],
  [
    "additional budget claimed",
    (b) => {
      b.revision.budgetLineage.additionalBudgetAuthorized = true;
    },
  ],
  [
    "unknown remaining budget treated as fresh 99",
    (b) => {
      b.revision.budgetLineage.availableAmountUsd = 99;
    },
    /remaining budget/,
  ],
  [
    "stale v2 reviewer approval",
    (b) => {
      b.required.authorizedAIReview.verdict =
        "APPROVED_FOR_DECLARED_EVALUATOR_SCOPE";
      b.required.authorizedAIReview.recordPlanDigest =
        b.previous.expectedPlanDigest;
    },
    /v2 reviewer/,
  ],
  [
    "paid flag enabled",
    (b) => {
      b.readiness.readyForPaidExecution = true;
    },
  ],
  [
    "observation fabricated",
    (b) => {
      b.readiness.matrix[3].taskObservationCount = 1;
    },
  ],
  [
    "per-host v2 approval carried forward",
    (b) => {
      b.readiness.matrix[3].authorizedAiEvaluatorReview = true;
    },
  ],
  [
    "historical preflight promoted",
    (b) => {
      b.readiness.historicalKeylessPreflight.appliesToThisRevision = true;
    },
  ],
  [
    "endpoint receipt fabricated",
    (b) => {
      b.required.providerControls[0].endpointReceipt = "not-an-actual-receipt";
    },
  ],
];
for (const [name, mutate, expected = { name: "AssertionError" }] of mutations) {
  test(`reject ${name}`, () => {
    const input = structuredClone(fixture);
    mutate(input);
    rehash(input);
    assert.throws(() => validatePlanRevision(input), expected);
  });
}

test("read-only production collection reports missing preparation and zero observations", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/verify01-collection.mjs", import.meta.url),
      ),
      "--plan-dir",
      fileURLToPath(
        new URL(
          "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine",
          import.meta.url,
        ),
      ),
      "--plan-digest",
      PLAN_DIGEST,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.planDigest, PLAN_DIGEST);
  assert.equal(output.productionAttested, false);
});

test("production outcome CLI preserves all missing denominators and unknown cost", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/task-outcome-report.mjs", import.meta.url),
      ),
      "--plan",
      fileURLToPath(
        new URL(
          "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
          import.meta.url,
        ),
      ),
      "--plan-digest",
      PLAN_DIGEST,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(output.task.observed, 0);
  assert.equal(output.task.missing, 36);
  assert.equal(output.firstRun.observed, 0);
  assert.equal(output.firstRun.missing, 9);
  assert.equal(output.task.totalCost, null);
  assert.equal(output.productionAttested, false);
});
