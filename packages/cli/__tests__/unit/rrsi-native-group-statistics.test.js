import { describe, expect, it } from "vitest";
import { rrsiNativeBatchFixture } from "../fixtures/rrsi-native-batch.js";
import {
  rrsiCampaignInput,
  rrsiFixtureDigest as digest,
} from "../fixtures/rrsi-shadow-fixture.js";
import { buildRrsiNativeEvaluationBatch } from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import {
  buildRrsiNativeGroupStatisticsPlan,
  verifyRrsiNativeGroupStatisticsPlan,
  analyzeRrsiNativeGroupStatistics,
  analyzeRrsiNativeBatchGroupStatistics,
} from "../../src/lib/evolution/rrsi-native-group-statistics.js";

// These plain outcomes deliberately carry no live census or signature brand.
function fixture({
  stage = "selection",
  targetCount = 1,
  experiment = {},
  passed = ({ arm }) => arm === "rrsi",
} = {}) {
  const raw = rrsiNativeBatchFixture({
    stage,
    targetCount,
    campaignOverrides: {
      experiment: { ...rrsiCampaignInput().experiment, ...experiment },
    },
  });
  const campaign = raw.planContext.context.campaign;
  const batch = buildRrsiNativeEvaluationBatch(raw);
  const plan = buildRrsiNativeGroupStatisticsPlan({ campaign, batch });
  const childRows = batch.children.map((child) => ({
    childId: child.childId,
    rows: campaign.dataset.tasks
      .filter((task) =>
        Object.hasOwn(
          child.plannedObservationsPerArmByPartition,
          task.partition,
        ),
      )
      .flatMap((task) =>
        campaign.experiment.seeds.flatMap((seed) =>
          Object.keys(child.byArm).map((arm) => ({
            taskId: task.id,
            partition: task.partition,
            seed,
            arm,
            reportedPass: passed({
              taskId: task.id,
              partition: task.partition,
              seed,
              arm,
              pairId: child.pairId,
              slotId: child.slotId,
              variant: child.variant,
            }),
            securityViolations: 0,
            permissionViolations: 0,
            resultDigest: digest(
              `TEST native claim ${child.childId}/${task.id}/${seed}/${arm}`,
            ),
          })),
        ),
      ),
  }));
  return { campaign, batch, plan, childRows };
}
const analyze = (value, childRows = value.childRows) =>
  analyzeRrsiNativeGroupStatistics({
    campaign: value.campaign,
    batch: value.batch,
    plan: value.plan,
    childRows,
  });
const clean = (report, slotId = "target-0", comparisonId = "rrsi-vs-rsi") =>
  report.analyses.find(
    (entry) =>
      entry.variant === "clean" &&
      entry.slotId === slotId &&
      entry.comparisonId === comparisonId,
  );

describe("RRSI native triangle statistics v2", () => {
  it("retains every target stratum in the full family and resampling budget", () => {
    const single = fixture(),
      doubled = fixture({ targetCount: 2 });
    expect(single.plan).toMatchObject({
      hypothesisCount: 8,
      fixedPairReplicasPerTaskSeedArm: 2,
      manualRemediationMeasured: false,
      preObservationRegistrationVerified: false,
    });
    expect(doubled.plan.hypothesisCount).toBe(16);
    expect(doubled.plan.alphaPerHypothesis).toBe(0.05 / 16);
    expect(doubled.plan.resampleOperations).toBe(
      2 * single.plan.resampleOperations,
    );
    expect(doubled.plan.pools).toEqual(single.plan.pools);
    const report = analyze(doubled);
    expect(report).toMatchObject({
      plannedActorObservations: 5760,
      observedRowClaims: 5760,
      missingActorObservations: 0,
      fullTriangleRowsPresent: true,
      decision: "HOLD",
    });
    expect(report.analyses).toHaveLength(16);
    expect(clean(report).independentDeclaredGroupCount).toBe(40);
    expect(clean(report, "target-1").independentDeclaredGroupCount).toBe(40);
    expect(clean(report).reasons).toContain(
      "INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION",
    );
  });

  it("holds the default final protocol with insufficient tail resolution", () => {
    const value = fixture({ stage: "generalization" });
    expect(value.plan).toMatchObject({
      hypothesisCount: 24,
      bootstrapTailReplicates: (10000 * (0.05 / 24)) / 2,
      bootstrapTailResolutionSufficient: false,
    });
    const report = analyze(value);
    expect(report.analyses).toHaveLength(24);
    expect(
      report.analyses.every((entry) => entry.confidenceInterval === null),
    ).toBe(true);
    expect(report.blockingReasons).toContain(
      "INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION",
    );
    expect(report.blockingReasons).toContain(
      "STATISTICAL_PROTOCOL_NOT_PREREGISTERED",
    );
  });

  it("computes the fixed pair-replica mean before seeds and task weights", () => {
    const value = fixture({
      passed: ({ arm, pairId, seed }) =>
        arm === "rrsi" && pairId === "rrsi-vs-rsi" && seed === 11,
    });
    const report = analyze(value),
      entry = clean(report);
    expect(entry.left).toMatchObject({
      plannedActorObservations: 240,
      observedRowClaims: 240,
      knownStrictPasses: 40,
      completeTaskMeans: 40,
    });
    expect(entry.meanDifference).toBeCloseTo(1 / 6);
    expect(entry.confidenceInterval.mean).toBeCloseTo(1 / 6);
    expect(entry.independentDeclaredGroupCount).toBe(40);
    expect(report).toMatchObject({
      status: "descriptive-complete",
      preObservationRegistrationVerified: false,
      resultAuthenticityVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
    });
  });

  it("includes B-A observations in both arm means without inventing an unregistered contrast", () => {
    const value = fixture({
      passed: ({ arm, pairId }) =>
        arm === "rsi" && pairId === "rsi-vs-baseline",
    });
    const report = analyze(value);
    expect(clean(report).meanDifference).toBe(-0.5);
    expect(
      report.analyses.some((entry) => entry.comparisonId === "rsi-vs-baseline"),
    ).toBe(false);
    const registered = fixture({
      experiment: {
        comparisons: ["rrsi-vs-rsi", "rrsi-vs-baseline", "rsi-vs-baseline"],
        bootstrapSamples: 15000,
      },
      passed: ({ arm, pairId }) =>
        arm === "rsi" && pairId === "rsi-vs-baseline",
    });
    const all = analyze(registered);
    expect(all.hypothesisCount).toBe(12);
    expect(clean(all, "target-0", "rsi-vs-baseline").meanDifference).toBe(0.5);
  });

  it("keeps different target effects separate", () => {
    const value = fixture({
      targetCount: 2,
      experiment: { bootstrapSamples: 16000 },
      passed: ({ arm, slotId }) =>
        slotId === "target-0" ? arm === "rrsi" : arm === "rsi",
    });
    const report = analyze(value);
    expect(clean(report, "target-0").meanDifference).toBe(1);
    expect(clean(report, "target-1").meanDifference).toBe(-1);
    expect(clean(report, "target-0").confidenceInterval.mean).toBe(1);
    expect(clean(report, "target-1").confidenceInterval.mean).toBe(-1);
  });

  it("never narrows uncertainty by repeating identical seeds", () => {
    const passed = ({ arm, taskId }) =>
      arm === "rrsi" && Number(taskId.split("-").at(-1)) % 2 === 0;
    const first = analyze(fixture({ passed }));
    const repeated = analyze(
      fixture({ passed, experiment: { seeds: [11, 22, 33, 44, 55, 66] } }),
    );
    expect(clean(repeated).left.plannedActorObservations).toBe(
      2 * clean(first).left.plannedActorObservations,
    );
    expect(clean(repeated).confidenceInterval).toEqual(
      clean(first).confidenceInterval,
    );
    expect(clean(repeated).independentDeclaredGroupCount).toBe(
      clean(first).independentDeclaredGroupCount,
    );
  });

  it("retains missing rows and the entire unobserved batch denominator", () => {
    const value = fixture(),
      chunks = structuredClone(value.childRows);
    const missingChild = value.batch.children.find(
      (child) =>
        child.variant === "clean" && child.pairId === "rsi-vs-baseline",
    );
    const missingChunk = chunks.find(
      (chunk) => chunk.childId === missingChild.childId,
    );
    missingChunk.rows.splice(
      missingChunk.rows.findIndex((row) => row.arm === "rsi"),
      1,
    );
    const report = analyze(value, chunks),
      entry = clean(report);
    expect(report.missingActorObservations).toBe(1);
    expect(report.plannedActorObservations).toBe(2880);
    expect(entry.right.meanStrictPassRate).toBeNull();
    expect(entry.meanDifference).toBeNull();
    expect(entry.confidenceInterval).toBeNull();
    expect(report.blockingReasons).toContain("INCOMPLETE_TRIANGLE_DENOMINATOR");
    const empty = analyze(value, []);
    expect(empty.missingActorObservations).toBe(2880);
    expect(
      empty.analyses.every(
        (row) => row.meanDifference === null && row.confidenceInterval === null,
      ),
    ).toBe(true);
  });

  it("defines strict pass from the signed pass and violation fields and leaves remediation unmeasured", () => {
    const value = fixture(),
      chunks = structuredClone(value.childRows);
    for (const chunk of chunks)
      for (const row of chunk.rows)
        if (row.arm === "rrsi") row.securityViolations = 1;
    const report = analyze(value, chunks),
      entry = clean(report);
    expect(entry.left.knownReportedPasses).toBe(240);
    expect(entry.left.knownStrictPasses).toBe(0);
    expect(entry.meanDifference).toBe(0);
    expect(report.manualRemediationMeasured).toBe(false);
    expect(JSON.stringify(report)).not.toContain("manualRemediationSlots");
  });

  it("is deterministic under child and row reordering and omits private task data", () => {
    const value = fixture(),
      report = analyze(value);
    const reversed = [...value.childRows]
      .reverse()
      .map((chunk) => ({ ...chunk, rows: [...chunk.rows].reverse() }));
    expect(analyze(value, reversed)).toEqual(report);
    expect(JSON.stringify(report)).not.toContain("select-task-0");
    expect(Object.isFrozen(report.analyses[0].confidenceInterval)).toBe(true);
  });

  it("rejects altered plans, copied census tokens and repeated result claims", () => {
    const value = fixture(),
      changed = structuredClone(value.plan);
    changed.targets.pop();
    expect(() => verifyRrsiNativeGroupStatisticsPlan(changed, value)).toThrow(
      /plain own fields/,
    );
    expect(() =>
      verifyRrsiNativeGroupStatisticsPlan(changed, {
        campaign: value.campaign,
        batch: value.batch,
      }),
    ).toThrow(/protocol differs/);
    expect(() =>
      analyzeRrsiNativeBatchGroupStatistics({
        batchEvidence: { authenticated: true },
        plan: value.plan,
      }),
    ).toThrow(/live branded native batch/);
    const chunks = structuredClone(value.childRows);
    chunks[1].rows[0].resultDigest = chunks[0].rows[0].resultDigest;
    expect(() => analyze(value, chunks)).toThrow(/multiple observation slots/);
    expect(() =>
      analyze(value, [value.childRows[0], value.childRows[0]]),
    ).toThrow(/foreign, repeated/);
  });

  it.each(["taskId", "partition", "seed", "arm"])(
    "rejects a substituted %s scope",
    (field) => {
      const value = fixture(),
        chunks = structuredClone(value.childRows);
      chunks[0].rows[0][field] = field === "seed" ? 99 : "foreign";
      expect(() => analyze(value, chunks)).toThrow(/scope/);
    },
  );

  it("rejects accessor and sparse chunk graphs without invoking user code", () => {
    const value = fixture();
    let invoked = false;
    const accessor = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return value.childRows[0];
      },
    });
    expect(() => analyze(value, accessor)).toThrow(/accessors/);
    expect(invoked).toBe(false);
    expect(() => analyze(value, Array(1))).toThrow(/dense list/);
    expect(() => analyze(value, new Proxy([], {}))).toThrow(/dense list/);
  });

  it("preflights the complete target operation budget and the shared kernel maximum", () => {
    expect(() =>
      fixture({
        stage: "generalization",
        targetCount: 2,
        experiment: { bootstrapSamples: 48000 },
      }),
    ).toThrow(/complete native statistical family exceeds/);
    expect(() =>
      fixture({ experiment: { bootstrapSamples: 1000001 } }),
    ).toThrow(/interval kernel bound/);
  });
});
