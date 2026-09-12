import { describe, expect, it } from "vitest";
import {
  createEvalComparison,
  createEvalHistoryRecord,
  EVAL_CONTEXT_SCHEMA,
  EVAL_EXECUTION_PROTOCOL,
  evaluateStrictEvalGate,
  parseEvalHistory,
  validateComparisonContext,
} from "../../src/lib/eval/evidence.js";
import { computeTrend } from "../../src/lib/eval/trend.js";

const NOW = Date.parse("2026-09-12T12:00:00.000Z");
const D = (character) => `sha256:${character.repeat(64)}`;
const context = () => ({
  schema: EVAL_CONTEXT_SCHEMA,
  provider: "openai",
  model: "test-model",
  modelRevision: "test-model@revision-1",
  environmentDigest: D("a"),
  permissionDigest: D("b"),
  inferenceDigest: D("c"),
});
const comparison = () =>
  createEvalComparison({
    suite: "builtin",
    corpusDigest: D("d"),
    provider: "openai",
    model: "test-model",
    context: context(),
    platform: "linux",
    arch: "x64",
    node: "v22.22.2",
  });
function record(
  index,
  pairs = [
    ["a", true],
    ["b", true],
  ],
) {
  const passed = pairs.filter(([, pass]) => pass).length;
  return createEvalHistoryRecord(
    {
      total: pairs.length,
      passed,
      failed: pairs.length - passed,
      passRate: passed / pairs.length,
      unrelatedChangeRate: 0,
      results: pairs.map(([id, pass]) => ({
        id,
        pass,
        artifactCheckPassed: pass,
        executionSucceeded: true,
        agentOk: true,
        executionEvidence: {
          protocol: EVAL_EXECUTION_PROTOCOL,
          exitCode: 0,
          signal: null,
          terminalVerified: true,
          observedFallback: false,
        },
        error: null,
        detail: "checked",
        changedFiles: [],
        unrelatedChanges: [],
      })),
    },
    {
      comparison: comparison(),
      runId: `run-${index}`,
      ranAt: new Date(NOW - (3 - index) * 1000).toISOString(),
    },
  );
}
const gate = (runs, options = {}) =>
  evaluateStrictEvalGate({ runs, issues: [] }, { now: NOW, ...options });

describe("strict local Eval comparison", () => {
  it("accepts only a complete pair and explicitly limits the authority claim", () => {
    expect(gate([record(1), record(2)])).toMatchObject({
      passed: true,
      status: "PASS",
      productionAttested: false,
      scope: "local-eval-comparison",
      baselineRunId: "run-1",
      candidateRunId: "run-2",
    });
  });
  it.each([[[]], [[record(1)]]])(
    "rejects missing baselines without changing diagnostic n/a",
    (runs) => {
      expect(gate(runs).status).toBe("INSUFFICIENT_EVIDENCE");
      expect(computeTrend(runs)).toMatchObject({
        direction: "n/a",
        regressed: false,
      });
    },
  );
  it("rejects deleted or added tasks even if the aggregate stays at 100 percent", () => {
    for (const pairs of [
      [["a", true]],
      [
        ["a", true],
        ["b", true],
        ["c", true],
      ],
    ]) {
      expect(gate([record(1), record(2, pairs)]).reasons).toContain(
        "task_population_changed",
      );
    }
  });
  it.each(["provider", "model", "corpusDigest", "runtime", "declared"])(
    "rejects changed %s",
    (field) => {
      const candidate = record(2);
      if (field === "runtime") candidate.comparison.runtime.node = "v24.0.0";
      else if (field === "declared")
        candidate.comparison.declared.permissionDigest = D("e");
      else if (field === "corpusDigest")
        candidate.comparison.corpusDigest = D("e");
      else {
        candidate.comparison[field] = "changed";
        candidate.comparison.declared[field] = "changed";
      }
      expect(gate([record(1), candidate]).reasons).toContain(
        "comparison_identity_changed",
      );
    },
  );
  it("never substitutes older passing rows for the latest dry run", () => {
    const dry = { ...record(3), dryRun: true };
    expect(computeTrend([record(1), record(2), dry]).runs).toBe(2);
    expect(gate([record(1), record(2), dry]).reasons).toContain(
      "dry_run_or_missing_execution_mode",
    );
  });
  it("rejects legacy, duplicate, stale and future evidence", () => {
    const legacy = { ...record(2) };
    delete legacy.comparison;
    delete legacy.schema;
    expect(gate([record(1), legacy]).passed).toBe(false);
    expect(gate([record(1), record(1)]).reasons).toContain(
      "duplicate_or_unordered_runs",
    );
    expect(gate([record(1), record(2)], { maxAgeMs: 500 }).reasons).toContain(
      "invalid_or_expired_evidence",
    );
    expect(
      gate([record(1), record(2)], { now: NOW - 10_000 }).reasons,
    ).toContain("invalid_or_expired_evidence");
  });
  it("rejects forged totals and duplicate task identities", () => {
    const forged = record(2);
    forged.passed = 1;
    expect(gate([record(1), forged]).reasons).toContain(
      "inconsistent_task_totals",
    );
    const duplicate = record(2);
    duplicate.results[1].id = "a";
    expect(gate([record(1), duplicate]).reasons).toContain(
      "invalid_or_duplicate_task",
    );
  });
  it("fails on artifact regressions and rejects failed execution evidence", () => {
    expect(
      gate([
        record(1),
        record(2, [
          ["a", true],
          ["b", false],
        ]),
      ]).status,
    ).toBe("FAIL");
    const failed = record(2);
    Object.assign(failed.results[0], {
      pass: false,
      agentOk: false,
      executionSucceeded: false,
      error: "provider failed",
    });
    failed.results[0].executionEvidence.exitCode = 1;
    Object.assign(failed, { passed: 1, failed: 1, passRate: 0.5 });
    expect(gate([record(1), failed]).reasons).toContain(
      "execution_not_successful",
    );
  });
  it("requires a verified terminal even when a caller claims ok", () => {
    const candidate = record(2);
    candidate.results[0].executionEvidence.terminalVerified = false;
    expect(gate([record(1), candidate]).reasons).toContain(
      "execution_not_successful",
    );
  });
  it("does not compare a fallback run as the originally declared model", () => {
    const candidate = record(2);
    candidate.results[0].executionEvidence.observedFallback = true;
    expect(gate([record(1), candidate]).reasons).toContain(
      "fallback_or_missing_model_continuity",
    );
  });
  it("rejects corrupted JSONL instead of comparing only its remaining valid lines", () => {
    const history = parseEvalHistory(
      `${JSON.stringify(record(1))}\nBROKEN\n${JSON.stringify(record(2))}\n`,
    );
    expect(history.runs).toHaveLength(2);
    expect(history.issues).toEqual([
      { code: "invalid_history_record", line: 2 },
    ]);
    expect(evaluateStrictEvalGate(history, { now: NOW })).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
    });
  });
  it.each([NaN, 0, -1])("rejects invalid age %s", (maxAgeMs) => {
    expect(gate([record(1), record(2)], { maxAgeMs }).reasons).toContain(
      "invalid_gate_options",
    );
  });
  it("retains execution/artifact failures in history", () => {
    const source = record(1);
    const result = source.results[0];
    Object.assign(result, {
      pass: false,
      artifactCheckPassed: true,
      executionSucceeded: false,
      agentOk: false,
      error: "timed out",
    });
    const stored = createEvalHistoryRecord(source);
    expect(stored.results[0]).toMatchObject({
      pass: false,
      artifactCheckPassed: true,
      executionSucceeded: false,
      error: "timed out",
    });
  });
});

describe("Eval comparison metadata", () => {
  it("does not invent a fingerprint for undeclared environment or implicit model selection", () => {
    expect(createEvalComparison({})).toBeNull();
    expect(() => createEvalComparison({ context: context() })).toThrow(
      "explicit --provider and --model",
    );
    expect(() =>
      validateComparisonContext(context(), { model: "other-model" }),
    ).toThrow("must match");
  });
  it("rejects missing digests and unknown context fields", () => {
    expect(() =>
      validateComparisonContext({ ...context(), permissionDigest: "unknown" }),
    ).toThrow("sha256");
    expect(() =>
      validateComparisonContext({ ...context(), extra: true }),
    ).toThrow("schema");
  });
});
