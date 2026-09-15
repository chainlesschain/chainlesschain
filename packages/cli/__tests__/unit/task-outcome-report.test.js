import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createEvalComparison,
  createEvalHistoryRecord,
  EVAL_CONTEXT_SCHEMA,
  EVAL_EXECUTION_PROTOCOL,
} from "../../src/lib/eval/evidence.js";
import {
  buildOutcomeReport,
  outcomeDigest,
  OUTCOME_PLAN_SCHEMA,
} from "../../src/lib/eval/outcomes.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const SHA = "a".repeat(40);
const D = (letter) => `sha256:${letter.repeat(64)}`;
const SCRIPT = fileURLToPath(
  new URL("../../scripts/task-outcome-report.mjs", import.meta.url),
);
function fixture() {
  const comparison = createEvalComparison({
    suite: "builtin",
    corpusDigest: D("a"),
    provider: "test",
    model: "test-model",
    context: {
      schema: EVAL_CONTEXT_SCHEMA,
      provider: "test",
      model: "test-model",
      modelRevision: "test-r1",
      environmentDigest: D("b"),
      permissionDigest: D("c"),
      inferenceDigest: D("d"),
    },
  });
  const window = {
    start: "2026-09-15T10:00:00.000Z",
    end: "2026-09-15T11:00:00.000Z",
  };
  const samples = ["task", "first-run"].map((kind, index) => ({
    id: `sample-${index}`,
    kind,
    taskId: "fix-build",
    stratum: "windows-cli-test",
    comparisonDigest: outcomeDigest(comparison),
    timeBudgetMs: 1000,
    costBudget: 1,
  }));
  const runs = samples.map((sample, index) =>
    createEvalHistoryRecord(
      {
        total: 1,
        passed: 1,
        failed: 0,
        passRate: 1,
        unrelatedChangeRate: 0,
        results: [
          {
            id: sample.taskId,
            pass: true,
            artifactCheckPassed: true,
            executionSucceeded: true,
            agentOk: true,
            error: null,
            ms: 100,
            executionEvidence: {
              protocol: EVAL_EXECUTION_PROTOCOL,
              exitCode: 0,
              signal: null,
              terminalVerified: true,
              observedFallback: false,
            },
          },
        ],
      },
      {
        runId: `run-${index}`,
        ranAt: "2026-09-15T10:30:00.000Z",
        label: SHA,
        comparison,
      },
    ),
  );
  return {
    plan: {
      schema: OUTCOME_PLAN_SCHEMA,
      commitSha: SHA,
      currency: "USD",
      window,
      samples,
    },
    history: { runs, issues: [] },
    observations: samples.map((sample, index) => ({
      sampleId: sample.id,
      observedAt: "2026-09-15T10:30:00.000Z",
      runId: `run-${index}`,
      cost: 0.1,
      elapsedMs: 500,
      retries: 0,
      manualRepairs: 0,
      ...(sample.kind === "first-run"
        ? {
            firstRun: {
              cleanEnvironment: true,
              stages: Object.fromEntries(
                [
                  "install",
                  "configure",
                  "authenticate",
                  "tool",
                  "artifact",
                ].map((stage) => [
                  stage,
                  { passed: true, receipt: `receipt:${stage}` },
                ]),
              ),
            },
          }
        : {}),
    })),
    maintenance: {
      window,
      complete: true,
      entries: [
        {
          id: "support-1",
          category: "support",
          hours: 2,
          evidenceRef: "ticket:1",
        },
        {
          id: "build-1",
          category: "construction",
          hours: 8,
          evidenceRef: "ticket:2",
        },
      ],
    },
  };
}
const report = (input) => buildOutcomeReport(input, { now: NOW });

describe("task outcome baseline", () => {
  it("reuses Eval evidence and records a baseline without issuing an improvement PASS", () => {
    const result = report(fixture());
    expect(result).toMatchObject({
      status: "BASELINE_RECORDED",
      improvementVerdict: "NOT_EVALUATED",
      productionAttested: false,
    });
    expect(result.task).toMatchObject({
      succeeded: 1,
      planned: 1,
      successRate: 1,
      costPerSuccess: 0.1,
    });
    expect(result.maintenance).toMatchObject({
      totalHours: 2,
      per100Attempts: 100,
      constructionHours: 8,
    });
  });
  it("retains missing planned samples and does not turn unknown costs into zero", () => {
    const input = fixture();
    input.plan.samples.push({ ...input.plan.samples[0], id: "never-ran" });
    const result = report(input);
    expect(result.task).toMatchObject({
      planned: 2,
      observed: 1,
      succeeded: 1,
      successRate: 0.5,
      totalCost: null,
      costPerSuccess: null,
    });
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.maintenance.per100Attempts).toBeNull();
  });
  it("counts an execution failure despite a correct artifact and preserves its expense", () => {
    const input = fixture();
    Object.assign(input.history.runs[0], { passed: 0, failed: 1, passRate: 0 });
    Object.assign(input.history.runs[0].results[0], {
      pass: false,
      agentOk: false,
      executionSucceeded: false,
      error: "timeout",
    });
    input.history.runs[0].results[0].executionEvidence.exitCode = 1;
    input.observations[0].failureCause = "model-protocol";
    const result = report(input);
    expect(result.task).toMatchObject({
      succeeded: 0,
      totalCost: 0.1,
      costPerSuccess: null,
    });
    expect(result.status).toBe("BASELINE_RECORDED");
  });
  it.each([
    "dryRun",
    "label",
    "comparison",
    "terminal",
    "fallback",
    "deleted-task",
    "tampered-pass",
  ])("cannot count %s evidence as success", (change) => {
    const input = fixture();
    const run = input.history.runs[0];
    if (change === "dryRun") run.dryRun = true;
    if (change === "label") run.label = "other-commit";
    if (change === "comparison") run.comparison.model = "different";
    if (change === "terminal")
      run.results[0].executionEvidence.terminalVerified = false;
    if (change === "fallback")
      run.results[0].executionEvidence.observedFallback = true;
    if (change === "deleted-task") run.results = [];
    if (change === "tampered-pass") run.results[0].artifactCheckPassed = false;
    expect(report(input).task.succeeded).toBe(0);
  });
  it("keeps retry expenses within one sample and rejects manual repair as initial success", () => {
    const input = fixture();
    Object.assign(input.observations[0], {
      retries: 3,
      cost: 0.8,
      manualRepairs: 1,
    });
    expect(report(input).task).toMatchObject({
      planned: 1,
      succeeded: 0,
      totalCost: 0.8,
      retries: 3,
      manualRepairs: 1,
    });
  });
  it.each([{ cost: 2 }, { elapsedMs: 1001 }])(
    "enforces the frozen budget %j",
    (override) => {
      const input = fixture();
      Object.assign(input.observations[0], override);
      expect(report(input).rows[0].reasons).toContain("budget_exceeded");
    },
  );
  it("does not count READY without the full first-run journey", () => {
    const input = fixture();
    input.observations[1].firstRun.stages.artifact.passed = false;
    expect(report(input).firstRun.succeeded).toBe(0);
    expect(report(input).firstRunFunnel.at(-1).passed).toBe(0);
  });
  it("accepts documented installation failure as a failed observation even before any Eval run", () => {
    const input = fixture();
    input.observations[1].runId = null;
    input.observations[1].failureCause = "install";
    for (const stage of Object.values(input.observations[1].firstRun.stages))
      stage.passed = false;
    const result = report(input);
    expect(result.status).toBe("BASELINE_RECORDED");
    expect(result.firstRun).toMatchObject({
      observed: 1,
      succeeded: 0,
      totalCost: 0.1,
    });
  });
  it("rejects out-of-order first-run stage evidence", () => {
    const input = fixture();
    input.observations[1].firstRun.stages.install.passed = false;
    expect(report(input).issues).toContain(
      "sample-1:inconsistent_first_run_stages",
    );
    expect(
      report(input).firstRunFunnel.every((stage) => stage.passed === 0),
    ).toBe(true);
  });
  it("rejects evidence reuse and extra observations instead of increasing the denominator", () => {
    const input = fixture();
    input.observations[1].runId = "run-0";
    expect(() => report(input)).toThrow("multiple samples");
    input.observations[1].sampleId = "unplanned";
    expect(() => report(input)).toThrow("outside the frozen plan");
  });
  it("rejects duplicate plan samples", () => {
    const input = fixture();
    input.plan.samples.push(input.plan.samples[0]);
    expect(() => report(input)).toThrow("duplicate");
  });
  it("detects a changed frozen plan", () => {
    const input = fixture();
    const digest = outcomeDigest(input.plan);
    input.plan.samples.pop();
    expect(() =>
      buildOutcomeReport(input, { now: NOW, expectedPlanDigest: digest }),
    ).toThrow("digest mismatch");
  });
  it.each([
    null,
    { complete: false, entries: [] },
    { complete: true, window: { start: "other" }, entries: [] },
  ])("does not report missing maintenance as free: %j", (maintenance) => {
    const input = fixture();
    input.maintenance = maintenance;
    expect(report(input).maintenance.totalHours).toBeNull();
  });
  it("retains history parse failures", () => {
    const input = fixture();
    input.history.issues.push({ code: "invalid_history_record", line: 2 });
    expect(report(input).status).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("rejects observations outside the window even when no model task started", () => {
    const input = fixture();
    input.observations[1].runId = null;
    input.observations[1].observedAt = "2026-09-14T10:30:00.000Z";
    for (const stage of Object.values(input.observations[1].firstRun.stages))
      stage.passed = false;
    expect(report(input).issues).toContain(
      "sample-1:observation_outside_window",
    );
  });
  it.each([NaN, -1, Infinity, "0"])(
    "rejects invalid observed costs %s",
    (cost) => {
      const input = fixture();
      input.observations[0].cost = cost;
      expect(report(input).task.totalCost).toBeNull();
      expect(report(input).task.succeeded).toBe(0);
    },
  );
  it("keeps per-task repeated samples and strata visible", () => {
    const input = fixture();
    input.plan.samples.push({ ...input.plan.samples[0], id: "repeat" });
    const result = report(input);
    expect(result.groups[0]).toMatchObject({
      taskId: "fix-build",
      planned: 2,
      succeeded: 1,
    });
  });
  it("runs the offline CLI with distinct complete, incomplete, and invalid exits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-outcome-test-"));
    try {
      const input = fixture();
      const runtimeNow = Date.now();
      input.plan.window.start = new Date(runtimeNow - 7200000).toISOString();
      input.plan.window.end = new Date(runtimeNow - 3600000).toISOString();
      for (const run of input.history.runs)
        run.ranAt = new Date(runtimeNow - 5400000).toISOString();
      for (const observation of input.observations)
        observation.observedAt = new Date(runtimeNow - 5400000).toISOString();
      const file = path.join(dir, "plan.json");
      fs.writeFileSync(file, JSON.stringify(input.plan));
      const digest = execFileSync(
        process.execPath,
        [SCRIPT, "--plan", file, "--fingerprint"],
        { encoding: "utf8" },
      ).trim();
      expect(digest).toBe(outcomeDigest(input.plan));
      const result = spawnSync(
        process.execPath,
        [SCRIPT, "--plan", file, "--plan-digest", digest],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).task).toMatchObject({
        planned: 1,
        observed: 0,
        succeeded: 0,
      });
      const changed = spawnSync(
        process.execPath,
        [SCRIPT, "--plan", file, "--plan-digest", D("f")],
        { encoding: "utf8" },
      );
      expect(changed.status).toBe(1);
      const history = path.join(dir, "history.jsonl");
      const observations = path.join(dir, "observations.json");
      const maintenance = path.join(dir, "maintenance.json");
      fs.writeFileSync(
        history,
        input.history.runs.map((run) => JSON.stringify(run)).join("\n"),
      );
      fs.writeFileSync(observations, JSON.stringify(input.observations));
      fs.writeFileSync(maintenance, JSON.stringify(input.maintenance));
      const complete = spawnSync(
        process.execPath,
        [
          SCRIPT,
          "--plan",
          file,
          "--plan-digest",
          digest,
          "--history",
          history,
          "--observations",
          observations,
          "--maintenance",
          maintenance,
        ],
        { encoding: "utf8" },
      );
      expect(complete.status, complete.stderr || complete.stdout).toBe(0);
      expect(JSON.parse(complete.stdout)).toMatchObject({
        status: "BASELINE_RECORDED",
        improvementVerdict: "NOT_EVALUATED",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
