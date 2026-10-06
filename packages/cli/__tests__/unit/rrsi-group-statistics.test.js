import { describe, expect, it, vi } from "vitest";
import { rrsiStatisticsFixture } from "../fixtures/rrsi-group-statistics.js";
import {
  rrsiCampaignInput,
  rrsiDatasetInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";
import { buildRrsiDatasetManifest } from "../../src/lib/evolution/rrsi-contracts.js";
import {
  buildRrsiGroupStatisticsPlan,
  verifyRrsiGroupStatisticsPlan,
  analyzeRrsiGroupStatistics,
  computeRrsiBoundedClusterInterval,
  computeRrsiClusterEnvelopeInterval,
} from "../../src/lib/evolution/rrsi-group-statistics.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const analyze = (value, rows = value.rows) =>
  analyzeRrsiGroupStatistics({
    campaign: value.campaign,
    plan: value.plan,
    rows,
  });
const clean = (report) =>
  report.analyses.find(
    (entry) =>
      entry.variant === "clean" && entry.comparisonId === "rrsi-vs-rsi",
  );

describe("RRSI preregistered group statistics", () => {
  it("allocates the frozen family across every contrast, partition and perturbation", () => {
    const input = rrsiCampaignInput();
    input.experiment.bootstrapSamples = 30000;
    const value = rrsiStatisticsFixture({
      stage: "generalization",
      campaignInput: input,
    });
    expect(value.plan).toMatchObject({
      hypothesisCount: 24,
      alphaPerHypothesis: 0.05 / 24,
      bootstrapTailResolutionSufficient: true,
      stoppingRule: "fixed-full-denominator-no-interim-acceptance",
      sourceIndependenceVerified: false,
    });
    expect(value.plan.pools.map((pool) => pool.partition)).toEqual([
      "gate-validation",
      "gate-test",
      "audit",
    ]);
    expect(
      verifyRrsiGroupStatisticsPlan(value.plan, {
        campaign: value.campaign,
        stage: "generalization",
        versions: value.versions,
      }),
    ).toEqual(value.plan);
    const changed = structuredClone(value.plan);
    changed.comparisons.pop();
    expect(() =>
      verifyRrsiGroupStatisticsPlan(changed, {
        campaign: value.campaign,
        stage: "generalization",
        versions: value.versions,
      }),
    ).toThrow(/protocol differs/);
  });

  it("uses task-weighted transitive source components and namespaces", () => {
    const dataset = rrsiDatasetInput();
    const selected = dataset.tasks.filter(
      (task) => task.partition === "select",
    );
    selected[1].groups.template = selected[0].groups.template;
    selected[2].groups.project = selected[1].groups.project;
    // Cross-dimension equality is not a shared source relationship.
    selected[3].groups.principal = selected[4].groups.timeWindow;
    const input = rrsiCampaignInput();
    input.dataset = buildRrsiDatasetManifest(dataset);
    const value = rrsiStatisticsFixture({ campaignInput: input });
    const pool = value.plan.pools[0];
    expect(pool.components).toHaveLength(38);
    const joint = pool.components.find((group) => group.taskCount === 3);
    expect(joint.taskIds).toHaveLength(3);
    expect(joint.weight).toBe(3 / 40);
    expect(
      pool.components.reduce((sum, group) => sum + group.taskCount, 0),
    ).toBe(40);
    const result = clean(analyze(value));
    expect(result.boundedInterval.effectiveGroupCount).toBeCloseTo(
      1 / (9 / 1600 + 37 / 1600),
    );
    expect(result.confidenceInterval.upper).toBe(1);
  });

  it("matches the independent finite-sample bound rather than a zero-variance fiction", () => {
    const result = computeRrsiBoundedClusterInterval({
      values: Array(20).fill(0),
      taskCounts: Array(20).fill(1),
      alpha: 0.025,
    });
    const radius = Math.sqrt((2 * Math.log(80)) / 20);
    expect(result.lower).toBeCloseTo(-radius);
    expect(result.upper).toBeCloseTo(radius);
    expect(result).toMatchObject({
      conditionalOnIndependentBoundedClusters: true,
      independenceVerified: false,
      qualifiesForPromotion: false,
    });
    const allPositive = computeRrsiBoundedClusterInterval({
      values: Array(20).fill(1),
      taskCounts: Array(20).fill(1),
      alpha: 0.025,
    });
    expect(allPositive.mean).toBe(1);
    expect(allPositive.upper).toBe(1);
    expect(allPositive.lower).toBeCloseTo(1 - radius);
  });

  it("retains positive uncertainty for identical outcomes and does not certify lucky seeds", () => {
    const same = rrsiStatisticsFixture({ passed: () => true });
    const comparison = clean(analyze(same));
    expect(comparison.bootstrapInterval).toEqual({ lower: 0, upper: 0 });
    expect(comparison.confidenceInterval.lower).toBeLessThan(0);
    expect(comparison.confidenceInterval.upper).toBeGreaterThan(0);
    const lucky = rrsiStatisticsFixture({
      passed: ({ arm, seed }) => arm === "rrsi" && seed === 11,
    });
    const report = analyze(lucky);
    expect(clean(report).bootstrapInterval.lower).toBeCloseTo(1 / 3);
    expect(clean(report).confidenceInterval.lower).toBeLessThan(0);
    expect(report).toMatchObject({
      resultAuthenticityVerified: false,
      sourceIndependenceVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
    });
  });

  it("uses the identical resampling primitive for analysis and simulation", () => {
    const value = rrsiStatisticsFixture({
      passed: ({ taskId, arm }) =>
        arm === "rrsi" && Number(taskId.split("-").at(-1)) % 2 === 0,
    });
    const pool = value.plan.pools[0];
    const interval = computeRrsiClusterEnvelopeInterval({
      values: pool.components.map(
        (group) =>
          group.taskIds.filter((id) => Number(id.split("-").at(-1)) % 2 === 0)
            .length / group.taskCount,
      ),
      taskCounts: pool.components.map((group) => group.taskCount),
      alpha: value.plan.alphaPerHypothesis,
      bootstrapSamples: value.plan.bootstrapSamples,
      randomnessSeedDigest: rrsiHash(
        "chainlesschain.rrsi-cluster-bootstrap-random/v1",
        {
          randomnessCommitment: value.plan.randomnessCommitment,
          partition: pool.partition,
          components: pool.components.map((group) => ({
            componentDigest: group.componentDigest,
            taskCount: group.taskCount,
          })),
        },
      ),
    });
    const report = clean(analyze(value));
    expect(interval.confidenceInterval).toEqual(report.confidenceInterval);
    expect(interval.bootstrapInterval).toEqual(report.bootstrapInterval);
    expect(interval.boundedInterval).toEqual(report.boundedInterval);
    expect(() =>
      computeRrsiClusterEnvelopeInterval({
        values: [0],
        taskCounts: [1],
        alpha: 0.025,
        bootstrapSamples: 1000,
        randomnessSeedDigest: rrsiFixtureDigest("rng"),
      }),
    ).toThrow(/tail resolution/);
  });

  it("does not gain independent units or narrower intervals from identical seed repetitions", () => {
    const input = rrsiCampaignInput();
    const passed = ({ taskId, arm }) =>
      arm === "rrsi" && Number(taskId.split("-").at(-1)) % 2 === 0;
    const first = rrsiStatisticsFixture({ passed });
    input.experiment.seeds = [11, 22, 33, 44, 55, 66];
    for (const allocation of Object.values(input.budget))
      allocation.maxExecutions *= 2;
    const repeated = rrsiStatisticsFixture({ campaignInput: input, passed });
    const a = clean(analyze(first)),
      b = clean(analyze(repeated));
    expect(b.independentDeclaredGroupCount).toBe(
      a.independentDeclaredGroupCount,
    );
    expect(b.left.plannedSlots).toBe(2 * a.left.plannedSlots);
    expect(b.bootstrapInterval).toEqual(a.bootstrapInterval);
    expect(b.confidenceInterval).toEqual(a.confidenceInterval);
  });

  it("is deterministic under row order and never exposes task results in the report", () => {
    const value = rrsiStatisticsFixture();
    const report = analyze(value);
    expect(analyze(value, [...value.rows].reverse())).toEqual(report);
    expect(JSON.stringify(report)).not.toContain("select-task-0");
    expect(Object.isFrozen(report.analyses[0].confidenceInterval)).toBe(true);
  });

  it.each(["missing", "unknown", "no-receipt", "ungraded"])(
    "retains the entire denominator for %s evidence",
    (mode) => {
      const value = rrsiStatisticsFixture();
      const rows = structuredClone(value.rows);
      const index = rows.findIndex(
        (row) => row.arm === "rrsi" && row.variant === "clean",
      );
      if (mode === "missing") rows.splice(index, 1);
      if (mode === "unknown") {
        rows[index].outcome = "unknown";
        rows[index].passed = null;
      }
      if (mode === "no-receipt") rows[index].resultDigest = null;
      if (mode === "ungraded") rows[index].passed = null;
      const report = analyze(value, rows),
        result = clean(report);
      expect(report.status).toBe("hold");
      expect(result.left).toMatchObject({
        plannedSlots: 120,
        missingSlots: 1,
        strictSuccessSlots: 119,
      });
      expect(result.plannedTaskCount).toBe(40);
      expect(result.independentDeclaredGroupCount).toBe(40);
      expect(result.confidenceInterval).toBe(null);
      expect(
        result.conservativeDifference.upper -
          result.conservativeDifference.lower,
      ).toBeCloseTo(1 / 120);
    },
  );

  it("counts terminal failures and manual repair in the planned denominator, never as original success", () => {
    const value = rrsiStatisticsFixture();
    const rows = structuredClone(value.rows);
    const chosen = rows.filter(
      (row) => row.arm === "rrsi" && row.variant === "clean",
    );
    chosen[0].manualRemediation = true;
    chosen[1].outcome = "failed";
    chosen[1].passed = false;
    const result = clean(analyze(value, rows));
    expect(result.left).toMatchObject({
      plannedSlots: 120,
      declaredTerminalSlots: 120,
      strictSuccessSlots: 118,
      manualRemediationSlots: 1,
      missingSlots: 0,
    });
    expect(result.status).toBe("descriptive-complete");
  });

  it.each([
    "duplicate",
    "reused-receipt",
    "wrong-version",
    "unregistered-seed",
    "wrong-variant",
    "holdout-task",
    "false-success",
  ])("rejects %s instead of changing the frozen family", (mode) => {
    const value = rrsiStatisticsFixture();
    const rows = structuredClone(value.rows);
    if (mode === "duplicate") rows.push({ ...rows[0] });
    if (mode === "reused-receipt") rows[1].resultDigest = rows[0].resultDigest;
    if (mode === "wrong-version")
      rows[0].versionDigest = rrsiFixtureDigest("wrong artifact");
    if (mode === "unregistered-seed") rows[0].seed = 77;
    if (mode === "wrong-variant") rows[0].variant = "new-perturbation";
    if (mode === "holdout-task") rows[0].taskId = "audit-task-0";
    if (mode === "false-success") {
      rows[0].outcome = "unknown";
      rows[0].passed = true;
    }
    expect(() => analyze(value, rows)).toThrow();
  });

  it("holds when adding all confirmatory hypotheses leaves too few bootstrap tail samples", () => {
    const value = rrsiStatisticsFixture({ stage: "generalization" });
    expect(value.plan.bootstrapTailResolutionSufficient).toBe(false);
    const report = analyze(value);
    expect(report.analyses).toHaveLength(24);
    expect(report.status).toBe("hold");
    expect(
      report.analyses.every(
        (entry) =>
          entry.reasons.includes("INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION") &&
          entry.confidenceInterval === null,
      ),
    ).toBe(true);
  });

  it("rejects arithmetic exhaustion and malformed data without invoking accessors", () => {
    const input = rrsiCampaignInput();
    input.experiment.bootstrapSamples = 1_000_000;
    expect(() => rrsiStatisticsFixture({ campaignInput: input })).toThrow(
      /operation limit/,
    );
    const value = rrsiStatisticsFixture();
    const getter = vi.fn(() => value.rows);
    const accessed = { campaign: value.campaign, plan: value.plan };
    Object.defineProperty(accessed, "rows", { get: getter, enumerable: true });
    expect(() => analyzeRrsiGroupStatistics(accessed)).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      buildRrsiGroupStatisticsPlan(
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).toThrow(/plain data/);
    expect(() =>
      computeRrsiBoundedClusterInterval({
        values: [2],
        taskCounts: [1],
        alpha: 0.025,
      }),
    ).toThrow(/range/);
  });
});
