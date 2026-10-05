import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createEvalHistoryRecord,
  evalDigest,
  EVAL_EXECUTION_PROTOCOL,
} from "../../src/lib/eval/evidence.js";
import { outcomeDigest } from "../../src/lib/eval/outcomes.js";
import {
  validateVerify01Bundle,
  validateVerify01Review,
  validateVerify01Collection,
} from "../../scripts/verify01-collection.mjs";

const directory = new URL(
  "../../../../docs/research/cli/verify01-plan-2026-10-04/",
  import.meta.url,
);
const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));
function bundle() {
  return {
    plan: read("plan.json"),
    catalog: read("tasks.json"),
    bindings: read("comparison-bindings.json"),
    expectedPlanDigest: fs
      .readFileSync(new URL("plan.sha256", directory), "utf8")
      .trim(),
  };
}
function fixture() {
  const frozen = bundle();
  // These in-memory bytes and records are test data, never saved as reviews
  // or real observations. The adapter never imports or executes these bytes.
  const bytes = Buffer.from(
    "throw new Error('must never execute a reviewed file');",
  );
  const review = {
    planDigest: frozen.expectedPlanDigest,
    catalogDigest: outcomeDigest(frozen.catalog),
    projectCommit: frozen.catalog.projectCommit,
    tasks: frozen.catalog.tasks.map((task) => ({
      taskId: task.id,
      setup: { path: `review/${task.id}-setup.js`, digest: evalDigest(bytes) },
      check: { path: `review/${task.id}-check.js`, digest: evalDigest(bytes) },
      allowedChangedPaths: [...task.expectedFiles],
    })),
  };
  const preparation = {
    review,
    expectedReviewDigest: outcomeDigest(review),
    projectCommit: frozen.catalog.projectCommit,
    readReviewedFile: () => bytes,
  };
  const sample = frozen.plan.samples.find((row) => row.kind === "task");
  const comparison = structuredClone(
    frozen.bindings.comparisons[sample.stratum],
  );
  const now = Date.parse(frozen.plan.window.end) + 1000;
  const ranAt = new Date(
    Date.parse(frozen.plan.window.start) + 10000,
  ).toISOString();
  const result = {
    id: sample.taskId,
    pass: true,
    artifactCheckPassed: true,
    executionSucceeded: true,
    agentOk: true,
    error: null,
    detail: "offline fixture",
    ms: 100,
    totalCostUsd: 0.1,
    usage: { input_tokens: 10, output_tokens: 2 },
    executionEvidence: {
      protocol: EVAL_EXECUTION_PROTOCOL,
      exitCode: 0,
      signal: null,
      terminalVerified: true,
      observedFallback: false,
    },
    changedFiles: frozen.catalog.tasks.find((task) => task.id === sample.taskId)
      .expectedFiles,
    unrelatedChanges: [],
  };
  const run = createEvalHistoryRecord(
    {
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      unrelatedChangeRate: 0,
      results: [result],
    },
    {
      comparison,
      runId: "test-only-not-a-real-run",
      label: frozen.plan.commitSha,
      ranAt,
    },
  );
  const collected = {
    sourceCommit: frozen.plan.commitSha,
    sampleIds: [sample.id],
    history: { runs: [run], issues: [] },
    observations: [
      {
        sampleId: sample.id,
        runId: run.runId,
        observedAt: new Date(Date.parse(ranAt) + 200).toISOString(),
        cost: 0.1,
        elapsedMs: 200,
        retries: 0,
        manualRepairs: 0,
      },
    ],
    now,
  };
  return { frozen, preparation, collected, run, result: run.results[0] };
}

function earlyStopFixture() {
  const f = fixture();
  const sample = f.frozen.plan.samples.find((row) => row.kind === "first-run");
  f.collected.sampleIds = [sample.id];
  f.collected.history.runs = [];
  f.collected.observations = [
    {
      ...f.collected.observations[0],
      sampleId: sample.id,
      runId: null,
      cost: null,
      failureCause: "install",
      firstRun: {
        cleanEnvironment: true,
        stages: Object.fromEntries(
          ["install", "configure", "authenticate", "tool", "artifact"].map(
            (stage) => [
              stage,
              {
                passed: false,
                receipt: `test-only-${stage}-failure-or-skipped`,
              },
            ],
          ),
        ),
      },
    },
  ];
  return f;
}

describe("separate tested-source binding", () => {
  it("retains the frozen project SHA while validating an independently pinned product SHA", () => {
    const f = fixture();
    f.run.label = f.collected.sourceCommit = "b".repeat(40);
    const report = validateVerify01Collection(
      f.frozen,
      f.preparation,
      f.collected,
    );
    expect(report.projectCommit).toBe(f.frozen.plan.commitSha);
    expect(report.executionCommitSha).toBe("b".repeat(40));
    expect(report.executionSource.identityVerified).toBe(false);
    expect(report.rows.find((row) => row.observed).reasons).not.toContain(
      "commit_mismatch",
    );
    delete f.collected.sourceCommit;
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(/tested source SHA/);
  });
});

describe("VERIFY-01 read-only preparation and collection", () => {
  it.each([
    ["case alias", (path) => path.toUpperCase(), /evaluator/],
    ["trailing dot", (path) => `${path}.`, /relative files/],
    ["trailing space", (path) => `${path} `, /relative files/],
  ])("rejects Windows evaluator %s", (_name, alias, error) => {
    const f = fixture();
    const entry = f.preparation.review.tasks[0];
    entry.check.path = alias(entry.allowedChangedPaths[0]);
    f.preparation.expectedReviewDigest = outcomeDigest(f.preparation.review);
    expect(() => validateVerify01Review(f.frozen, f.preparation)).toThrow(
      error,
    );
  });

  it("retains a first-install failure before any task starts, with unknown cost", () => {
    const f = earlyStopFixture();
    const report = validateVerify01Collection(
      f.frozen,
      f.preparation,
      f.collected,
    );
    expect(report.firstRun).toMatchObject({
      observed: 1,
      missing: 8,
      succeeded: 0,
      totalCost: null,
    });
    expect(report.task).toMatchObject({ observed: 0, missing: 36 });
    const row = report.rows.find((item) => item.observed);
    expect(row).toMatchObject({
      cost: null,
      failureCause: "install",
      succeeded: false,
    });
    expect(row.reasons).not.toContain("missing_eval_run");
  });

  it.each([
    [
      "missing stage receipt",
      (f) => {
        delete f.collected.observations[0].firstRun.stages.install.receipt;
      },
    ],
    [
      "impossible completed stage",
      (f) => {
        f.collected.observations[0].firstRun.stages.artifact.passed = true;
      },
    ],
    [
      "missing attribution",
      (f) => {
        delete f.collected.observations[0].failureCause;
      },
    ],
    [
      "invalid cost",
      (f) => {
        f.collected.observations[0].cost = -1;
      },
    ],
  ])("rejects malformed early-stop %s", (_name, mutate) => {
    const f = earlyStopFixture();
    mutate(f);
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(/early-stop/);
  });

  it("requires task terminal evidence after the first-run tool stage succeeds", () => {
    const f = earlyStopFixture();
    f.collected.observations[0].firstRun.stages.tool.passed = true;
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(/missing run/);
  });

  it("does not allow a normal task to claim first-install early-stop", () => {
    const f = earlyStopFixture();
    const task = f.frozen.plan.samples.find((sample) => sample.kind === "task");
    f.collected.sampleIds = [task.id];
    f.collected.observations[0].sampleId = task.id;
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(/missing run/);
  });
  it("validates the frozen population without running tasks or creating observations", () => {
    const f = fixture();
    expect(validateVerify01Bundle(f.frozen).tasks.size).toBe(36);
    expect(validateVerify01Review(f.frozen, f.preparation).reviewed.size).toBe(
      36,
    );
    const report = validateVerify01Collection(
      f.frozen,
      f.preparation,
      f.collected,
    );
    expect(report.productionAttested).toBe(false);
    expect(report.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.task).toMatchObject({
      planned: 36,
      observed: 1,
      missing: 35,
      succeeded: 1,
      totalCost: null,
    });
    expect(report.firstRun).toMatchObject({
      planned: 9,
      observed: 0,
      missing: 9,
    });
    expect(
      f.frozen.catalog.tasks.every((task) => task.status === "NOT_RUN"),
    ).toBe(true);
  });

  it.each([
    [
      "plan mutation",
      (f) => {
        f.frozen.plan.samples[0].costBudget = 0;
      },
      /plan digest/,
    ],
    [
      "catalog prompt mutation",
      (f) => {
        f.frozen.catalog.tasks[0].prompt += "changed";
      },
      /catalog\/comparison/,
    ],
    [
      "catalog task omission",
      (f) => {
        f.frozen.catalog.tasks.pop();
      },
      /36 tasks/,
    ],
    [
      "catalog duplicate",
      (f) => {
        f.frozen.catalog.tasks[1] = f.frozen.catalog.tasks[0];
      },
      /duplicate/,
    ],
    [
      "project SHA",
      (f) => {
        f.preparation.projectCommit = "a".repeat(40);
      },
      /project SHA/,
    ],
    [
      "review file mutation",
      (f) => {
        f.preparation.readReviewedFile = () => Buffer.from("changed evaluator");
      },
      /file changed/,
    ],
    [
      "review config mutation",
      (f) => {
        f.preparation.review.tasks[0].allowedChangedPaths.push("malicious.js");
      },
      /review digest/,
    ],
  ])("rejects %s using separately supplied pins", (_name, change, error) => {
    const f = fixture();
    change(f);
    expect(() => validateVerify01Review(f.frozen, f.preparation)).toThrow(
      error,
    );
  });

  it.each([
    ["omitted task", (review) => review.tasks.pop(), /omitted/],
    [
      "duplicate task",
      (review) => review.tasks.push(review.tasks[0]),
      /duplicate/,
    ],
    [
      "expanded path",
      (review) => review.tasks[0].allowedChangedPaths.push("unreviewed.js"),
      /change surface/,
    ],
    [
      "path traversal",
      (review) => {
        review.tasks[0].check.path = "../check.js";
      },
      /relative files/,
    ],
    [
      "evaluator editing",
      (review) => {
        review.tasks[0].check.path = review.tasks[0].allowedChangedPaths[0];
      },
      /evaluator/,
    ],
  ])(
    "refuses structurally invalid reviewed configuration: %s",
    (_name, change, error) => {
      const f = fixture();
      change(f.preparation.review);
      // A matching external pin cannot make an invalid review admissible.
      f.preparation.expectedReviewDigest = outcomeDigest(f.preparation.review);
      expect(() => validateVerify01Review(f.frozen, f.preparation)).toThrow(
        error,
      );
    },
  );

  it.each([
    [
      "missing terminal",
      (f) => {
        delete f.result.executionEvidence.terminalVerified;
      },
      /verified terminal/,
    ],
    [
      "false terminal",
      (f) => {
        f.result.executionEvidence.terminalVerified = false;
      },
      /verified terminal/,
    ],
    [
      "unsupported terminal protocol",
      (f) => {
        f.result.executionEvidence.protocol = "unverified-fixture";
      },
      /verified terminal/,
    ],
    [
      "unknown cost coerced to zero",
      (f) => {
        f.result.totalCostUsd = null;
        f.collected.observations[0].cost = 0;
      },
      /cost.*zero/,
    ],
    [
      "mismatched known cost",
      (f) => {
        f.collected.observations[0].cost = 0;
      },
      /cost.*zero/,
    ],
    [
      "duplicate sample selection",
      (f) => {
        f.collected.sampleIds.push(f.collected.sampleIds[0]);
      },
      /selected samples/,
    ],
    [
      "missing selected observation",
      (f) => {
        f.collected.observations = [];
      },
      /observations omitted/,
    ],
    [
      "duplicate observation",
      (f) => {
        f.collected.observations.push(f.collected.observations[0]);
      },
      /duplicate/,
    ],
    [
      "outside changed path",
      (f) => {
        f.result.changedFiles = ["extra.js"];
      },
      /unreviewed path/,
    ],
    [
      "missing diff inventory",
      (f) => {
        delete f.result.changedFiles;
      },
      /inventory/,
    ],
    [
      "wrong product SHA",
      (f) => {
        f.run.label = "a".repeat(40);
      },
      /run SHA/,
    ],
    [
      "changed runtime identity",
      (f) => {
        f.run.comparison.runtime.node = "v24.0.0";
      },
      /comparison mismatch/,
    ],
    [
      "dry run passed as real",
      (f) => {
        f.run.dryRun = true;
      },
      /dry_run/,
    ],
    [
      "extra history result",
      (f) => {
        f.collected.history.runs.push({ ...f.run, runId: "unbound-run" });
      },
      /unbound/,
    ],
  ])("rejects collected %s", (_name, change, error) => {
    const f = fixture();
    change(f);
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(error);
  });

  it("retains unknown costs as null and does not count the sample as success", () => {
    const f = fixture();
    f.result.totalCostUsd = null;
    f.collected.observations[0].cost = null;
    const report = validateVerify01Collection(
      f.frozen,
      f.preparation,
      f.collected,
    );
    expect(report.task).toMatchObject({
      observed: 1,
      succeeded: 0,
      totalCost: null,
      costPerSuccess: null,
    });
    expect(report.status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("rejects reuse of one task execution for its independent first-run sample", () => {
    const f = fixture();
    const first = f.frozen.plan.samples.find(
      (sample) => sample.kind === "first-run" && sample.taskId === f.result.id,
    );
    f.collected.sampleIds.push(first.id);
    f.collected.observations.push({
      ...f.collected.observations[0],
      sampleId: first.id,
    });
    expect(() =>
      validateVerify01Collection(f.frozen, f.preparation, f.collected),
    ).toThrow(/cannot count as multiple samples/);
  });

  it("retains a verified failure and budget overrun rather than changing the denominator", () => {
    const f = fixture();
    Object.assign(f.result, {
      pass: false,
      artifactCheckPassed: false,
      executionSucceeded: false,
      agentOk: false,
      error: "fixture failure",
      totalCostUsd: 3,
    });
    Object.assign(f.run, { passed: 0, failed: 1, passRate: 0 });
    Object.assign(f.collected.observations[0], {
      cost: 3,
      failureCause: "budget",
    });
    const report = validateVerify01Collection(
      f.frozen,
      f.preparation,
      f.collected,
    );
    expect(report.task).toMatchObject({
      planned: 36,
      observed: 1,
      succeeded: 0,
      knownCost: 3,
    });
  });

  it("checks the real plan directory from CLI with zero observations and no output files", () => {
    const frozen = bundle();
    const files = [
      "tasks.json",
      "plan.json",
      "plan.sha256",
      "comparison-bindings.json",
    ];
    const before = files.map((file) =>
      fs.readFileSync(new URL(file, directory)),
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../scripts/verify01-collection.mjs", import.meta.url),
        ),
        "--plan-dir",
        fileURLToPath(directory),
        "--plan-digest",
        frozen.expectedPlanDigest,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    expect(result.status, result.stderr).toBe(2);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      executionStatus: "NOT_RUN",
      productionAttested: false,
      reviewValidated: false,
      report: {
        task: { observed: 0, missing: 36, totalCost: null },
        firstRun: { observed: 0, missing: 9 },
      },
    });
    files.forEach((file, i) =>
      expect(fs.readFileSync(new URL(file, directory))).toEqual(before[i]),
    );
  });
});
